import { UploadPanel } from "@/components/upload-panel";

export default function UploadPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:py-10">
      <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Upload a recording</h1>
      <p className="mt-1.5 max-w-lg text-[13.5px] leading-relaxed text-ink-soft">
        A Zoom file a client sent you, a voice memo, a webinar you downloaded. Drop it in and it
        becomes a meeting like any other — transcribed, summarised, searchable and shareable.
      </p>

      <div className="mt-6">
        <UploadPanel />
      </div>
    </div>
  );
}
