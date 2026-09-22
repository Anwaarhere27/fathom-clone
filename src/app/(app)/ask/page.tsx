import { AskPanel } from "@/components/ask-panel";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AskPage() {
  const supabase = await createClient();
  const { count } = await supabase.from("meetings").select("id", { count: "exact", head: true });

  return (
    <div className="mx-auto flex h-[calc(100dvh-1px)] max-w-3xl flex-col px-4 py-8 sm:px-6 lg:h-dvh lg:py-10">
      <div className="mb-5 shrink-0">
        <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Ask AI</h1>
        <p className="mt-1 text-[13.5px] text-ink-soft">
          Questions answered from {count ?? 0} recorded {count === 1 ? "meeting" : "meetings"}, with
          the moment it came from.
        </p>
      </div>

      <AskPanel />
    </div>
  );
}
