#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { isAlive } from './redline-home.mjs';
import { discover } from './discover.mjs';
import { MONITOR_BEAT_MS, MONITOR_LOCK_TAG, MONITOR_STALE_MS, monitorLockPath, plural, sleep } from './wake.mjs';

const SESSION_ID = process.env.CLAUDE_CODE_SESSION_ID;
if (!SESSION_ID) process.exit(0);

const LOCK_FILE = monitorLockPath(SESSION_ID);
const BACKOFF_MIN_MS = Number(process.env.REDLINE_MONITOR_BACKOFF_MIN_MS) || 1000;
const BACKOFF_MAX_MS = Number(process.env.REDLINE_MONITOR_BACKOFF_MAX_MS) || 30000;

function touchLock() {
  try {
    writeFileSync(
      LOCK_FILE,
      JSON.stringify({ tag: MONITOR_LOCK_TAG, sid: SESSION_ID, pid: process.pid, cwd: process.cwd(), beatAt: Date.now() })
    );
  } catch {
    /* unwritable -> run unlocked */
  }
}

let rec = null;
try {
  rec = JSON.parse(readFileSync(LOCK_FILE, 'utf8'));
} catch {
  rec = null;
}
if (
  rec &&
  rec.tag === MONITOR_LOCK_TAG &&
  rec.sid === SESSION_ID &&
  Number(rec.beatAt) > Date.now() - MONITOR_STALE_MS &&
  isAlive(Number(rec.pid))
) {
  process.exit(0);
}
touchLock();
setInterval(touchLock, MONITOR_BEAT_MS).unref();

const sanitize = (s) =>
  String(s ?? '')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .slice(0, 120);

const note = (msg) => process.stderr.write(`redline-monitor: ${msg}\n`);


function format(event) {
  if (!event || typeof event !== 'object') return null;
  if (event.type === 'review_submitted') {
    const round = sanitize(event.roundId);
    return (
      `[redline] review submitted: ${plural(Number(event.commentCount) || 0, 'comment')} in ` +
      `${plural(Number(event.fileCount) || 0, 'file')} on ${sanitize(event.sourceLabel)} ` +
      `(round ${round}). Call get_review("${round}").`
    );
  }
  if (event.type === 'thread_sent') {
    const round = sanitize(event.roundId);
    const thread = sanitize(event.threadId);
    return (
      `[redline] comment sent: ${sanitize(event.file)}:${Number(event.line) || 0} ` +
      `(round ${round}, thread ${thread}). ` +
      `Call get_review("${round}", {threads: ["${thread}"]}).`
    );
  }
  return null;
}

const seen = new Set();
let lastEventId = null;

function announce(id, event) {
  if (id) {
    if (seen.has(id)) return;
    seen.add(id);
    if (seen.size > 500) seen.delete(seen.values().next().value);
    lastEventId = id;
  }
  const line = format(event);
  if (line) console.log(line.slice(0, 199));
}

function handleFrame(block) {
  let id = null;
  const data = [];
  for (const raw of block.split('\n')) {
    if (raw.startsWith(':')) continue;
    const sep = raw.indexOf(':');
    const field = sep === -1 ? raw : raw.slice(0, sep);
    const value = sep === -1 ? '' : raw.slice(sep + 1).replace(/^ /, '');
    if (field === 'id') id = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return;
  let event;
  try {
    event = JSON.parse(data.join('\n'));
  } catch {
    return;
  }
  announce(id, event);
}

// The stream carries no history on a first connect, so comments submitted before this monitor
// started are announced from /pending once. Reconnects replay by last-event-id instead.
let backlogDone = false;
async function announceBacklog(found) {
  if (backlogDone) return;
  backlogDone = true;
  const res = await fetch(`http://127.0.0.1:${found.port}/pending`, {
    headers: { authorization: `Bearer ${found.token}` },
    signal: AbortSignal.timeout(5000)
  });
  if (!res.ok) return;
  const pending = await res.json();
  if (!Array.isArray(pending)) return;
  for (const item of pending) {
    announce(null, {
      type: 'review_submitted',
      roundId: item.roundId,
      commentCount: item.threadIds?.length ?? 0,
      fileCount: item.fileCount,
      sourceLabel: item.sourceLabel
    });
  }
}

async function stream() {
  const found = await discover(process.cwd());
  const headers = { authorization: `Bearer ${found.token}`, accept: 'text/event-stream' };
  if (lastEventId) headers['last-event-id'] = lastEventId;
  const res = await fetch(`http://127.0.0.1:${found.port}/events`, { headers });
  if (!res.ok || !res.body) throw new Error(`/events returned ${res.status}`);
  await announceBacklog(found);
  return res.body;
}

async function consume(body) {
  const decoder = new TextDecoder();
  let buffer = '';
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let cut;
    while ((cut = buffer.indexOf('\n\n')) !== -1) {
      handleFrame(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 2);
    }
  }
}

let backoff = BACKOFF_MIN_MS;
for (;;) {
  let connected = false;
  try {
    const body = await stream();
    connected = true;
    backoff = BACKOFF_MIN_MS;
    note('connected');
    await consume(body);
    note('stream closed');
  } catch (err) {
    note(`${connected ? 'stream error' : 'connect failed'}: ${err.message}`);
  } finally {
    await sleep(backoff);
    backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
  }
}
