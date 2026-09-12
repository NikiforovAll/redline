import type { Thread } from '@redline/protocol';

const TOUR_PREFIX = /^\s*\*\*\[(\d+)\/\d+\]\*\*/;

export function tourNumber(thread: Thread): number | undefined {
  const match = TOUR_PREFIX.exec(thread.comments[0]?.body ?? '');
  return match ? Number(match[1]) : undefined;
}

export function anchorSortLine(thread: Thread): number {
  return thread.anchor.newLine ?? thread.anchor.oldLine ?? 0;
}

/** Tour-numbered threads first in tour order, then the rest by file order and line. */
export function tourOrder(threads: readonly Thread[], fileOrder: readonly string[]): Thread[] {
  const fileIndex = (thread: Thread) => {
    const index = fileOrder.indexOf(thread.anchor.file);
    return index === -1 ? fileOrder.length : index;
  };
  return [...threads].sort((a, b) => {
    const na = tourNumber(a);
    const nb = tourNumber(b);
    if (na !== undefined && nb !== undefined) return na - nb;
    if (na !== undefined) return -1;
    if (nb !== undefined) return 1;
    return fileIndex(a) - fileIndex(b) || anchorSortLine(a) - anchorSortLine(b);
  });
}

export function stepIndex(current: number | undefined, delta: 1 | -1, length: number): number {
  if (length === 0) return -1;
  if (current === undefined) return delta === 1 ? 0 : length - 1;
  return (current + delta + length) % length;
}
