#!/usr/bin/env node
/**
 * Applies every file in supabase/migrations in name order.
 *
 * Connects through the Supabase transaction pooler. The database password is
 * passed as a config field rather than inside a URI, so passwords containing
 * ? > < : " and friends need no percent-encoding.
 *
 *   npm run migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

const env = Object.fromEntries(
  readFileSync(join(process.cwd(), ".env.local"), "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
const password = env.SUPABASE_DB_PASSWORD;
if (!password) throw new Error("SUPABASE_DB_PASSWORD missing from .env.local");

// Supabase has shuffled pooler hostnames between projects; try the plausible
// ones rather than making the region/prefix a thing anyone has to look up.
const REGION = env.SUPABASE_DB_REGION || "ap-south-1";
const candidates = [
  { host: `aws-1-${REGION}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
  { host: `aws-0-${REGION}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
  { host: `aws-1-${REGION}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
  { host: `aws-0-${REGION}.pooler.supabase.com`, port: 5432, user: `postgres.${ref}` },
  { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
];

async function connect() {
  let lastError;
  for (const c of candidates) {
    const client = new pg.Client({
      ...c,
      database: "postgres",
      password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
      // The transaction pooler does not support prepared statements.
      statement_timeout: 120000,
    });
    try {
      await client.connect();
      console.log(`connected via ${c.host}:${c.port}`);
      return client;
    } catch (err) {
      lastError = err;
      console.log(`  ${c.host}:${c.port} -> ${err.code || err.message}`);
      await client.end().catch(() => {});
    }
  }
  throw lastError;
}

const client = await connect();
const dir = join(process.cwd(), "supabase", "migrations");

try {
  for (const name of readdirSync(dir).filter((n) => n.endsWith(".sql")).sort()) {
    process.stdout.write(`applying ${name} ... `);
    await client.query(readFileSync(join(dir, name), "utf8"));
    console.log("ok");
  }
  console.log("\nAll migrations applied.");
} catch (err) {
  console.error(`\nFAILED\n${err.message}`);
  if (err.position) console.error(`at character ${err.position}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
