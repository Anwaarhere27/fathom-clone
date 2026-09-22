"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarDays, Check, Mic, RefreshCw, Unplug, Users, Video } from "lucide-react";
import { Avatar, Badge, Button, Card, Spinner } from "@/components/ui";
import { cn, PLATFORM_LABELS, speakerColor } from "@/lib/utils";
import type { CalendarEvent } from "@/lib/types";
import { disconnectCalendar, setRecordEnabled, syncCalendar } from "@/app/(app)/upcoming/actions";

export function CalendarControls({ connectedEmail }: { connectedEmail: string | null }) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  if (!connectedEmail) return null;

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        <Badge tone="positive">
          <Check size={10} /> {connectedEmail}
        </Badge>
        <Button
          size="sm"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              try {
                const count = await syncCalendar();
                setMessage(`Synced ${count} events.`);
              } catch (error) {
                setMessage(error instanceof Error ? error.message : "Sync failed.");
              }
            })
          }
        >
          {pending ? <Spinner /> : <RefreshCw size={14} />} Sync
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => startTransition(() => disconnectCalendar().then(() => setMessage(null)))}
        >
          <Unplug size={14} /> Disconnect
        </Button>
      </div>
      {message && <p className="text-[11.5px] text-ink-faint">{message}</p>}
    </div>
  );
}

export function EventRow({ event }: { event: CalendarEvent }) {
  const [enabled, setEnabled] = useState(event.record_enabled);
  const [, startTransition] = useTransition();

  const start = new Date(event.starts_at);
  const minutes = Math.round((new Date(event.ends_at).getTime() - start.getTime()) / 60_000);
  const soon = start.getTime() - Date.now() < 15 * 60_000;
  const live = start.getTime() <= Date.now() && new Date(event.ends_at).getTime() > Date.now();

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-[15px] font-semibold tracking-tight">{event.title}</h2>
            {live && <Badge tone="critical">Happening now</Badge>}
            {!live && soon && <Badge tone="caution">Starting soon</Badge>}
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-[12.5px] text-ink-faint">
            <span className="tnum inline-flex items-center gap-1">
              <CalendarDays size={13} />
              {start.toLocaleString(undefined, {
                weekday: "short",
                hour: "numeric",
                minute: "2-digit",
              })}
            </span>
            <span className="tnum">{minutes} min</span>
            {event.platform && (
              <span className="inline-flex items-center gap-1">
                <Video size={13} />
                {PLATFORM_LABELS[event.platform] ?? event.platform}
              </span>
            )}
            {event.attendees.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <Users size={13} />
                {event.attendees.length}
              </span>
            )}
          </div>

          {event.attendees.length > 0 && (
            <div className="mt-2.5 flex items-center -space-x-1.5">
              {event.attendees.slice(0, 6).map((a, i) => (
                <Avatar
                  key={i}
                  name={a.name ?? a.email ?? "?"}
                  color={speakerColor(a.name ?? a.email ?? "?")}
                  size={22}
                  className="ring-2 ring-surface"
                />
              ))}
              {event.attendees.length > 6 && (
                <span className="grid h-[22px] w-[22px] place-items-center rounded-full bg-sunken text-[10px] font-semibold text-ink-soft ring-2 ring-surface">
                  +{event.attendees.length - 6}
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <label className="flex cursor-pointer items-center gap-2">
            <span className="text-[12.5px] text-ink-soft">Record</span>
            <button
              role="switch"
              aria-checked={enabled}
              aria-label={`Record ${event.title}`}
              onClick={() => {
                const next = !enabled;
                setEnabled(next);
                startTransition(() => setRecordEnabled(event.id, next).catch(() => setEnabled(!next)));
              }}
              className={cn(
                "relative h-5 w-9 rounded-full transition-colors",
                enabled ? "bg-brand" : "bg-line-strong"
              )}
            >
              <span
                className={cn(
                  "absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform",
                  enabled ? "translate-x-[18px]" : "translate-x-0.5"
                )}
              />
            </button>
          </label>

          {enabled && (live || soon) && (
            <Link href={`/record?title=${encodeURIComponent(event.title)}`}>
              <Button size="sm" variant="primary">
                <Mic size={14} /> Record now
              </Button>
            </Link>
          )}

          {event.meeting_url && (
            <a
              href={event.meeting_url}
              target="_blank"
              rel="noreferrer"
              className="text-[12px] text-ink-faint transition-colors hover:text-ink"
            >
              Open meeting link
            </a>
          )}
        </div>
      </div>
    </Card>
  );
}
