import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { createClient, getUser } from "@/lib/supabase/server";
import { exchangeCode, listUpcoming } from "@/lib/google";

function back(path: string) {
  return NextResponse.redirect(new URL(path, process.env.NEXT_PUBLIC_SITE_URL));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");

  if (denied) return back(`/upcoming?error=${encodeURIComponent(denied)}`);
  if (!code) return back("/upcoming?error=missing_code");

  const jar = await cookies();
  const expected = jar.get("google_oauth_state")?.value;
  jar.delete("google_oauth_state");
  if (!expected || expected !== state) return back("/upcoming?error=bad_state");

  const user = await getUser();
  if (!user) return back("/login");

  try {
    const tokens = await exchangeCode(code);
    const supabase = await createClient();

    // Google omits refresh_token when re-consenting; keep the stored one so a
    // reconnect does not silently downgrade the connection to session-only.
    const { data: existing } = await supabase
      .from("google_connections")
      .select("refresh_token")
      .eq("user_id", user.id)
      .maybeSingle();

    const profile = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null);

    await supabase.from("google_connections").upsert(
      {
        user_id: user.id,
        google_email: profile?.email ?? user.email ?? "connected",
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? existing?.refresh_token ?? null,
        expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
        scope: tokens.scope,
      },
      { onConflict: "user_id" }
    );

    // Pull the calendar straight away so the page has content on first load
    // rather than an empty list the user has to refresh.
    try {
      const events = await listUpcoming(tokens.access_token);
      if (events.length) {
        await supabase.from("calendar_events").upsert(
          events.map((e) => ({
            user_id: user.id,
            google_event_id: e.id,
            title: e.title,
            starts_at: e.startsAt,
            ends_at: e.endsAt,
            meeting_url: e.meetingUrl,
            platform: e.platform,
            attendees: e.attendees,
            // Default to recording anything with a joinable link.
            record_enabled: Boolean(e.meetingUrl),
          })),
          { onConflict: "user_id,google_event_id" }
        );
      }
    } catch {
      // Connection is saved; the page can retry the sync itself.
    }

    return back("/upcoming?connected=1");
  } catch (error) {
    return back(
      `/upcoming?error=${encodeURIComponent(error instanceof Error ? error.message.slice(0, 120) : "exchange_failed")}`
    );
  }
}
