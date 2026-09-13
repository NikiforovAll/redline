import type { Anchor, Thread } from '@redline/protocol';
import type { StoredRound } from './store.ts';

const TOUR_PREFIX = /^\s*\*\*\[(\d+)\/\d+\]\*\*\s*/;

export function tourNumber(thread: Thread): number | undefined {
  const match = TOUR_PREFIX.exec(thread.comments[0]?.body ?? '');
  return match ? Number(match[1]) : undefined;
}

export function stripTourPrefix(text: string): string {
  return text.replace(TOUR_PREFIX, '');
}

/** Every thread in reading order: numbered tour notes first, then the rest as they were posted. */
export function allNotes(round: StoredRound): Thread[] {
  return tourOrder(round.threads);
}

/** Unresolved threads in reading order. */
export function openNotes(round: StoredRound): Thread[] {
  return allNotes(round).filter((thread) => !thread.resolved);
}

/** "n/total" over all threads, so a note keeps its number when earlier ones are resolved. */
export function notePosition(round: StoredRound, thread: Thread): string {
  const ordered = allNotes(round);
  return `${ordered.findIndex((entry) => entry.id === thread.id) + 1}/${ordered.length}`;
}

export function anchorSortLine(anchor: Anchor): number {
  return anchor.newLine ?? anchor.oldLine ?? 0;
}

/** Tour-numbered threads first in tour order, then the rest in the order they were posted, so a note added later lands after the ones the reviewer already walked. */
export function tourOrder(threads: readonly Thread[]): Thread[] {
  return [...threads].sort((a, b) => {
    const na = tourNumber(a);
    const nb = tourNumber(b);
    if (na !== undefined && nb !== undefined) return na - nb;
    if (na !== undefined) return -1;
    if (nb !== undefined) return 1;
    return 0;
  });
}

/** Position of a file in the round, files the round lacks last. */
export function fileIndex(fileOrder: readonly string[], file: string): number {
  const index = fileOrder.indexOf(file);
  return index === -1 ? fileOrder.length : index;
}

export function stepIndex(current: number | undefined, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current === undefined) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}
