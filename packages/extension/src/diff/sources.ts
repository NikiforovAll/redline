import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { promisify } from 'node:util';
import { INDEX_SIDE, WORKTREE_SIDE, type FileStatus, type Source } from '@redline/protocol';
import { parsePatch, sideFromHunks, type Hunk, type ParsedFile } from './parse.ts';

const execFileAsync = promisify(execFile);

export type SnapshotStatus = FileStatus;

export type SourceUnavailableReason = 'not_a_repo' | 'unknown_revision' | 'git_failed';

export class SourceUnavailableError extends Error {
  readonly reason: SourceUnavailableReason;

  constructor(reason: SourceUnavailableReason, message: string) {
    super(message);
    this.name = 'SourceUnavailableError';
    this.reason = reason;
  }
}

function asSourceUnavailable(error: unknown): SourceUnavailableError {
  if (error instanceof SourceUnavailableError) return error;
  const detailed = error as { stderr?: string; message?: string };
  const text = (detailed.stderr ?? detailed.message ?? String(error)).trim();
  const reason: SourceUnavailableReason = /not a git repository/i.test(text)
    ? 'not_a_repo'
    : /unknown revision|bad revision|ambiguous argument|does not have any commits/i.test(text)
      ? 'unknown_revision'
      : 'git_failed';
  return new SourceUnavailableError(reason, text);
}

export interface SnapshotFile {
  path: string;
  oldPath?: string;
  status: SnapshotStatus;
  left: string | null;
  right: string | null;
  hunks: Hunk[];
}

export interface RoundSnapshot {
  files: SnapshotFile[];
  partial?: boolean;
}

const MAX_BUFFER = 64 * 1024 * 1024;

export async function git(repoRoot: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', ['--no-pager', ...args], {
    cwd: repoRoot,
    maxBuffer: MAX_BUFFER,
    windowsHide: true
  });
  return stdout;
}

export async function gitOrNull(repoRoot: string, args: string[]): Promise<string | null> {
  try {
    return await git(repoRoot, args);
  } catch {
    return null;
  }
}

async function gitDiff(repoRoot: string, args: string[]): Promise<string> {
  try {
    return await git(repoRoot, ['diff', '--no-color', '--no-ext-diff', '--find-renames', '-U3', ...args]);
  } catch (error) {
    const withStdout = error as { code?: number; stdout?: string };
    if (withStdout.code === 1 && typeof withStdout.stdout === 'string') {
      return withStdout.stdout;
    }
    throw error;
  }
}

function toPosix(value: string): string {
  return value.replace(/\\/g, '/');
}

async function readDisk(repoRoot: string, filePath: string): Promise<string | null> {
  try {
    return await readFile(path.join(repoRoot, filePath), 'utf8');
  } catch {
    return null;
  }
}

async function showBlob(repoRoot: string, rev: string, filePath: string): Promise<string | null> {
  return gitOrNull(repoRoot, ['show', `${rev}:${filePath}`]);
}

function statusOf(file: ParsedFile): SnapshotStatus {
  return file.binary ? 'binary' : file.status;
}

function pathOf(file: ParsedFile): string {
  return toPosix((file.newPath ?? file.oldPath) as string);
}

function baseEntry(file: ParsedFile): SnapshotFile {
  const entry: SnapshotFile = {
    path: pathOf(file),
    status: statusOf(file),
    left: null,
    right: null,
    hunks: file.hunks
  };
  if (file.status === 'renamed' && file.oldPath) {
    entry.oldPath = toPosix(file.oldPath);
  }
  return entry;
}

type SideLoader = (file: ParsedFile, entry: SnapshotFile) => Promise<string | null>;

const LOAD_CONCURRENCY = 8;

async function mapBounded<T, R>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await work(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

async function buildEntries(
  patch: string,
  loadLeft: SideLoader,
  loadRight: SideLoader
): Promise<SnapshotFile[]> {
  return mapBounded(parsePatch(patch), LOAD_CONCURRENCY, async (file) => {
    const entry = baseEntry(file);
    if (entry.status === 'binary') return entry;
    const [left, right] = await Promise.all([
      file.status === 'added' ? Promise.resolve(null) : loadLeft(file, entry),
      file.status === 'deleted' ? Promise.resolve(null) : loadRight(file, entry)
    ]);
    entry.left = left;
    entry.right = right;
    return entry;
  });
}

async function untrackedFiles(repoRoot: string): Promise<SnapshotFile[]> {
  const raw = await git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z']);
  const paths = raw.split('\0').filter((value) => value.length > 0);
  return mapBounded(paths, LOAD_CONCURRENCY, async (filePath) => {
    const right = await readDisk(repoRoot, filePath);
    return {
      path: toPosix(filePath),
      status: right === null ? 'binary' : 'added',
      left: null,
      right,
      hunks: right === null ? [] : [wholeFileHunk(right)]
    } satisfies SnapshotFile;
  });
}

function wholeFileHunk(content: string): Hunk {
  const endsWithNewline = content.endsWith('\n');
  const body = endsWithNewline ? content.slice(0, -1) : content;
  const lines = body.length === 0 ? [] : body.split('\n');
  return {
    oldStart: 0,
    oldLines: 0,
    newStart: 1,
    newLines: lines.length,
    lines: lines.map((line, index) => ({
      kind: 'add' as const,
      content: line,
      ...(index === lines.length - 1 && !endsWithNewline ? { noNewline: true } : {})
    }))
  };
}

/** Uncommitted work against `baseRev`: `staged` reads the index, `all` reads the disk, `unstaged` reads disk against index and ignores `baseRev`. */
async function worktreeSnapshot(
  repoRoot: string,
  scope: 'staged' | 'unstaged' | 'all',
  baseRev = 'HEAD'
): Promise<RoundSnapshot> {
  if (scope === 'staged') {
    const patch = await gitDiff(repoRoot, ['--cached', baseRev]);
    const files = await buildEntries(
      patch,
      (file) => showBlob(repoRoot, baseRev, file.oldPath as string),
      (file) => gitOrNull(repoRoot, ['show', `:${file.newPath as string}`])
    );
    return { files };
  }

  // Untracked files are unstaged work too: `git status` lists them, `git diff` does not.
  const base = scope === 'unstaged' ? [] : [baseRev];
  const loadLeft =
    scope === 'unstaged'
      ? (file: ParsedFile) => gitOrNull(repoRoot, ['show', `:${file.oldPath as string}`])
      : (file: ParsedFile) => showBlob(repoRoot, baseRev, file.oldPath as string);
  const patch = await gitDiff(repoRoot, base);
  const [tracked, untracked] = await Promise.all([
    buildEntries(patch, loadLeft, (file) => readDisk(repoRoot, file.newPath as string)),
    untrackedFiles(repoRoot)
  ]);
  return { files: [...tracked, ...untracked] };
}

export interface RangeSpec {
  spec: string;
  threeDot: boolean;
  leftRev: string;
  rightRev: string;
}

/** Accepts every spelling a client sends, `a..b` in `from` alone, `a` and `b`, or `a...` and `b`, and returns one canonical spec so equal ranges get equal labels. A sentinel `to` is kept as is. */
export function splitRange(from: string, to: string): RangeSpec {
  if (to === WORKTREE_SIDE || to === INDEX_SIDE) {
    const leftRev = from.replace(/\.+$/, '') || 'HEAD';
    return { spec: `${leftRev}..${to}`, threeDot: false, leftRev, rightRev: to };
  }
  const joined = !to ? from : from.endsWith('.') ? `${from}${to}` : `${from}..${to}`;
  const threeDot = joined.includes('...');
  const [rawLeft, rawRight] = joined.split(threeDot ? '...' : '..');
  const leftRev = rawLeft || 'HEAD';
  const rightRev = rawRight || 'HEAD';
  return { spec: `${leftRev}${threeDot ? '...' : '..'}${rightRev}`, threeDot, leftRev, rightRev };
}

async function rangeSnapshot(repoRoot: string, from: string, to: string): Promise<RoundSnapshot> {
  const range = splitRange(from, to);
  const { spec, threeDot, rightRev } = range;
  if (rightRev === WORKTREE_SIDE) return worktreeSnapshot(repoRoot, 'all', range.leftRev);
  if (rightRev === INDEX_SIDE) return worktreeSnapshot(repoRoot, 'staged', range.leftRev);
  let leftRev = range.leftRev;
  const patch = await gitDiff(repoRoot, [spec]);
  if (threeDot) {
    const base = await gitOrNull(repoRoot, ['merge-base', leftRev, rightRev]);
    if (base) {
      leftRev = base.trim();
    }
  }
  const files = await buildEntries(
    patch,
    (file) => showBlob(repoRoot, leftRev, file.oldPath as string),
    (file) => showBlob(repoRoot, rightRev, file.newPath as string)
  );
  return { files };
}

function patchSnapshot(text: string): RoundSnapshot {
  const files = parsePatch(text).map((file) => {
    const entry = baseEntry(file);
    if (entry.status !== 'binary') {
      entry.left = file.status === 'added' ? null : sideFromHunks(file.hunks, 'left');
      entry.right = file.status === 'deleted' ? null : sideFromHunks(file.hunks, 'right');
    }
    return entry;
  });
  return { files, partial: true };
}

async function filesSnapshot(pairs: { left: string; right: string }[]): Promise<RoundSnapshot> {
  const files = await mapBounded(pairs, LOAD_CONCURRENCY, async (pair) => {
    const [left, right, patch] = await Promise.all([
      readFileOrNull(pair.left),
      readFileOrNull(pair.right),
      diffNoIndex(pair.left, pair.right)
    ]);
    const parsed = parsePatch(patch)[0];
    const status: SnapshotStatus =
      parsed?.binary === true
        ? 'binary'
        : left === null
          ? 'added'
          : right === null
            ? 'deleted'
            : 'modified';
    return {
      path: toPosix(pair.right),
      oldPath: toPosix(pair.left),
      status,
      left: status === 'binary' ? null : left,
      right: status === 'binary' ? null : right,
      hunks: parsed?.hunks ?? []
    } satisfies SnapshotFile;
  });
  return { files };
}

async function readFileOrNull(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, 'utf8');
  } catch {
    return null;
  }
}

async function diffNoIndex(left: string, right: string): Promise<string> {
  const cwd = process.cwd();
  try {
    return await git(cwd, [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--no-index',
      '-U3',
      '--',
      left,
      right
    ]);
  } catch (error) {
    const withStdout = error as { stdout?: string };
    return typeof withStdout.stdout === 'string' ? withStdout.stdout : '';
  }
}

export async function buildSnapshot(source: Source, repoRoot: string): Promise<RoundSnapshot> {
  try {
    switch (source.kind) {
      case 'worktree':
        return await worktreeSnapshot(repoRoot, source.scope);
      case 'range':
        return await rangeSnapshot(repoRoot, source.from, source.to);
      case 'patch':
        return patchSnapshot(source.text);
      case 'files':
        return await filesSnapshot(source.pairs);
    }
  } catch (error) {
    throw asSourceUnavailable(error);
  }
}
