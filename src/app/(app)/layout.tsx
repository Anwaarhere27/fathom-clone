import { redirect } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { createClient } from "@/lib/supabase/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, email, is_demo")
    .eq("id", user.id)
    .maybeSingle();

  const isDemo = profile?.is_demo ?? user.is_anonymous ?? false;

  return (
    <AppShell
      userName={profile?.full_name ?? (isDemo ? "Alex Rivera" : "You")}
      userEmail={profile?.email ?? (isDemo ? "alex@cadence.io" : (user.email ?? ""))}
      isDemo={isDemo}
    >
      {children}
    </AppShell>
  );
}
