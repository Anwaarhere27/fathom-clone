#!/usr/bin/env node
/** Prints what is actually in the database. npm run db:status */
import { connect } from "./lib/db.mjs";

const client = await connect();
try {
  const tables = await client.query(
    "select tablename from pg_tables where schemaname = 'public' order by 1"
  );
  console.log(`tables (${tables.rowCount}): ${tables.rows.map((r) => r.tablename).join(", ")}`);

  const fns = await client.query(
    "select proname from pg_proc where proname in ('clone_demo_workspace', 'handle_new_user') order by 1"
  );
  console.log(`functions: ${fns.rows.map((r) => r.proname).join(", ") || "none"}`);

  const trg = await client.query("select 1 from pg_trigger where tgname = 'on_auth_user_created'");
  console.log(`auth trigger: ${trg.rowCount ? "present" : "MISSING"}`);

  const pol = await client.query(
    "select count(*)::int n from pg_policies where schemaname = 'public'"
  );
  console.log(`rls policies: ${pol.rows[0].n}`);

  for (const t of ["meetings", "transcript_segments", "summaries", "action_items"]) {
    const { rows } = await client.query(`select count(*)::int n from ${t}`);
    console.log(`  ${t}: ${rows[0].n} rows`);
  }
} finally {
  await client.end();
}
