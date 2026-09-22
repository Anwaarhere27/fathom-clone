"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button, Spinner } from "@/components/ui";
import { cn } from "@/lib/utils";

export function TryDemoButton({
  className,
  size = "lg",
  label = "Try the demo",
}: {
  className?: string;
  size?: "sm" | "md" | "lg";
  label?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");

  async function start() {
    setState("loading");
    try {
      const res = await fetch("/api/demo", { method: "POST" });
      if (!res.ok) throw new Error((await res.json()).error ?? "Something went wrong");
      // Server components need to re-read the new session cookie.
      router.refresh();
      router.push("/meetings");
    } catch {
      setState("error");
    }
  }

  return (
    <div className={cn("flex flex-col items-center gap-2", className)}>
      <Button variant="primary" size={size} onClick={start} disabled={state === "loading"}>
        {state === "loading" ? (
          <>
            <Spinner /> Setting up your workspace
          </>
        ) : (
          <>
            {label} <ArrowRight size={16} />
          </>
        )}
      </Button>
      {state === "error" && (
        <p className="text-[13px] text-critical">Could not start the demo. Try again.</p>
      )}
    </div>
  );
}
