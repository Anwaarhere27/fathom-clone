"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Link2, Scissors, Trash2 } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { formatTimestamp } from "@/lib/utils";
import type { Highlight } from "@/lib/types";
import { createShare, deleteHighlight } from "@/app/(app)/meetings/[id]/actions";

export function Highlights({
  meetingId,
  highlights,
  onSeek,
  onCreate,
}: {
  meetingId: string;
  highlights: Highlight[];
  onSeek: (ms: number) => void;
  onCreate: () => void;
}) {
  if (highlights.length === 0) {
    return (
      <div className="py-12 text-center">
        <Scissors size={22} className="mx-auto mb-2 text-ink-faint" />
        <p className="mx-auto mb-4 max-w-xs text-[13.5px] leading-relaxed text-ink-soft">
          Mark a moment while you listen, then send it to someone who was not on the call.
        </p>
        <Button size="sm" onClick={onCreate}>
          <Scissors size={14} /> Highlight this moment
        </Button>
      </div>
    );
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[12.5px] text-ink-faint">
          {highlights.length} {highlights.length === 1 ? "clip" : "clips"}
        </p>
        <Button size="sm" variant="ghost" onClick={onCreate}>
          <Scissors size={14} /> New
        </Button>
      </div>

      <ul className="space-y-2">
        {highlights.map((highlight) => (
          <HighlightRow
            key={highlight.id}
            highlight={highlight}
            meetingId={meetingId}
            onSeek={onSeek}
          />
        ))}
      </ul>
    </div>
  );
}

function HighlightRow({
  highlight,
  meetingId,
  onSeek,
}: {
  highlight: Highlight;
  meetingId: string;
  onSeek: (ms: number) => void;
}) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function share() {
    startTransition(async () => {
      const token = await createShare({
        meetingId,
        highlightId: highlight.id,
        startMs: highlight.start_ms,
        endMs: highlight.end_ms,
      });
      const url = `${window.location.origin}/share/${token}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2200);
      } catch {
        // Clipboard is blocked in some contexts; the link is shown regardless.
      }
    });
  }

  return (
    <li className="rounded-[10px] border border-line bg-surface p-3">
      <div className="flex items-start gap-2.5">
        <button
          onClick={() => onSeek(highlight.start_ms)}
          className="tnum mt-0.5 shrink-0 rounded bg-caution/15 px-1.5 py-0.5 text-[11.5px] font-medium text-caution"
        >
          {formatTimestamp(highlight.start_ms)}
        </button>

        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] leading-snug">{highlight.label ?? "Highlight"}</p>
          <p className="tnum mt-0.5 text-[11.5px] text-ink-faint">
            {formatTimestamp(highlight.end_ms - highlight.start_ms)} long
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            onClick={share}
            disabled={pending}
            title="Get a public link"
            className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
          >
            {pending ? <Spinner /> : copied ? <Check size={15} className="text-positive" /> : <Link2 size={15} />}
          </button>
          <form
            action={async () => {
              await deleteHighlight(highlight.id, meetingId);
            }}
          >
            <button
              type="submit"
              title="Delete"
              className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-critical"
            >
              <Trash2 size={15} />
            </button>
          </form>
        </div>
      </div>

      {link && (
        <div className="mt-2.5 flex items-center gap-2 rounded-lg bg-sunken px-2.5 py-1.5">
          <input
            readOnly
            value={link}
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 bg-transparent text-[11.5px] text-ink-soft outline-none"
          />
          <button
            onClick={() => {
              void navigator.clipboard.writeText(link);
              setCopied(true);
              setTimeout(() => setCopied(false), 2200);
            }}
            className="shrink-0 text-ink-faint hover:text-ink"
          >
            {copied ? <Check size={13} className="text-positive" /> : <Copy size={13} />}
          </button>
        </div>
      )}
    </li>
  );
}
