import { complete, parseJson, textModel } from "./groq";
import type { SummarySection, SummaryTemplate } from "../types";

export interface TranscriptLine {
  speaker_name: string;
  start_ms: number;
  text: string;
}

/**
 * Shape of each template's output. The headings are fixed rather than left to
 * the model so that switching template visibly reorganises the same call
 * instead of producing a differently-worded version of the same thing.
 */
const TEMPLATES: Record<SummaryTemplate, { label: string; sections: string[]; guidance: string }> = {
  general: {
    label: "General",
    sections: ["What this was about", "Key points", "Decisions", "Open questions"],
    guidance: "A neutral record for someone who missed the call and has two minutes.",
  },
  sales_discovery: {
    label: "Sales discovery",
    sections: [
      "Company and context",
      "Pain and current state",
      "Requirements and constraints",
      "Objections raised",
      "Budget, timeline and process",
      "Next steps",
    ],
    guidance:
      "Written for the rep's own pipeline review. Be blunt about what is unresolved and where the deal is weak.",
  },
  customer_interview: {
    label: "Customer interview",
    sections: [
      "Who we spoke to",
      "How they use the product today",
      "What is working",
      "What is not working",
      "Signals worth acting on",
    ],
    guidance:
      "Written for a product team. Prefer the customer's own words. Offhand remarks are often the most useful finding -- surface them.",
  },
  standup: {
    label: "Standup",
    sections: ["Progress", "Blockers", "Decisions", "Who owes what"],
    guidance: "Terse. Bullets, not sentences. Name people.",
  },
  all_hands: {
    label: "All-hands",
    sections: [
      "Headline numbers",
      "What went well",
      "What went badly",
      "Priorities ahead",
      "Questions from the team",
    ],
    guidance:
      "Written for someone who could not attend. Keep every specific number that was said.",
  },
};

export const TEMPLATE_IDS = Object.keys(TEMPLATES) as SummaryTemplate[];

/**
 * ~4 chars per token against an 8,000-tokens-per-minute ceiling that counts
 * input AND the reserved output together. Every request has to fit under it, so
 * the transcript is chunked to CHUNK_CHARS and the combined notes are squeezed
 * back under MAX_NOTES_CHARS before any template pass runs.
 */
const CHUNK_CHARS = 9_000;
const MAX_NOTES_CHARS = 8_000;
/** Input window for a reduction pass, leaving room for the reply. */
const WINDOW_CHARS = 7_000;

function formatLines(lines: TranscriptLine[]) {
  return lines.map((l) => `[${Math.round(l.start_ms / 1000)}s] ${l.speaker_name}: ${l.text}`).join("\n");
}

function chunk(lines: TranscriptLine[]) {
  const chunks: TranscriptLine[][] = [];
  let current: TranscriptLine[] = [];
  let size = 0;

  for (const line of lines) {
    const cost = line.text.length + line.speaker_name.length + 12;
    if (size + cost > CHUNK_CHARS && current.length) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Condense a long call into notes that later passes can work from.
 *
 * The 59-minute QBR is ~12k tokens of transcript, well past the free tier's
 * per-minute budget, so it cannot go into one request. Each chunk is reduced to
 * dense notes that keep numbers, names and the second something was said; the
 * template passes then run over the notes instead of the raw transcript.
 */
export async function buildNotes(lines: TranscriptLine[], onProgress?: (done: number, total: number) => void) {
  const chunks = chunk(lines);
  const notes: string[] = [];

  for (let i = 0; i < chunks.length; i++) {
    const text = await complete(
      [
        {
          role: "system",
          content:
            "You condense meeting transcripts into dense notes for later summarisation.\n" +
            "- Keep every number, name, date, product name and commitment.\n" +
            "- Keep the [Ns] timestamp that each point came from.\n" +
            "- Note disagreements and unresolved threads explicitly; they matter more than agreement.\n" +
            "- No preamble. Bullets only.",
        },
        {
          role: "user",
          content: `Part ${i + 1} of ${chunks.length} of a meeting transcript.\n\n${formatLines(chunks[i])}`,
        },
      ],
      // Hard cap per chunk: four chunks at 2,500 tokens each produces notes too
      // big to send back in a single later request.
      { temperature: 0.2, maxTokens: 700 }
    );

    notes.push(text.trim());
    onProgress?.(i + 1, chunks.length);
  }

  return reduceNotes(notes.join("\n\n"));
}

/**
 * A 55-minute call condenses to notes that are themselves too big to send
 * alongside a summary request. One more pass merges the per-chunk notes into a
 * single account of the meeting that fits in a request.
 */
async function reduceNotes(notes: string): Promise<string> {
  let current = notes;

  // Reduce in windows, repeatedly, until it fits. A single merge request over
  // long notes is itself too large to send, which is the trap here: the fix for
  // "too big" cannot be one more big request.
  for (let round = 0; current.length > MAX_NOTES_CHARS && round < 3; round++) {
    const windows = splitLines(current, WINDOW_CHARS);
    const merged: string[] = [];

    for (const window of windows) {
      const reduced = await complete(
        [
          {
            role: "system",
            content:
              "You tighten meeting notes without losing content.\n" +
              "- Keep every number, name, date, commitment and [Ns] timestamp.\n" +
              "- Merge points that repeat; keep the earliest timestamp.\n" +
              "- Keep disagreements and unresolved threads. Drop pleasantries and scheduling chatter.\n" +
              "- Bullets only, one line each. No preamble, no headings.",
          },
          { role: "user", content: window },
        ],
        { temperature: 0.2, maxTokens: 700 }
      );

      const trimmed = reduced.trim();
      // An implausibly short reply means the model discarded the content;
      // keeping the original window is the safer failure.
      merged.push(trimmed.length < 120 ? window : trimmed);
    }

    const next = merged.join("\n");
    // No progress means another round will not help either.
    if (next.length >= current.length) return next.slice(0, MAX_NOTES_CHARS);
    current = next;
  }

  return current.length <= MAX_NOTES_CHARS ? current : current.slice(0, MAX_NOTES_CHARS);
}

/** Splits on line boundaries so a bullet is never cut in half. */
function splitLines(text: string, budget: number) {
  const windows: string[] = [];
  let current = "";

  for (const line of text.split("\n")) {
    if (current && current.length + line.length + 1 > budget) {
      windows.push(current);
      current = "";
    }
    current += (current ? "\n" : "") + line;
  }
  if (current) windows.push(current);
  return windows;
}

/**
 * Deliberately flat.
 *
 * Asking for sections-containing-bullets makes the model emit nested arrays it
 * routinely fails to balance, and JSON mode then rejects a whole generation
 * over one stray bracket. A single list with a section label per bullet is
 * something it gets right every time; grouping is trivial here.
 */
interface SummaryResponse {
  one_liner: string;
  bullets: { section: string; text: string; at?: number | string | null }[];
}

const MIN_BULLETS_PER_SECTION = 3;
const MAX_BULLETS_PER_SECTION = 6;

export async function summarizeToTemplate(
  notes: string,
  template: SummaryTemplate,
  meta: { title: string; participants: string[]; durationMinutes: number }
): Promise<{ one_liner: string | null; sections: SummarySection[]; model: string }> {
  const spec = TEMPLATES[template];

  const raw = await complete(
    [
      {
        role: "system",
        content:
          "You write meeting summaries. Output JSON only, in exactly this shape:\n" +
          '{"one_liner": "...", "bullets": [{"section": "<one of the given headings>", "text": "...", "at": <seconds or null>}]}\n\n' +
          '- Every bullet names its "section", copied EXACTLY from the headings given. Do not invent headings.\n' +
          "- Order the bullets so sections appear in the order given.\n" +
          `- ${MIN_BULLETS_PER_SECTION} to ${MAX_BULLETS_PER_SECTION} bullets per section. Fewer than ${MIN_BULLETS_PER_SECTION} is too thin to be useful; more than ${MAX_BULLETS_PER_SECTION} is a transcript, not a summary.\n` +
          "- Only if the call genuinely covered nothing for a section, give it one bullet saying so plainly.\n" +
          '- "at" is the timestamp in SECONDS from the [Ns] markers, for the moment the point was made. null when no marker applies.\n' +
          "- Bullets are specific and short. Keep the actual numbers and names.\n" +
          "- Never invent anything that is not in the notes.\n" +
          "- one_liner is one sentence, under 140 characters, saying what actually happened.",
      },
      {
        role: "user",
        content: `MEETING: ${meta.title}
PARTICIPANTS: ${meta.participants.join(", ")}
LENGTH: ${meta.durationMinutes} minutes

TEMPLATE: ${spec.label}
TONE: ${spec.guidance}
SECTIONS (use exactly these headings, in this order):
${spec.sections.map((s) => `- ${s}`).join("\n")}

NOTES FROM THE CALL:
${notes}`,
      },
    ],
    { json: true, temperature: 0.3, maxTokens: 1800 }
  );

  const parsed = parseJson<SummaryResponse>(raw);

  // Group into the fixed headings. Anything the model labelled with a heading
  // we did not ask for is dropped rather than shown as a stray section.
  const grouped = new Map<string, SummarySection["bullets"]>(spec.sections.map((h) => [h, []]));

  for (const bullet of parsed.bullets ?? []) {
    if (!bullet || typeof bullet.text !== "string" || !bullet.text.trim()) continue;

    const heading = spec.sections.find(
      (h) => h.toLowerCase() === String(bullet.section ?? "").trim().toLowerCase()
    );
    if (!heading) continue;

    const target = grouped.get(heading)!;
    if (target.length >= MAX_BULLETS_PER_SECTION) continue;

    const seconds = typeof bullet.at === "string" ? Number(bullet.at) : bullet.at;
    target.push({
      text: bullet.text.trim(),
      start_ms:
        typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
          ? Math.round(seconds * 1000)
          : null,
    });
  }

  const sections: SummarySection[] = spec.sections
    .map((heading) => ({ heading, bullets: grouped.get(heading)! }))
    .filter((section) => section.bullets.length > 0);

  return {
    one_liner: (parsed.one_liner ?? "").trim() || null,
    sections,
    model: textModel(),
  };
}

export interface ExtractedActionItem {
  text: string;
  owner_name: string | null;
  due_hint: string | null;
  start_ms: number | null;
}

export async function extractActionItems(
  notes: string,
  participants: string[]
): Promise<ExtractedActionItem[]> {
  const raw = await complete(
    [
      {
        role: "system",
        content:
          "You pull action items out of meeting notes. Output JSON only:\n" +
          '{"items": [{"text": "...", "owner": "<exact participant name or null>", "due": "<phrase said on the call, or null>", "at": <seconds or null>}]}\n\n' +
          "- Only things someone actually committed to. Not topics discussed, not ideas floated.\n" +
          "- The owner is who agreed to do it, named exactly as in the participant list. Null if nobody took it.\n" +
          '- "due" is only what was said out loud, e.g. "by Tuesday", "end of quarter". Never invent a date.\n' +
          "- Start each item with a verb.\n" +
          "- Between zero and twelve items. Zero is a valid answer.",
      },
      {
        role: "user",
        content: `PARTICIPANTS: ${participants.join(", ")}\n\nNOTES:\n${notes}`,
      },
    ],
    { json: true, temperature: 0.2, maxTokens: 1200 }
  );

  const parsed = parseJson<{
    items: { text: string; owner?: string | null; due?: string | null; at?: number | string | null }[];
  }>(raw);

  const known = new Set(participants);

  return (parsed.items ?? [])
    .filter((i) => i && typeof i.text === "string" && i.text.trim())
    .map((i) => {
      const seconds = typeof i.at === "string" ? Number(i.at) : i.at;
      return {
        text: i.text.trim(),
        owner_name: i.owner && known.has(i.owner) ? i.owner : null,
        due_hint: i.due?.trim() || null,
        start_ms:
          typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
            ? Math.round(seconds * 1000)
            : null,
      };
    });
}

export async function draftFollowUpEmail(
  notes: string,
  meta: { title: string; sender: string; participants: string[] }
): Promise<{ subject: string; body: string }> {
  const raw = await complete(
    [
      {
        role: "system",
        content:
          'You draft follow-up emails after meetings. Output JSON only: {"subject": "...", "body": "..."}\n\n' +
          "- Written by the sender, to the people who were on the call.\n" +
          "- Short. Thanks, what was agreed, what each side owes, and one clear next step.\n" +
          "- Plain text with line breaks. No markdown, no bullet characters other than a leading dash.\n" +
          "- Never invent a commitment that is not in the notes.\n" +
          "- No placeholder brackets. If something is unknown, leave it out.",
      },
      {
        role: "user",
        content: `MEETING: ${meta.title}\nFROM: ${meta.sender}\nTO: ${meta.participants.join(", ")}\n\nNOTES:\n${notes}`,
      },
    ],
    { json: true, temperature: 0.4, maxTokens: 1000 }
  );

  const parsed = parseJson<{ subject?: string; body?: string }>(raw);
  return {
    subject: parsed.subject?.trim() || `Follow-up: ${meta.title}`,
    body: parsed.body?.trim() || "",
  };
}

/** Which template a meeting opens on, inferred from its title. */
export function defaultTemplateFor(title: string): SummaryTemplate {
  const t = title.toLowerCase();
  if (t.includes("standup") || t.includes("stand-up")) return "standup";
  if (t.includes("all-hands") || t.includes("all hands")) return "all_hands";
  if (t.includes("interview")) return "customer_interview";
  if (t.includes("discovery")) return "sales_discovery";
  return "general";
}

export { TEMPLATES };
