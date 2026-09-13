import assert from 'node:assert/strict';
import test, { beforeEach } from 'node:test';
import { add, complete, list, reset } from './store.mjs';

beforeEach(() => reset());

test('add assigns increasing ids', () => {
  assert.equal(add('a').id, 1);
  assert.equal(add('b').id, 2);
});

test('complete marks the item done', () => {
  add('a');
  assert.equal(complete(1).done, true);
});

test('list returns every item', () => {
  add('a');
  add('b');
  assert.equal(list().length, 2);
});
