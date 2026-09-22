/**
 * Shared Postgres connection for the migration and seed scripts.
 *
 * Connects through the Supabase pooler with the password as a config field
 * rather than inside a URI, so passwords containing ? > < : " need no
 * percent-encoding.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import pg from "pg";

export function loadEnv() {
  return Object.fromEntries(
    readFileSync(join(process.cwd(), ".env.local"), "utf8")
      .split(/\r?\n/)
      .filter((l) => l && !l.trimStart().startsWith("#") && l.includes("="))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      })
  );
}

export async function connect() {
  const env = loadEnv();
  const ref = new URL(env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0];
  const password = env.SUPABASE_DB_PASSWORD;
  if (!password) throw new Error("SUPABASE_DB_PASSWORD missing from .env.local");

  const region = env.SUPABASE_DB_REGION || "ap-south-1";
  // Supabase has shuffled pooler hostnames between projects; try the plausible
  // ones rather than making the prefix something anyone has to look up.
  const candidates = [
    { host: `aws-0-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
    { host: `aws-1-${region}.pooler.supabase.com`, port: 6543, user: `postgres.${ref}` },
    { host: `db.${ref}.supabase.co`, port: 5432, user: "postgres" },
  ];

  let lastError;
  for (const c of candidates) {
    const client = new pg.Client({
      ...c,
      database: "postgres",
      password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 12000,
      statement_timeout: 180000,
    });
    try {
      await client.connect();
      return client;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => {});
    }
  }
  throw lastError;
}
