import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { add, all, complete, isOverdue, open, reset } from './store.mjs';

beforeEach(() => reset());

test('add assigns increasing ids', () => {
  assert.equal(add('a').id, 1);
  assert.equal(add('b').id, 2);
});

test('complete marks the item done', () => {
  add('a');
  assert.equal(complete(1).done, true);
});

test('open hides completed items, all keeps them', () => {
  add('a');
  add('b');
  complete(1);
  assert.deepEqual(open().map((item) => item.id), [2]);
  assert.equal(all().length, 2);
});

test('isOverdue compares against today', () => {
  const item = add('a', '2020-01-01');
  assert.equal(isOverdue(item, new Date('2020-01-02T00:00:00Z')), true);
  assert.equal(isOverdue(item, new Date('2020-01-01T00:00:00Z')), false);
});
