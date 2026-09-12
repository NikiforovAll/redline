import type { Thread } from '@redline/protocol';
import type { TourCursor } from './navigator.ts';
import { hasHumanComment, isDraft, threadLine, type StoredRound } from './store.ts';
import { allNotes, stripTourPrefix } from './tour.ts';

export type RoundNode =
  | { kind: 'round'; roundId: string; round: StoredRound; active: boolean }
  | { kind: 'info'; roundId: string; label: string; icon: string }
  | { kind: 'note'; roundId: string; thread: Thread; index: number; line: number; current: boolean; answered: boolean };

export function draftCount(round: StoredRound): number {
  return round.threads.filter(isDraft).length;
}

export function roundLabel(round: StoredRound): string {
  return `${round.id}: ${round.title ?? round.sourceLabel}`;
}

export function roundDescription(round: StoredRound): string {
  const open = round.threads.filter((thread) => !thread.resolved).length;
  const drafts = draftCount(round);
  const state = round.submittedAt ? 'submitted' : drafts > 0 ? 'draft' : 'open';
  const parts = [`${round.files.length} file${round.files.length === 1 ? '' : 's'}`, `${open} open`, state];
  if (drafts > 0) parts.push(`${drafts} to send`);
  return parts.join(' · ');
}

/** Newest round first, so the active one is at the top when the reviewer has not moved elsewhere. */
export function rootNodes(rounds: readonly StoredRound[], activeRoundId: string | undefined): RoundNode[] {
  return [...rounds]
    .reverse()
    .map((round) => ({ kind: 'round', roundId: round.id, round, active: round.id === activeRoundId }));
}

export function roundChildren(round: StoredRound, cursor: TourCursor | undefined): RoundNode[] {
  return [
    { kind: 'info', roundId: round.id, label: round.sourceLabel, icon: 'git-compare' },
    {
      kind: 'info',
      roundId: round.id,
      label: round.submittedAt ? `Submitted ${formatDate(round.submittedAt)}` : `Opened ${formatDate(round.createdAt)}`,
      icon: round.submittedAt ? 'check' : 'clock'
    },
    ...allNotes(round).map((thread, index): RoundNode => ({
      kind: 'note',
      roundId: round.id,
      thread,
      index: index + 1,
      line: threadLine(round, thread),
      current: cursor?.roundId === round.id && cursor.threadId === thread.id,
      answered: hasHumanComment(thread)
    }))
  ];
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
  return parts.join(' · ');
}

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : DATE_FORMAT.format(date);
}
