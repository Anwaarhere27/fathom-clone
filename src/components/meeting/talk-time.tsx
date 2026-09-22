"use client";

import { Avatar } from "@/components/ui";
import { formatDuration, speakerColor } from "@/lib/utils";
import type { Participant, TranscriptSegment } from "@/lib/types";

/**
 * Who actually talked, and when.
 *
 * Fathom shows talk time as a number; the timeline underneath is the more
 * useful half -- it shows whether a call was a conversation or one person
 * presenting, and where the quiet person finally spoke up.
 */
export function TalkTime({
  participants,
  segments,
  durationMs,
  onSeek,
}: {
  participants: Participant[];
  segments: TranscriptSegment[];
  durationMs: number;
  onSeek: (ms: number) => void;
}) {
  const total = participants.reduce((n, p) => n + p.talk_seconds, 0) || 1;
  const ranked = [...participants].sort((a, b) => b.talk_seconds - a.talk_seconds);

  const byName = new Map<string, TranscriptSegment[]>();
  for (const s of segments) {
    const bucket = byName.get(s.speaker_name) ?? [];
    bucket.push(s);
    byName.set(s.speaker_name, bucket);
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-faint">
          Share of the conversation
        </h3>

        {/* One stacked bar reads as a whole far better than five separate ones. */}
        <div className="mb-4 flex h-2.5 overflow-hidden rounded-full bg-sunken">
          {ranked.map((p) => (
            <div
              key={p.id}
              style={{
                width: `${(p.talk_seconds / total) * 100}%`,
                background: speakerColor(p.name),
              }}
              title={`${p.name} — ${Math.round((p.talk_seconds / total) * 100)}%`}
            />
          ))}
        </div>

        <ul className="space-y-2.5">
          {ranked.map((p) => {
            const share = Math.round((p.talk_seconds / total) * 100);
            const turns = byName.get(p.name) ?? [];
            return (
              <li key={p.id}>
                <div className="mb-1 flex items-center gap-2">
                  <Avatar name={p.name} color={speakerColor(p.name)} size={22} />
                  <span className="text-[13px] font-medium">{p.name}</span>
                  {p.company && <span className="text-[11.5px] text-ink-faint">{p.company}</span>}
                  <span className="tnum ml-auto text-[12px] text-ink-soft">
                    {share}% · {formatDuration(p.talk_seconds)}
                  </span>
                </div>

                {/* When this person spoke, across the call. */}
                <div className="relative h-4 overflow-hidden rounded bg-sunken">
                  {turns.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => onSeek(t.start_ms)}
                      title={`${new Intl.NumberFormat().format(t.text.split(/\s+/).length)} words — click to jump`}
                      className="absolute inset-y-0 transition-opacity hover:opacity-100"
                      style={{
                        left: `${(t.start_ms / durationMs) * 100}%`,
                        width: `${Math.max(0.35, ((t.end_ms - t.start_ms) / durationMs) * 100)}%`,
                        background: speakerColor(p.name),
                        opacity: 0.75,
                      }}
                    />
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
