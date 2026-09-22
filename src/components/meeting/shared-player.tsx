"use client";

import { useRef, useState } from "react";
import { Player, type PlayerHandle } from "./player";
import { Transcript } from "./transcript";
import type { Meeting, Participant, TranscriptSegment } from "@/lib/types";

/**
 * The share page's player. Same component as the app's, but bounded to a clip
 * and with no highlight controls -- a recipient can watch and read, not edit.
 */
export function SharedPlayer({
  meeting,
  participants,
  segments,
  bounds,
}: {
  meeting: Meeting;
  participants: Participant[];
  segments: TranscriptSegment[];
  bounds: { start: number; end: number } | null;
}) {
  const [currentMs, setCurrentMs] = useState(bounds?.start ?? 0);
  const playerRef = useRef<PlayerHandle | null>(null);

  const activeSpeaker =
    [...segments].reverse().find((s) => s.start_ms <= currentMs && currentMs < s.end_ms)
      ?.speaker_name ?? null;

  function seek(ms: number) {
    playerRef.current?.seek(ms);
    setCurrentMs(ms);
  }

  return (
    <div className="space-y-4">
      <Player
        src={meeting.media_url}
        durationMs={meeting.duration_seconds * 1000}
        participants={participants}
        activeSpeaker={activeSpeaker}
        highlights={[]}
        currentMs={currentMs}
        onTime={setCurrentMs}
        onReady={(handle) => {
          playerRef.current = handle;
          // Open a clip at its start rather than at the top of the recording.
          if (bounds) handle.seek(bounds.start);
        }}
        bounds={bounds}
      />

      <div className="flex h-[420px] flex-col overflow-hidden rounded-[var(--radius-card)] border border-line bg-surface shadow-card">
        <Transcript segments={segments} currentMs={currentMs} onSeek={seek} className="flex-1" />
      </div>
    </div>
  );
}
