import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Thread } from '@redline/protocol';
import type { StoredRound } from './store.ts';
import { noteDescription, noteLabel, roundChildren, roundDescription, rootNodes, draftCount } from './view-model.ts';

function thread(id: string, file: string, newLine: number, body: string, extra: Partial<Thread> = {}): Thread {
  return {
    id,
    roundId: 'r1',
    anchor: { file, side: 'right', newLine },
    comments: [{ id: `${id}-c`, threadId: id, author: 'claude', body, createdAt: '' }],
    resolved: false,
    sent: true,
    delivered: true,
    kind: 'note',
    ...extra
  };
}

function round(id: string, threads: Thread[], submittedAt?: string): StoredRound {
  return {
    id,
    source: { kind: 'worktree', scope: 'all' },
    sourceLabel: 'working tree',
    createdAt: '2026-09-12T10:00:00Z',
    submittedAt,
    notes: [],
    files: [
      { path: 'a.ts', status: 'modified', left: '', right: '', hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: [] }] },
      { path: 'b.ts', status: 'added', left: null, right: '', hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: 2, lines: [] }] }
    ],
    threads
  };
}

const human = thread('h1', 'b.ts', 2, 'why?', {
  kind: 'human',
  sent: false,
  delivered: false,
  comments: [{ id: 'h1-c', threadId: 'h1', author: 'human', body: 'why?', createdAt: '' }]
});
const r1 = round('r1', [thread('t2', 'b.ts', 1, '**[2/2]** Second.'), thread('t1', 'a.ts', 2, '**[1/2]** First.'), human]);

describe('rootNodes', () => {
  it('lists newest first and marks the active round', () => {
    const nodes = rootNodes([r1, round('r2', [])], 'r1');
    assert.deepEqual(
      nodes.map((node) => node.kind === 'round' && [node.round.id, node.active]),
      [['r2', false], ['r1', true]]
    );
  });
});

describe('roundChildren', () => {
  it('shows source and date, then open notes in reading order with the current one marked', () => {
    const nodes = roundChildren(r1, { roundId: 'r1', threadId: 't1' });
    assert.deepEqual(nodes.map((node) => node.kind), ['info', 'info', 'note', 'note', 'note']);
    assert.deepEqual(
      nodes.map((node) => node.kind === 'note' && [node.thread.id, node.index, node.current, node.answered]).filter(Boolean),
      [['t1', 1, true, false], ['t2', 2, false, false], ['h1', 3, false, true]]
    );
  });

  it('keeps resolved threads in place so numbering matches the tour', () => {
    const r4 = round('r4', [thread('t2', 'b.ts', 1, '**[2/2]** Second.'), thread('t1', 'a.ts', 2, '**[1/2]** First.', { resolved: true })]);
    const notes = roundChildren(r4, undefined).filter((node) => node.kind === 'note');
    assert.deepEqual(
      notes.map((node) => [node.thread.id, node.index, node.thread.resolved]),
      [['t1', 1, true], ['t2', 2, false]]
    );
    assert.equal(noteDescription(notes[0]), 'a.ts:2 · resolved');
  });

  it('describes the round state', () => {
    assert.equal(roundDescription(r1), '2 files · 3 open · draft · 1 to send');
    assert.equal(roundDescription(round('r3', [], '2026-09-12T11:00:00Z')), '2 files · 0 open · submitted');
    assert.equal(draftCount(round('r3', [])), 0);
  });
});

describe('noteLabel', () => {
  it('strips the tour prefix and emphasis, keeps the first line', () => {
    assert.equal(noteLabel(thread('t', 'a.ts', 1, '**[3/9]** Adds the `Quote` type.\n\nMore.')), 'Adds the Quote type.');
    assert.equal(noteLabel(thread('t', 'a.ts', 1, '')), 't');
  });
});
