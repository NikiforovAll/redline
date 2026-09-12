import { homedir } from 'node:os';
import { join } from 'node:path';

export function normalizeWorkspacePath(input) {
  let p = String(input).replace(/\\/g, '/');
  if (process.platform === 'win32') {
    p = p.toLowerCase();
  } else if (/^[A-Za-z]:/.test(p)) {
    p = p[0].toLowerCase() + p.slice(1);
  }
  while (p.length > 1 && p.endsWith('/') && !/^[a-z]:\/$/.test(p)) {
    p = p.slice(0, -1);
  }
  return p;
}

export function redlineHome() {
  return process.env.REDLINE_HOME ?? join(homedir(), '.redline');
}

export function isAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}
