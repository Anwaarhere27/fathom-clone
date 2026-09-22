"use client";

import { useState } from "react";
import { Check, Copy, Mail } from "lucide-react";
import { Button } from "@/components/ui";

/**
 * Fathom makes you read the summary and write the email yourself. This drafts
 * it from what was actually agreed, ready to paste.
 */
export function FollowUpEmail({
  email,
  title,
}: {
  email: { subject: string; body: string } | null;
  title: string;
}) {
  const [copied, setCopied] = useState(false);

  if (!email) {
    return (
      <div className="py-12 text-center">
        <Mail size={22} className="mx-auto mb-2 text-ink-faint" />
        <p className="text-[13.5px] text-ink-soft">No draft for this meeting yet.</p>
      </div>
    );
  }

  async function copy() {
    if (!email) return;
    try {
      await navigator.clipboard.writeText(`Subject: ${email.subject}\n\n${email.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      // Clipboard can be blocked; the text is on screen and selectable.
    }
  }

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <p className="text-[12.5px] text-ink-faint">Drafted from what was agreed on the call.</p>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={copy}>
            {copied ? <Check size={14} className="text-positive" /> : <Copy size={14} />}
            {copied ? "Copied" : "Copy"}
          </Button>
          <a
            href={`mailto:?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`}
          >
            <Button size="sm" variant="primary">
              <Mail size={14} /> Open in mail
            </Button>
          </a>
        </div>
      </div>

      <div className="overflow-hidden rounded-[10px] border border-line">
        <div className="border-b border-line bg-sunken px-3.5 py-2.5">
          <p className="text-[11px] uppercase tracking-[0.06em] text-ink-faint">Subject</p>
          <p className="mt-0.5 text-[13.5px] font-medium">{email.subject}</p>
        </div>
        <pre className="scroll-thin max-h-[420px] overflow-auto whitespace-pre-wrap px-3.5 py-3 font-sans text-[13.5px] leading-[1.65] text-ink-soft">
          {email.body}
        </pre>
      </div>

      <p className="mt-2 text-[11.5px] text-ink-faint">
        Meeting: {title}. Read it before you send it.
      </p>
    </div>
  );
}
