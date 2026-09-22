import { NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { transcribeFile, inferSpeakers, MAX_UPLOAD_BYTES } from "@/lib/ai/transcribe";
import {
  buildNotes,
  summarizeToTemplate,
  extractActionItems,
  draftFollowUpEmail,
  defaultTemplateFor,
} from "@/lib/ai/summarize";

export const maxDuration = 300;

const ACCENTS = ["indigo", "emerald", "amber", "violet", "rose"];

/**
 * Upload a recording you already have.
 *
 * This is the gap in Fathom: a Zoom file a client emailed you, a voice memo, a
 * webinar download -- none of it can get in, because Fathom only ingests calls
 * its own bot attended. Here an uploaded file becomes an ordinary meeting:
 * transcribed, summarised, searchable, clippable, shareable.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const title = (form.get("title") as string | null)?.trim();

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file received." }, { status: 400 });
  }

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: `That file is ${(file.size / 1e6).toFixed(0)} MB. The transcription API accepts up to 25 MB — export audio-only, or trim it first.`,
      },
      { status: 413 }
    );
  }

  const meetingTitle = title || file.name.replace(/\.[^.]+$/, "") || "Uploaded recording";

  // Create the row first so the UI has something to show while the slow parts
  // run, and so a failure leaves a visible record rather than silence.
  const { data: meeting, error: createError } = await supabase
    .from("meetings")
    .insert({
      user_id: user.id,
      title: meetingTitle,
      started_at: new Date().toISOString(),
      duration_seconds: 0,
      platform: "upload",
      source: "upload",
      status: "processing",
      media_type: file.type || "audio/mpeg",
      accent: ACCENTS[Math.floor(Math.random() * ACCENTS.length)],
    })
    .select("id")
    .single();

  if (createError || !meeting) {
    return NextResponse.json({ error: createError?.message ?? "Could not start." }, { status: 500 });
  }

  try {
    // Storage write uses the service role: the bucket is public for playback
    // and should not be writable by end users.
    const admin = createAdminClient();
    const key = `uploads/${user.id}/${meeting.id}-${file.name.replace(/[^\w.-]+/g, "_")}`;
    const { error: uploadError } = await admin.storage
      .from("recordings")
      .upload(key, file, { contentType: file.type || "audio/mpeg", upsert: true });
    if (uploadError) throw new Error(uploadError.message);

    const { data: publicUrl } = admin.storage.from("recordings").getPublicUrl(key);

    const segments = await transcribeFile(file);
    if (segments.length === 0) throw new Error("No speech was found in that file.");

    const { labels, confident } = await inferSpeakers(segments);

    const durationMs = segments[segments.length - 1]?.end_ms ?? 0;
    const speakerNames = [...new Set(labels)];

    const { data: people } = await supabase
      .from("participants")
      .insert(
        speakerNames.map((name, i) => ({
          meeting_id: meeting.id,
          name,
          is_host: i === 0,
          talk_seconds: Math.round(
            segments.reduce(
              (n, s, j) => n + (labels[j] === name ? s.end_ms - s.start_ms : 0),
              0
            ) / 1000
          ),
        }))
      )
      .select("id, name");

    const idByName = new Map((people ?? []).map((p) => [p.name, p.id]));

    const rows = segments.map((s, i) => ({
      meeting_id: meeting.id,
      participant_id: idByName.get(labels[i]) ?? null,
      speaker_name: labels[i],
      idx: i,
      start_ms: s.start_ms,
      end_ms: s.end_ms,
      text: s.text,
    }));

    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await supabase.from("transcript_segments").insert(rows.slice(i, i + 100));
      if (error) throw new Error(error.message);
    }

    await supabase
      .from("meetings")
      .update({
        media_url: publicUrl.publicUrl,
        duration_seconds: Math.round(durationMs / 1000),
        participant_count: speakerNames.length,
        status: "ready",
      })
      .eq("id", meeting.id);

    // The transcript is the thing that must land. Summaries are generated on a
    // best-effort basis so a spent token budget does not lose the recording --
    // the meeting page can generate them later on demand.
    try {
      const notes = await buildNotes(
        segments.map((s, i) => ({
          speaker_name: labels[i],
          start_ms: s.start_ms,
          text: s.text,
        }))
      );

      const template = defaultTemplateFor(meetingTitle);
      const meta = {
        title: meetingTitle,
        participants: speakerNames,
        durationMinutes: Math.round(durationMs / 60_000),
      };

      const summary = await summarizeToTemplate(notes, template, meta);
      await supabase.from("summaries").upsert(
        {
          meeting_id: meeting.id,
          template,
          sections: summary.sections,
          one_liner: summary.one_liner,
          model: summary.model,
        },
        { onConflict: "meeting_id,template" }
      );

      const items = await extractActionItems(notes, speakerNames);
      if (items.length) {
        await supabase
          .from("action_items")
          .insert(items.map((i) => ({ ...i, meeting_id: meeting.id })));
      }

      const email = await draftFollowUpEmail(notes, {
        title: meetingTitle,
        sender: "you",
        participants: speakerNames,
      });
      await supabase
        .from("follow_up_emails")
        .insert({ meeting_id: meeting.id, subject: email.subject, body: email.body });
    } catch {
      // Left without a summary; the meeting page offers to generate one.
    }

    return NextResponse.json({
      id: meeting.id,
      segments: segments.length,
      speakers: speakerNames.length,
      durationSeconds: Math.round(durationMs / 1000),
      speakersInferred: confident,
    });
  } catch (error) {
    await supabase.from("meetings").update({ status: "failed" }).eq("id", meeting.id);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Processing failed." },
      { status: 500 }
    );
  }
}
