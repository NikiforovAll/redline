import { readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isAlive, normalizeWorkspacePath } from './redline-home.mjs';

// Kept under Claude Code's MCP tool-call timeout; the caller loops on the timeout text.
export const WAIT_MAX_S = 300;

export const CONNECT_TEXT = 'Now invoke the redline:redline-connect skill.';

// Lock contract shared by the writer (monitor.mjs) and the reader (monitorArmed).
export const MONITOR_LOCK_TAG = 'redline-monitor';
export const MONITOR_BEAT_MS = 5000;
export const MONITOR_STALE_MS = 3 * MONITOR_BEAT_MS;
const LOCK_PREFIX = 'redline-monitor-';

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`;

function monitorLockDir(env = process.env) {
  return env.CLAUDE_PLUGIN_DATA || tmpdir();
}

export function monitorLockPath(sid, env = process.env) {
  return join(monitorLockDir(env), `${LOCK_PREFIX}${sid}.pid`);
}

function readLocks(env) {
  const dirs = [...new Set([monitorLockDir(env), tmpdir()])];
  const locks = [];
  for (const dir of dirs) {
    let names = [];
    try {
      names = readdirSync(dir).filter((name) => name.startsWith(LOCK_PREFIX) && name.endsWith('.pid'));
    } catch {
      continue;
    }
    for (const name of names) {
      try {
        locks.push(JSON.parse(readFileSync(join(dir, name), 'utf8')));
      } catch {
        /* partial write or foreign file */
      }
    }
  }
  return locks;
}

const fresh = (rec, now) =>
  rec?.tag === MONITOR_LOCK_TAG && Number(rec.beatAt) > now - MONITOR_STALE_MS && isAlive(Number(rec.pid));

/**
 * A fresh lock for this session id means the monitor wakes it on submit. The MCP server keeps the
 * env it started with, so after /clear or a resume its session id can lag the monitor's; a fresh
 * monitor started from the same folder then counts too. null when the host set no session id.
 */
export function monitorArmed(env = process.env, now = Date.now(), cwd = process.cwd()) {
  const sid = env.CLAUDE_CODE_SESSION_ID;
  if (!sid) return null;
  const locks = readLocks(env).filter((rec) => fresh(rec, now));
  if (locks.some((rec) => rec.sid === sid)) return true;
  const here = normalizeWorkspacePath(cwd);
  return locks.some((rec) => typeof rec.cwd === 'string' && normalizeWorkspacePath(rec.cwd) === here);
}
