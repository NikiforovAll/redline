import { INDEX_SIDE, WORKTREE_SIDE, type Source } from '@redline/protocol';

export type RefKind = 'worktree' | 'index' | 'head' | 'branch' | 'remote' | 'tag' | 'typed';

export interface RefItem {
  name: string;
  kind: RefKind;
  current?: boolean;
}

export interface RepoRefs {
  branches: string[];
  remotes: string[];
  tags: string[];
  current?: string;
  defaultBranch?: string;
}

export const WORKTREE_ITEM: RefItem = { name: WORKTREE_SIDE, kind: 'worktree' };
export const INDEX_ITEM: RefItem = { name: INDEX_SIDE, kind: 'index' };
export const HEAD_ITEM: RefItem = { name: 'HEAD', kind: 'head' };

function refItems(refs: RepoRefs): RefItem[] {
  const branches = [...refs.branches].sort((a, b) => Number(b === refs.current) - Number(a === refs.current) || a.localeCompare(b));
  return [
    HEAD_ITEM,
    ...branches.map((name) => ({ name, kind: 'branch' as const, current: name === refs.current })),
    ...refs.remotes.map((name) => ({ name, kind: 'remote' as const })),
    ...refs.tags.map((name) => ({ name, kind: 'tag' as const }))
  ];
}

/** Working tree and index first, then HEAD, the current branch, other branches, remotes, tags. */
export function headItems(refs: RepoRefs): RefItem[] {
  return [WORKTREE_ITEM, INDEX_ITEM, ...refItems(refs)];
}

/** The refs minus the picked head. The default branch leads, and is the suggested base, unless it is the head. */
export function baseItems(refs: RepoRefs, head: RefItem): { items: RefItem[]; suggested?: RefItem } {
  const items = refItems(refs).filter((item) => item.name !== head.name);
  const preferred = items.findIndex((item) => item.name === refs.defaultBranch);
  if (preferred > 0) items.unshift(...items.splice(preferred, 1));
  return { items, suggested: preferred >= 0 ? items[0] : undefined };
}

/** Working tree or index against HEAD is the source Claude already opens for `all` and `staged`, so the two must not become two rounds. A branch base gets the three-dot form: only what the head added since the fork. */
export function sourceFor(base: RefItem, head: RefItem): Source {
  if (head.kind === 'worktree' || head.kind === 'index') {
    if (base.kind === 'head') return { kind: 'worktree', scope: head.kind === 'worktree' ? 'all' : 'staged' };
    return { kind: 'range', from: base.name, to: head.name };
  }
  const from = base.kind === 'branch' || base.kind === 'remote' ? `${base.name}...` : base.name;
  return { kind: 'range', from, to: head.name };
}
