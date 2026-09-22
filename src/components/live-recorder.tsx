"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CircleAlert, Mic, Monitor, Square } from "lucide-react";
import { Badge, Button, Card, Input, Spinner } from "@/components/ui";
import { cn, formatTimestamp } from "@/lib/utils";

type Stage = "setup" | "recording" | "processing" | "error";

/**
 * Records a call from the browser.
 *
 * A bot that dials into Zoom, Meet and Teams is an infrastructure project, and
 * faking one would produce a demo with nothing real behind it. This captures
 * the actual call instead: your microphone, optionally mixed with the audio of
 * the tab the meeting is running in, then straight into the same transcription
 * and summarisation pipeline an upload uses.
 */
export function LiveRecorder() {
  const router = useRouter();
  const params = useSearchParams();

  const [title, setTitle] = useState(params.get("title") ?? "");
  const [includeTab, setIncludeTab] = useState(true);
  const [stage, setStage] = useState<Stage>("setup");
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamsRef = useRef<MediaStream[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);

  const cleanup = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamsRef.current.forEach((s) => s.getTracks().forEach((t) => t.stop()));
    streamsRef.current = [];
    void audioContextRef.current?.close().catch(() => {});
    audioContextRef.current = null;
  }, []);

  useEffect(() => cleanup, [cleanup]);

  useEffect(() => {
    if (stage !== "recording") return;
    const timer = setInterval(() => setElapsed((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [stage]);

  async function start() {
    setError(null);
    chunksRef.current = [];

    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      streamsRef.current.push(mic);

      const context = new AudioContext();
      audioContextRef.current = context;
      const destination = context.createMediaStreamDestination();
      context.createMediaStreamSource(mic).connect(destination);

      if (includeTab) {
        try {
          // Chrome only shares audio when the user picks a tab and ticks the
          // "share audio" box, so this can legitimately come back silent.
          const display = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: true,
          });
          streamsRef.current.push(display);

          if (display.getAudioTracks().length > 0) {
            context.createMediaStreamSource(display).connect(destination);
          } else {
            setError(
              "Screen sharing started without audio, so only your microphone is being recorded. Pick a tab and tick “Also share tab audio” to capture the others."
            );
          }
          // The video track is only there to make audio sharing available.
          display.getVideoTracks().forEach((t) => t.stop());
        } catch {
          setError("Continuing with microphone only — the meeting audio was not shared.");
        }
      }

      // Level meter, so it is obvious something is being captured.
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      context.createMediaStreamSource(destination.stream).connect(analyser);
      const data = new Uint8Array(analyser.frequencyBinCount);

      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let peak = 0;
        for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
        setLevel(Math.min(1, peak / 70));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();

      const recorder = new MediaRecorder(destination.stream, {
        mimeType: MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
          ? "audio/webm;codecs=opus"
          : "audio/webm",
        audioBitsPerSecond: 64_000,
      });

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = () => void finish();

      recorder.start(1000);
      recorderRef.current = recorder;
      setElapsed(0);
      setStage("recording");
    } catch {
      setStage("error");
      setError("Could not access the microphone. Check the browser's permission prompt.");
    }
  }

  async function finish() {
    cleanup();
    setStage("processing");

    const blob = new Blob(chunksRef.current, { type: "audio/webm" });
    if (blob.size < 2000) {
      setStage("error");
      setError("That recording was too short to transcribe.");
      return;
    }

    try {
      const body = new FormData();
      body.append("file", new File([blob], "recording.webm", { type: "audio/webm" }));
      body.append("title", title || "Recorded meeting");

      const res = await fetch("/api/upload", { method: "POST", body });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Processing failed");

      router.refresh();
      router.push(`/meetings/${data.id}`);
    } catch (err) {
      setStage("error");
      setError(err instanceof Error ? err.message : "Processing failed");
    }
  }

  if (stage === "processing") {
    return (
      <Card className="p-6">
        <div className="flex items-center gap-3">
          <Spinner className="text-brand" />
          <div>
            <p className="text-[14px] font-medium">Transcribing and summarising</p>
            <p className="text-[12.5px] text-ink-faint">
              {formatTimestamp(elapsed * 1000)} of audio. This takes about a minute.
            </p>
          </div>
        </div>
      </Card>
    );
  }

  if (stage === "recording") {
    return (
      <Card className="overflow-hidden">
        <div className="bg-ink/[0.97] px-6 py-10 text-center text-white">
          <div className="mb-4 flex items-center justify-center gap-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-critical" />
            <span className="text-[12.5px] uppercase tracking-[0.08em] text-white/70">
              Recording
            </span>
          </div>

          <p className="tnum mb-6 text-[44px] font-semibold tabular-nums tracking-tight">
            {formatTimestamp(elapsed * 1000)}
          </p>

          {/* Live level meter. */}
          <div className="mx-auto mb-7 flex h-10 max-w-xs items-end justify-center gap-1">
            {Array.from({ length: 28 }).map((_, i) => {
              const distance = Math.abs(i - 13.5) / 13.5;
              const height = Math.max(3, level * 40 * (1 - distance * 0.7) * (0.6 + Math.random() * 0.8));
              return (
                <span
                  key={i}
                  className="w-1.5 rounded-full bg-white/80 transition-all duration-75"
                  style={{ height }}
                />
              );
            })}
          </div>

          <Button
            variant="danger"
            onClick={() => recorderRef.current?.stop()}
            className="mx-auto"
          >
            <Square size={15} fill="currentColor" /> Stop and process
          </Button>
        </div>

        {error && (
          <p className="flex items-start gap-2 border-t border-line bg-caution/10 px-4 py-3 text-[12.5px] leading-relaxed text-caution">
            <CircleAlert size={14} className="mt-0.5 shrink-0" />
            {error}
          </p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="p-5">
        <label className="mb-4 block">
          <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Meeting title</span>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Weekly pipeline review"
          />
        </label>

        <button
          onClick={() => setIncludeTab((v) => !v)}
          className={cn(
            "flex w-full items-start gap-3 rounded-[10px] border p-3.5 text-left transition-colors",
            includeTab ? "border-brand-line bg-brand-soft" : "border-line hover:border-line-strong"
          )}
        >
          <span
            className={cn(
              "mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg",
              includeTab ? "bg-brand text-white" : "bg-sunken text-ink-faint"
            )}
          >
            <Monitor size={15} />
          </span>
          <span className="min-w-0">
            <span className="block text-[13.5px] font-medium">
              Also capture the other people on the call
            </span>
            <span className="mt-0.5 block text-[12.5px] leading-relaxed text-ink-soft">
              You will be asked to share the tab your meeting is in. Tick “Also share tab audio” in
              that dialog, or only your own voice is recorded.
            </span>
          </span>
        </button>
      </Card>

      {error && (
        <p className="rounded-[10px] border border-critical/25 bg-critical/5 px-3.5 py-2.5 text-[13px] leading-relaxed text-critical">
          {error}
        </p>
      )}

      <div className="flex items-center justify-between gap-3">
        <Badge tone="neutral">Audio never leaves your browser until you stop</Badge>
        <Button variant="primary" size="lg" onClick={start}>
          <Mic size={16} /> Start recording
        </Button>
      </div>
    </div>
  );
}
