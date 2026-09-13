import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { baseItems, HEAD_ITEM, headItems, INDEX_ITEM, sourceFor, WORKTREE_ITEM, type RepoRefs } from './compare-model.ts';

const refs: RepoRefs = {
  branches: ['feature', 'main', 'zeta'],
  remotes: ['origin/main'],
  tags: ['v1'],
  current: 'feature',
  defaultBranch: 'main'
};

describe('headItems', () => {
  it('leads with the working tree, index and HEAD, then the current branch', () => {
    assert.deepEqual(
      headItems(refs).map((item) => item.name),
      ['worktree', 'index', 'HEAD', 'feature', 'main', 'zeta', 'origin/main', 'v1']
    );
    assert.equal(headItems(refs)[3].current, true);
  });
});

describe('baseItems', () => {
  it('drops the picked head and leads with the default branch, which is the suggestion', () => {
    const { items, suggested } = baseItems(refs, { name: 'feature', kind: 'branch' });
    assert.deepEqual(items.map((item) => item.name), ['main', 'HEAD', 'zeta', 'origin/main', 'v1']);
    assert.equal(suggested?.name, 'main');
  });

  it('suggests nothing when the head is the default branch', () => {
    const { items, suggested } = baseItems(refs, { name: 'main', kind: 'branch' });
    assert.equal(suggested, undefined);
    assert.deepEqual(items.map((item) => item.name), ['HEAD', 'feature', 'zeta', 'origin/main', 'v1']);
  });

  it('suggests nothing when there is no default branch', () => {
    assert.equal(baseItems({ ...refs, defaultBranch: undefined }, { name: 'feature', kind: 'branch' }).suggested, undefined);
  });
});

describe('sourceFor', () => {
  it('folds working tree and index against HEAD into the worktree sources Claude opens', () => {
    assert.deepEqual(sourceFor(HEAD_ITEM, WORKTREE_ITEM), { kind: 'worktree', scope: 'all' });
    assert.deepEqual(sourceFor(HEAD_ITEM, INDEX_ITEM), { kind: 'worktree', scope: 'staged' });
  });

  it('uses the sentinel against any other base', () => {
    assert.deepEqual(sourceFor({ name: 'main', kind: 'branch' }, WORKTREE_ITEM), { kind: 'range', from: 'main', to: 'worktree' });
    assert.deepEqual(sourceFor({ name: 'v1', kind: 'tag' }, INDEX_ITEM), { kind: 'range', from: 'v1', to: 'index' });
  });

  it('gives a branch base the three-dot form and a tag or commit base two dots', () => {
    assert.deepEqual(sourceFor({ name: 'main', kind: 'branch' }, { name: 'feature', kind: 'branch' }), { kind: 'range', from: 'main...', to: 'feature' });
    assert.deepEqual(sourceFor({ name: 'origin/main', kind: 'remote' }, HEAD_ITEM), { kind: 'range', from: 'origin/main...', to: 'HEAD' });
    assert.deepEqual(sourceFor({ name: 'v1', kind: 'tag' }, HEAD_ITEM), { kind: 'range', from: 'v1', to: 'HEAD' });
    assert.deepEqual(sourceFor({ name: 'abc123', kind: 'typed' }, HEAD_ITEM), { kind: 'range', from: 'abc123', to: 'HEAD' });
  });
});
