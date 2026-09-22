import { groq, complete, parseJson, TRANSCRIBE_MODEL } from "./groq";

export interface RawSegment {
  start_ms: number;
  end_ms: number;
  text: string;
}

/** Groq caps a single transcription request at 25 MB. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Transcribe an uploaded recording with Whisper.
 *
 * verbose_json gives per-segment timestamps, which is what makes an uploaded
 * file behave like any other meeting -- click-to-seek and timestamped summary
 * bullets work the same way.
 */
export async function transcribeFile(file: File): Promise<RawSegment[]> {
  const res = (await groq().audio.transcriptions.create({
    file,
    model: TRANSCRIBE_MODEL,
    response_format: "verbose_json",
    language: "en",
  })) as unknown as {
    text?: string;
    segments?: { start: number; end: number; text: string }[];
  };

  const segments = (res.segments ?? [])
    .filter((s) => s.text?.trim())
    .map((s) => ({
      start_ms: Math.round(s.start * 1000),
      end_ms: Math.round(s.end * 1000),
      text: s.text.trim(),
    }));

  // Some inputs come back as one blob with no segmentation.
  if (segments.length === 0 && res.text?.trim()) {
    return [{ start_ms: 0, end_ms: 0, text: res.text.trim() }];
  }

  return segments;
}

/**
 * Whisper transcribes but does not diarize, and no hosted open-weight model
 * offers speaker separation. Rather than labelling every line "Speaker", the
 * model reads the transcript and infers where the speaker changes from the
 * shape of the conversation -- questions answered, names used, turn-taking.
 *
 * This is a guess and the UI says so. It is a good guess on a two-person call
 * and a rough one on a crowded meeting.
 */
export async function inferSpeakers(
  segments: RawSegment[]
): Promise<{ labels: string[]; confident: boolean }> {
  const BATCH = 40;
  const labels: string[] = [];
  let carried: string[] = [];

  try {
    for (let i = 0; i < segments.length; i += BATCH) {
      const batch = segments.slice(i, i + BATCH);

      const raw = await complete(
        [
          {
            role: "system",
            content:
              "You label who is speaking in an automatic transcript that has no speaker information.\n" +
              'Output JSON only: {"speakers": ["<name or label per line, in order>"]}\n\n' +
              "- One entry per numbered line, same order, same count.\n" +
              "- If someone is addressed by name and then replies, use that name.\n" +
              '- Otherwise use "Speaker 1", "Speaker 2" and so on, consistently.\n' +
              "- Consecutive lines are usually the same person. Only change speaker where the conversation clearly turns.\n" +
              "- Reuse the labels already established earlier in the call.",
          },
          {
            role: "user",
            content:
              (carried.length
                ? `Speakers established so far: ${[...new Set(carried)].join(", ")}\n\n`
                : "") +
              batch.map((s, j) => `${j + 1}. ${s.text}`).join("\n"),
          },
        ],
        { json: true, temperature: 0.1, maxTokens: 900 }
      );

      const parsed = parseJson<{ speakers?: string[] }>(raw);
      const got = parsed.speakers ?? [];

      for (let j = 0; j < batch.length; j++) {
        labels.push((got[j] ?? "Speaker 1").toString().trim() || "Speaker 1");
      }
      carried = labels.slice(-20);
    }

    return { labels, confident: true };
  } catch {
    // Attribution is a nice-to-have; a transcript without it still works.
    return { labels: segments.map(() => "Speaker"), confident: false };
  }
}
