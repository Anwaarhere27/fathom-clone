import { Suspense } from "react";
import { LiveRecorder } from "@/components/live-recorder";

export default function RecordPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Record a meeting</h1>
      <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-ink-soft">
        Capture the call as it happens. When you stop, it is transcribed, summarised and filed with
        your other meetings.
      </p>

      <div className="mt-6">
        <Suspense>
          <LiveRecorder />
        </Suspense>
      </div>
    </div>
  );
}
