"use client";

import { useState, useTransition } from "react";
import { Check, Copy, Share2 } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { createShare } from "@/app/(app)/meetings/[id]/actions";

export function ShareMeetingButton({ meetingId }: { meetingId: string }) {
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, startTransition] = useTransition();

  function share() {
    startTransition(async () => {
      const token = await createShare({ meetingId });
      const url = `${window.location.origin}/share/${token}`;
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2400);
      } catch {
        // Clipboard can be blocked; the link is shown either way.
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <Button size="sm" variant="secondary" onClick={share} disabled={pending}>
        {pending ? <Spinner /> : copied ? <Check size={14} className="text-positive" /> : <Share2 size={14} />}
        {copied ? "Link copied" : "Share"}
      </Button>

      {link && (
        <div className="flex w-full max-w-sm items-center gap-2 rounded-lg border border-line bg-sunken px-2.5 py-1.5">
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
              setTimeout(() => setCopied(false), 2400);
            }}
            className="shrink-0 text-ink-faint transition-colors hover:text-ink"
            aria-label="Copy link"
          >
            {copied ? <Check size={13} className="text-positive" /> : <Copy size={13} />}
          </button>
        </div>
      )}

      {link && (
        <p className="text-[11.5px] text-ink-faint">Opens without an account.</p>
      )}
    </div>
  );
}
