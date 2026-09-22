/**
 * Turn-by-turn speech synthesis for the seeded meetings.
 *
 * Each turn is synthesised separately with that person's voice, then the clips
 * are concatenated with a natural pause between them. Doing it per turn is what
 * makes the timestamps exact: the start of a transcript line is the sum of the
 * real durations of everything before it, not an estimate from word count. That
 * is the difference between click-to-seek landing on the right sentence and
 * landing near it.
 *
 * Output is mono MP3 so an hour-long meeting is ~28 MB rather than ~170 MB of
 * WAV, which matters on Supabase's free storage tier.
 */
import { Mp3Encoder } from "@breezystack/lamejs";

/**
 * Two pools, so a character is never voiced against the name on their
 * transcript line. Within a pool the order mixes accents (US, GB) to keep
 * two same-pool speakers in one meeting distinguishable.
 */
export const PIPER_VOICES = {
  f: ["en_US-amy-medium", "en_GB-jenny_dioco-medium", "en_US-lessac-medium", "en_US-kristin-medium"],
  m: ["en_US-ryan-high", "en_GB-alan-medium", "en_US-joe-medium", "en_US-kusal-medium"],
};

/**
 * Assign a distinct voice per speaker.
 *
 * Every meeting's roster fits inside the four-plus-four pools, so nobody
 * shares. Names arrive ordered by how much each person talks, which only
 * matters if a meeting ever outgrows the pool -- then the collision lands on
 * the two people you hear least.
 */
export function assignVoices(speakerNamesByProminence, pools) {
  const next = { f: 0, m: 0 };
  const assignment = {};

  for (const name of speakerNamesByProminence) {
    const pool = pools[name] === "m" ? "m" : "f";
    const options = PIPER_VOICES[pool];
    assignment[name] = options[next[pool]++ % options.length];
  }

  return assignment;
}

/** Minimal RIFF/WAVE parser. Returns Int16 PCM plus the format we need. */
export function parseWav(buffer) {
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("not a RIFF/WAVE buffer");
  }

  let offset = 12;
  let sampleRate = 24000;
  let channels = 1;
  let bitsPerSample = 16;
  let data = null;

  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("ascii", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") {
      channels = buffer.readUInt16LE(body + 2);
      sampleRate = buffer.readUInt32LE(body + 4);
      bitsPerSample = buffer.readUInt16LE(body + 14);
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(body + size, buffer.length));
    }

    // Chunks are word-aligned.
    offset = body + size + (size % 2);
  }

  if (!data) throw new Error("no data chunk in WAV");
  if (bitsPerSample !== 16) throw new Error(`expected 16-bit PCM, got ${bitsPerSample}`);

  let samples = new Int16Array(data.buffer, data.byteOffset, Math.floor(data.length / 2));

  // Orpheus returns mono, but fold down defensively rather than producing
  // double-speed audio if that ever changes.
  if (channels === 2) {
    const mono = new Int16Array(Math.floor(samples.length / 2));
    for (let i = 0; i < mono.length; i++) {
      mono[i] = (samples[i * 2] + samples[i * 2 + 1]) / 2;
    }
    samples = mono;
    channels = 1;
  }

  return { samples, sampleRate, channels };
}

export function silence(sampleRate, ms) {
  return new Int16Array(Math.round((sampleRate * ms) / 1000));
}

export function encodeMp3(samples, sampleRate, kbps = 64) {
  const encoder = new Mp3Encoder(1, sampleRate, kbps);
  const chunks = [];
  const BLOCK = 1152;

  for (let i = 0; i < samples.length; i += BLOCK) {
    const block = samples.subarray(i, Math.min(i + BLOCK, samples.length));
    const encoded = encoder.encodeBuffer(block);
    if (encoded.length) chunks.push(Buffer.from(encoded));
  }

  const flushed = encoder.flush();
  if (flushed.length) chunks.push(Buffer.from(flushed));

  return Buffer.concat(chunks);
}
