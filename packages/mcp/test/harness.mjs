import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export function makeRedlineHome(prefix = 'redline-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  const redlineHome = join(root, 'home', '.redline');
  const workspace = join(root, 'workspace');
  mkdirSync(redlineHome, { recursive: true });
  mkdirSync(workspace, { recursive: true });
  process.env.REDLINE_HOME = redlineHome;
  const cleanup = () =>
    rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return { root, redlineHome, workspace, cleanup };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(predicate, timeoutMs, label, details) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await sleep(50);
  }
  throw new Error(`timed out waiting for ${label}${details ? `\n${details()}` : ''}`);
}

export function writeGhostLock(dir, folders, options = {}) {
  const { name = 'ghost.lock', port = 1, token = 'ghost', pid = process.pid } = options;
  const file = join(dir, name);
  writeFileSync(
    file,
    JSON.stringify({
      port,
      token,
      workspaceFolders: folders,
      pid,
      version: '0.0.0',
      startedAt: new Date().toISOString()
    })
  );
  return file;
}
