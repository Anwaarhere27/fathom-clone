import Link from "next/link";
import { CalendarDays, Clock, Sparkles, Upload, Users, Video } from "lucide-react";
import { Avatar, Badge, Button, Card } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";
import { formatDuration, formatRelativeDay, PLATFORM_LABELS, speakerColor } from "@/lib/utils";
import type { Meeting, Participant } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MeetingsPage() {
  const supabase = await createClient();

  const { data: meetings } = await supabase
    .from("meetings")
    .select("*")
    .order("started_at", { ascending: false });

  const list = (meetings ?? []) as Meeting[];

  // One extra round trip instead of N: pull every participant for the page and
  // group client-side.
  const { data: participantRows } = await supabase
    .from("participants")
    .select("*")
    .in("meeting_id", list.length ? list.map((m) => m.id) : ["00000000-0000-0000-0000-000000000000"]);

  const byMeeting = new Map<string, Participant[]>();
  for (const p of (participantRows ?? []) as Participant[]) {
    const bucket = byMeeting.get(p.meeting_id) ?? [];
    bucket.push(p);
    byMeeting.set(p.meeting_id, bucket);
  }

  const totalMinutes = Math.round(list.reduce((n, m) => n + m.duration_seconds, 0) / 60);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Meetings</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            {list.length === 0
              ? "Nothing recorded yet."
              : `${list.length} recordings · ${totalMinutes} minutes captured`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/upload">
            <Button size="sm">
              <Upload size={15} /> Upload a recording
            </Button>
          </Link>
          <Link href="/upcoming">
            <Button variant="primary" size="sm">
              <Video size={15} /> Record a meeting
            </Button>
          </Link>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="space-y-2.5">
          {list.map((meeting) => {
            const people = byMeeting.get(meeting.id) ?? [];
            return (
              <Link key={meeting.id} href={`/meetings/${meeting.id}`} className="block">
                <Card className="group p-4 transition-all hover:border-line-strong hover:shadow-float sm:p-5">
                  <div className="flex items-start gap-4">
                    <div
                      className="mt-0.5 h-10 w-1 shrink-0 rounded-full"
                      style={{ background: `var(--color-accent-${meeting.accent})` }}
                      aria-hidden
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <h2 className="text-[15.5px] font-semibold tracking-tight transition-colors group-hover:text-brand-ink">
                          {meeting.title}
                        </h2>
                        {meeting.source === "upload" && (
                          <Badge tone="brand">
                            <Upload size={10} /> Uploaded
                          </Badge>
                        )}
                        {meeting.status !== "ready" && (
                          <Badge tone={meeting.status === "failed" ? "critical" : "caution"}>
                            {meeting.status}
                          </Badge>
                        )}
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-ink-faint">
                        <span className="inline-flex items-center gap-1 tnum">
                          <CalendarDays size={13} />
                          {formatRelativeDay(meeting.started_at)}
                        </span>
                        <span className="inline-flex items-center gap-1 tnum">
                          <Clock size={13} />
                          {formatDuration(meeting.duration_seconds)}
                        </span>
                        <span className="inline-flex items-center gap-1">
                          <Users size={13} />
                          {meeting.participant_count}
                        </span>
                        {meeting.platform && (
                          <span>{PLATFORM_LABELS[meeting.platform] ?? meeting.platform}</span>
                        )}
                      </div>
                    </div>

                    <div className="hidden shrink-0 items-center -space-x-1.5 sm:flex">
                      {people.slice(0, 5).map((p) => (
                        <Avatar
                          key={p.id}
                          name={p.name}
                          color={speakerColor(p.name)}
                          size={26}
                          className="ring-2 ring-surface"
                        />
                      ))}
                      {people.length > 5 && (
                        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-sunken text-[10.5px] font-semibold text-ink-soft ring-2 ring-surface">
                          +{people.length - 5}
                        </span>
                      )}
                    </div>
                  </div>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <Card className="px-6 py-14 text-center">
      <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-brand-soft text-brand-ink">
        <Sparkles size={22} />
      </div>
      <h2 className="text-[17px] font-semibold tracking-tight">No recordings yet</h2>
      <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-soft">
        Connect your calendar so the notetaker can join your next call, or upload a recording you
        already have.
      </p>
      <div className="mt-6 flex justify-center gap-2">
        <Link href="/upcoming">
          <Button variant="primary" size="sm">
            <CalendarDays size={15} /> Connect calendar
          </Button>
        </Link>
        <Link href="/upload">
          <Button size="sm">
            <Upload size={15} /> Upload a recording
          </Button>
        </Link>
      </div>
    </Card>
  );
}
