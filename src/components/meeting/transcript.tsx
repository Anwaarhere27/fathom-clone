"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Avatar, Input } from "@/components/ui";
import { cn, formatTimestamp, speakerColor } from "@/lib/utils";
import type { TranscriptSegment } from "@/lib/types";

export function Transcript({
  segments,
  currentMs,
  onSeek,
  className,
}: {
  segments: TranscriptSegment[];
  currentMs: number;
  onSeek: (ms: number) => void;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [following, setFollowing] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  const activeIndex = useMemo(() => {
    // Segments are ordered, so the active one is the last that has started.
    let lo = 0;
    let hi = segments.length - 1;
    let found = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid].start_ms <= currentMs) {
        found = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return found;
  }, [segments, currentMs]);

  useEffect(() => {
    if (!following || activeIndex < 0) return;
    activeRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [activeIndex, following]);

  const filtered = useMemo(() => {
    if (!query.trim()) return segments;
    const needle = query.toLowerCase();
    return segments.filter((s) => s.text.toLowerCase().includes(needle));
  }, [segments, query]);

  return (
    <div className={cn("flex min-h-0 flex-col", className)}>
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <div className="relative flex-1">
          <Search
            size={14}
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-faint"
          />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find in this transcript"
            className="h-8 pl-8 text-[13px]"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint hover:text-ink"
              aria-label="Clear"
            >
              <X size={14} />
            </button>
          )}
        </div>
        <label className="flex shrink-0 items-center gap-1.5 text-[12px] text-ink-soft">
          <input
            type="checkbox"
            checked={following}
            onChange={(e) => setFollowing(e.target.checked)}
            className="accent-[var(--color-brand)]"
          />
          Follow
        </label>
      </div>

      {query && (
        <p className="border-b border-line bg-sunken px-4 py-1.5 text-[12px] text-ink-soft">
          {filtered.length} {filtered.length === 1 ? "line" : "lines"} matching “{query}”
        </p>
      )}

      <div ref={containerRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {filtered.map((segment) => {
          const isActive = segments[activeIndex]?.id === segment.id;
          return (
            <button
              key={segment.id}
              ref={isActive ? activeRef : undefined}
              onClick={() => onSeek(segment.start_ms)}
              className={cn(
                "flex w-full gap-3 rounded-[10px] px-2.5 py-2 text-left transition-colors",
                isActive ? "bg-brand-soft" : "hover:bg-sunken"
              )}
            >
              <Avatar
                name={segment.speaker_name}
                color={speakerColor(segment.speaker_name)}
                size={26}
                className="mt-0.5"
              />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5 flex items-baseline gap-2">
                  <span className="text-[12.5px] font-semibold tracking-tight">
                    {segment.speaker_name}
                  </span>
                  <span className="tnum text-[11.5px] text-ink-faint">
                    {formatTimestamp(segment.start_ms)}
                  </span>
                </div>
                <p
                  className={cn(
                    "text-[13.5px] leading-[1.6]",
                    isActive ? "text-ink" : "text-ink-soft"
                  )}
                >
                  {query ? highlight(segment.text, query) : segment.text}
                </p>
              </div>
            </button>
          );
        })}

        {filtered.length === 0 && (
          <p className="px-3 py-10 text-center text-[13px] text-ink-faint">
            Nothing in this transcript matches “{query}”.
          </p>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, query: string) {
  const parts = text.split(new RegExp(`(${escapeRegex(query)})`, "ig"));
  return parts.map((part, i) =>
    part.toLowerCase() === query.toLowerCase() ? (
      <mark key={i} className="rounded bg-caution/30 px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      part
    )
  );
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
