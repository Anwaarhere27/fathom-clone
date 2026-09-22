import Groq from "groq-sdk";

/**
 * Everything the product generates runs on open-weight models.
 *
 * gpt-oss-120b (Apache 2.0) for language work, whisper-large-v3-turbo for
 * transcription. Both are served by Groq; nothing here depends on a closed
 * model.
 */
export const TEXT_MODEL = "openai/gpt-oss-120b";
export const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";

let client: Groq | null = null;

export function groq() {
  if (!client) {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) throw new Error("GROQ_API_KEY is not set");
    client = new Groq({ apiKey });
  }
  return client;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Groq's free tier is 8,000 tokens per minute and it tells us exactly how long
 * to wait when we exceed it. Honouring that hint beats guessing at a backoff.
 */
function retryDelay(error: unknown, attempt: number) {
  const message = error instanceof Error ? error.message : String(error);

  // Groq reports waits as "40s" or "25m54.768s".
  const hint = /try again in (?:(\d+)m)?([\d.]+)s/i.exec(message);
  if (hint) {
    const minutes = hint[1] ? Number(hint[1]) : 0;
    return Math.ceil((minutes * 60 + parseFloat(hint[2])) * 1000) + 500;
  }

  return Math.min(20_000, 1_500 * 2 ** attempt);
}

/**
 * Per-minute limits are worth waiting out. The daily cap is not -- a request
 * that says "try again in 25 minutes" would block a server route far past any
 * sane request timeout, so callers get the error and decide.
 */
const MAX_WAIT_MS = Number(process.env.GROQ_MAX_WAIT_MS ?? 90_000);

function isRetryable(error: unknown) {
  const status = (error as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
}

/**
 * When JSON mode rejects the model's output, the text still comes back on the
 * error. It is usually one unbalanced bracket away from valid and represents a
 * full generation's worth of work, so try to rescue it before retrying.
 */
function salvage(error: unknown): string | null {
  const failed = (error as { error?: { error?: { failed_generation?: string } } })?.error?.error
    ?.failed_generation;
  if (typeof failed !== "string" || !failed.trim()) return null;

  try {
    JSON.parse(failed);
    return failed;
  } catch {
    // Keep dropping trailing characters back to the last plausible close and
    // re-balance. This recovers the common "one bracket too many" case.
    const repaired = rebalance(failed);
    if (repaired) return repaired;
    return null;
  }
}

function rebalance(text: string): string | null {
  const chars = [...text];
  const stack: string[] = [];
  let out = "";
  let inString = false;
  let escaped = false;

  for (const ch of chars) {
    if (inString) {
      out += ch;
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }

    if (ch === '"') {
      inString = true;
      out += ch;
      continue;
    }

    if (ch === "{" || ch === "[") {
      stack.push(ch === "{" ? "}" : "]");
      out += ch;
      continue;
    }

    if (ch === "}" || ch === "]") {
      // An unmatched closer is the failure mode we are repairing: drop it.
      if (stack[stack.length - 1] !== ch) continue;
      stack.pop();
      out += ch;
      continue;
    }

    out += ch;
  }

  while (stack.length) out += stack.pop();

  try {
    JSON.parse(out);
    return out;
  } catch {
    return null;
  }
}

export async function complete(
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  options: { json?: boolean; temperature?: number; maxTokens?: number; attempts?: number } = {}
) {
  const { json = false, temperature = 0.3, maxTokens = 6000, attempts = 6 } = options;

  for (let attempt = 0; ; attempt++) {
    try {
      const res = await groq().chat.completions.create({
        model: TEXT_MODEL,
        messages,
        temperature,
        max_completion_tokens: maxTokens,
        reasoning_effort: "low",
        ...(json ? { response_format: { type: "json_object" as const } } : {}),
      });
      return res.choices[0]?.message?.content ?? "";
    } catch (error) {
      const rescued = json ? salvage(error) : null;
      if (rescued) return rescued;
      if (attempt >= attempts - 1 || !isRetryable(error)) throw error;

      const wait = retryDelay(error, attempt);
      if (wait > MAX_WAIT_MS) throw error;
      await sleep(wait);
    }
  }
}

/**
 * Models wrap JSON in prose or fences often enough that every call site would
 * otherwise need the same defensive parsing.
 */
export function parseJson<T>(raw: string): T {
  const text = raw
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start !== -1 && end > start) return JSON.parse(text.slice(start, end + 1)) as T;
    throw new Error(`Model did not return JSON: ${text.slice(0, 200)}`);
  }
}
