import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Thread } from '@redline/protocol';
import type { StoredRound } from './store.ts';
import {
  dateLabel,
  draftCount,
  formatDate,
  noteDescription,
  noteLabel,
  noteNodes,
  notesDescription,
  roundMessage,
  roundChildren,
  roundDescription,
  roundLabel,
  rootNodes
} from './view-model.ts';

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
    refreshCount: 0,
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
  it('shows the date, then a notes group with every thread in reading order and the current one marked', () => {
    const cursor = { roundId: 'r1', threadId: 't1' };
    const nodes = roundChildren(r1, cursor);
    assert.deepEqual(nodes.map((node) => node.kind), ['info', 'notes']);
    assert.equal(notesDescription(r1), '3 notes');
    assert.deepEqual(
      noteNodes(r1, cursor).map((node) => [node.thread.id, node.index, node.current, node.answered]),
      [['t1', 1, true, false], ['t2', 2, false, false], ['h1', 3, false, true]]
    );
    assert.deepEqual(roundChildren(round('r3', []), undefined).map((node) => node.kind), ['info']);
  });

  it('keeps resolved threads in place so numbering matches the tour', () => {
    const r4 = round('r4', [thread('t2', 'b.ts', 1, '**[2/2]** Second.'), thread('t1', 'a.ts', 2, '**[1/2]** First.', { resolved: true })]);
    assert.equal(notesDescription(r4), '2 notes · 1 open');
    const notes = noteNodes(r4, undefined);
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

  it('names the round by its source and shows the title as the first child only', () => {
    const titled = { ...round('r5', [thread('d', 'a.ts', 2, 'gone', { detached: true })]), title: 'Fix store pruning' };
    assert.equal(roundLabel(titled), 'working tree');
    assert.equal(roundDescription(titled), '2 files · 1 open · 1 detached · open');
    const nodes = roundChildren(titled, undefined);
    assert.deepEqual(nodes.slice(0, 2).map((node) => node.kind === 'info' && node.label), ['Fix store pruning', `Opened ${formatDate(titled.createdAt)}`]);
    assert.equal(noteDescription(noteNodes(titled, undefined)[0]), 'a.ts:1 · detached');
  });

  it('reports refreshes in the date row and the refresh message', () => {
    const refreshed = { ...round('r6', [human]), refreshedAt: '2026-09-12T12:30:00Z', refreshCount: 3 };
    const at = formatDate(refreshed.refreshedAt);
    assert.equal(dateLabel(refreshed), `Refreshed ${at} · 3 refreshes`);
    assert.equal(dateLabel({ ...refreshed, refreshCount: 1 }), `Refreshed ${at} · 1 refresh`);
    assert.equal(dateLabel({ ...refreshed, submittedAt: '2026-09-12T13:00:00Z' }), `Submitted ${formatDate('2026-09-12T13:00:00Z')}`);
    assert.equal(roundMessage(refreshed, 'refreshed'), 'Refreshed working tree (2 files, 1 open thread)');
    assert.equal(roundMessage(refreshed, 'opened'), 'Opened working tree (2 files, 1 note)');
    assert.equal(roundMessage(refreshed, 'kept'), 'Kept working tree: nothing uncommitted to refresh from');
    assert.equal(
      roundMessage({ ...refreshed, source: { kind: 'range', from: 'main', to: 'HEAD' } }, 'kept'),
      'Kept working tree: the range has no changes to refresh from'
    );
  });
});

describe('noteLabel', () => {
  it('strips the tour prefix and emphasis, keeps the first line', () => {
    assert.equal(noteLabel(thread('t', 'a.ts', 1, '**[3/9]** Adds the `Quote` type.\n\nMore.')), 'Adds the Quote type.');
    assert.equal(noteLabel(thread('t', 'a.ts', 1, '')), 't');
  });
});
