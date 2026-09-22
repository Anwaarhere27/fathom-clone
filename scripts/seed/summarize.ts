#!/usr/bin/env node
/**
 * Generates summaries, action items and follow-up emails for every seeded
 * meeting, and writes them to the database.
 *
 *   npm run seed:summarize
 *   npm run seed:summarize -- --force      # regenerate what already exists
 *
 * This runs at seed time rather than on page load so the demo opens instantly.
 * The generation path is the same code the app uses for uploaded recordings --
 * nothing here is hand-written.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildNotes,
  summarizeToTemplate,
  extractActionItems,
  draftFollowUpEmail,
  defaultTemplateFor,
  TEMPLATE_IDS,
  type TranscriptLine,
} from "../../src/lib/ai/summarize";
import type { SummaryTemplate } from "../../src/lib/types";

// Load .env.local before anything reads process.env.
for (const line of readFileSync(join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  if (!line || line.trimStart().startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  process.env[line.slice(0, i).trim()] ??= line.slice(i + 1).trim();
}

const force = process.argv.includes("--force");

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } }
);

const { data: template } = await supabase.from("demo_template").select("user_id").maybeSingle();
if (!template?.user_id) {
  console.error("No demo template user. Run: npm run seed:load");
  process.exit(1);
}

const { data: meetings, error } = await supabase
  .from("meetings")
  .select("id, title, duration_seconds, participant_count")
  .eq("user_id", template.user_id)
  .order("started_at");
if (error) throw error;

for (const meeting of meetings ?? []) {
  console.log(`\n${meeting.title}`);

  const { count } = await supabase
    .from("summaries")
    .select("id", { count: "exact", head: true })
    .eq("meeting_id", meeting.id);

  if (count && count > 0 && !force) {
    console.log("  already summarised, skipping");
    continue;
  }

  const { data: people } = await supabase
    .from("participants")
    .select("name")
    .eq("meeting_id", meeting.id);
  const participants = (people ?? []).map((p) => p.name);

  // Pull the transcript in pages; PostgREST caps a single select at 1,000 rows.
  const lines: TranscriptLine[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from("transcript_segments")
      .select("speaker_name, start_ms, text")
      .eq("meeting_id", meeting.id)
      .order("idx")
      .range(from, from + 999);
    if (!page?.length) break;
    lines.push(...page);
    if (page.length < 1000) break;
  }

  console.log(`  ${lines.length} segments -> condensing`);
  const notes = await buildNotes(lines, (done, total) =>
    process.stdout.write(`\r  notes ${done}/${total} chunks   `)
  );
  console.log(`\r  notes built (${notes.length} chars)        `);

  const meta = {
    title: meeting.title,
    participants,
    durationMinutes: Math.round(meeting.duration_seconds / 60),
  };

  // The template this meeting opens on, plus general, plus one more so that
  // switching template in the UI has somewhere real to switch to.
  const primary = defaultTemplateFor(meeting.title);
  const wanted: SummaryTemplate[] = [...new Set<SummaryTemplate>([primary, "general", ...TEMPLATE_IDS])];

  if (force) await supabase.from("summaries").delete().eq("meeting_id", meeting.id);

  for (const templateId of wanted) {
    const summary = await summarizeToTemplate(notes, templateId, meta);
    const { error: upsertError } = await supabase.from("summaries").upsert(
      {
        meeting_id: meeting.id,
        template: templateId,
        sections: summary.sections,
        one_liner: summary.one_liner,
        model: summary.model,
      },
      { onConflict: "meeting_id,template" }
    );
    if (upsertError) throw upsertError;
    const bullets = summary.sections.reduce((n, s) => n + s.bullets.length, 0);
    console.log(`  summary [${templateId}]: ${summary.sections.length} sections, ${bullets} bullets`);
  }

  await supabase.from("action_items").delete().eq("meeting_id", meeting.id);
  const items = await extractActionItems(notes, participants);
  if (items.length) {
    const { error: itemsError } = await supabase
      .from("action_items")
      .insert(items.map((i) => ({ ...i, meeting_id: meeting.id })));
    if (itemsError) throw itemsError;
  }
  console.log(`  action items: ${items.length}`);

  await supabase.from("follow_up_emails").delete().eq("meeting_id", meeting.id);
  const email = await draftFollowUpEmail(notes, {
    title: meeting.title,
    sender: "Alex Rivera",
    participants,
  });
  const { error: emailError } = await supabase
    .from("follow_up_emails")
    .insert({ meeting_id: meeting.id, subject: email.subject, body: email.body });
  if (emailError) throw emailError;
  console.log(`  follow-up email: "${email.subject}"`);
}

console.log("\nSummaries generated.");
