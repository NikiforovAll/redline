import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LockFile } from '@redline/protocol';
import { redlineHome, normalizeWorkspacePath } from '@nikiforovall/redline-mcp/home';

export { redlineHome, normalizeWorkspacePath };

export interface LockFileContents extends LockFile {
  startedAt: string;
}

export function lockFileName(): string {
  return `redline-${process.pid}-${randomBytes(4).toString('hex')}.lock`;
}

export function lockFilePath(): string {
  return join(redlineHome(), lockFileName());
}

export function writeLockFile(path: string, contents: LockFileContents): void {
  mkdirSync(redlineHome(), { recursive: true });
  writeFileSync(path, JSON.stringify(contents, null, 2), 'utf8');
}

export function removeLockFile(path: string): void {
  rmSync(path, { force: true });
}
