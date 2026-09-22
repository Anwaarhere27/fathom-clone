#!/usr/bin/env node
/**
 * .agent-logs capture hook for Claude Code.
 *
 * Wired in .claude/settings.json to two lifecycle events:
 *   UserPromptSubmit -> `node capture.js prompt`    (appends the verbatim prompt)
 *   Stop             -> `node capture.js response`  (appends the final response)
 *
 * Both events hand the hook a JSON payload on stdin containing session_id,
 * cwd and transcript_path. The response pass reads the session transcript
 * (JSONL) and keeps only the assistant text that came after the last tool
 * call of the turn -- no thinking, no tool calls, no intermediate steps.
 *
 * The script never rewrites a LOG_ENTRY once written. The only part of the
 * file it edits after the fact is the YAML frontmatter, which has to track
 * total_exchanges / last_prompt_time as the session grows.
 *
 * It must print nothing on stdout: UserPromptSubmit stdout is injected into
 * the model's context.
 */

const fs = require('fs');
const path = require('path');

const MODE = process.argv[2]; // "prompt" | "response"
const TOOL = 'claude-code';

function main(payload) {
  const projectDir =
    process.env.CLAUDE_PROJECT_DIR || payload.cwd || process.cwd();
  const logDir = path.join(projectDir, '.agent-logs');
  fs.mkdirSync(logDir, { recursive: true });

  const cfg = readConfig(projectDir);
  const sessionId = payload.session_id || 'unknown-session';
  const transcript = readTranscript(payload.transcript_path);

  const file = sessionFile(logDir, sessionId, cfg);

  if (MODE === 'prompt') {
    // If the previous turn never reached Stop (interrupted with Esc, crash,
    // context switch), close it out honestly instead of silently swallowing it.
    flushOrphanPrompt(file);
    const prompt = payload.prompt != null ? String(payload.prompt) : '';
    appendEntry(file, {
      type: 'PROMPT',
      num: countEntries(file, 'PROMPT') + 1,
      sessionId,
      timestamp: nowIso(),
      model:
        lastModel(transcript) ||
        known(frontmatterValue(file, 'model')) ||
        lastModelInProject(payload.transcript_path) ||
        'unknown',
      body: prompt,
    });
  } else if (MODE === 'response') {
    const promptCount = countEntries(file, 'PROMPT');
    const responseCount = countEntries(file, 'RESPONSE');
    if (promptCount === 0 || responseCount >= promptCount) return; // nothing owed
    // Stop can fire a beat before the last assistant message is flushed to
    // the transcript, which silently produced empty RESPONSE entries. Re-read
    // the file a few times before giving up.
    let turn = finalResponse(transcript);
    for (let i = 0; i < 12 && !turn.text; i++) {
      sleepSync(250);
      turn = finalResponse(readTranscript(payload.transcript_path));
    }
    appendEntry(file, {
      type: 'RESPONSE',
      num: promptCount,
      sessionId,
      timestamp: nowIso(),
      model: turn.model || lastModel(transcript) || 'unknown',
      body:
        turn.text ||
        '(no final text response captured for this turn -- the turn ended on a tool call or was cut short)',
    });
  }

  updateFrontmatter(file);
}

/* ---------------------------------------------------------------- config */

function readConfig(projectDir) {
  const defaults = { author: 'UNSET', project: path.basename(projectDir).toLowerCase() };
  try {
    const raw = fs.readFileSync(
      path.join(projectDir, '.claude', 'capture-config.json'),
      'utf8'
    );
    return Object.assign(defaults, JSON.parse(raw));
  } catch (_) {
    return defaults;
  }
}

// A freshly created session file carries `model: unknown`, which is a truthy
// string and would otherwise short-circuit the rest of the fallback chain.
function known(v) {
  return v && v !== 'unknown' ? v : null;
}

/* ------------------------------------------------------------ transcript */

function readTranscript(p) {
  if (!p) return [];
  try {
    return fs
      .readFileSync(p, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch (_) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (_) {
    return [];
  }
}

// A real user turn: role=user, plain text content, not a tool result, not a
// sidechain (subagent) message, not harness metadata.
function isUserPrompt(e) {
  if (!e || e.type !== 'user' || e.isSidechain || e.isMeta) return false;
  if (e.toolUseResult !== undefined) return false;
  const c = e.message && e.message.content;
  if (typeof c === 'string') return c.length > 0;
  return Array.isArray(c) && c.some((b) => b.type === 'text');
}

function isAssistant(e) {
  return e && e.type === 'assistant' && !e.isSidechain && e.message;
}

function textOf(msg) {
  const c = msg.content;
  if (typeof c === 'string') return c;
  if (!Array.isArray(c)) return '';
  return c
    .filter((b) => b.type === 'text' && b.text)
    .map((b) => b.text)
    .join('\n');
}

/**
 * On the very first prompt of a session the transcript holds no assistant
 * message yet, so there is no model to read. Fall back to the model the most
 * recently touched session in this same project ran on. The RESPONSE entry is
 * always the authoritative one -- it reads the model off the actual reply.
 */
function lastModelInProject(transcriptPath) {
  if (!transcriptPath) return null;
  try {
    const dir = path.dirname(transcriptPath);
    const files = fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.jsonl'))
      .map((f) => path.join(dir, f))
      .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
      .sort((a, b) => b.t - a.t)
      .slice(0, 5);
    for (const { f } of files) {
      const m = lastModel(readTranscript(f));
      if (m) return m;
    }
  } catch (_) {}
  return null;
}

function lastModel(entries) {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isAssistant(entries[i]) && entries[i].message.model) {
      return entries[i].message.model;
    }
  }
  return null;
}

/**
 * The final response of the last turn: the run of assistant text that has no
 * tool call after it. Any assistant text written before a tool call is an
 * intermediate progress note, so a tool call resets the buffer.
 */
function finalResponse(entries) {
  let start = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isUserPrompt(entries[i])) {
      start = i + 1;
      break;
    }
  }
  const parts = [];
  let model = null;
  for (let i = start; i < entries.length; i++) {
    const e = entries[i];
    if (!isAssistant(e)) continue;
    const blocks = Array.isArray(e.message.content) ? e.message.content : [];
    if (blocks.some((b) => b.type === 'tool_use')) {
      parts.length = 0; // everything before this tool call was intermediate
      continue;
    }
    const t = textOf(e.message);
    if (t.trim()) {
      parts.push(t);
      model = e.message.model || model;
    }
  }
  return { text: parts.join('\n').trim(), model };
}

/* ----------------------------------------------------------- log writing */

function nowIso() {
  return new Date().toISOString();
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function stamp(d) {
  const p = (n) => String(n).padStart(2, '0');
  return (
    d.getUTCFullYear() +
    '-' + p(d.getUTCMonth() + 1) +
    '-' + p(d.getUTCDate()) +
    '_' + p(d.getUTCHours()) +
    '-' + p(d.getUTCMinutes()) +
    '-' + p(d.getUTCSeconds())
  );
}

function sessionFile(logDir, sessionId, cfg) {
  const existing = fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith(`_${sessionId}.md`));
  if (existing.length) return path.join(logDir, existing[0]);

  const now = new Date();
  const file = path.join(logDir, `${stamp(now)}_${sessionId}.md`);
  const short = sessionId.slice(0, 8);
  fs.writeFileSync(
    file,
    [
      '---',
      `session_id: ${sessionId}`,
      `date: ${now.toISOString().slice(0, 10)}`,
      `author: ${cfg.author}`,
      'model: unknown',
      `tool: ${TOOL}`,
      `project: ${cfg.project}`,
      'total_exchanges: 0',
      `first_prompt_time: ${now.toISOString()}`,
      `last_prompt_time: ${now.toISOString()}`,
      '---',
      '',
      `# Session Log - ${now.toISOString().slice(0, 10)}`,
      '',
      `Session: \`${short}\` | Project: \`${cfg.project}\` | Author: \`${cfg.author}\``,
      '',
      '---',
      '',
      '',
    ].join('\n'),
    'utf8'
  );
  return file;
}

function read(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (_) {
    return '';
  }
}

function countEntries(file, type) {
  const m = read(file).match(new RegExp(`^\\[LOG_ENTRY type=${type} `, 'gm'));
  return m ? m.length : 0;
}

function appendEntry(file, e) {
  const short = e.sessionId.slice(0, 8);
  const block = [
    `[LOG_ENTRY type=${e.type} num=${e.num} session=${short}]`,
    `timestamp: ${e.timestamp}`,
    `model: ${e.model}`,
    '',
    e.body,
    '',
    '',
  ].join('\n');
  fs.appendFileSync(file, block, 'utf8');
}

function flushOrphanPrompt(file) {
  const prompts = countEntries(file, 'PROMPT');
  const responses = countEntries(file, 'RESPONSE');
  if (prompts <= responses) return;
  const sessionId =
    frontmatterValue(file, 'session_id') || 'unknown-session';
  appendEntry(file, {
    type: 'RESPONSE',
    num: prompts,
    sessionId,
    timestamp: nowIso(),
    model: frontmatterValue(file, 'model') || 'unknown',
    body:
      '(no final response captured -- the turn was interrupted before it ended, so the Stop hook never fired)',
  });
}

/* ----------------------------------------------------------- frontmatter */

function frontmatterValue(file, key) {
  const m = read(file).match(new RegExp(`^${key}:\\s*(.*)$`, 'm'));
  return m ? m[1].trim() : null;
}

// Only total_exchanges / last_prompt_time / model move as a session grows.
// LOG_ENTRY blocks below the frontmatter are never touched.
function updateFrontmatter(file) {
  const text = read(file);
  const end = text.indexOf('\n---', 4);
  if (!text.startsWith('---') || end === -1) return;

  const head = text.slice(0, end);
  const rest = text.slice(end);

  const prompts = countEntries(file, 'PROMPT');
  const times = [...text.matchAll(/^timestamp: (.*)$/gm)].map((m) => m[1]);
  const models = [...text.matchAll(/^model: (.*)$/gm)]
    .map((m) => m[1])
    .filter((m) => m && m !== 'unknown');

  let out = head
    .replace(/^total_exchanges: .*$/m, `total_exchanges: ${prompts}`)
    .replace(
      /^last_prompt_time: .*$/m,
      `last_prompt_time: ${times.length ? times[times.length - 1] : ''}`
    );
  if (models.length) {
    // A mid-session model switch shows up here as a comma-joined list.
    const uniq = [...new Set(models)];
    out = out.replace(/^model: .*$/m, `model: ${uniq.join(', ')}`);
  }
  fs.writeFileSync(file, out + rest, 'utf8');
}

/* ------------------------------------------------------------ entrypoint */

let raw = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => (raw += d));
process.stdin.on('end', () => {
  try {
    main(JSON.parse(raw || '{}'));
  } catch (err) {
    try {
      const dir = path.join(
        process.env.CLAUDE_PROJECT_DIR || process.cwd(),
        '.agent-logs'
      );
      fs.mkdirSync(dir, { recursive: true });
      fs.appendFileSync(
        path.join(dir, 'capture-errors.log'),
        `${nowIso()} [${MODE}] ${err && err.stack ? err.stack : err}\n`,
        'utf8'
      );
    } catch (_) {}
  }
  process.exit(0);
});
