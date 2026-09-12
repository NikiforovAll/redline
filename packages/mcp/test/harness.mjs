import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const protoServer = join(repoRoot, 'packages', 'extension', 'scripts', 'proto-server.mjs');

/** Starts the extension's stdin-driven proto server; resolves once it has written its lock. */
export function startProtoServer(cwd, redlineHome) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [protoServer], {
      cwd,
      env: { ...process.env, REDLINE_HOME: redlineHome, REDLINE_REPO_ROOT: cwd },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('proto-server did not start'));
    }, 30000);
    let buffer = '';
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      const match = buffer.match(/\{[\s\S]*?"lockPath"[\s\S]*?\}/);
      if (match) {
        clearTimeout(timer);
        resolve({
          child,
          info: JSON.parse(match[0]),
          command: (cmd) => child.stdin.write(`${JSON.stringify(cmd)}\n`)
        });
      }
    });
    child.on('error', reject);
  });
}

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
  const { name = 'ghost.lock', port = 1, token = 'ghost', pid = process.pid, ...rest } = options;
  const file = join(dir, name);
  writeFileSync(
    file,
    JSON.stringify({
      port,
      token,
      workspaceFolders: folders,
      pid,
      version: '0.0.0',
      startedAt: new Date().toISOString(),
      ...rest
    })
  );
  return file;
}
