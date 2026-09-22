#!/usr/bin/env node
/**
 * Turns each generated transcript into an MP3 plus exact per-turn timings.
 *
 *   npm run seed:audio               # all meetings, resumable
 *   npm run seed:audio -- eng-standup
 *
 * Per-turn clips are cached under seed/audio/<slug>/, so a run that dies
 * part-way through an hour-long meeting picks up where it stopped instead of
 * re-synthesising everything.
 */
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BLUEPRINTS } from "./blueprints.mjs";
import { loadEnv } from "../lib/db.mjs";
import { assignVoices, synthesize, parseWav, silence, encodeMp3 } from "./voices.mjs";

/** Pause between turns. Long enough to hear a handover, short enough to feel live. */
const GAP_MS = 320;

const env = loadEnv();
const GROQ_KEY = env.GROQ_API_KEY;

const args = process.argv.slice(2);
const only = args.filter((a) => !a.startsWith("--"));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function retryDelay(err, attempt) {
  const hint = /try again in ([\d.]+)s/i.exec(err?.message ?? "");
  if (hint) return Math.ceil(parseFloat(hint[1]) * 1000) + 500;
  return Math.min(30000, 1500 * 2 ** attempt);
}

async function clipFor(slug, index, text, voice) {
  const dir = join(process.cwd(), "seed", "audio", slug);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${String(index).padStart(4, "0")}.wav`);

  if (existsSync(path)) return readFileSync(path);

  for (let attempt = 0; ; attempt++) {
    try {
      const wav = await synthesize(GROQ_KEY, text, voice);
      writeFileSync(path, wav);
      return wav;
    } catch (err) {
      if (attempt >= 6) throw err;
      await sleep(retryDelay(err, attempt));
    }
  }
}

async function synthesizeMeeting(bp) {
  const transcriptPath = join(process.cwd(), "seed", "transcripts", `${bp.slug}.json`);
  if (!existsSync(transcriptPath)) {
    console.log(`${bp.slug}: no transcript yet, skipping`);
    return;
  }

  const outDir = join(process.cwd(), "seed", "audio");
  mkdirSync(outDir, { recursive: true });
  const mp3Path = join(outDir, `${bp.slug}.mp3`);
  const timingPath = join(outDir, `${bp.slug}.timings.json`);

  if (existsSync(mp3Path) && existsSync(timingPath) && !args.includes("--force")) {
    console.log(`${bp.slug}: audio already built, skipping`);
    return;
  }

  const { turns } = JSON.parse(readFileSync(transcriptPath, "utf8"));
  const voices = assignVoices(bp.participants.map((p) => p.name));

  const pieces = [];
  const timings = [];
  let sampleRate = 24000;
  let cursorSamples = 0;

  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i];
    const wav = await clipFor(bp.slug, i, turn.text, voices[turn.speaker] ?? "tara");
    const parsed = parseWav(wav);
    sampleRate = parsed.sampleRate;

    const startMs = Math.round((cursorSamples / sampleRate) * 1000);
    pieces.push(parsed.samples);
    cursorSamples += parsed.samples.length;
    const endMs = Math.round((cursorSamples / sampleRate) * 1000);

    const gap = silence(sampleRate, GAP_MS);
    pieces.push(gap);
    cursorSamples += gap.length;

    timings.push({ idx: i, speaker: turn.speaker, text: turn.text, start_ms: startMs, end_ms: endMs });

    if ((i + 1) % 25 === 0 || i === turns.length - 1) {
      const mins = (cursorSamples / sampleRate / 60).toFixed(1);
      console.log(`${bp.slug}: ${i + 1}/${turns.length} turns (${mins} min of audio)`);
    }
  }

  const combined = new Int16Array(cursorSamples);
  let offset = 0;
  for (const piece of pieces) {
    combined.set(piece, offset);
    offset += piece.length;
  }

  console.log(`${bp.slug}: encoding mp3...`);
  const mp3 = encodeMp3(combined, sampleRate);
  writeFileSync(mp3Path, mp3);

  const durationMs = Math.round((cursorSamples / sampleRate) * 1000);
  writeFileSync(
    timingPath,
    JSON.stringify({ slug: bp.slug, duration_ms: durationMs, sample_rate: sampleRate, turns: timings }, null, 2)
  );

  console.log(
    `${bp.slug}: done — ${(durationMs / 60000).toFixed(1)} min, ${(mp3.length / 1e6).toFixed(1)} MB\n`
  );
}

const targets = only.length ? BLUEPRINTS.filter((b) => only.includes(b.slug)) : BLUEPRINTS;
for (const bp of targets) await synthesizeMeeting(bp);
console.log("Audio built.");
