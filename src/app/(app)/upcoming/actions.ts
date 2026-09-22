"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { accessTokenFor, listUpcoming } from "@/lib/google";

export async function setRecordEnabled(eventId: string, enabled: boolean) {
  const supabase = await createClient();
  const { error } = await supabase
    .from("calendar_events")
    .update({ record_enabled: enabled })
    .eq("id", eventId);
  if (error) throw new Error(error.message);
  revalidatePath("/upcoming");
}

export async function syncCalendar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  const token = await accessTokenFor(user.id);
  if (!token) throw new Error("Calendar is not connected, or the connection expired.");

  const events = await listUpcoming(token);

  if (events.length) {
    const { error } = await supabase.from("calendar_events").upsert(
      events.map((e) => ({
        user_id: user.id,
        google_event_id: e.id,
        title: e.title,
        starts_at: e.startsAt,
        ends_at: e.endsAt,
        meeting_url: e.meetingUrl,
        platform: e.platform,
        attendees: e.attendees,
        record_enabled: Boolean(e.meetingUrl),
      })),
      { onConflict: "user_id,google_event_id" }
    );
    if (error) throw new Error(error.message);
  }

  revalidatePath("/upcoming");
  return events.length;
}

export async function disconnectCalendar() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error("Not signed in");

  await supabase.from("google_connections").delete().eq("user_id", user.id);
  // Only remove events that came from Google; seeded demo entries stay.
  await supabase
    .from("calendar_events")
    .delete()
    .eq("user_id", user.id)
    .not("google_event_id", "is", null);

  revalidatePath("/upcoming");
}
