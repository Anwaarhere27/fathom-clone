"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  buildNotes,
  summarizeToTemplate,
  type TranscriptLine,
} from "@/lib/ai/summarize";
import type { SummaryTemplate } from "@/lib/types";

export async function toggleActionItem(id: string, completed: boolean, meetingId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("action_items").update({ completed }).eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/meetings/${meetingId}`);
}

export async function createHighlight(input: {
  meetingId: string;
  startMs: number;
  endMs: number;
  label: string | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const { data, error } = await supabase
    .from("highlights")
    .insert({
      meeting_id: input.meetingId,
      user_id: user.id,
      label: input.label,
      start_ms: Math.max(0, Math.round(input.startMs)),
      end_ms: Math.round(input.endMs),
    })
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath(`/meetings/${input.meetingId}`);
  return data;
}

export async function deleteHighlight(id: string, meetingId: string) {
  const supabase = await createClient();
  const { error } = await supabase.from("highlights").delete().eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/meetings/${meetingId}`);
}

/**
 * Mints a public link. Sharing a clip is the same row as sharing the whole
 * meeting, just with bounds set -- the share page reads either shape.
 */
export async function createShare(input: {
  meetingId: string;
  highlightId?: string | null;
  startMs?: number | null;
  endMs?: number | null;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  // Reuse an identical share rather than minting a new link each time the
  // button is pressed.
  const existing = await supabase
    .from("shares")
    .select("token")
    .eq("meeting_id", input.meetingId)
    .is("highlight_id", input.highlightId ?? null)
    .maybeSingle();

  if (existing.data?.token) return existing.data.token as string;

  const { data, error } = await supabase
    .from("shares")
    .insert({
      meeting_id: input.meetingId,
      highlight_id: input.highlightId ?? null,
      start_ms: input.startMs ?? null,
      end_ms: input.endMs ?? null,
      created_by: user.id,
    })
    .select("token")
    .single();

  if (error) throw new Error(error.message);
  return data.token as string;
}

/**
 * Generates a template the meeting does not have cached yet.
 *
 * Seeded meetings arrive with every template pre-generated, so this is the path
 * for uploads and for templates added after a meeting was first processed.
 */
export async function generateSummary(meetingId: string, template: SummaryTemplate) {
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("summaries")
    .select("*")
    .eq("meeting_id", meetingId)
    .eq("template", template)
    .maybeSingle();
  if (existing) return existing;

  const { data: meeting } = await supabase
    .from("meetings")
    .select("title, duration_seconds")
    .eq("id", meetingId)
    .single();
  if (!meeting) throw new Error("Meeting not found");

  const { data: people } = await supabase
    .from("participants")
    .select("name")
    .eq("meeting_id", meetingId);

  const lines: TranscriptLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from("transcript_segments")
      .select("speaker_name, start_ms, text")
      .eq("meeting_id", meetingId)
      .order("idx")
      .range(from, from + 999);
    if (!page?.length) break;
    lines.push(...page);
    if (page.length < 1000) break;
  }

  const notes = await buildNotes(lines);
  const summary = await summarizeToTemplate(notes, template, {
    title: meeting.title,
    participants: (people ?? []).map((p) => p.name),
    durationMinutes: Math.round(meeting.duration_seconds / 60),
  });

  const { data, error } = await supabase
    .from("summaries")
    .upsert(
      {
        meeting_id: meetingId,
        template,
        sections: summary.sections,
        one_liner: summary.one_liner,
        model: summary.model,
      },
      { onConflict: "meeting_id,template" }
    )
    .select("*")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath(`/meetings/${meetingId}`);
  return data;
}
