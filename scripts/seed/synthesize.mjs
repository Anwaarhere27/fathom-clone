#!/usr/bin/env node
/**
 * Turns each generated transcript into an MP3 plus exact per-turn timings.
 *
 *   npm run seed:setup-tts     # once, downloads Piper + voice models
 *   npm run seed:audio         # all meetings, resumable
 *   npm run seed:audio -- eng-standup --force
 *
 * Each turn is synthesised separately, then the clips are concatenated with a
 * short pause. Per-turn synthesis is what makes timestamps exact: a line's
 * start is the sum of the real durations before it, not an estimate from word
 * count. Estimates drift, and by the fifty-minute mark of the QBR they would be
 * tens of seconds out -- click-to-seek would land in the wrong conversation.
 *
 * Piper is invoked once per voice with all of that speaker's lines piped in as
 * JSONL, rather than once per line, because process startup dominates the cost
 * of a short utterance.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BLUEPRINTS, VOICE_POOL } from "./blueprints.mjs";
import { assignVoices, parseWav, silence, encodeMp3 } from "./voices.mjs";

/** Pause between turns. Long enough to hear a handover, short enough to feel live. */
const GAP_MS = 300;

const PIPER = join(process.cwd(), "tools", "piper", "piper.exe");
const VOICE_DIR = join(process.cwd(), "tools", "voices");

const args = process.argv.slice(2);
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("--"));

if (!existsSync(PIPER)) {
  console.error("Piper is not installed. Run: npm run seed:setup-tts");
  process.exit(1);
}

/** Runs one Piper process for one voice over many lines. */
function synthesizeVoice(voiceId, jobs, label) {
  return new Promise((resolve, reject) => {
    if (jobs.length === 0) return resolve();

    const child = spawn(
      PIPER,
      ["-m", join(VOICE_DIR, `${voiceId}.onnx`), "--json-input", "--quiet"],
      { stdio: ["pipe", "ignore", "pipe"] }
    );

    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) return reject(new Error(`piper ${voiceId} exited ${code}: ${stderr.slice(-400)}`));
      const missing = jobs.filter((j) => !existsSync(j.output_file));
      if (missing.length) {
        return reject(new Error(`piper ${voiceId} produced no audio for ${missing.length} line(s)`));
      }
      console.log(`  ${label}: ${voiceId} -> ${jobs.length} clips`);
      resolve();
    });

    for (const job of jobs) {
      child.stdin.write(`${JSON.stringify({ text: job.text, output_file: job.output_file })}\n`);
    }
    child.stdin.end();
  });
}

async function synthesizeMeeting(bp) {
  const transcriptPath = join(process.cwd(), "seed", "transcripts", `${bp.slug}.json`);
  if (!existsSync(transcriptPath)) {
    console.log(`${bp.slug}: no transcript yet, skipping`);
    return;
  }

  const outDir = join(process.cwd(), "seed", "audio");
  const clipDir = join(outDir, bp.slug);
  mkdirSync(clipDir, { recursive: true });

  const mp3Path = join(outDir, `${bp.slug}.mp3`);
  const timingPath = join(outDir, `${bp.slug}.timings.json`);

  if (existsSync(mp3Path) && existsSync(timingPath) && !force) {
    console.log(`${bp.slug}: audio already built, skipping`);
    return;
  }

  const { turns } = JSON.parse(readFileSync(transcriptPath, "utf8"));

  // Order speakers by how much they talk. With eight voices for at most eight
  // people this changes nothing today, but it degrades sensibly if a meeting
  // ever has more participants than there are voices.
  const spoken = new Map();
  for (const t of turns) {
    spoken.set(t.speaker, (spoken.get(t.speaker) ?? 0) + t.text.split(/\s+/).length);
  }
  const byProminence = bp.participants
    .map((p) => p.name)
    .sort((a, b) => (spoken.get(b) ?? 0) - (spoken.get(a) ?? 0));
  const voices = assignVoices(byProminence, VOICE_POOL);

  console.log(`${bp.slug}: ${turns.length} turns`);
  console.log(`  voices — ${byProminence.map((n) => `${n.split(" ")[0]}=${voices[n]}`).join(", ")}`);

  // Group the outstanding work by voice so each model loads once.
  const jobsByVoice = new Map();
  const clipPaths = [];

  turns.forEach((turn, i) => {
    const file = join(clipDir, `${String(i).padStart(4, "0")}.wav`);
    clipPaths.push(file);
    if (existsSync(file) && !force) return;

    const voiceId = voices[turn.speaker];
    const bucket = jobsByVoice.get(voiceId) ?? [];
    bucket.push({ text: turn.text, output_file: file });
    jobsByVoice.set(voiceId, bucket);
  });

  const outstanding = [...jobsByVoice.values()].reduce((n, j) => n + j.length, 0);
  if (outstanding === 0) {
    console.log("  all clips cached");
  } else {
    console.log(`  synthesising ${outstanding} clips across ${jobsByVoice.size} voices...`);
    // One process per voice, all at once. Piper is single-threaded per process,
    // so this is what actually uses the machine.
    await Promise.all(
      [...jobsByVoice].map(([voiceId, jobs]) => synthesizeVoice(voiceId, jobs, bp.slug))
    );
  }

  // Stitch, measuring as we go.
  const pieces = [];
  const timings = [];
  let sampleRate = null;
  let cursor = 0;

  for (let i = 0; i < turns.length; i++) {
    const parsed = parseWav(readFileSync(clipPaths[i]));
    if (sampleRate === null) sampleRate = parsed.sampleRate;
    if (parsed.sampleRate !== sampleRate) {
      throw new Error(
        `sample rate mismatch at turn ${i}: ${parsed.sampleRate} vs ${sampleRate}. ` +
          `Mixing voice models of different rates would need resampling.`
      );
    }

    const startMs = Math.round((cursor / sampleRate) * 1000);
    pieces.push(parsed.samples);
    cursor += parsed.samples.length;
    const endMs = Math.round((cursor / sampleRate) * 1000);

    const gap = silence(sampleRate, GAP_MS);
    pieces.push(gap);
    cursor += gap.length;

    timings.push({
      idx: i,
      speaker: turns[i].speaker,
      text: turns[i].text,
      start_ms: startMs,
      end_ms: endMs,
    });
  }

  const combined = new Int16Array(cursor);
  let offset = 0;
  for (const piece of pieces) {
    combined.set(piece, offset);
    offset += piece.length;
  }

  process.stdout.write("  encoding mp3 ... ");
  const mp3 = encodeMp3(combined, sampleRate);
  writeFileSync(mp3Path, mp3);

  const durationMs = Math.round((cursor / sampleRate) * 1000);
  writeFileSync(
    timingPath,
    JSON.stringify(
      { slug: bp.slug, duration_ms: durationMs, sample_rate: sampleRate, turns: timings },
      null,
      2
    )
  );

  console.log(
    `done\n${bp.slug}: ${(durationMs / 60000).toFixed(1)} min, ${(mp3.length / 1e6).toFixed(1)} MB\n`
  );
}


const targets = only.length ? BLUEPRINTS.filter((b) => only.includes(b.slug)) : BLUEPRINTS;
if (!targets.length) {
  console.error(`No blueprint matched. Known: ${BLUEPRINTS.map((b) => b.slug).join(", ")}`);
  process.exit(1);
}

for (const bp of targets) await synthesizeMeeting(bp);

// A stray clip left over from an earlier --force run would silently shift every
// timestamp after it, so check the caches match the transcripts.
for (const bp of targets) {
  const dir = join(process.cwd(), "seed", "audio", bp.slug);
  if (!existsSync(dir)) continue;
  const clips = readdirSync(dir).filter((f) => f.endsWith(".wav")).length;
  const path = join(process.cwd(), "seed", "transcripts", `${bp.slug}.json`);
  if (!existsSync(path)) continue;
  const expected = JSON.parse(readFileSync(path, "utf8")).turns.length;
  if (clips !== expected) console.warn(`WARNING ${bp.slug}: ${clips} clips for ${expected} turns`);
}

console.log("Audio built.");
