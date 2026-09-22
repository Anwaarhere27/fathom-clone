#!/usr/bin/env node
/**
 * Loads the generated transcripts, timings and audio into Supabase under a
 * template user. Every "Try the demo" visitor gets a clone of it.
 *
 *   npm run seed:load
 *
 * Re-running wipes the template user's meetings and rebuilds them, so this is
 * safe to iterate on. It does not touch real users' data.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { BLUEPRINTS, OWNER } from "./blueprints.mjs";
import { loadEnv } from "../lib/db.mjs";

const env = loadEnv();
const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const BUCKET = "recordings";
const TEMPLATE_EMAIL = "demo-template@cadence.local";

/** Upcoming calendar entries, relative to whenever the demo is opened. */
const UPCOMING = [
  {
    title: "Meridian Logistics — Technical deep dive",
    inHours: 3,
    minutes: 45,
    platform: "zoom",
    url: "https://zoom.us/j/8821049",
    attendees: ["Alex Rivera", "Sarah Chen", "Marcus Webb", "Elena Vasquez"],
    record: true,
  },
  {
    title: "Weekly pipeline review",
    inHours: 22,
    minutes: 30,
    platform: "meet",
    url: "https://meet.google.com/kfp-rxzq-mnv",
    attendees: ["Alex Rivera", "Nadia Hassan", "James Mbeki"],
    record: true,
  },
  {
    title: "1:1 with Nadia",
    inHours: 26,
    minutes: 30,
    platform: "meet",
    url: "https://meet.google.com/qwe-asdf-zxc",
    attendees: ["Alex Rivera", "Nadia Hassan"],
    record: false,
  },
  {
    title: "Helix Health — Epic integration checkpoint",
    inHours: 49,
    minutes: 60,
    platform: "teams",
    url: "https://teams.microsoft.com/l/meetup-join/19%3ameeting_demo",
    attendees: ["Alex Rivera", "Tom Bradley", "Elena Vasquez", "Marcus Webb", "Priya Raman"],
    record: true,
  },
];

async function ensureTemplateUser() {
  const { data: existing } = await supabase.from("demo_template").select("user_id").maybeSingle();
  if (existing?.user_id) {
    console.log(`template user: ${existing.user_id} (existing)`);
    return existing.user_id;
  }

  // createUser fails if the address is taken, which happens when demo_template
  // was cleared but the auth user survived.
  const { data: page } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const found = page?.users?.find((u) => u.email === TEMPLATE_EMAIL);

  let userId = found?.id;
  if (!userId) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: TEMPLATE_EMAIL,
      email_confirm: true,
      user_metadata: { full_name: OWNER.name },
    });
    if (error) throw error;
    userId = data.user.id;
    console.log(`template user: ${userId} (created)`);
  } else {
    console.log(`template user: ${userId} (recovered)`);
  }

  await supabase
    .from("profiles")
    .upsert({ id: userId, email: OWNER.email, full_name: OWNER.name, is_demo: false });
  await supabase.from("demo_template").upsert({ id: true, user_id: userId });

  return userId;
}

async function ensureBucket() {
  const { data: buckets } = await supabase.storage.listBuckets();
  if (buckets?.some((b) => b.name === BUCKET)) {
    console.log(`bucket: ${BUCKET} (existing)`);
    return;
  }
  const { error } = await supabase.storage.createBucket(BUCKET, {
    public: true,
    fileSizeLimit: "200MB",
    allowedMimeTypes: ["audio/mpeg", "audio/wav", "video/mp4", "audio/mp4", "audio/webm", "video/webm"],
  });
  if (error) throw error;
  console.log(`bucket: ${BUCKET} (created, public)`);
}

async function uploadAudio(slug) {
  const path = join(process.cwd(), "seed", "audio", `${slug}.mp3`);
  if (!existsSync(path)) return null;

  const body = readFileSync(path);
  const key = `seed/${slug}.mp3`;
  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(key, body, { contentType: "audio/mpeg", upsert: true });
  if (error) throw error;

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(key);
  console.log(`  uploaded ${(body.length / 1e6).toFixed(1)} MB`);
  return data.publicUrl;
}

/** started_at derived from the blueprint's daysAgo/startHour, in local time. */
function startedAt(bp) {
  const d = new Date();
  d.setDate(d.getDate() - bp.daysAgo);
  d.setHours(bp.startHour, 0, 0, 0);
  return d.toISOString();
}

async function loadMeeting(bp, userId) {
  const timingPath = join(process.cwd(), "seed", "audio", `${bp.slug}.timings.json`);
  const transcriptPath = join(process.cwd(), "seed", "transcripts", `${bp.slug}.json`);

  if (!existsSync(transcriptPath)) {
    console.log(`${bp.slug}: no transcript, skipping`);
    return;
  }

  console.log(`${bp.slug}:`);

  // Timings come from the real audio when it exists. Without it we fall back to
  // a reading-speed estimate so the app still works, but seek will be
  // approximate -- so say so rather than letting it look exact.
  let turns;
  let durationMs;
  if (existsSync(timingPath)) {
    const timing = JSON.parse(readFileSync(timingPath, "utf8"));
    turns = timing.turns;
    durationMs = timing.duration_ms;
  } else {
    console.log("  WARNING: no audio timings, estimating from word count");
    const raw = JSON.parse(readFileSync(transcriptPath, "utf8")).turns;
    let cursor = 0;
    turns = raw.map((t, idx) => {
      const ms = Math.round((t.text.split(/\s+/).length / 150) * 60_000);
      const start = cursor;
      cursor += ms + 300;
      return { idx, speaker: t.speaker, text: t.text, start_ms: start, end_ms: start + ms };
    });
    durationMs = cursor;
  }

  const mediaUrl = await uploadAudio(bp.slug);

  const { data: meeting, error: meetingError } = await supabase
    .from("meetings")
    .insert({
      user_id: userId,
      title: bp.title,
      started_at: startedAt(bp),
      duration_seconds: Math.round(durationMs / 1000),
      platform: bp.platform,
      source: bp.source,
      status: "ready",
      media_url: mediaUrl,
      media_type: mediaUrl ? "audio/mpeg" : null,
      participant_count: bp.participants.length,
      accent: bp.accent,
    })
    .select("id")
    .single();
  if (meetingError) throw meetingError;

  // Talk time is real: sum of each speaker's clip durations.
  const talk = new Map();
  for (const t of turns) {
    talk.set(t.speaker, (talk.get(t.speaker) ?? 0) + (t.end_ms - t.start_ms));
  }

  const { data: people, error: peopleError } = await supabase
    .from("participants")
    .insert(
      bp.participants.map((p) => ({
        meeting_id: meeting.id,
        name: p.name,
        email: `${p.name.split(" ")[0].toLowerCase()}@${p.company.toLowerCase().replace(/\s+/g, "")}.com`,
        company: p.company,
        is_host: Boolean(p.host),
        talk_seconds: Math.round((talk.get(p.name) ?? 0) / 1000),
      }))
    )
    .select("id, name");
  if (peopleError) throw peopleError;

  const idByName = new Map(people.map((p) => [p.name, p.id]));

  // Batched: a 285-turn meeting in one insert times out on the free tier.
  const rows = turns.map((t) => ({
    meeting_id: meeting.id,
    participant_id: idByName.get(t.speaker) ?? null,
    speaker_name: t.speaker,
    idx: t.idx,
    start_ms: t.start_ms,
    end_ms: t.end_ms,
    text: t.text,
  }));

  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from("transcript_segments").insert(rows.slice(i, i + 100));
    if (error) throw error;
  }

  console.log(
    `  ${rows.length} segments, ${bp.participants.length} participants, ${(durationMs / 60000).toFixed(1)} min`
  );
  return meeting.id;
}

async function loadCalendar(userId) {
  const now = Date.now();
  const rows = UPCOMING.map((e) => {
    const start = new Date(now + e.inHours * 3_600_000);
    return {
      user_id: userId,
      google_event_id: null,
      title: e.title,
      starts_at: start.toISOString(),
      ends_at: new Date(start.getTime() + e.minutes * 60_000).toISOString(),
      meeting_url: e.url,
      platform: e.platform,
      attendees: e.attendees.map((name) => ({ name })),
      record_enabled: e.record,
    };
  });

  const { error } = await supabase.from("calendar_events").insert(rows);
  if (error) throw error;
  console.log(`calendar: ${rows.length} upcoming events`);
}

// ---------------------------------------------------------------------------

const userId = await ensureTemplateUser();
await ensureBucket();

// Rebuild from scratch. Cascades clear participants, segments, summaries etc.
const { error: wipeError } = await supabase.from("meetings").delete().eq("user_id", userId);
if (wipeError) throw wipeError;
await supabase.from("calendar_events").delete().eq("user_id", userId);

for (const bp of BLUEPRINTS) await loadMeeting(bp, userId);
await loadCalendar(userId);

console.log("\nSeed loaded.");
