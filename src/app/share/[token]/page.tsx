import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { AudioLines, CalendarDays, Clock, Users } from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { SharedPlayer } from "@/components/meeting/shared-player";
import { createAdminClient } from "@/lib/supabase/server";
import { formatDuration, formatRelativeDay, PLATFORM_LABELS } from "@/lib/utils";
import type { Meeting, Participant, Summary, TranscriptSegment } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Public. No session required -- a clip sent to someone who was not on the call
 * has to open for them. Reads run through the service role, so RLS on the
 * underlying tables stays closed and only what the token points at is exposed.
 */
async function load(token: string) {
  const admin = createAdminClient();

  const { data: share } = await admin
    .from("shares")
    .select("*, highlight:highlights(*)")
    .eq("token", token)
    .maybeSingle();

  if (!share) return null;

  const { data: meeting } = await admin
    .from("meetings")
    .select("*")
    .eq("id", share.meeting_id)
    .maybeSingle();
  if (!meeting) return null;

  const highlight = share.highlight as { start_ms: number; end_ms: number; label: string | null } | null;
  const startMs = highlight?.start_ms ?? share.start_ms ?? null;
  const endMs = highlight?.end_ms ?? share.end_ms ?? null;

  const [{ data: participants }, { data: summaries }] = await Promise.all([
    admin.from("participants").select("*").eq("meeting_id", meeting.id).order("talk_seconds", { ascending: false }),
    admin.from("summaries").select("*").eq("meeting_id", meeting.id).eq("template", "general"),
  ]);

  // A clip only shows the transcript inside its bounds. Sharing a moment should
  // not hand over the whole hour.
  let query = admin
    .from("transcript_segments")
    .select("*")
    .eq("meeting_id", meeting.id)
    .order("idx");

  if (startMs !== null && endMs !== null) {
    query = query.gte("end_ms", startMs).lte("start_ms", endMs);
  }

  const { data: segments } = await query.limit(1000);

  await admin
    .from("shares")
    .update({ view_count: (share.view_count ?? 0) + 1 })
    .eq("id", share.id);

  return {
    share,
    meeting: meeting as Meeting,
    participants: (participants ?? []) as Participant[],
    segments: (segments ?? []) as TranscriptSegment[],
    summary: (summaries?.[0] ?? null) as Summary | null,
    bounds: startMs !== null && endMs !== null ? { start: startMs, end: endMs } : null,
    label: highlight?.label ?? null,
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const data = await load(token);
  if (!data) return { title: "Link not found" };

  return {
    title: `${data.meeting.title} — Cadence Notes`,
    description: data.summary?.one_liner ?? "A shared recording.",
  };
}

export default async function SharePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await load(token);
  if (!data) notFound();

  const { meeting, participants, segments, summary, bounds, label } = data;

  return (
    <div className="min-h-dvh bg-canvas">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3.5 sm:px-6">
          <Link href="/" className="flex items-center gap-2">
            <div className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white">
              <AudioLines size={15} />
            </div>
            <span className="text-[14px] font-semibold tracking-tight">Cadence Notes</span>
          </Link>
          <Link href="/">
            <Button size="sm" variant="secondary">
              Try it free
            </Button>
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-7 sm:px-6">
        <div className="mb-4">
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <Badge tone="brand">{bounds ? "Shared clip" : "Shared recording"}</Badge>
            <span className="text-[12px] text-ink-faint">
              Shared with you — you do not need an account.
            </span>
          </div>

          <h1 className="text-[22px] font-semibold tracking-[-0.015em]">{meeting.title}</h1>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-ink-faint">
            <span className="inline-flex items-center gap-1 tnum">
              <CalendarDays size={13} />
              {formatRelativeDay(meeting.started_at)}
            </span>
            <span className="inline-flex items-center gap-1 tnum">
              <Clock size={13} />
              {bounds
                ? `${formatDuration((bounds.end - bounds.start) / 1000)} clip`
                : formatDuration(meeting.duration_seconds)}
            </span>
            <span className="inline-flex items-center gap-1">
              <Users size={13} />
              {meeting.participant_count} people
            </span>
            {meeting.platform && <span>{PLATFORM_LABELS[meeting.platform] ?? meeting.platform}</span>}
          </div>

          {label && (
            <p className="mt-3 border-l-2 border-caution pl-3 text-[13.5px] leading-relaxed text-ink-soft">
              {label}
            </p>
          )}
        </div>

        <SharedPlayer
          meeting={meeting}
          participants={participants}
          segments={segments}
          bounds={bounds}
        />

        {!bounds && summary && summary.sections.length > 0 && (
          <section className="mt-6 rounded-[var(--radius-card)] border border-line bg-surface p-5 shadow-card">
            <h2 className="mb-4 text-[15px] font-semibold tracking-tight">Summary</h2>
            {summary.one_liner && (
              <p className="mb-4 border-l-2 border-brand-line pl-3 text-[14px] leading-relaxed">
                {summary.one_liner}
              </p>
            )}
            <div className="space-y-4">
              {summary.sections.map((section) => (
                <div key={section.heading}>
                  <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
                    {section.heading}
                  </h3>
                  <ul className="space-y-1.5">
                    {section.bullets.map((bullet, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-faint" aria-hidden />
                        <span className="text-[13.5px] leading-[1.6] text-ink-soft">{bullet.text}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        )}
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-4xl px-4 py-6 text-center sm:px-6">
          <p className="text-[13px] text-ink-soft">
            Recorded and summarised with Cadence Notes.{" "}
            <Link href="/" className="font-medium text-brand-ink hover:underline">
              See how it works
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}
