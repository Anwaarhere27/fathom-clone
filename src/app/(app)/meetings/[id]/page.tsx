import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CalendarDays, Clock, Upload, Users } from "lucide-react";
import { Badge } from "@/components/ui";
import { ShareMeetingButton } from "@/components/meeting/share-meeting-button";
import { MeetingWorkspace } from "@/components/meeting/workspace";
import { createClient } from "@/lib/supabase/server";
import { defaultTemplateFor } from "@/lib/ai/summarize";
import { formatDuration, formatRelativeDay, PLATFORM_LABELS } from "@/lib/utils";
import type {
  ActionItem,
  Highlight,
  Meeting,
  Participant,
  Summary,
  TranscriptSegment,
} from "@/lib/types";

export const dynamic = "force-dynamic";

/** PostgREST caps a select at 1,000 rows; the QBR alone has 285 but uploads can exceed it. */
async function fetchAllSegments(
  supabase: Awaited<ReturnType<typeof createClient>>,
  meetingId: string
) {
  const all: TranscriptSegment[] = [];
  for (let from = 0; ; from += 1000) {
    const { data } = await supabase
      .from("transcript_segments")
      .select("*")
      .eq("meeting_id", meetingId)
      .order("idx")
      .range(from, from + 999);
    if (!data?.length) break;
    all.push(...(data as TranscriptSegment[]));
    if (data.length < 1000) break;
  }
  return all;
}

export default async function MeetingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: meeting } = await supabase.from("meetings").select("*").eq("id", id).maybeSingle();
  if (!meeting) notFound();

  const [participants, segments, summaries, actionItems, highlights, followUp] = await Promise.all([
    supabase.from("participants").select("*").eq("meeting_id", id).order("talk_seconds", { ascending: false }),
    fetchAllSegments(supabase, id),
    supabase.from("summaries").select("*").eq("meeting_id", id),
    supabase.from("action_items").select("*").eq("meeting_id", id).order("start_ms", { nullsFirst: false }),
    supabase.from("highlights").select("*").eq("meeting_id", id).order("start_ms"),
    supabase.from("follow_up_emails").select("subject, body").eq("meeting_id", id).maybeSingle(),
  ]);

  const typed = meeting as Meeting;

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-6 sm:px-6">
      <Link
        href="/meetings"
        className="mb-4 inline-flex items-center gap-1.5 text-[13px] text-ink-soft transition-colors hover:text-ink"
      >
        <ArrowLeft size={14} /> All meetings
      </Link>

      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{typed.title}</h1>
            {typed.source === "upload" && (
              <Badge tone="brand">
                <Upload size={10} /> Uploaded
              </Badge>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-ink-faint">
            <span className="inline-flex items-center gap-1 tnum">
              <CalendarDays size={13} />
              {formatRelativeDay(typed.started_at)}
            </span>
            <span className="inline-flex items-center gap-1 tnum">
              <Clock size={13} />
              {formatDuration(typed.duration_seconds)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users size={13} />
              {typed.participant_count} people
            </span>
            {typed.platform && <span>{PLATFORM_LABELS[typed.platform] ?? typed.platform}</span>}
          </div>
        </div>

        <ShareMeetingButton meetingId={typed.id} />
      </header>

      <MeetingWorkspace
        meeting={typed}
        participants={(participants.data ?? []) as Participant[]}
        segments={segments}
        summaries={(summaries.data ?? []) as Summary[]}
        actionItems={(actionItems.data ?? []) as ActionItem[]}
        highlights={(highlights.data ?? []) as Highlight[]}
        followUp={followUp.data ?? null}
        defaultTemplate={defaultTemplateFor(typed.title)}
      />
    </div>
  );
}
