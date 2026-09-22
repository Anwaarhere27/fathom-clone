#!/usr/bin/env node
/**
 * Downloads Piper (MIT, runs locally on CPU) and the voice models the seeded
 * meetings use.
 *
 * Groq's hosted open TTS is capped at 3,600 tokens per day on the free tier,
 * which works out to about 26 turns. The seed needs 815. Piper has no cap, and
 * being local it also gives us eight distinct voices instead of six, so every
 * participant in the eight-person QBR sounds like a different person.
 *
 *   npm run seed:setup-tts
 *
 * Everything lands in tools/, which is gitignored -- these are large binaries,
 * not source.
 */
import { createWriteStream, existsSync, mkdirSync, statSync } from "node:fs";
import { pipeline } from "node:stream/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

const TOOLS = join(process.cwd(), "tools");
const PIPER_DIR = join(TOOLS, "piper");
const VOICE_DIR = join(TOOLS, "voices");

const PIPER_ZIP =
  "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";

const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/en";

/** One per person in the largest meeting, alternating timbre. */
export const PIPER_VOICES = [
  { id: "en_US-amy-medium", path: "en_US/amy/medium" },
  { id: "en_US-ryan-high", path: "en_US/ryan/high" },
  { id: "en_GB-jenny_dioco-medium", path: "en_GB/jenny_dioco/medium" },
  { id: "en_US-joe-medium", path: "en_US/joe/medium" },
  { id: "en_US-lessac-medium", path: "en_US/lessac/medium" },
  { id: "en_GB-alan-medium", path: "en_GB/alan/medium" },
  { id: "en_US-kristin-medium", path: "en_US/kristin/medium" },
  { id: "en_US-kusal-medium", path: "en_US/kusal/medium" },
];

async function download(url, dest) {
  if (existsSync(dest) && statSync(dest).size > 1024) {
    console.log(`  have ${dest.split(/[\\/]/).pop()}`);
    return;
  }
  process.stdout.write(`  fetching ${dest.split(/[\\/]/).pop()} ... `);
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  await pipeline(res.body, createWriteStream(dest));
  console.log(`${(statSync(dest).size / 1e6).toFixed(1)} MB`);
}

mkdirSync(TOOLS, { recursive: true });
mkdirSync(VOICE_DIR, { recursive: true });

const exe = join(PIPER_DIR, "piper.exe");
if (!existsSync(exe)) {
  console.log("Piper binary:");
  const zip = join(TOOLS, "piper.zip");
  await download(PIPER_ZIP, zip);
  console.log("  extracting ...");
  // Expand-Archive puts the zip's own piper/ folder inside TOOLS.
  execFileSync(
    "powershell.exe",
    ["-NoProfile", "-Command", `Expand-Archive -Path '${zip}' -DestinationPath '${TOOLS}' -Force`],
    { stdio: "inherit" }
  );
  if (!existsSync(exe)) throw new Error(`expected ${exe} after extraction`);
  console.log("  ok");
} else {
  console.log("Piper binary: already installed");
}

console.log("\nVoice models:");
for (const voice of PIPER_VOICES) {
  await download(`${VOICE_BASE}/${voice.path}/${voice.id}.onnx`, join(VOICE_DIR, `${voice.id}.onnx`));
  await download(
    `${VOICE_BASE}/${voice.path}/${voice.id}.onnx.json`,
    join(VOICE_DIR, `${voice.id}.onnx.json`)
  );
}

console.log("\nPiper ready.");
