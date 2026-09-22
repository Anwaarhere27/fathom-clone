import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { complete, parseJson, TEXT_MODEL } from "@/lib/ai/groq";

export const maxDuration = 60;

interface Citation {
  meeting_id: string;
  meeting_title: string;
  start_ms: number;
  speaker_name: string;
  quote: string;
}

/**
 * Ask a question across every meeting you own.
 *
 * Retrieval is Postgres full-text over the transcripts rather than a vector
 * store: the corpus is one person's meetings, the queries are about things that
 * were literally said, and keeping it in the database means no embedding
 * pipeline to keep in sync. The model only ever sees retrieved lines, so it
 * cannot answer from outside the user's own recordings.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const { question, meetingId } = (await request.json()) as {
    question?: string;
    meetingId?: string | null;
  };

  if (!question?.trim()) {
    return NextResponse.json({ error: "Ask something." }, { status: 400 });
  }

  // Search on the meaningful words. Stop words in a spoken question ("what did
  // they say about the outage") otherwise dominate the match.
  const terms = question
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w));

  const searchQuery = terms.length ? terms.join(" or ") : question;

  const { data: hits, error } = await supabase.rpc("search_transcripts", {
    q: searchQuery,
    max_results: 60,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  type Hit = {
    meeting_id: string;
    meeting_title: string;
    started_at: string;
    speaker_name: string;
    start_ms: number;
    text: string;
  };

  const rows = (hits ?? []) as Hit[];

  if (rows.length === 0) {
    return NextResponse.json({
      answer:
        "I could not find anything about that in your meetings. Try naming a person, a company, or a phrase you remember being said.",
      citations: [],
    });
  }

  // Spread across meetings rather than letting one chatty meeting fill the
  // whole context, then keep them in time order so the model reads a narrative.
  const perMeeting = new Map<string, Hit[]>();
  for (const hit of rows) {
    const bucket = perMeeting.get(hit.meeting_id) ?? [];
    if (bucket.length < 8) bucket.push(hit);
    perMeeting.set(hit.meeting_id, bucket);
  }

  const selected: Hit[] = [];
  let budget = 5_000;
  for (const bucket of perMeeting.values()) {
    for (const hit of bucket) {
      if (budget - hit.text.length < 0) break;
      selected.push(hit);
      budget -= hit.text.length + 60;
    }
  }
  selected.sort((a, b) =>
    a.meeting_id === b.meeting_id
      ? a.start_ms - b.start_ms
      : a.started_at.localeCompare(b.started_at)
  );

  const context = selected
    .map(
      (h, i) =>
        `[${i + 1}] meeting="${h.meeting_title}" id=${h.meeting_id} at=${Math.round(h.start_ms / 1000)}s ${h.speaker_name}: ${h.text}`
    )
    .join("\n");

  const raw = await complete(
    [
      {
        role: "system",
        content:
          "You answer questions about someone's own recorded meetings, using only the excerpts given.\n" +
          'Output JSON only: {"answer": "...", "used": [<excerpt numbers you relied on>]}\n\n' +
          "- Answer in two or three sentences. Be specific: names, numbers, what was decided.\n" +
          "- If the excerpts do not answer it, say so plainly. Never guess.\n" +
          "- Do not mention excerpt numbers in the answer text itself.\n" +
          '- "used" lists the numbers in square brackets of the excerpts your answer rests on.',
      },
      {
        role: "user",
        content: `QUESTION: ${question}\n\nEXCERPTS FROM THE USER'S MEETINGS:\n${context}`,
      },
    ],
    { json: true, temperature: 0.2, maxTokens: 900 }
  );

  const parsed = parseJson<{ answer?: string; used?: (number | string)[] }>(raw);

  const citations: Citation[] = (parsed.used ?? [])
    .map((n) => selected[Number(n) - 1])
    .filter(Boolean)
    .slice(0, 6)
    .map((h) => ({
      meeting_id: h.meeting_id,
      meeting_title: h.meeting_title,
      start_ms: h.start_ms,
      speaker_name: h.speaker_name,
      quote: h.text.length > 190 ? `${h.text.slice(0, 190)}…` : h.text,
    }));

  const answer = parsed.answer?.trim() || "I could not find an answer in your meetings.";

  // Best effort: the conversation log is not worth failing the request over.
  await supabase.from("ask_messages").insert([
    { user_id: user.id, meeting_id: meetingId ?? null, role: "user", content: question },
    {
      user_id: user.id,
      meeting_id: meetingId ?? null,
      role: "assistant",
      content: answer,
      citations,
    },
  ]);

  return NextResponse.json({ answer, citations, model: TEXT_MODEL });
}

const STOP_WORDS = new Set([
  "the", "and", "for", "are", "was", "were", "what", "when", "who", "how", "why", "did", "does",
  "you", "your", "our", "his", "her", "its", "they", "them", "this", "that", "these", "those",
  "about", "with", "from", "have", "has", "had", "been", "being", "there", "their", "into",
  "said", "say", "says", "tell", "told", "can", "could", "would", "should", "will", "any",
  "some", "all", "not", "but", "out", "get", "got", "much", "many", "which", "where", "anything",
]);
