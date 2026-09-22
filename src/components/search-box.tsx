"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, X } from "lucide-react";
import { Input, Spinner } from "@/components/ui";

export function SearchBox({ initialQuery }: { initialQuery: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initialQuery);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Do not re-run the search the page was already rendered with.
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const timer = setTimeout(() => {
      startTransition(() => {
        router.replace(value.trim() ? `/search?q=${encodeURIComponent(value.trim())}` : "/search");
      });
    }, 280);

    return () => clearTimeout(timer);
  }, [value, router]);

  return (
    <div className="relative">
      <Search
        size={16}
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint"
      />
      <Input
        ref={inputRef}
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search every transcript…"
        className="h-11 pl-9 pr-10 text-[14.5px]"
      />
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        {pending ? (
          <Spinner className="text-ink-faint" />
        ) : value ? (
          <button
            onClick={() => setValue("")}
            className="text-ink-faint transition-colors hover:text-ink"
            aria-label="Clear search"
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
