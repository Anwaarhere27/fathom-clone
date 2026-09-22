"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { AudioLines } from "lucide-react";
import { Button, Card, Input, Spinner } from "@/components/ui";
import { TryDemoButton } from "@/components/try-demo-button";
import { createClient } from "@/lib/supabase/client";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") ?? "/meetings";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setNotice(null);

    const supabase = createClient();

    if (mode === "signup") {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name || email.split("@")[0] } },
      });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
      // With email confirmation on, there is no session yet.
      if (!data.session) {
        setNotice("Check your inbox to confirm your address, then sign in.");
        setBusy(false);
        return;
      }
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setError(error.message);
        setBusy(false);
        return;
      }
    }

    router.refresh();
    router.push(next);
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-4 py-10">
      <div className="w-full max-w-[400px]">
        <Link href="/" className="mb-8 flex items-center justify-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-white">
            <AudioLines size={17} />
          </div>
          <span className="text-[15px] font-semibold tracking-tight">Cadence Notes</span>
        </Link>

        <Card className="p-7">
          <h1 className="text-[22px] font-semibold tracking-tight">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-1.5 text-[13.5px] text-ink-soft">
            {mode === "login"
              ? "Sign in to get to your meetings."
              : "Start recording and summarising your calls."}
          </p>

          <form onSubmit={submit} className="mt-6 space-y-3.5">
            {mode === "signup" && (
              <label className="block">
                <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Name</span>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Alex Rivera"
                  autoComplete="name"
                />
              </label>
            )}

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Email</span>
              <Input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                autoComplete="email"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink-soft">Password</span>
              <Input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </label>

            {error && <p className="text-[13px] text-critical">{error}</p>}
            {notice && <p className="text-[13px] text-positive">{notice}</p>}

            <Button type="submit" variant="primary" className="w-full" disabled={busy}>
              {busy ? <Spinner /> : mode === "login" ? "Sign in" : "Create account"}
            </Button>
          </form>

          <div className="my-6 flex items-center gap-3">
            <div className="h-px flex-1 bg-line" />
            <span className="text-[12px] text-ink-faint">or</span>
            <div className="h-px flex-1 bg-line" />
          </div>

          <TryDemoButton
            size="md"
            label="Explore the demo workspace"
            className="[&>button]:w-full"
          />
          <p className="mt-2 text-center text-[12px] text-ink-faint">
            Five meetings, already recorded and summarised.
          </p>
        </Card>

        <p className="mt-5 text-center text-[13px] text-ink-soft">
          {mode === "login" ? (
            <>
              No account yet?{" "}
              <Link href="/signup" className="font-medium text-brand-ink hover:underline">
                Create one
              </Link>
            </>
          ) : (
            <>
              Already have one?{" "}
              <Link href="/login" className="font-medium text-brand-ink hover:underline">
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
