#!/usr/bin/env node
/**
 * Expands each blueprint into a full transcript, one beat at a time.
 *
 * Beat-at-a-time rather than whole-meeting-at-once for two reasons: a 58 minute
 * call is roughly 8,500 words, which is past the point where a single
 * completion stays coherent; and feeding back the tail of what was already said
 * keeps names, numbers and grievances consistent across the call.
 *
 *   npm run seed:generate            # all meetings, skips ones already done
 *   npm run seed:generate -- helix-qbr --force
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import Groq from "groq-sdk";
import { BLUEPRINTS, OWNER } from "./blueprints.mjs";
import { loadEnv } from "../lib/db.mjs";

// Open-weight (Apache 2.0), and the strongest thing Groq currently serves.
const MODEL = "openai/gpt-oss-120b";
const WORDS_PER_MINUTE = 150;
const OUT_DIR = join(process.cwd(), "seed", "transcripts");

const env = loadEnv();
const groq = new Groq({ apiKey: env.GROQ_API_KEY });

/**
 * Groq's free tier allows 8,000 tokens per minute and a beat costs roughly
 * 3,000, so every request in this script goes through one queue. Concurrency
 * would only convert into 429s.
 */
let chain = Promise.resolve();
function serialize(fn) {
  const result = chain.then(fn, fn);
  chain = result.then(
    () => {},
    () => {}
  );
  return result;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Groq tells us exactly how long to wait; use it instead of guessing. */
function retryDelay(err, attempt) {
  const hint = /try again in ([\d.]+)s/i.exec(err?.message ?? "");
  if (hint) return Math.ceil(parseFloat(hint[1]) * 1000) + 750;
  return Math.min(30000, 2000 * 2 ** attempt);
}

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));

const SYSTEM = `You write transcripts of real business meetings for a meeting-recording product's demo data.

Rules:
- Output ONLY a JSON object: {"turns": [{"speaker": "<exact name>", "text": "<what they said>"}, ...]}
- Speaker names must match the roster exactly.
- A turn is ONE uninterrupted thing one person says, then someone else speaks. Real meetings are made of many short turns, not a few speeches. Hit the turn count you are given.
- Write how people actually talk: contractions, false starts, "yeah", "I mean", trailing off, someone cutting in. Not every turn, but enough that it does not read like a press release.
- Vary turn length hard. Some turns are three words. Some run two hundred. Do not alternate evenly between speakers.
- Be specific. Real numbers, real dates, real product names, real names of things that broke. Vagueness is the failure mode.
- Keep facts consistent with what has already been said earlier in the call.
- No stage directions, no [laughs], no timestamps, no speaker labels inside the text field.
- Do not wrap up the meeting unless the beat says to. Each beat is a slice of a longer conversation.`;

/**
 * The model likes non-breaking hyphens, narrow spaces and smart quotes. They
 * look fine but a TTS engine reads them wrong, and the transcript has to match
 * the audio word for word. Curly apostrophes are kept -- those read correctly.
 */
function normalize(text) {
  return text
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/[    ]/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/\s+([%,.;:!?])/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function rosterBlock(bp) {
  return bp.participants
    .map((p) => `- ${p.name} — ${p.role}, ${p.company}${p.host ? " (host)" : ""}`)
    .join("\n");
}

function extractTurns(raw) {
  const text = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();

  const slice = (open, close) => {
    const start = text.indexOf(open);
    const end = text.lastIndexOf(close);
    return start === -1 || end === -1 ? null : text.slice(start, end + 1);
  };

  const obj = slice("{", "}");
  if (obj) {
    try {
      const parsed = JSON.parse(obj);
      if (Array.isArray(parsed.turns)) return parsed.turns;
      if (parsed.speaker && parsed.text) return [parsed];
    } catch {
      /* fall through to the array and line-wise attempts */
    }
  }

  const arr = slice("[", "]");
  if (arr) {
    try {
      return JSON.parse(arr);
    } catch {
      /* fall through */
    }
  }

  // Last resort: the model sometimes emits bare objects one per line.
  const lines = text
    .split("\n")
    .map((l) => l.trim().replace(/,$/, ""))
    .filter((l) => l.startsWith("{") && l.endsWith("}"));
  const parsed = lines.flatMap((l) => {
    try {
      return [JSON.parse(l)];
    } catch {
      return [];
    }
  });
  if (parsed.length) return parsed;

  throw new Error(`no turns in model output: ${text.slice(0, 160)}`);
}

async function generateBeat(bp, beat, index, priorTurns, wordBudget, turnBudget) {
  const tail = priorTurns
    .slice(-14)
    .map((t) => `${t.speaker}: ${t.text}`)
    .join("\n");

  const user = `MEETING: ${bp.title}
PLATFORM: ${bp.platform}
RECORDED FOR: ${OWNER.name}, ${OWNER.role} at ${OWNER.company}

ROSTER:
${rosterBlock(bp)}

CONTEXT:
${bp.context}

FULL AGENDA (for your awareness — you are writing only the beat named below):
${bp.beats.map((b, i) => `${i + 1}. ${b}${i === index ? "   <-- WRITE THIS ONE" : ""}`).join("\n")}

${tail ? `THE CONVERSATION SO FAR (last turns, continue naturally from here):\n${tail}\n` : "This is the very start of the call.\n"}
WRITE BEAT ${index + 1}: ${beat}

Length: roughly ${wordBudget} words, split across AT LEAST ${turnBudget} separate turns. Vary them — some one-liners, some long. Output the JSON object only.`;

  const res = await serialize(() =>
    groq.chat.completions.create({
      model: MODEL,
      temperature: 0.85,
      max_completion_tokens: 8000,
      // gpt-oss reasons before answering; dialogue does not need much of it and
      // the tokens come out of the same budget as the transcript.
      reasoning_effort: "low",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM },
        { role: "user", content: user },
      ],
    })
  );

  const turns = extractTurns(res.choices[0].message.content);
  const names = new Set(bp.participants.map((p) => p.name));
  return turns
    .filter((t) => t && typeof t.text === "string" && t.text.trim())
    .map((t) => ({ ...t, text: normalize(t.text) }))
    .map((t) => ({
      // The model occasionally drifts to a first name or a role; snap it back.
      speaker: names.has(t.speaker)
        ? t.speaker
        : bp.participants.find((p) => p.name.split(" ")[0] === String(t.speaker).split(" ")[0])?.name ??
          bp.participants[0].name,
      text: t.text.trim(),
    }));
}

async function generateMeeting(bp) {
  const out = join(OUT_DIR, `${bp.slug}.json`);
  if (existsSync(out) && !force) {
    const existing = JSON.parse(readFileSync(out, "utf8"));
    console.log(`${bp.slug}: already generated (${existing.turns.length} turns), skipping`);
    return;
  }

  const totalWords = bp.targetMinutes * WORDS_PER_MINUTE;
  const perBeat = Math.round(totalWords / bp.beats.length);
  // Standups are rapid-fire; a QBR has longer speeches. Shorter average turns
  // for the small meetings keeps the transcript from reading as monologues.
  const avgTurnWords = bp.participants.length <= 2 ? 55 : bp.targetMinutes < 20 ? 30 : 45;
  const turnsPerBeat = Math.max(4, Math.round(perBeat / avgTurnWords));
  const turns = [];

  for (let i = 0; i < bp.beats.length; i++) {
    let attempt = 0;
    for (;;) {
      try {
        const beatTurns = await generateBeat(bp, bp.beats[i], i, turns, perBeat, turnsPerBeat);
        turns.push(...beatTurns);
        const words = turns.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
        console.log(
          `${bp.slug}: beat ${i + 1}/${bp.beats.length} -> +${beatTurns.length} turns (${words} words total)`
        );
        break;
      } catch (err) {
        if (++attempt >= 8) throw new Error(`${bp.slug} beat ${i + 1}: ${err.message}`);
        const wait = retryDelay(err, attempt);
        console.log(
          `${bp.slug}: beat ${i + 1} retry ${attempt} in ${wait}ms (${err.message.slice(0, 70)})`
        );
        await sleep(wait);
      }
    }
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(out, JSON.stringify({ slug: bp.slug, title: bp.title, turns }, null, 2));
  const words = turns.reduce((n, t) => n + t.text.split(/\s+/).length, 0);
  console.log(
    `${bp.slug}: done — ${turns.length} turns, ${words} words, ~${Math.round(words / WORDS_PER_MINUTE)} min\n`
  );
}

const targets = only.length ? BLUEPRINTS.filter((b) => only.includes(b.slug)) : BLUEPRINTS;
if (!targets.length) {
  console.error(`No blueprint matched. Known: ${BLUEPRINTS.map((b) => b.slug).join(", ")}`);
  process.exit(1);
}

// One at a time. Every request shares a single 8,000 TPM budget, so running
// meetings concurrently just moves the waiting into the retry loop.
for (const bp of targets) await generateMeeting(bp);
console.log("All transcripts generated.");
