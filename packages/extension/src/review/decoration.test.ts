import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  COMMENT_OPTIONS,
  sideLabel,
  threadDecoration,
  type ThreadDecorationInput
} from './decoration.ts';

function input(overrides: Partial<ThreadDecorationInput> = {}): ThreadDecorationInput {
  return {
    kind: 'human',
    resolved: false,
    sent: false,
    submitted: false,
    hasHumanComment: true,
    file: 'src/http/middleware.ts',
    line: 76,
    side: 'right',
    ...overrides
  };
}

describe('threadDecoration', () => {
  it('labels a claude note before any human reply', () => {
    const decoration = threadDecoration(input({ kind: 'note', hasHumanComment: false }));
    assert.equal(decoration.stage, 'note');
    assert.equal(decoration.contextValue, 'redline.note');
    assert.equal(decoration.label, 'note · middleware.ts:76 (new)');
  });

  it('labels an unsent human comment as a draft', () => {
    assert.equal(threadDecoration(input()).stage, 'draft');
  });

  it('labels a submitted round', () => {
    const decoration = threadDecoration(input({ submitted: true }));
    assert.equal(decoration.stage, 'submitted');
    assert.equal(decoration.contextValue, 'redline.submitted');
  });

  it('prefers send-now over submitted', () => {
    assert.equal(threadDecoration(input({ submitted: true, sent: true })).stage, 'sent');
    assert.equal(
      threadDecoration(input({ sent: true })).label,
      'sent to Agent · middleware.ts:76 (new)'
    );
  });

  it('prefers resolved over every other stage', () => {
    const decoration = threadDecoration(input({ resolved: true, sent: true, submitted: true }));
    assert.equal(decoration.stage, 'resolved');
    assert.equal(decoration.contextValue, 'redline.resolved');
  });

  it('names the diff side the thread anchors to', () => {
    assert.equal(sideLabel('left'), 'old');
    assert.equal(sideLabel('right'), 'new');
    assert.match(threadDecoration(input({ side: 'left' })).label, /\(old\)$/);
  });

  it('keeps a claude note in the note stage until a human replies', () => {
    assert.equal(threadDecoration(input({ kind: 'note' })).stage, 'draft');
  });
});

describe('reply box copy', () => {
  it('stays short enough not to wrap in the comment widget', () => {
    assert.equal(COMMENT_OPTIONS.prompt, 'Comment for Agent');
    assert.equal(COMMENT_OPTIONS.placeHolder, 'Comment');
  });
});
