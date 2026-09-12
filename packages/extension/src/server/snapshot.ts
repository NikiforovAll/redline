import { buildSnapshot } from '../diff/index.ts';
import type { ReviewStore, StoredRound } from '../review/store.ts';

export async function attachSnapshot(
  store: ReviewStore,
  round: StoredRound,
  repoRoot: string | undefined
): Promise<StoredRound> {
  if (round.files.length > 0) return round;
  if (!repoRoot) {
    throw new Error('redline: no workspace folder to resolve the diff against');
  }
  const snapshot = await buildSnapshot(round.source, repoRoot);
  return store.attachFiles(round.id, snapshot.files, snapshot.partial);
}
