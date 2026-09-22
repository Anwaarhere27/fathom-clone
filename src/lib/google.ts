import { createClient } from "@/lib/supabase/server";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events.readonly",
  "https://www.googleapis.com/auth/userinfo.email",
];

export function redirectUri() {
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/google/callback`;
}

export function consentUrl(state: string) {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    // offline + consent so a refresh token is actually issued. Google only
    // returns one on the first consent unless prompt=consent is forced.
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_URL}?${params}`;
}

export async function exchangeCode(code: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });

  if (!res.ok) throw new Error(`Token exchange failed: ${await res.text()}`);

  return (await res.json()) as {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope: string;
  };
}

async function refresh(refreshToken: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) throw new Error(`Token refresh failed: ${await res.text()}`);
  return (await res.json()) as { access_token: string; expires_in: number };
}

/**
 * Returns a usable access token, refreshing it if it has expired.
 *
 * Note for anyone running this: while the OAuth app is unverified, Google
 * expires refresh tokens after seven days, so a connection made today stops
 * working next week and has to be reconnected.
 */
export async function accessTokenFor(userId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("google_connections")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (!connection) return null;

  // A minute of slack so a token does not expire mid-request.
  if (new Date(connection.expires_at).getTime() > Date.now() + 60_000) {
    return connection.access_token as string;
  }

  if (!connection.refresh_token) return null;

  try {
    const refreshed = await refresh(connection.refresh_token);
    await supabase
      .from("google_connections")
      .update({
        access_token: refreshed.access_token,
        expires_at: new Date(Date.now() + refreshed.expires_in * 1000).toISOString(),
      })
      .eq("user_id", userId);
    return refreshed.access_token;
  } catch {
    return null;
  }
}

export interface GoogleEvent {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  meetingUrl: string | null;
  platform: string | null;
  attendees: { name?: string; email?: string }[];
}

/** Detect a joinable conference link, whichever field Google put it in. */
function conferenceFrom(event: {
  hangoutLink?: string;
  location?: string;
  description?: string;
  conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
}) {
  const video = event.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri;
  const candidate =
    video ??
    event.hangoutLink ??
    [event.location, event.description]
      .filter(Boolean)
      .join(" ")
      .match(/https?:\/\/[^\s<>"]+(?:zoom\.us|meet\.google\.com|teams\.microsoft\.com)[^\s<>"]*/i)?.[0] ??
    null;

  if (!candidate) return { url: null, platform: null };

  const platform = /zoom\.us/i.test(candidate)
    ? "zoom"
    : /meet\.google\.com/i.test(candidate)
      ? "meet"
      : /teams\.microsoft\.com/i.test(candidate)
        ? "teams"
        : null;

  return { url: candidate, platform };
}

export async function listUpcoming(accessToken: string): Promise<GoogleEvent[]> {
  const params = new URLSearchParams({
    timeMin: new Date().toISOString(),
    timeMax: new Date(Date.now() + 14 * 86_400_000).toISOString(),
    singleEvents: "true",
    orderBy: "startTime",
    maxResults: "25",
  });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/primary/events?${params}`,
    { headers: { Authorization: `Bearer ${accessToken}` }, cache: "no-store" }
  );

  if (!res.ok) throw new Error(`Calendar fetch failed: ${await res.text()}`);

  const body = (await res.json()) as {
    items?: {
      id: string;
      summary?: string;
      start?: { dateTime?: string; date?: string };
      end?: { dateTime?: string; date?: string };
      hangoutLink?: string;
      location?: string;
      description?: string;
      conferenceData?: { entryPoints?: { entryPointType?: string; uri?: string }[] };
      attendees?: { email?: string; displayName?: string }[];
    }[];
  };

  return (body.items ?? [])
    // All-day entries have a date but no dateTime and are not meetings.
    .filter((e) => e.start?.dateTime)
    .map((e) => {
      const { url, platform } = conferenceFrom(e);
      return {
        id: e.id,
        title: e.summary ?? "(no title)",
        startsAt: e.start!.dateTime!,
        endsAt: e.end?.dateTime ?? e.start!.dateTime!,
        meetingUrl: url,
        platform,
        attendees: (e.attendees ?? []).map((a) => ({ name: a.displayName, email: a.email })),
      };
    });
}
