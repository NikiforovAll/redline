import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { Thread } from '@redline/protocol';
import { stepIndex, tourNumber, tourOrder } from './tour.ts';

function thread(id: string, file: string, newLine: number, body: string): Thread {
  return {
    id,
    roundId: 'r1',
    anchor: { file, side: 'right', newLine },
    comments: [{ id: `${id}-c`, threadId: id, author: 'claude', body, createdAt: '' }],
    resolved: false,
    sent: true,
    delivered: true,
    kind: 'note'
  };
}

describe('tourNumber', () => {
  it('reads the bold bracketed prefix', () => {
    assert.equal(tourNumber(thread('a', 'x', 1, '**[3/14]** Adds the type.')), 3);
    assert.equal(tourNumber(thread('a', 'x', 1, 'Plain note.')), undefined);
  });
});

describe('tourOrder', () => {
  it('walks tour numbers first, then the rest as posted', () => {
    const ordered = tourOrder([
      thread('b-9', 'src/b.ts', 9, 'unnumbered'),
      thread('t2', 'src/b.ts', 1, '**[2/2]** second'),
      thread('a-40', 'src/a.ts', 40, 'unnumbered'),
      thread('t1', 'src/a.ts', 99, '**[1/2]** first'),
      thread('a-3', 'src/a.ts', 3, 'unnumbered')
    ]);
    assert.deepEqual(
      ordered.map((entry) => entry.id),
      ['t1', 't2', 'b-9', 'a-40', 'a-3']
    );
  });
});

describe('stepIndex', () => {
  it('starts at either end and wraps', () => {
    assert.equal(stepIndex(undefined, 1, 3), 0);
    assert.equal(stepIndex(undefined, -1, 3), 2);
    assert.equal(stepIndex(2, 1, 3), 0);
    assert.equal(stepIndex(0, -1, 3), 2);
    assert.equal(stepIndex(undefined, 1, 0), -1);
  });
});
