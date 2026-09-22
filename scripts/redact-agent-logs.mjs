#!/usr/bin/env node
/**
 * The assignment requires .agent-logs/ to ship in a public repo, but the capture
 * hook records whatever gets pasted into the conversation -- including API keys.
 * This scrubs known secret shapes out of the logs before they are committed.
 *
 * Idempotent. Run it before every commit:  npm run redact
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOG_DIR = join(process.cwd(), ".agent-logs");

const RULES = [
  // Groq API keys
  [/gsk_[A-Za-z0-9]{20,}/g, "[REDACTED_GROQ_KEY]"],
  // Supabase / any HS256 JWT (anon + service_role keys)
  [/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_JWT]"],
  // Google OAuth client secrets
  [/GOCSPX-[A-Za-z0-9_-]{20,}/g, "[REDACTED_GOOGLE_SECRET]"],
  // OpenAI / Anthropic style keys, in case they ever turn up
  [/sk-[A-Za-z0-9_-]{20,}/g, "[REDACTED_API_KEY]"],
  // Postgres connection URIs with inline credentials
  [/(postgres(?:ql)?:\/\/[^:\s]+:)[^@\s]+@/g, "$1[REDACTED]@"],
];

// Secrets with no recognisable shape (e.g. a hand-typed DB password) have to be
// listed explicitly. Read them from the local env file so this script itself
// never contains a secret.
function literalsFromEnv() {
  let raw;
  try {
    raw = readFileSync(join(process.cwd(), ".env.local"), "utf8");
  } catch {
    return [];
  }
  const SENSITIVE = /(PASSWORD|SECRET|_KEY|TOKEN)/i;
  return raw
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
    .filter(([name, value]) => SENSITIVE.test(name) && value.length >= 6)
    .map(([, value]) => value)
    // Longest first, so a value that contains another is replaced whole.
    .sort((a, b) => b.length - a.length);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function redact(text, literals) {
  let out = text;
  for (const [pattern, replacement] of RULES) out = out.replace(pattern, replacement);
  for (const literal of literals) {
    out = out.replaceAll(literal, "[REDACTED_SECRET]");
    // The hook writes logs as JSON-escaped strings in places, so quotes and
    // backslashes in a password arrive doubled.
    out = out.replaceAll(JSON.stringify(literal).slice(1, -1), "[REDACTED_SECRET]");
  }
  return out;
}

const literals = literalsFromEnv();
let changed = 0;

for (const name of readdirSync(LOG_DIR)) {
  if (!name.endsWith(".md")) continue;
  const path = join(LOG_DIR, name);
  const before = readFileSync(path, "utf8");
  const after = redact(before, literals);
  if (after !== before) {
    writeFileSync(path, after, "utf8");
    changed++;
    console.log(`redacted ${name}`);
  }
}

console.log(
  changed === 0
    ? `No secrets found in .agent-logs (${literals.length} literal patterns checked).`
    : `Redacted ${changed} log file(s).`
);
