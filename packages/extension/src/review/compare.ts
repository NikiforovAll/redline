import * as vscode from 'vscode';
import type { Source } from '@redline/protocol';
import { gitOrNull } from '../diff/index.ts';
import { baseItems, headItems, sourceFor, type RefItem, type RepoRefs } from './compare-model.ts';

interface RefPick extends vscode.QuickPickItem {
  ref?: RefItem;
}

const KIND_ICON: Partial<Record<RefItem['kind'], string>> = {
  worktree: 'files',
  index: 'diff-added',
  head: 'target',
  branch: 'git-branch',
  remote: 'cloud',
  tag: 'tag'
};

const KIND_DETAIL: Partial<Record<RefItem['kind'], string>> = {
  worktree: 'Files on disk, untracked included',
  index: 'Staged changes',
  head: 'The checked-out commit'
};

const KIND_LABEL: Partial<Record<RefItem['kind'], string>> = {
  worktree: 'Working tree',
  index: 'Index'
};

async function lines(repoRoot: string, args: string[]): Promise<string[]> {
  const out = (await gitOrNull(repoRoot, args)) ?? '';
  return out.split('\n').map((line) => line.trim()).filter(Boolean);
}

async function repoRefs(repoRoot: string): Promise<RepoRefs> {
  const [branches, remotes, tags, current, originHead] = await Promise.all([
    lines(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/heads']),
    lines(repoRoot, ['for-each-ref', '--format=%(refname:short)', 'refs/remotes']),
    lines(repoRoot, ['for-each-ref', '--format=%(refname:short)', '--sort=-creatordate', 'refs/tags']),
    lines(repoRoot, ['symbolic-ref', '--short', '-q', 'HEAD']),
    lines(repoRoot, ['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'])
  ]);
  const remoteDefault = originHead[0]?.replace(/^origin\//, '');
  const defaultBranch = [remoteDefault, 'main', 'master'].find((name) => name && branches.includes(name));
  return {
    branches,
    remotes: remotes.filter((name) => !name.endsWith('/HEAD')),
    tags,
    current: current[0],
    defaultBranch: defaultBranch ?? (originHead[0] && remotes.includes(originHead[0]) ? originHead[0] : undefined)
  };
}

async function isRevision(repoRoot: string, text: string): Promise<boolean> {
  return (await gitOrNull(repoRoot, ['rev-parse', '--verify', '--quiet', `${text}^{commit}`])) !== null;
}

function toPick(item: RefItem): RefPick {
  return {
    label: `$(${KIND_ICON[item.kind] ?? 'edit'}) ${KIND_LABEL[item.kind] ?? item.name}`,
    description: item.current ? 'current' : undefined,
    detail: KIND_DETAIL[item.kind],
    ref: item
  };
}

/** A quick pick over `items` that also accepts typed text, verified as a revision on accept. Resolves undefined on escape and `'back'` on the Back button. */
function pickRef(
  repoRoot: string,
  options: { title: string; placeholder: string; items: RefItem[]; picked?: RefItem; back: boolean }
): Promise<RefItem | 'back' | undefined> {
  return new Promise((resolve) => {
    const picker = vscode.window.createQuickPick<RefPick>();
    picker.title = options.title;
    picker.placeholder = options.placeholder;
    picker.matchOnDescription = true;
    if (options.back) picker.buttons = [vscode.QuickInputButtons.Back];
    const fixed = options.items.map(toPick);
    picker.items = fixed;
    if (options.picked) picker.activeItems = fixed.filter((item) => item.ref?.name === options.picked?.name);
    const typedItem = (text: string, detail: string): RefPick => ({
      label: `$(edit) ${text}`,
      detail,
      alwaysShow: true,
      ref: { name: text, kind: 'typed' }
    });
    picker.onDidChangeValue((value) => {
      const text = value.trim();
      picker.items =
        !text || fixed.some((item) => item.ref?.name === text) ? fixed : [typedItem(text, 'Typed revision'), ...fixed];
    });
    picker.onDidTriggerButton(() => {
      resolve('back');
      picker.dispose();
    });
    picker.onDidAccept(async () => {
      const chosen = picker.selectedItems[0]?.ref;
      if (!chosen) return;
      if (chosen.kind === 'typed') {
        picker.busy = true;
        const ok = await isRevision(repoRoot, chosen.name);
        picker.busy = false;
        if (!ok) {
          picker.items = [typedItem(chosen.name, `${chosen.name} is not a revision in this repository`), ...fixed];
          return;
        }
      }
      resolve(chosen);
      picker.dispose();
    });
    picker.onDidHide(() => {
      resolve(undefined);
      picker.dispose();
    });
    picker.show();
  });
}

/** Head first, then base, as GitLens does; Back on the base step returns to the head step with the head still active. */
export async function pickComparison(repoRoot: string): Promise<Source | undefined> {
  const refs = await repoRefs(repoRoot);
  const heads = headItems(refs);
  let head: RefItem | undefined;
  for (;;) {
    const pickedHead = await pickRef(repoRoot, {
      title: 'Redline: Compare (1/2)',
      placeholder: 'Pick what to review, or type a revision',
      items: heads,
      picked: head,
      back: false
    });
    if (!pickedHead || pickedHead === 'back') return undefined;
    head = pickedHead;
    const bases = baseItems(refs, head);
    const base = await pickRef(repoRoot, {
      title: 'Redline: Compare (2/2)',
      placeholder: `Pick what to compare ${KIND_LABEL[head.kind] ?? head.name} against, or type a revision`,
      items: bases.items,
      picked: bases.suggested,
      back: true
    });
    if (!base) return undefined;
    if (base !== 'back') return sourceFor(base, head);
  }
}
