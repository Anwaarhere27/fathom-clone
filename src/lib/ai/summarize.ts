import { complete, parseJson, TEXT_MODEL } from "./groq";
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

/** ~4 chars per token, and the free tier gives us 8k tokens a minute. */
const CHUNK_CHARS = 9_000;

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
      { temperature: 0.2, maxTokens: 2500 }
    );

    notes.push(text.trim());
    onProgress?.(i + 1, chunks.length);
  }

  return notes.join("\n\n");
}

interface SummaryResponse {
  one_liner: string;
  sections: { heading: string; bullets: { text: string; at?: number | string | null }[] }[];
}

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
          "You write meeting summaries. Output JSON only:\n" +
          '{"one_liner": "...", "sections": [{"heading": "...", "bullets": [{"text": "...", "at": <seconds or null>}]}]}\n\n' +
          "- Use EXACTLY the section headings given. Keep their order. If a section has nothing in it, give it one bullet saying so plainly.\n" +
          '- "at" is the timestamp in SECONDS taken from the [Ns] markers, for the moment the point was made. Use null only when no marker applies.\n' +
          "- Bullets are specific and short. Include the actual numbers and names.\n" +
          "- Never invent anything that is not in the notes.\n" +
          "- one_liner is a single sentence, under 140 characters, that says what actually happened.",
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
    { json: true, temperature: 0.3, maxTokens: 4000 }
  );

  const parsed = parseJson<SummaryResponse>(raw);

  const sections: SummarySection[] = (parsed.sections ?? []).map((section) => ({
    heading: section.heading,
    bullets: (section.bullets ?? [])
      .filter((b) => b && typeof b.text === "string" && b.text.trim())
      .map((b) => {
        const seconds = typeof b.at === "string" ? Number(b.at) : b.at;
        return {
          text: b.text.trim(),
          start_ms:
            typeof seconds === "number" && Number.isFinite(seconds) && seconds >= 0
              ? Math.round(seconds * 1000)
              : null,
        };
      }),
  }));

  return {
    one_liner: (parsed.one_liner ?? "").trim() || null,
    sections,
    model: TEXT_MODEL,
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
    { json: true, temperature: 0.2, maxTokens: 2500 }
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
    { json: true, temperature: 0.4, maxTokens: 1800 }
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
