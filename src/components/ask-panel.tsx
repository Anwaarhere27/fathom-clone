"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, MessageSquareText, Sparkles } from "lucide-react";
import { Avatar, Spinner } from "@/components/ui";
import { cn, formatTimestamp, speakerColor } from "@/lib/utils";

interface Citation {
  meeting_id: string;
  meeting_title: string;
  start_ms: number;
  speaker_name: string;
  quote: string;
}

interface Turn {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
  error?: boolean;
}

const SUGGESTIONS = [
  "What did we commit to Helix Health?",
  "What are people unhappy about?",
  "Summarise everything about the August outage",
  "Which deals are at risk and why?",
];

export function AskPanel() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, busy]);

  async function ask(question: string) {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setTurns((prev) => [...prev, { role: "user", content: trimmed }]);
    setValue("");
    setBusy(true);

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong");

      setTurns((prev) => [
        ...prev,
        { role: "assistant", content: data.answer, citations: data.citations ?? [] },
      ]);
    } catch (error) {
      setTurns((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            error instanceof Error && /rate limit|quota|429/i.test(error.message)
              ? "The model's daily free-tier budget is spent. It resets on a rolling window — try again shortly."
              : "Something went wrong answering that. Try again.",
          error: true,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto pb-4">
        {turns.length === 0 ? (
          <div className="py-10 text-center">
            <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-xl bg-brand-soft text-brand-ink">
              <MessageSquareText size={20} />
            </div>
            <p className="mx-auto mb-5 max-w-sm text-[13.5px] leading-relaxed text-ink-soft">
              Ask across every meeting at once. Answers come back with the exact moment they came
              from, so you can check them.
            </p>
            <div className="mx-auto flex max-w-lg flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => ask(s)}
                  className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-soft transition-colors hover:border-line-strong hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {turns.map((turn, i) =>
              turn.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <p className="max-w-[80%] rounded-2xl rounded-br-md bg-brand px-3.5 py-2 text-[13.5px] leading-relaxed text-white">
                    {turn.content}
                  </p>
                </div>
              ) : (
                <div key={i} className="flex gap-2.5">
                  <div className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink">
                    <Sparkles size={14} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "text-[14px] leading-[1.65]",
                        turn.error ? "text-critical" : "text-ink"
                      )}
                    >
                      {turn.content}
                    </p>

                    {turn.citations && turn.citations.length > 0 && (
                      <ul className="mt-3 space-y-1.5">
                        {turn.citations.map((c, j) => (
                          <li key={j}>
                            <Link
                              href={`/meetings/${c.meeting_id}?t=${c.start_ms}`}
                              className="flex gap-2.5 rounded-[10px] border border-line bg-surface px-3 py-2 transition-colors hover:border-line-strong hover:bg-sunken"
                            >
                              <Avatar
                                name={c.speaker_name}
                                color={speakerColor(c.speaker_name)}
                                size={22}
                                className="mt-0.5"
                              />
                              <div className="min-w-0 flex-1">
                                <div className="mb-0.5 flex flex-wrap items-baseline gap-x-2">
                                  <span className="text-[12px] font-medium">{c.speaker_name}</span>
                                  <span className="text-[11.5px] text-ink-faint">
                                    {c.meeting_title}
                                  </span>
                                  <span className="tnum ml-auto text-[11.5px] text-brand-ink">
                                    {formatTimestamp(c.start_ms)}
                                  </span>
                                </div>
                                <p className="text-[12.5px] leading-snug text-ink-soft">
                                  “{c.quote}”
                                </p>
                              </div>
                            </Link>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )
            )}

            {busy && (
              <div className="flex items-center gap-2.5 text-[13.5px] text-ink-soft">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand-ink">
                  <Sparkles size={14} />
                </div>
                <Spinner /> Reading your meetings…
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(value);
        }}
        className="sticky bottom-0 shrink-0 bg-canvas pt-2"
      >
        <div className="relative">
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void ask(value);
              }
            }}
            rows={1}
            placeholder="Ask anything about your meetings…"
            className="scroll-thin max-h-32 w-full resize-none rounded-xl border border-line bg-surface py-3 pl-4 pr-12 text-[14px] text-ink placeholder:text-ink-faint focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/15"
          />
          <button
            type="submit"
            disabled={!value.trim() || busy}
            className="absolute bottom-2.5 right-2.5 grid h-8 w-8 place-items-center rounded-lg bg-brand text-white transition-all hover:brightness-110 disabled:opacity-35"
            aria-label="Ask"
          >
            <ArrowUp size={16} />
          </button>
        </div>
        <p className="mt-1.5 text-center text-[11.5px] text-ink-faint">
          Answers are drawn only from your own recordings.
        </p>
      </form>
    </div>
  );
}
