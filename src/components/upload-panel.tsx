"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileAudio, Upload, X } from "lucide-react";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

type Stage = "idle" | "uploading" | "done" | "error";

/** Groq's transcription endpoint accepts up to 25 MB. */
const MAX_BYTES = 25 * 1024 * 1024;

const STEPS = [
  "Uploading the file",
  "Transcribing with Whisper",
  "Working out who is speaking",
  "Writing the summary and pulling action items",
];

export function UploadPanel() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [stage, setStage] = useState<Stage>("idle");
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function choose(next: File | null) {
    setError(null);
    if (!next) return;

    if (next.size > MAX_BYTES) {
      setError(
        `That file is ${(next.size / 1e6).toFixed(0)} MB. The transcription API accepts up to 25 MB — export audio-only, or trim it first.`
      );
      return;
    }

    setFile(next);
    if (!title) setTitle(next.name.replace(/\.[^.]+$/, ""));
  }

  async function submit() {
    if (!file) return;

    setStage("uploading");
    setError(null);
    setStep(0);

    // The request is one round trip, so the steps are paced rather than
    // reported. They reflect the real order of work on the server.
    const pace = setInterval(() => setStep((s) => Math.min(s + 1, STEPS.length - 1)), 9000);

    try {
      const body = new FormData();
      body.append("file", file);
      body.append("title", title);

      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Upload failed");

      setStage("done");
      router.refresh();
      router.push(`/meetings/${data.id}`);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      clearInterval(pace);
    }
  }

  if (stage === "uploading") {
    return (
      <Card className="p-6">
        <div className="mb-5 flex items-center gap-3">
          <Spinner className="text-brand" />
          <div className="min-w-0">
            <p className="truncate text-[14px] font-medium">{title || file?.name}</p>
            <p className="text-[12.5px] text-ink-faint">
              This takes a minute or two. Leaving this page cancels it.
            </p>
          </div>
        </div>

        <ol className="space-y-2.5">
          {STEPS.map((label, i) => (
            <li key={label} className="flex items-center gap-2.5">
              {i < step ? (
                <CheckCircle2 size={16} className="shrink-0 text-positive" />
              ) : i === step ? (
                <Spinner className="shrink-0 text-brand" />
              ) : (
                <span className="h-4 w-4 shrink-0 rounded-full border border-line" />
              )}
              <span
                className={cn(
                  "text-[13.5px]",
                  i < step ? "text-ink-faint" : i === step ? "text-ink" : "text-ink-faint"
                )}
              >
                {label}
              </span>
            </li>
          ))}
        </ol>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          choose(e.dataTransfer.files?.[0] ?? null);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "cursor-pointer rounded-[var(--radius-card)] border-2 border-dashed px-6 py-12 text-center transition-colors",
          dragging ? "border-brand bg-brand-soft" : "border-line bg-surface hover:border-line-strong"
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.webm,.ogg,.flac"
          className="hidden"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />

        {file ? (
          <div className="flex items-center justify-center gap-3">
            <FileAudio size={20} className="text-brand" />
            <div className="text-left">
              <p className="text-[14px] font-medium">{file.name}</p>
              <p className="tnum text-[12.5px] text-ink-faint">
                {(file.size / 1e6).toFixed(1)} MB
              </p>
            </div>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setFile(null);
                setTitle("");
              }}
              className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
              aria-label="Remove file"
            >
              <X size={15} />
            </button>
          </div>
        ) : (
          <>
            <Upload size={22} className="mx-auto mb-3 text-ink-faint" />
            <p className="text-[14px] font-medium">Drop a recording here, or click to choose</p>
            <p className="mt-1 text-[12.5px] text-ink-faint">
              MP3, M4A, WAV, MP4, WebM · up to 25 MB
            </p>
          </>
        )}
      </div>

      {file && (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Meeting title</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Client call — 12 March"
          />
        </label>
      )}

      {error && (
        <p className="rounded-[10px] border border-critical/25 bg-critical/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-critical">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[12px] leading-relaxed text-ink-faint">
          Whisper transcribes but cannot separate speakers, so who-said-what is inferred from the
          conversation and labelled as a guess.
        </p>
        <Button variant="primary" onClick={submit} disabled={!file}>
          <Upload size={15} /> Process
        </Button>
      </div>
    </div>
  );
}
