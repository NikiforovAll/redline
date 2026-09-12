import { randomBytes } from 'node:crypto';
import type {
  Anchor,
  Author,
  Comment,
  Note,
  PendingSummary,
  Round,
  RoundSummary,
  Source,
  Thread,
  ThreadKind
} from '@redline/protocol';
import type { DiffLine, Hunk, SnapshotFile } from '../diff/index.ts';

export type StoreLineKind = DiffLine['kind'];
export type StoreLine = DiffLine;
export type StoreHunk = Hunk;
export type StoreFile = SnapshotFile;

export interface StoredRound {
  id: string;
  title?: string;
  source: Source;
  sourceLabel: string;
  createdAt: string;
  submittedAt?: string;
  partial?: boolean;
  notes: Note[];
  files: StoreFile[];
  threads: Thread[];
}

export interface StoreState {
  version: 1;
  nextRound: number;
  rounds: StoredRound[];
}

export interface Persistence {
  load(): StoreState | undefined;
  save(state: StoreState): void;
}

export interface CreateRoundInput {
  source: Source;
  title?: string;
  notes?: Note[];
}

export interface SubmitResult {
  roundId: string;
  sourceLabel: string;
  threadIds: string[];
  commentCount: number;
  fileCount: number;
}

export function sourceLabel(source: Source): string {
  switch (source.kind) {
    case 'worktree':
      return `${source.scope} changes`;
    case 'range':
      return source.to ? `${source.from}..${source.to}` : source.from;
    case 'patch':
      return 'patch';
    case 'files':
      return `${source.pairs.length} file pair${source.pairs.length === 1 ? '' : 's'}`;
  }
}

export function memoryPersistence(backing = new Map<string, StoreState>()): Persistence {
  return {
    load: () => backing.get('redline.store'),
    save: (state) => {
      backing.set('redline.store', state);
    }
  };
}

function shortId(prefix: string): string {
  return `${prefix}-${randomBytes(4).toString('hex')}`;
}

export function anchorLine(anchor: Anchor, file: StoreFile | undefined, fallback = 0): number {
  if (anchor.newLine !== undefined) return anchor.newLine;
  if (anchor.oldLine !== undefined) return anchor.oldLine;
  const hunk = file?.hunks[(anchor.hunk ?? 1) - 1];
  if (!hunk) return fallback;
  return anchor.side === 'left' ? hunk.oldStart : hunk.newStart;
}

function hunkAt(file: StoreFile | undefined, anchor: Anchor): StoreHunk | undefined {
  if (!file) return undefined;
  const want = anchorLine(anchor, file);
  return file.hunks.find((hunk) => {
    const start = anchor.side === 'left' ? hunk.oldStart : hunk.newStart;
    const count = anchor.side === 'left' ? hunk.oldLines : hunk.newLines;
    return want >= start && want < start + Math.max(count, 1);
  });
}

function snapToChange(filePath: string, hunk: StoreHunk | undefined): Anchor | undefined {
  if (!hunk) return undefined;
  let oldNo = hunk.oldStart;
  let newNo = hunk.newStart;
  let firstRemoved: number | undefined;
  for (const line of hunk.lines) {
    if (line.kind === 'add') return { file: filePath, side: 'right', newLine: newNo };
    if (line.kind === 'del' && firstRemoved === undefined) firstRemoved = oldNo;
    oldNo += 1;
    if (line.kind === 'context') newNo += 1;
  }
  if (firstRemoved !== undefined) return { file: filePath, side: 'left', oldLine: firstRemoved };
  return undefined;
}

export function hasHumanComment(thread: Thread): boolean {
  return thread.comments.some((comment) => comment.author === 'human');
}

function prefixOf(kind: StoreLineKind): string {
  if (kind === 'add') return '+';
  if (kind === 'del') return '-';
  return ' ';
}

function tally(threads: Thread[]): { commentCount: number; fileCount: number } {
  return {
    commentCount: threads.reduce(
      (total, thread) => total + thread.comments.filter((c) => c.author === 'human').length,
      0
    ),
    fileCount: new Set(threads.map((thread) => thread.anchor.file)).size
  };
}

function contextFor(file: StoreFile | undefined, anchor: Anchor, wholeHunk = false): string[] {
  if (!file) return [];
  if (wholeHunk) {
    const hunk = hunkAt(file, anchor);
    if (hunk) return hunk.lines.map((line) => `${prefixOf(line.kind)}${line.content}`);
  }
  for (const hunk of file.hunks) {
    let oldNo = hunk.oldStart;
    let newNo = hunk.newStart;
    const numbered = hunk.lines.map((line) => {
      const entry = { line, oldNo: line.kind === 'add' ? -1 : oldNo, newNo: line.kind === 'del' ? -1 : newNo };
      if (line.kind !== 'add') oldNo += 1;
      if (line.kind !== 'del') newNo += 1;
      return entry;
    });
    const want = anchorLine(anchor, file);
    const index = numbered.findIndex((entry) =>
      anchor.side === 'left' ? entry.oldNo === want : entry.newNo === want
    );
    if (index === -1) continue;

    let start = index;
    while (start > 0 && numbered[start - 1].line.kind !== 'context') start -= 1;
    let end = index;
    while (end + 1 < numbered.length && numbered[end + 1].line.kind !== 'context') end += 1;
    if (numbered[index].line.kind === 'context') {
      start = index;
      end = index;
    }
    const withContext = start > 0 ? start - 1 : start;
    return numbered
      .slice(withContext, end + 1)
      .map((entry) => `${prefixOf(entry.line.kind)}${entry.line.content}`);
  }
  return [];
}

function authorLabel(thread: Thread, comment: Comment): string {
  if (comment.author === 'claude') {
    return thread.kind === 'note' ? 'claude (note)' : 'claude';
  }
  return 'human';
}

const MAX_RETAINED_ROUNDS = 10;

export class ReviewStore {
  private state: StoreState;
  private readonly persistence: Persistence;
  private readonly roundById = new Map<string, StoredRound>();
  private readonly threadIndex = new Map<string, { thread: Thread; round: StoredRound }>();

  constructor(persistence: Persistence) {
    this.persistence = persistence;
    const loaded = persistence.load();
    this.state =
      loaded && loaded.version === 1 ? loaded : { version: 1, nextRound: 1, rounds: [] };
    for (const round of this.state.rounds) this.indexRound(round);
  }

  private indexRound(round: StoredRound): void {
    this.roundById.set(round.id, round);
    for (const thread of round.threads) this.threadIndex.set(thread.id, { thread, round });
  }

  private trim(): void {
    const excess = this.state.rounds.length - MAX_RETAINED_ROUNDS;
    if (excess <= 0) return;
    for (const round of this.state.rounds.splice(0, excess)) {
      this.roundById.delete(round.id);
      for (const thread of round.threads) this.threadIndex.delete(thread.id);
    }
  }

  private flush(): void {
    this.trim();
    this.persistence.save(this.state);
  }

  clear(): void {
    this.state = { version: 1, nextRound: 1, rounds: [] };
    this.roundById.clear();
    this.threadIndex.clear();
    this.flush();
  }

  createRound(input: CreateRoundInput): StoredRound {
    const round: StoredRound = {
      id: `r${this.state.nextRound}`,
      title: input.title,
      source: input.source,
      sourceLabel: sourceLabel(input.source),
      createdAt: new Date().toISOString(),
      notes: input.notes ?? [],
      files: [],
      threads: []
    };
    this.state.nextRound += 1;
    this.state.rounds.push(round);
    this.indexRound(round);
    this.flush();
    return round;
  }

  attachFiles(roundId: string, files: StoreFile[], partial?: boolean): StoredRound {
    const round = this.requireRound(roundId);
    round.files = files;
    if (partial) round.partial = true;
    this.seedNotes(round);
    this.flush();
    return round;
  }

  private seedNotes(round: StoredRound): void {
    for (const note of round.notes) {
      const file = round.files.find((entry) => entry.path === note.file);
      if (!file) continue;
      if (note.summary) {
        const fallback: Anchor = {
          file: note.file,
          side: 'right',
          newLine: file.hunks[0]?.newStart ?? 1
        };
        const anchor = snapToChange(note.file, file.hunks[0]) ?? fallback;
        this.pushThread(round, anchor, 'claude', note.summary, 'note');
      }
      for (const hunk of note.hunks ?? []) {
        const body = hunk.rationale ? `${hunk.summary}\n\n${hunk.rationale}` : hunk.summary;
        const fallback: Anchor = { file: note.file, side: 'right', newLine: hunk.newRange[0] };
        const anchor = snapToChange(note.file, hunkAt(file, fallback)) ?? fallback;
        this.pushThread(round, anchor, 'claude', body, 'note');
      }
    }
  }

  private pushThread(
    round: StoredRound,
    anchor: Anchor,
    author: Author,
    body: string,
    kind: ThreadKind
  ): Thread {
    const thread: Thread = {
      id: shortId('t'),
      roundId: round.id,
      anchor,
      comments: [],
      resolved: false,
      delivered: false,
      kind
    };
    thread.comments.push(this.makeComment(thread.id, author, body));
    round.threads.push(thread);
    this.threadIndex.set(thread.id, { thread, round });
    return thread;
  }

  private makeComment(threadId: string, author: Author, body: string): Comment {
    return {
      id: shortId('c'),
      threadId,
      author,
      body,
      createdAt: new Date().toISOString()
    };
  }

  addThread(roundId: string, anchor: Anchor, author: Author, body: string, kind: ThreadKind = 'human'): Thread {
    const round = this.requireRound(roundId);
    const thread = this.pushThread(round, anchor, author, body, kind);
    this.flush();
    return thread;
  }

  addComment(threadId: string, author: Author, body: string): Thread {
    const thread = this.requireThread(threadId);
    thread.comments.push(this.makeComment(thread.id, author, body));
    if (author === 'human') thread.delivered = false;
    this.flush();
    return thread;
  }

  setResolved(threadId: string, resolved: boolean): Thread {
    const thread = this.requireThread(threadId);
    thread.resolved = resolved;
    this.flush();
    return thread;
  }

  rounds(): StoredRound[] {
    return this.state.rounds;
  }

  round(roundId: string): StoredRound | undefined {
    return this.roundById.get(roundId);
  }

  thread(threadId: string): Thread | undefined {
    return this.threadIndex.get(threadId)?.thread;
  }

  file(roundId: string, path: string): StoreFile | undefined {
    return this.round(roundId)?.files.find((file) => file.path === path);
  }

  private requireRound(roundId: string): StoredRound {
    const round = this.round(roundId);
    if (!round) throw new Error(`redline: unknown round ${roundId}`);
    return round;
  }

  private requireThread(threadId: string): Thread {
    const thread = this.thread(threadId);
    if (!thread) throw new Error(`redline: unknown thread ${threadId}`);
    return thread;
  }

  summary(roundId: string): RoundSummary {
    const round = this.requireRound(roundId);
    return {
      id: round.id,
      title: round.title,
      sourceLabel: round.sourceLabel,
      fileCount: round.files.length,
      openThreads: round.threads.filter((thread) => !thread.resolved).length,
      createdAt: round.createdAt,
      submittedAt: round.submittedAt
    };
  }

  summaries(): RoundSummary[] {
    return [...this.state.rounds].reverse().map((round) => this.summary(round.id));
  }

  wireRound(roundId: string): Round {
    const round = this.requireRound(roundId);
    return {
      ...this.summary(roundId),
      source: round.source,
      partial: round.partial,
      files: round.files.map((file) => ({
        path: file.path,
        oldPath: file.oldPath,
        status: file.status,
        hunks: file.hunks.map((hunk) => ({
          oldStart: hunk.oldStart,
          oldLines: hunk.oldLines,
          newStart: hunk.newStart,
          newLines: hunk.newLines
        }))
      })),
      threads: round.threads
    };
  }

  undelivered(roundId: string): Thread[] {
    const round = this.requireRound(roundId);
    return round.threads.filter((thread) => !thread.delivered && hasHumanComment(thread));
  }

  pending(): PendingSummary[] {
    const out: PendingSummary[] = [];
    for (const round of [...this.state.rounds].reverse()) {
      const threads = this.undelivered(round.id);
      if (threads.length === 0) continue;
      out.push({
        roundId: round.id,
        sourceLabel: round.sourceLabel,
        threadIds: threads.map((thread) => thread.id),
        fileCount: tally(threads).fileCount
      });
    }
    return out;
  }

  markSubmitted(roundId: string): SubmitResult {
    const round = this.requireRound(roundId);
    round.submittedAt = new Date().toISOString();
    const threads = this.undelivered(roundId);
    this.flush();
    return {
      roundId: round.id,
      sourceLabel: round.sourceLabel,
      threadIds: threads.map((thread) => thread.id),
      ...tally(threads)
    };
  }

  renderReview(roundId: string, threadIds?: string[]): { markdown: string; delivered: string[] } {
    const round = this.requireRound(roundId);
    const wanted = threadIds && threadIds.length > 0 ? new Set(threadIds) : null;
    const selected = round.threads.filter((thread) => {
      if (!hasHumanComment(thread)) return false;
      return wanted ? wanted.has(thread.id) : !thread.delivered;
    });

    const byPath = new Map(round.files.map((file) => [file.path, file]));
    const order = new Map(round.files.map((file, index) => [file.path, index]));
    selected.sort((a, b) => {
      const fileDelta =
        (order.get(a.anchor.file) ?? Number.MAX_SAFE_INTEGER) -
        (order.get(b.anchor.file) ?? Number.MAX_SAFE_INTEGER);
      if (fileDelta !== 0) return fileDelta;
      return (
        anchorLine(a.anchor, byPath.get(a.anchor.file)) -
        anchorLine(b.anchor, byPath.get(b.anchor.file))
      );
    });

    const grouped = new Map<string, Thread[]>();
    for (const thread of selected) {
      const bucket = grouped.get(thread.anchor.file);
      if (bucket) bucket.push(thread);
      else grouped.set(thread.anchor.file, [thread]);
    }

    const { commentCount, fileCount } = tally(selected);

    const lines: string[] = [];
    lines.push(
      `# Review ${round.id}: ${round.sourceLabel}, ${commentCount} comment${
        commentCount === 1 ? '' : 's'
      } in ${fileCount} file${fileCount === 1 ? '' : 's'}`
    );
    lines.push('');
    if (selected.length === 0) {
      lines.push('No undelivered comments.');
      return { markdown: `${lines.join('\n')}\n`, delivered: [] };
    }
    lines.push('Resolve each with resolve_comment(id) once addressed.');

    for (const [file, threads] of grouped) {
      lines.push('');
      lines.push(`## ${file}`);
      const storeFile = byPath.get(file);
      for (const thread of threads) {
        const line = anchorLine(thread.anchor, storeFile);
        lines.push('');
        lines.push(
          `### :${line} ${thread.anchor.side}  [${thread.id}]${thread.resolved ? ' (resolved)' : ''}`
        );
        const context = contextFor(storeFile, thread.anchor, thread.kind === 'note');
        if (context.length > 0) {
          lines.push('```diff');
          lines.push(...context);
          lines.push('```');
        }
        for (const comment of thread.comments) {
          lines.push(`**${authorLabel(thread, comment)}:** ${comment.body}`);
        }
      }
    }

    const delivered = selected.map((thread) => thread.id);
    for (const thread of selected) thread.delivered = true;
    this.flush();
    return { markdown: `${lines.join('\n')}\n`, delivered };
  }
}
