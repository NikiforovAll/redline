import type { RoundOutcome, Thread } from '@redline/protocol';
import type { TourCursor } from './navigator.ts';
import { hasHumanComment, isDraft, threadLine, type StoredRound } from './store.ts';
import { allNotes, stripTourPrefix } from './tour.ts';

export type RoundNode =
  | { kind: 'round'; roundId: string; round: StoredRound; active: boolean }
  | { kind: 'info'; roundId: string; label: string; icon: string }
  | { kind: 'notes'; roundId: string; round: StoredRound }
  | { kind: 'note'; roundId: string; thread: Thread; index: number; line: number; current: boolean; answered: boolean };

export function draftCount(round: StoredRound): number {
  return round.threads.filter(isDraft).length;
}

export function detachedCount(round: StoredRound): number {
  return round.threads.filter((thread) => thread.detached).length;
}

export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

/** The source scope is the round's identity; ids stay internal. */
export function roundLabel(round: StoredRound): string {
  return round.sourceLabel;
}

export function roundDescription(round: StoredRound): string {
  const open = round.threads.filter((thread) => !thread.resolved).length;
  const drafts = draftCount(round);
  const detached = detachedCount(round);
  const state = round.submittedAt ? 'submitted' : drafts > 0 ? 'draft' : 'open';
  const parts = [plural(round.files.length, 'file'), `${open} open`];
  if (detached > 0) parts.push(`${detached} detached`);
  parts.push(state);
  if (drafts > 0) parts.push(`${drafts} to send`);
  return parts.join(' · ');
}

/** The one-line result of a request_review, for the reviewer's toast and the agent's tool result alike. No trailing period. */
export function roundMessage(round: StoredRound, outcome: RoundOutcome): string {
  if (outcome === 'kept') {
    return round.source.kind === 'worktree'
      ? `Kept ${round.sourceLabel}: nothing uncommitted to refresh from`
      : `Kept ${round.sourceLabel}: the range has no changes to refresh from`;
  }
  const open = round.threads.filter((thread) => !thread.resolved).length;
  if (outcome === 'opened') return `Opened ${round.sourceLabel} (${plural(round.files.length, 'file')}, ${plural(open, 'note')})`;
  const detached = detachedCount(round);
  const parts = [plural(round.files.length, 'file'), plural(open, 'open thread')];
  if (detached > 0) parts.push(`${detached} detached`);
  return `Refreshed ${round.sourceLabel} (${parts.join(', ')})`;
}

export function dateLabel(round: StoredRound): string {
  if (round.submittedAt) return `Submitted ${formatDate(round.submittedAt)}`;
  if (round.refreshedAt) {
    const times = round.refreshCount === 1 ? '1 refresh' : `${round.refreshCount} refreshes`;
    return `Refreshed ${formatDate(round.refreshedAt)} · ${times}`;
  }
  return `Opened ${formatDate(round.createdAt)}`;
}

/** Newest round first, so the active one is at the top when the reviewer has not moved elsewhere. */
export function rootNodes(rounds: readonly StoredRound[], activeRoundId: string | undefined): RoundNode[] {
  return [...rounds]
    .reverse()
    .map((round) => ({ kind: 'round', roundId: round.id, round, active: round.id === activeRoundId }));
}

export function roundChildren(round: StoredRound, cursor: TourCursor | undefined): RoundNode[] {
  const info: RoundNode[] = [];
  if (round.title) info.push({ kind: 'info', roundId: round.id, label: round.title, icon: 'tag' });
  info.push({
    kind: 'info',
    roundId: round.id,
    label: dateLabel(round),
    icon: round.submittedAt ? 'check' : round.refreshCount > 0 ? 'sync' : 'clock'
  });
  if (round.threads.length > 0) info.push({ kind: 'notes', roundId: round.id, round });
  return info;
}

/** Every thread in tour order, numbered from 1, with the tour cursor marked. */
export function noteNodes(round: StoredRound, cursor: TourCursor | undefined): Extract<RoundNode, { kind: 'note' }>[] {
  return allNotes(round).map((thread, index) => ({
    kind: 'note',
    roundId: round.id,
    thread,
    index: index + 1,
    line: threadLine(round, thread),
    current: cursor?.roundId === round.id && cursor.threadId === thread.id,
    answered: hasHumanComment(thread)
  }));
}

export function notesDescription(round: StoredRound): string {
  const total = round.threads.length;
  const open = round.threads.filter((thread) => !thread.resolved).length;
  return open === total ? plural(total, 'note') : `${plural(total, 'note')} · ${open} open`;
}

/** First line of the note, without the tour prefix and inline markdown emphasis. */
export function noteLabel(thread: Thread): string {
  const body = thread.comments[0]?.body ?? '';
  const first = body.split(/\r?\n/, 1)[0] ?? '';
  return stripTourPrefix(first).replace(/[*_`]/g, '').trim() || thread.id;
}

export function noteDescription(node: Extract<RoundNode, { kind: 'note' }>): string {
  const parts = [`${node.thread.anchor.file}:${node.line}`];
  if (node.thread.kind !== 'note') parts.push('yours');
  if (node.thread.resolved) parts.push('resolved');
  if (node.thread.detached) parts.push('detached');
  return parts.join(' · ');
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}
