import type { RequestReview } from '@redline/protocol';
import { buildSnapshot } from '../diff/index.ts';
import type { RefreshOutcome, ReviewStore, StoredRound } from '../review/store.ts';

async function snapshotOf(round: StoredRound, repoRoot: string | undefined): ReturnType<typeof buildSnapshot> {
  if (!repoRoot) {
    throw new Error('redline: no workspace folder to resolve the diff against');
  }
  return buildSnapshot(round.source, repoRoot);
}

/** Rebuilds the round's snapshot from its source and carries the threads over; `request` supplies a new title and notes. */
export async function refreshSnapshot(
  store: ReviewStore,
  round: StoredRound,
  repoRoot: string | undefined,
  request?: Pick<RequestReview, 'title' | 'notes'>
): Promise<RefreshOutcome> {
  const snapshot = await snapshotOf(round, repoRoot);
  return store.refreshRound(round.id, {
    files: snapshot.files,
    partial: snapshot.partial,
    title: request?.title,
    notes: request?.notes
  });
}

export async function attachSnapshot(
  store: ReviewStore,
  round: StoredRound,
  repoRoot: string | undefined
): Promise<StoredRound> {
  if (round.files.length > 0) return round;
  const snapshot = await snapshotOf(round, repoRoot);
  return store.attachFiles(round.id, snapshot.files, snapshot.partial);
}
