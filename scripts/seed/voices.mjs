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

export const ORPHEUS_VOICES = ["tara", "leah", "jess", "leo", "dan", "mia", "zac", "zoe"];

/**
 * Assign a voice per speaker for one meeting. Only eight voices exist, so the
 * constraint that matters is that no two people in the SAME meeting share one.
 */
export function assignVoices(speakerNames) {
  const assignment = {};
  speakerNames.forEach((name, i) => {
    assignment[name] = ORPHEUS_VOICES[i % ORPHEUS_VOICES.length];
  });
  return assignment;
}

export async function synthesize(groqKey, text, voice) {
  const res = await fetch("https://api.groq.com/openai/v1/audio/speech", {
    method: "POST",
    headers: { Authorization: `Bearer ${groqKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "canopylabs/orpheus-v1-english",
      voice,
      input: text,
      response_format: "wav",
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`TTS ${res.status}: ${body.slice(0, 300)}`);
    err.status = res.status;
    throw err;
  }

  return Buffer.from(await res.arrayBuffer());
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
