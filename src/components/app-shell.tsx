"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  AudioLines,
  CalendarDays,
  LogOut,
  Menu,
  Mic,
  MessageSquareText,
  Search,
  Upload,
  Video,
  X,
} from "lucide-react";
import { Avatar, Badge, Button } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn, speakerColor } from "@/lib/utils";

const NAV = [
  { href: "/meetings", label: "Meetings", icon: Video },
  { href: "/upcoming", label: "Upcoming", icon: CalendarDays },
  { href: "/search", label: "Search", icon: Search },
  { href: "/ask", label: "Ask AI", icon: MessageSquareText },
  { href: "/record", label: "Record", icon: Mic },
  { href: "/upload", label: "Upload", icon: Upload },
];

export function AppShell({
  children,
  userName,
  userEmail,
  isDemo,
}: {
  children: React.ReactNode;
  userName: string;
  userEmail: string;
  isDemo: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function signOut() {
    await createClient().auth.signOut();
    router.refresh();
    router.push("/");
  }

  const nav = (
    <nav className="flex flex-col gap-0.5">
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            onClick={() => setMobileOpen(false)}
            className={cn(
              "flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium transition-colors",
              active
                ? "bg-brand-soft text-brand-ink"
                : "text-ink-soft hover:bg-sunken hover:text-ink"
            )}
          >
            <Icon size={16} />
            {label}
          </Link>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Sidebar, desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col border-r border-line bg-surface px-3 py-4 lg:flex">
        <Link href="/meetings" className="mb-6 flex items-center gap-2 px-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
            <AudioLines size={17} />
          </div>
          <span className="text-[14.5px] font-semibold tracking-tight">Cadence Notes</span>
        </Link>

        {nav}

        <div className="mt-auto border-t border-line pt-3">
          {isDemo && (
            <div className="mb-3 rounded-[10px] border border-brand-line bg-brand-soft p-3">
              <Badge tone="brand" className="mb-1.5">
                Demo workspace
              </Badge>
              <p className="text-[12px] leading-relaxed text-brand-ink">
                This is your own private copy. Change anything you like.
              </p>
            </div>
          )}
          <div className="flex items-center gap-2.5 px-2 py-1.5">
            <Avatar name={userName} color={speakerColor(userName)} size={30} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-medium">{userName}</p>
              <p className="truncate text-[11.5px] text-ink-faint">{userEmail}</p>
            </div>
            <button
              onClick={signOut}
              title="Sign out"
              className="rounded-md p-1.5 text-ink-faint transition-colors hover:bg-sunken hover:text-ink"
            >
              <LogOut size={15} />
            </button>
          </div>
        </div>
      </aside>

      {/* Top bar, mobile */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/meetings" className="flex items-center gap-2">
          <div className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-white">
            <AudioLines size={15} />
          </div>
          <span className="text-[14px] font-semibold tracking-tight">Cadence Notes</span>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => setMobileOpen((v) => !v)}>
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </Button>
      </header>

      {mobileOpen && (
        <div className="sticky top-[53px] z-20 border-b border-line bg-surface px-3 py-3 lg:hidden">
          {nav}
          <button
            onClick={signOut}
            className="mt-2 flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2 text-[13.5px] font-medium text-ink-soft hover:bg-sunken"
          >
            <LogOut size={16} /> Sign out
          </button>
        </div>
      )}

      <main className="lg:pl-60">{children}</main>
    </div>
  );
}
