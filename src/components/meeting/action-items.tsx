"use client";

import { useOptimistic, useTransition } from "react";
import { CircleCheck, Circle, ListChecks } from "lucide-react";
import { Avatar } from "@/components/ui";
import { cn, formatTimestamp, speakerColor } from "@/lib/utils";
import type { ActionItem } from "@/lib/types";
import { toggleActionItem } from "@/app/(app)/meetings/[id]/actions";

export function ActionItems({
  items,
  meetingId,
  onSeek,
}: {
  items: ActionItem[];
  meetingId: string;
  onSeek: (ms: number) => void;
}) {
  const [optimistic, setOptimistic] = useOptimistic(
    items,
    (state: ActionItem[], update: { id: string; completed: boolean }) =>
      state.map((i) => (i.id === update.id ? { ...i, completed: update.completed } : i))
  );
  const [, startTransition] = useTransition();

  if (items.length === 0) {
    return (
      <div className="py-12 text-center">
        <ListChecks size={22} className="mx-auto mb-2 text-ink-faint" />
        <p className="text-[13.5px] text-ink-soft">Nobody committed to anything on this call.</p>
      </div>
    );
  }

  const done = optimistic.filter((i) => i.completed).length;

  return (
    <div>
      <p className="mb-3 text-[12.5px] text-ink-faint tnum">
        {done} of {optimistic.length} done
      </p>

      <ul className="space-y-1">
        {optimistic.map((item) => (
          <li key={item.id}>
            <div
              className={cn(
                "flex gap-2.5 rounded-[10px] px-2.5 py-2 transition-colors hover:bg-sunken",
                item.completed && "opacity-55"
              )}
            >
              <button
                onClick={() =>
                  startTransition(async () => {
                    setOptimistic({ id: item.id, completed: !item.completed });
                    await toggleActionItem(item.id, !item.completed, meetingId);
                  })
                }
                className="mt-0.5 shrink-0 text-ink-faint transition-colors hover:text-brand"
                aria-label={item.completed ? "Mark as not done" : "Mark as done"}
              >
                {item.completed ? (
                  <CircleCheck size={17} className="text-positive" />
                ) : (
                  <Circle size={17} />
                )}
              </button>

              <div className="min-w-0 flex-1">
                <p
                  className={cn(
                    "text-[13.5px] leading-[1.55]",
                    item.completed ? "text-ink-faint line-through" : "text-ink"
                  )}
                >
                  {item.text}
                </p>

                <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11.5px] text-ink-faint">
                  {item.owner_name ? (
                    <span className="inline-flex items-center gap-1.5">
                      <Avatar
                        name={item.owner_name}
                        color={speakerColor(item.owner_name)}
                        size={16}
                      />
                      {item.owner_name}
                    </span>
                  ) : (
                    <span className="italic">Unassigned</span>
                  )}
                  {item.due_hint && <span>· {item.due_hint}</span>}
                  {typeof item.start_ms === "number" && (
                    <button
                      onClick={() => onSeek(item.start_ms!)}
                      className="tnum rounded px-1 py-0.5 font-medium text-brand-ink transition-colors hover:bg-brand-soft"
                      title="Jump to where this was agreed"
                    >
                      {formatTimestamp(item.start_ms)}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
