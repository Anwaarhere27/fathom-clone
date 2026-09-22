"use client";

import { useCallback, useRef, useState } from "react";
import { BarChart3, ListChecks, Mail, Scissors, Sparkles } from "lucide-react";
import { Player, type PlayerHandle } from "./player";
import { Transcript } from "./transcript";
import { SummaryPanel } from "./summary-panel";
import { ActionItems } from "./action-items";
import { TalkTime } from "./talk-time";
import { Highlights } from "./highlights";
import { FollowUpEmail } from "./follow-up-email";
import { cn } from "@/lib/utils";
import { createHighlight } from "@/app/(app)/meetings/[id]/actions";
import type {
  ActionItem,
  Highlight,
  Meeting,
  Participant,
  Summary,
  SummaryTemplate,
  TranscriptSegment,
} from "@/lib/types";

const TABS = [
  { id: "summary", label: "Summary", icon: Sparkles },
  { id: "actions", label: "Action items", icon: ListChecks },
  { id: "highlights", label: "Clips", icon: Scissors },
  { id: "analytics", label: "Talk time", icon: BarChart3 },
  { id: "email", label: "Follow-up", icon: Mail },
] as const;

type TabId = (typeof TABS)[number]["id"];

/** A highlight is the fifteen seconds around where you were listening. */
const HIGHLIGHT_LEAD_MS = 20_000;
const HIGHLIGHT_TAIL_MS = 10_000;

export function MeetingWorkspace({
  meeting,
  participants,
  segments,
  summaries,
  actionItems,
  highlights: initialHighlights,
  followUp,
  defaultTemplate,
  initialMs = 0,
}: {
  meeting: Meeting;
  participants: Participant[];
  segments: TranscriptSegment[];
  summaries: Summary[];
  actionItems: ActionItem[];
  highlights: Highlight[];
  followUp: { subject: string; body: string } | null;
  defaultTemplate: SummaryTemplate;
  /** Where to open playback, so a search result lands on the moment it matched. */
  initialMs?: number;
}) {
  const [currentMs, setCurrentMs] = useState(initialMs);
  const [tab, setTab] = useState<TabId>("summary");
  const [highlights, setHighlights] = useState(initialHighlights);
  const playerRef = useRef<PlayerHandle | null>(null);

  const durationMs = meeting.duration_seconds * 1000;

  const seek = useCallback((ms: number) => {
    playerRef.current?.seek(ms);
    setCurrentMs(ms);
  }, []);

  const activeSpeaker =
    [...segments].reverse().find((s) => s.start_ms <= currentMs && currentMs < s.end_ms)
      ?.speaker_name ?? null;

  async function addHighlight() {
    const start = Math.max(0, currentMs - HIGHLIGHT_LEAD_MS);
    const end = Math.min(durationMs, currentMs + HIGHLIGHT_TAIL_MS);

    // Label it with whoever was talking, so the clip list is readable at a
    // glance instead of a column of timestamps.
    const line = segments.find((s) => s.start_ms <= currentMs && currentMs < s.end_ms);
    const label = line
      ? `${line.speaker_name}: ${line.text.slice(0, 90)}${line.text.length > 90 ? "…" : ""}`
      : null;

    const created = await createHighlight({
      meetingId: meeting.id,
      startMs: start,
      endMs: end,
      label,
    });

    setHighlights((prev) => [...prev, created as Highlight].sort((a, b) => a.start_ms - b.start_ms));
    setTab("highlights");
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_400px] xl:grid-cols-[minmax(0,1fr)_440px]">
      <div className="min-w-0 space-y-5">
        <Player
          src={meeting.media_url}
          durationMs={durationMs}
          participants={participants}
          activeSpeaker={activeSpeaker}
          highlights={highlights}
          currentMs={currentMs}
          onTime={setCurrentMs}
          onReady={(handle) => {
            playerRef.current = handle;
            if (initialMs > 0) handle.seek(initialMs);
          }}
          onHighlight={addHighlight}
        />

        <div className="rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
          <div className="scroll-thin flex gap-0.5 overflow-x-auto border-b border-line px-2 pt-2">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={cn(
                  "flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3 py-2 text-[13px] font-medium transition-colors",
                  tab === id
                    ? "border-brand text-brand-ink"
                    : "border-transparent text-ink-soft hover:text-ink"
                )}
              >
                <Icon size={14} />
                {label}
                {id === "actions" && actionItems.length > 0 && (
                  <span className="tnum ml-0.5 rounded-full bg-sunken px-1.5 text-[10.5px] text-ink-soft">
                    {actionItems.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          <div className="p-4 sm:p-5">
            {tab === "summary" && (
              <SummaryPanel
                meetingId={meeting.id}
                summaries={summaries}
                defaultTemplate={defaultTemplate}
                onSeek={seek}
              />
            )}
            {tab === "actions" && (
              <ActionItems items={actionItems} meetingId={meeting.id} onSeek={seek} />
            )}
            {tab === "highlights" && (
              <Highlights
                meetingId={meeting.id}
                highlights={highlights}
                onSeek={seek}
                onCreate={addHighlight}
              />
            )}
            {tab === "analytics" && (
              <TalkTime
                participants={participants}
                segments={segments}
                durationMs={durationMs}
                onSeek={seek}
              />
            )}
            {tab === "email" && <FollowUpEmail email={followUp} title={meeting.title} />}
          </div>
        </div>
      </div>

      <aside className="min-w-0">
        <div className="flex h-[560px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card lg:sticky lg:top-5 lg:h-[calc(100dvh-6rem)]">
          <Transcript
            segments={segments}
            currentMs={currentMs}
            onSeek={seek}
            className="flex-1"
          />
        </div>
      </aside>
    </div>
  );
}
