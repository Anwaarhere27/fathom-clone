import { CalendarDays, CircleAlert, Video } from "lucide-react";
import { Badge, Button, Card } from "@/components/ui";
import { CalendarControls, EventRow } from "@/components/upcoming-controls";
import { createClient } from "@/lib/supabase/server";
import type { CalendarEvent } from "@/lib/types";

export const dynamic = "force-dynamic";

const ERRORS: Record<string, string> = {
  bad_state: "That sign-in attempt could not be verified. Please try connecting again.",
  missing_code: "Google did not send an authorisation code back.",
  access_denied: "You declined access, so the calendar was not connected.",
};

export default async function UpcomingPage({
  searchParams,
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const { connected, error } = await searchParams;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [{ data: connection }, { data: events }] = await Promise.all([
    supabase.from("google_connections").select("google_email").maybeSingle(),
    supabase
      .from("calendar_events")
      .select("*")
      .gte("ends_at", new Date().toISOString())
      .order("starts_at")
      .limit(25),
  ]);

  const list = (events ?? []) as CalendarEvent[];
  const isDemo = user?.is_anonymous ?? false;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 lg:py-10">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-[26px] font-semibold tracking-[-0.015em]">Upcoming</h1>
          <p className="mt-1 text-[13.5px] text-ink-soft">
            Choose which meetings the notetaker joins.
          </p>
        </div>
        <CalendarControls connectedEmail={connection?.google_email ?? null} />
      </div>

      {error && (
        <Card className="mb-4 flex items-start gap-2.5 border-critical/25 bg-critical/5 p-3.5">
          <CircleAlert size={16} className="mt-0.5 shrink-0 text-critical" />
          <p className="text-[13px] leading-relaxed text-critical">
            {ERRORS[error] ?? `Could not connect the calendar: ${error}`}
          </p>
        </Card>
      )}

      {connected && (
        <Card className="mb-4 border-positive/25 bg-positive/5 p-3.5">
          <p className="text-[13px] text-positive">
            Calendar connected. Your next two weeks of meetings are below.
          </p>
        </Card>
      )}

      {!connection && (
        <Card className="mb-4 p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="max-w-md">
              <h2 className="text-[15px] font-semibold tracking-tight">
                {isDemo ? "This demo calendar is pre-filled" : "Connect your calendar"}
              </h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-ink-soft">
                {isDemo
                  ? "The meetings below are seeded so you can see the flow. Connecting a real Google Calendar works too, though the consent screen will warn you the app is unverified."
                  : "Cadence Notes reads your upcoming events so the notetaker knows which calls to join. Read-only access; nothing is ever written to your calendar."}
              </p>
            </div>
            <a href="/api/google/connect" className="shrink-0">
              <Button variant={isDemo ? "secondary" : "primary"} size="sm">
                <CalendarDays size={15} /> Connect Google Calendar
              </Button>
            </a>
          </div>
        </Card>
      )}

      {list.length === 0 ? (
        <Card className="px-6 py-14 text-center">
          <Video size={22} className="mx-auto mb-3 text-ink-faint" />
          <h2 className="text-[16px] font-semibold tracking-tight">Nothing coming up</h2>
          <p className="mx-auto mt-1.5 max-w-sm text-[13.5px] leading-relaxed text-ink-soft">
            Meetings with a Zoom, Meet or Teams link will show here once your calendar is
            connected.
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {list.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}

      <Card className="mt-5 border-brand-line bg-brand-soft p-4">
        <Badge tone="brand" className="mb-2">
          How capture works here
        </Badge>
        <p className="text-[13px] leading-relaxed text-brand-ink">
          A bot that joins Zoom, Meet and Teams calls is an infrastructure project, not a feature,
          and it is the one part this rebuild deliberately does not fake. Instead you can record a
          call live from your browser, or upload a recording you already have — both run through
          the same transcription and summarisation pipeline the seeded meetings did.
        </p>
      </Card>
    </div>
  );
}
