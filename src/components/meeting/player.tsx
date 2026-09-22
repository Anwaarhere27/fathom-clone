"use client";

import { useEffect, useRef, useState } from "react";
import { Pause, Play, Rewind, FastForward, Scissors, Volume2 } from "lucide-react";
import { Avatar, Button } from "@/components/ui";
import { cn, formatTimestamp, speakerColor } from "@/lib/utils";
import type { Highlight, Participant } from "@/lib/types";

export interface PlayerHandle {
  seek: (ms: number) => void;
  play: () => void;
}

export function Player({
  src,
  durationMs,
  participants,
  activeSpeaker,
  highlights,
  currentMs,
  onTime,
  onReady,
  onHighlight,
  bounds,
}: {
  src: string | null;
  durationMs: number;
  participants: Participant[];
  activeSpeaker: string | null;
  highlights: Highlight[];
  currentMs: number;
  onTime: (ms: number) => void;
  onReady: (handle: PlayerHandle) => void;
  onHighlight?: () => void;
  /** Share pages open bounded to a clip rather than the whole recording. */
  bounds?: { start: number; end: number } | null;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [scrubbing, setScrubbing] = useState<number | null>(null);

  const start = bounds?.start ?? 0;
  const end = bounds?.end ?? durationMs;
  const span = Math.max(1, end - start);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    onReady({
      seek: (ms) => {
        audio.currentTime = ms / 1000;
        onTime(ms);
      },
      play: () => void audio.play(),
    });
    // onReady is recreated each render by the parent; depending on it would
    // re-register on every tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep a clip from running past its end.
  useEffect(() => {
    if (!bounds) return;
    if (currentMs >= end) {
      audioRef.current?.pause();
      setPlaying(false);
    }
  }, [currentMs, end, bounds]);

  const shown = scrubbing ?? currentMs;
  const progress = Math.min(100, Math.max(0, ((shown - start) / span) * 100));

  function scrubTo(clientX: number, el: HTMLElement) {
    const rect = el.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return start + ratio * span;
  }

  return (
    <div className="overflow-hidden rounded-[var(--radius-card)] border border-line bg-ink/[0.97] text-white shadow-card">
      {/* Speaker stage. The seeded recordings are audio, so rather than a black
          rectangle this shows who is talking right now. */}
      <div className="relative grid min-h-[210px] place-items-center bg-[radial-gradient(ellipse_at_top,oklch(32%_0.04_265),oklch(19%_0.02_265))] px-6 py-8 sm:min-h-[260px]">
        <div className="flex flex-wrap items-center justify-center gap-3">
          {participants.map((p) => {
            const talking = activeSpeaker === p.name;
            return (
              <div
                key={p.id}
                className={cn(
                  "flex flex-col items-center gap-2 rounded-xl px-3 py-2.5 transition-all duration-300",
                  talking ? "bg-white/[0.08] scale-105" : "opacity-45"
                )}
              >
                <div
                  className={cn(
                    "rounded-full transition-all duration-300",
                    talking && "ring-2 ring-white/70 ring-offset-2 ring-offset-transparent"
                  )}
                >
                  <Avatar name={p.name} color={speakerColor(p.name)} size={talking ? 52 : 44} />
                </div>
                <span className="max-w-[92px] truncate text-[11.5px] font-medium">
                  {p.name.split(" ")[0]}
                </span>
              </div>
            );
          })}
        </div>

        {activeSpeaker && (
          <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/35 px-3 py-1 text-[11.5px] backdrop-blur">
            <Volume2 size={12} />
            {activeSpeaker} is speaking
          </div>
        )}
      </div>

      <div className="px-4 pb-4 pt-3">
        {/* Scrubber */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Seek"
          aria-valuemin={start}
          aria-valuemax={end}
          aria-valuenow={shown}
          className="group relative mb-3 cursor-pointer py-2"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            setScrubbing(scrubTo(e.clientX, e.currentTarget));
          }}
          onPointerMove={(e) => {
            if (scrubbing === null) return;
            setScrubbing(scrubTo(e.clientX, e.currentTarget));
          }}
          onPointerUp={(e) => {
            const ms = scrubTo(e.clientX, e.currentTarget);
            if (audioRef.current) audioRef.current.currentTime = ms / 1000;
            onTime(ms);
            setScrubbing(null);
          }}
          onKeyDown={(e) => {
            if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
            e.preventDefault();
            const next = currentMs + (e.key === "ArrowRight" ? 5000 : -5000);
            if (audioRef.current) audioRef.current.currentTime = Math.max(0, next) / 1000;
            onTime(Math.max(start, Math.min(end, next)));
          }}
        >
          <div className="relative h-1.5 rounded-full bg-white/15">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-white"
              style={{ width: `${progress}%` }}
            />
            {/* Highlight markers sit in the track so you can see where the
                interesting moments are before you scrub to them. */}
            {highlights.map((h) => (
              <span
                key={h.id}
                title={h.label ?? "Highlight"}
                className="absolute top-1/2 h-3 w-[3px] -translate-y-1/2 rounded-full bg-caution"
                style={{ left: `${((h.start_ms - start) / span) * 100}%` }}
              />
            ))}
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100"
              style={{ left: `${progress}%` }}
            />
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => {
              const audio = audioRef.current;
              if (!audio) return;
              if (playing) audio.pause();
              else void audio.play();
            }}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white text-ink transition-transform hover:scale-105 active:scale-95"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" className="ml-0.5" />}
          </button>

          <button
            onClick={() => {
              if (audioRef.current) audioRef.current.currentTime = Math.max(0, (currentMs - 10000) / 1000);
            }}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Back 10 seconds"
          >
            <Rewind size={16} />
          </button>
          <button
            onClick={() => {
              if (audioRef.current) audioRef.current.currentTime = (currentMs + 10000) / 1000;
            }}
            className="grid h-8 w-8 place-items-center rounded-lg text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            aria-label="Forward 10 seconds"
          >
            <FastForward size={16} />
          </button>

          <span className="tnum ml-1 text-[12.5px] text-white/70">
            {formatTimestamp(shown)} <span className="text-white/35">/ {formatTimestamp(end)}</span>
          </span>

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => {
                const next = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : rate === 1.5 ? 2 : 1;
                setRate(next);
                if (audioRef.current) audioRef.current.playbackRate = next;
              }}
              className="tnum rounded-lg px-2 py-1 text-[12px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white"
            >
              {rate}×
            </button>
            {onHighlight && (
              <Button
                size="sm"
                variant="ghost"
                onClick={onHighlight}
                className="text-white/70 hover:bg-white/10 hover:text-white"
              >
                <Scissors size={14} /> Highlight
              </Button>
            )}
          </div>
        </div>
      </div>

      {src ? (
        <audio
          ref={audioRef}
          src={src}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => onTime(e.currentTarget.currentTime * 1000)}
          onEnded={() => setPlaying(false)}
        />
      ) : null}
    </div>
  );
}
