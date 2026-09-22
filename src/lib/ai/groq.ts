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
  const hint = /try again in ([\d.]+)s/i.exec(message);
  if (hint) return Math.ceil(parseFloat(hint[1]) * 1000) + 500;
  return Math.min(20_000, 1_500 * 2 ** attempt);
}

function isRetryable(error: unknown) {
  const status = (error as { status?: number })?.status;
  return status === 429 || (typeof status === "number" && status >= 500);
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
      if (attempt >= attempts - 1 || !isRetryable(error)) throw error;
      await sleep(retryDelay(error, attempt));
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
