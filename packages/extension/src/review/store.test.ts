import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  anchorLine,
  hasHumanComment,
  memoryPersistence,
  ReviewStore,
  sourceLabel,
  type StoreFile
} from './store.ts';

function sessionFile(): StoreFile {
  return {
    path: 'src/auth/session.ts',
    status: 'modified',
    left: 'x\n',
    right: 'y\n',
    hunks: [
      {
        oldStart: 16,
        oldLines: 5,
        newStart: 40,
        newLines: 4,
        lines: [
          { kind: 'context', content: 'export function issueSession(payload, options = {}) {' },
          { kind: 'context', content: '  const secret = process.env.SESSION_SECRET;' },
          { kind: 'add', content: '  const ttl = options.ttl ?? 3600;' },
          { kind: 'add', content: '  return sign(payload, secret, { expiresIn: ttl });' },
          { kind: 'del', content: '  if (!secret) throw new Error("missing secret");' },
          { kind: 'context', content: '}' }
        ]
      }
    ]
  };
}

function middlewareFile(): StoreFile {
  return {
    path: 'src/http/middleware.ts',
    status: 'modified',
    left: 'x\n',
    right: 'y\n',
    hunks: [
      {
        oldStart: 74,
        oldLines: 2,
        newStart: 74,
        newLines: 4,
        lines: [
          { kind: 'context', content: '  await audit.write(req);' },
          { kind: 'add', content: '' },
          { kind: 'add', content: '  next();' },
          { kind: 'context', content: '}' }
        ]
      }
    ]
  };
}

function fixture(): { store: ReviewStore; roundId: string } {
  const store = new ReviewStore(memoryPersistence());
  const round = store.createRound({
    source: { kind: 'worktree', scope: 'unstaged' },
    notes: [
      {
        file: 'src/http/middleware.ts',
        hunks: [
          {
            newRange: [76, 76],
            summary: 'moved next() after the audit write so failures are recorded before the handler runs'
          }
        ]
      }
    ]
  });
  store.attachFiles(round.id, [sessionFile(), middlewareFile()]);
  return { store, roundId: round.id };
}

describe('sourceLabel', () => {
  it('renders every source kind', () => {
    assert.equal(sourceLabel({ kind: 'worktree', scope: 'unstaged' }), 'unstaged changes');
    assert.equal(sourceLabel({ kind: 'worktree', scope: 'all' }), 'all changes');
    assert.equal(sourceLabel({ kind: 'range', from: 'main', to: 'HEAD' }), 'main..HEAD');
    assert.equal(sourceLabel({ kind: 'range', from: 'main...', to: 'feature' }), 'main...feature');
    assert.equal(sourceLabel({ kind: 'range', from: 'main...feature', to: '' }), 'main...feature');
    assert.equal(sourceLabel({ kind: 'range', from: 'main', to: 'worktree' }), 'main..worktree');
    assert.equal(sourceLabel({ kind: 'patch', text: '' }), 'patch');
    assert.equal(
      sourceLabel({ kind: 'files', pairs: [{ left: 'a', right: 'b' }, { left: 'c', right: 'd' }] }),
      '2 file pairs'
    );
  });
});

describe('ids', () => {
  it('numbers rounds and prefixes threads and comments', () => {
    const { store, roundId } = fixture();
    assert.equal(roundId, 'r1');
    const second = store.createRound({ source: { kind: 'patch', text: '' } });
    assert.equal(second.id, 'r2');
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'hi'
    );
    assert.match(thread.id, /^t-[0-9a-f]{8}$/);
    assert.match(thread.comments[0].id, /^c-[0-9a-f]{8}$/);
  });
});

describe('removeRound', () => {
  it('drops the round and its threads, keeps the numbering, notifies listeners', () => {
    const { store, roundId } = fixture();
    const threadId = store.rounds()[0].threads[0].id;
    let changes = 0;
    store.onChange(() => changes++);
    store.removeRound(roundId);
    assert.equal(store.round(roundId), undefined);
    assert.equal(store.thread(threadId), undefined);
    assert.equal(store.rounds().length, 0);
    assert.equal(changes, 1);
    assert.equal(store.createRound({ source: { kind: 'patch', text: '' } }).id, 'r2');
    assert.throws(() => store.removeRound('r9'));
  });
});

describe('renderReview', () => {
  it('produces candidate-C markdown for two files and three threads', () => {
    const { store, roundId } = fixture();
    const t1 = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'Make the default TTL a named constant and read it from config.'
    );
    const t2 = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'left', oldLine: 18 },
      'human',
      'Why was this guard removed?'
    );
    const note = store.round(roundId)!.threads.find((thread) => thread.kind === 'note')!;
    store.addComment(note.id, 'human', 'Fine, but wrap the audit write in try/catch.');
    store.markSubmitted(roundId);

    const { markdown, delivered } = store.renderReview(roundId);
    assert.deepEqual(delivered.sort(), [t1.id, t2.id, note.id].sort());
    assert.equal(
      markdown,
      [
        '# Review: unstaged changes, 3 comments in 2 files',
        '',
        "Done thread (change landed, or declined with a reason): resolve_comment(id). Reviewer's turn (question, proposal, answer): reply_comment(id), thread stays open.",
        '',
        '## src/auth/session.ts',
        '',
        `### :18 left  [${t2.id}]`,
        '```diff',
        '   const secret = process.env.SESSION_SECRET;',
        '+  const ttl = options.ttl ?? 3600;',
        '+  return sign(payload, secret, { expiresIn: ttl });',
        '-  if (!secret) throw new Error("missing secret");',
        '```',
        '**human:** Why was this guard removed?',
        '',
        `### :42 right  [${t1.id}]`,
        '```diff',
        '   const secret = process.env.SESSION_SECRET;',
        '+  const ttl = options.ttl ?? 3600;',
        '+  return sign(payload, secret, { expiresIn: ttl });',
        '-  if (!secret) throw new Error("missing secret");',
        '```',
        '**human:** Make the default TTL a named constant and read it from config.',
        '',
        '## src/http/middleware.ts',
        '',
        `### :75 right  [${note.id}]`,
        '```diff',
        '   await audit.write(req);',
        '+',
        '+  next();',
        ' }',
        '```',
        '**claude (note):** moved next() after the audit write so failures are recorded before the handler runs',
        '**human:** Fine, but wrap the audit write in try/catch.',
        ''
      ].join('\n')
    );
  });

  it('omits notes with no human reply and marks threads delivered once', () => {
    const { store, roundId } = fixture();
    store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    store.markSubmitted(roundId);
    const first = store.renderReview(roundId);
    assert.equal(first.delivered.length, 1);
    assert.ok(!first.markdown.includes('claude (note)'));

    const second = store.renderReview(roundId);
    assert.deepEqual(second.delivered, []);
    assert.match(second.markdown, /No undelivered comments\./);
  });

  it('renders only the requested threads', () => {
    const { store, roundId } = fixture();
    const a = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'aaa'
    );
    store.addThread(
      roundId,
      { file: 'src/http/middleware.ts', side: 'right', newLine: 76 },
      'human',
      'bbb'
    );
    const { markdown, delivered } = store.renderReview(roundId, [a.id]);
    assert.deepEqual(delivered, [a.id]);
    assert.ok(markdown.includes('aaa'));
    assert.ok(!markdown.includes('bbb'));
  });
});

function deletionOnlyFile(): StoreFile {
  return {
    path: 'src/legacy/parse.ts',
    status: 'modified',
    left: 'x\n',
    right: 'y\n',
    hunks: [
      {
        oldStart: 10,
        oldLines: 3,
        newStart: 10,
        newLines: 1,
        lines: [
          { kind: 'context', content: 'export function parse(input) {' },
          { kind: 'del', content: '  assert(typeof input === "string");' },
          { kind: 'del', content: '  log(input);' }
        ]
      }
    ]
  };
}

describe('note order', () => {
  it('seeds a batch by file order and line, and appends a later batch after it', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({
      source: { kind: 'worktree', scope: 'unstaged' },
      notes: [
        { file: 'src/http/middleware.ts', summary: 'later file' },
        { file: 'src/auth/session.ts', summary: 'first file' }
      ]
    });
    store.attachFiles(round.id, [sessionFile(), middlewareFile()]);
    const bodies = () => store.round(round.id)!.threads.map((thread) => thread.comments[0].body);
    assert.deepEqual(bodies(), ['first file', 'later file']);
    store.addNotes(round.id, [{ file: 'src/auth/session.ts', summary: 'added afterwards' }]);
    assert.deepEqual(bodies(), ['first file', 'later file', 'added afterwards']);
  });
});

describe('note anchoring', () => {
  it('snaps a per-hunk note forward to the first added line of its hunk', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({
      source: { kind: 'worktree', scope: 'unstaged' },
      notes: [
        {
          file: 'src/http/middleware.ts',
          hunks: [{ newRange: [74, 77], summary: 'call next() after the audit write' }]
        }
      ]
    });
    store.attachFiles(round.id, [middlewareFile()]);
    const note = store.round(round.id)!.threads[0];
    assert.deepEqual(note.anchor, {
      file: 'src/http/middleware.ts',
      side: 'right',
      newLine: 75
    });
  });

  it('reports note files the diff does not contain', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({
      source: { kind: 'worktree', scope: 'unstaged' },
      notes: [
        { file: 'src/auth/session.ts', summary: 'kept' },
        { file: 'src/new/file.ts', summary: 'dropped' },
        { file: 'src/new/file.ts', hunks: [{ newRange: [1, 2], summary: 'dropped too' }] }
      ]
    });
    store.attachFiles(round.id, [sessionFile()]);
    assert.equal(store.round(round.id)!.threads.length, 1);
    assert.deepEqual(store.summary(round.id).unmatchedNoteFiles, ['src/new/file.ts']);
  });

  it('anchors a per-file summary note to the first added line of the first hunk', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({
      source: { kind: 'worktree', scope: 'unstaged' },
      notes: [{ file: 'src/auth/session.ts', summary: 'made the TTL configurable' }]
    });
    store.attachFiles(round.id, [sessionFile()]);
    const note = store.round(round.id)!.threads[0];
    assert.deepEqual(note.anchor, {
      file: 'src/auth/session.ts',
      side: 'right',
      newLine: 42
    });
  });

  it('falls back to the first removed line on the left when the hunk adds nothing', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({
      source: { kind: 'worktree', scope: 'unstaged' },
      notes: [{ file: 'src/legacy/parse.ts', summary: 'dropped the input guard' }]
    });
    store.attachFiles(round.id, [deletionOnlyFile()]);
    const note = store.round(round.id)!.threads[0];
    assert.deepEqual(note.anchor, {
      file: 'src/legacy/parse.ts',
      side: 'left',
      oldLine: 11
    });
  });

  it('renders the whole hunk in the fence of a note thread', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({
      source: { kind: 'worktree', scope: 'unstaged' },
      notes: [{ file: 'src/legacy/parse.ts', summary: 'dropped the input guard' }]
    });
    store.attachFiles(round.id, [deletionOnlyFile()]);
    const note = store.round(round.id)!.threads[0];
    store.addComment(note.id, 'human', 'Keep the guard.');
    store.markSubmitted(round.id);

    const { markdown } = store.renderReview(round.id);
    assert.equal(
      markdown,
      [
        '# Review: unstaged changes, 1 comment in 1 file',
        '',
        "Done thread (change landed, or declined with a reason): resolve_comment(id). Reviewer's turn (question, proposal, answer): reply_comment(id), thread stays open.",
        '',
        '## src/legacy/parse.ts',
        '',
        `### :11 left  [${note.id}]`,
        '```diff',
        ' export function parse(input) {',
        '-  assert(typeof input === "string");',
        '-  log(input);',
        '```',
        '**claude (note):** dropped the input guard',
        '**human:** Keep the guard.',
        ''
      ].join('\n')
    );
  });
});

describe('pending and submit', () => {
  it('queues human threads on submit, not when the comment is typed, and clears after delivery', () => {
    const { store, roundId } = fixture();
    assert.deepEqual(store.pending(), []);
    store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    store.addThread(
      roundId,
      { file: 'src/http/middleware.ts', side: 'right', newLine: 76 },
      'human',
      'two'
    );
    assert.equal(store.drafts(roundId).length, 2);
    assert.deepEqual(store.pending(), []);
    assert.match(store.renderReview(roundId).markdown, /No undelivered comments\./);

    const submitted = store.markSubmitted(roundId);
    assert.equal(submitted.commentCount, 2);
    assert.equal(submitted.fileCount, 2);
    assert.ok(store.summary(roundId).submittedAt);
    const pending = store.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].roundId, roundId);
    assert.equal(pending[0].fileCount, 2);
    assert.equal(pending[0].threadIds.length, 2);

    store.renderReview(roundId);
    assert.deepEqual(store.pending(), []);
  });

  it('queues a single thread on send, and a new human comment takes it back to draft', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    store.markSent(thread.id);
    assert.deepEqual(store.pending()[0]?.threadIds, [thread.id]);
    store.addComment(thread.id, 'human', 'wait, also this');
    assert.deepEqual(store.pending(), []);
    assert.equal(store.drafts(roundId).length, 1);
  });

  it('reopens a resolved thread when the reviewer replies, and delivers it only on send', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    store.setResolved(thread.id, true);
    store.addComment(thread.id, 'human', 'not done yet');
    assert.equal(store.thread(thread.id)?.resolved, false);
    assert.deepEqual(store.pending(), []);
    assert.equal(store.drafts(roundId).length, 1);
    store.markSent(thread.id);
    assert.deepEqual(store.pending()[0]?.threadIds, [thread.id]);
  });

  it('counts human comments only, and reports the same numbers as the markdown header', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    store.addComment(thread.id, 'claude', 'noted');
    store.addComment(thread.id, 'human', 'two');
    const note = store.round(roundId)!.threads.find((entry) => entry.kind === 'note')!;
    store.addComment(note.id, 'human', 'three');

    const submitted = store.markSubmitted(roundId);
    assert.equal(submitted.commentCount, 3);
    assert.equal(submitted.fileCount, 2);
    assert.match(
      store.renderReview(roundId).markdown,
      /^# Review: unstaged changes, 3 comments in 2 files$/m
    );
  });

  it('re-opens delivery when a human replies again', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    store.markSubmitted(roundId);
    store.renderReview(roundId);
    assert.deepEqual(store.pending(), []);
    store.addComment(thread.id, 'human', 'and another thing');
    assert.deepEqual(store.pending(), []);
    assert.equal(store.drafts(roundId).length, 1);
    store.markSubmitted(roundId);
    assert.equal(store.pending().length, 1);
  });
});

describe('persistence', () => {
  it('reloads rounds and threads from the injected backing store', () => {
    const backing = new Map();
    const store = new ReviewStore(memoryPersistence(backing));
    const round = store.createRound({ source: { kind: 'worktree', scope: 'all' } });
    store.attachFiles(round.id, [sessionFile()]);
    const thread = store.addThread(
      round.id,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'persist me'
    );

    const reloaded = new ReviewStore(memoryPersistence(backing));
    assert.equal(reloaded.thread(thread.id)?.comments[0].body, 'persist me');
    assert.equal(reloaded.createRound({ source: { kind: 'patch', text: '' } }).id, 'r2');
  });
});

describe('anchorLine', () => {
  it('prefers explicit line numbers over the hunk index', () => {
    const file = sessionFile();
    assert.equal(anchorLine({ file: file.path, side: 'right', newLine: 42 }, file), 42);
    assert.equal(anchorLine({ file: file.path, side: 'left', oldLine: 18 }, file), 18);
  });

  it('reads the hunk start when the anchor names only a hunk', () => {
    const file = sessionFile();
    assert.equal(anchorLine({ file: file.path, side: 'right', hunk: 1 }, file), 40);
    assert.equal(anchorLine({ file: file.path, side: 'left', hunk: 1 }, file), 16);
  });

  it('returns the caller fallback when the hunk is missing', () => {
    const file = sessionFile();
    const anchor = { file: file.path, side: 'right' as const, hunk: 9 };
    assert.equal(anchorLine(anchor, file), 0);
    assert.equal(anchorLine(anchor, undefined), 0);
    assert.equal(anchorLine(anchor, file, 1), 1);
    assert.equal(anchorLine(anchor, undefined, 1), 1);
  });
});

describe('hasHumanComment', () => {
  it('is false for a claude-only note and true once a human replies', () => {
    const { store, roundId } = fixture();
    const note = store.round(roundId)!.threads.find((thread) => thread.kind === 'note')!;
    assert.equal(hasHumanComment(note), false);
    store.addComment(note.id, 'human', 'ok');
    assert.equal(hasHumanComment(note), true);
  });
});

describe('editComment and deleteComment', () => {
  it('edit changes the body and keeps delivered, sent, and resolved', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, { file: 'src/http/middleware.ts', side: 'right', newLine: 76 }, 'human', 'tpyo');
    store.markSent(thread.id);
    store.renderReview(roundId);
    store.setResolved(thread.id, true);
    const edited = store.editComment(thread.id, thread.comments[0].id, 'typo');
    assert.equal(edited.comments[0].body, 'typo');
    assert.equal(edited.delivered, true);
    assert.equal(edited.sent, true);
    assert.equal(edited.resolved, true);
  });

  it('delete of the last comment removes the thread', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, { file: 'src/http/middleware.ts', side: 'right', newLine: 76 }, 'human', 'gone');
    assert.equal(store.deleteComment(thread.id, thread.comments[0].id), undefined);
    assert.equal(store.thread(thread.id), undefined);
    assert.equal(store.round(roundId)!.threads.some((entry) => entry.id === thread.id), false);
  });

  it('delete of the only human reply on a note keeps the note', () => {
    const { store, roundId } = fixture();
    const note = store.round(roundId)!.threads.find((thread) => thread.kind === 'note')!;
    const reply = store.addComment(note.id, 'human', 'ok').comments.at(-1)!;
    const kept = store.deleteComment(note.id, reply.id);
    assert.equal(kept?.id, note.id);
    assert.equal(kept?.comments.length, 1);
    assert.equal(hasHumanComment(kept!), false);
  });

  it('delete of a human comment with a claude reply keeps the thread', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, { file: 'src/http/middleware.ts', side: 'right', newLine: 76 }, 'human', 'why?');
    store.addComment(thread.id, 'claude', 'because');
    const kept = store.deleteComment(thread.id, thread.comments[0].id);
    assert.equal(kept?.comments.map((comment) => comment.author).join(), 'claude');
  });

  it('rejects an unknown comment id', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, { file: 'src/http/middleware.ts', side: 'right', newLine: 76 }, 'human', 'x');
    assert.throws(() => store.editComment(thread.id, 'c-nope', 'y'), /unknown comment c-nope/);
    assert.throws(() => store.deleteComment(thread.id, 'c-nope'), /unknown comment c-nope/);
  });
});

describe('round retention', () => {
  it('keeps only the ten most recent rounds and keeps numbering rounds', () => {
    const backing = new Map();
    const store = new ReviewStore(memoryPersistence(backing));
    for (let i = 0; i < 12; i += 1) {
      store.createRound({ source: { kind: 'patch', text: '' } });
    }
    assert.deepEqual(
      store.rounds().map((round) => round.id),
      ['r3', 'r4', 'r5', 'r6', 'r7', 'r8', 'r9', 'r10', 'r11', 'r12']
    );
    assert.equal(store.round('r1'), undefined);
    assert.equal(store.createRound({ source: { kind: 'patch', text: '' } }).id, 'r13');

    const reloaded = new ReviewStore(memoryPersistence(backing));
    assert.equal(reloaded.rounds().length, 10);
    assert.equal(reloaded.round('r13')?.id, 'r13');
  });

  it('loads a state written before the cap and trims it on the next write', () => {
    const backing = new Map();
    const seeded = new ReviewStore(memoryPersistence(backing));
    const round = seeded.createRound({ source: { kind: 'worktree', scope: 'all' } });
    seeded.attachFiles(round.id, [sessionFile()]);
    const oversized = {
      version: 1 as const,
      nextRound: 14,
      rounds: Array.from({ length: 13 }, (_unused, index) => ({
        ...structuredClone(seeded.rounds()[0]),
        id: `r${index + 1}`
      }))
    };
    backing.set('redline.store', oversized);

    const store = new ReviewStore(memoryPersistence(backing));
    assert.equal(store.rounds().length, 13);
    assert.equal(store.round('r1')?.id, 'r1');
    store.createRound({ source: { kind: 'patch', text: '' } });
    assert.equal(store.rounds().length, 10);
    assert.equal(store.round('r1'), undefined);
    assert.equal(store.round('r14')?.id, 'r14');
  });
});

/** `sessionFile` after an edit: two lines inserted above the hunk, the guard restored, the TTL line rewritten. */
function sessionFileEdited(): StoreFile {
  return {
    path: 'src/auth/session.ts',
    status: 'modified',
    left: 'x\n',
    right: 'z\n',
    hunks: [
      {
        oldStart: 16,
        oldLines: 5,
        newStart: 42,
        newLines: 6,
        lines: [
          { kind: 'context', content: 'export function issueSession(payload, options = {}) {' },
          { kind: 'context', content: '  const secret = process.env.SESSION_SECRET;' },
          { kind: 'add', content: '  if (!secret) throw new Error("missing secret");' },
          { kind: 'add', content: '  const ttl = options.ttl ?? DEFAULT_TTL;' },
          { kind: 'add', content: '  return sign(payload, secret, { expiresIn: ttl });' },
          { kind: 'del', content: '  if (!secret) throw new Error("missing secret");' },
          { kind: 'context', content: '}' }
        ]
      }
    ]
  };
}

describe('refreshRound', () => {
  const ttlLine = { file: 'src/auth/session.ts', side: 'right' as const, newLine: 42 };
  const signLine = { file: 'src/auth/session.ts', side: 'right' as const, newLine: 43 };

  it('finds the newest round with the same label for worktree and range sources, never for patches or file pairs', () => {
    const store = new ReviewStore(memoryPersistence());
    const first = store.createRound({ source: { kind: 'worktree', scope: 'all' } });
    store.createRound({ source: { kind: 'range', from: 'main', to: 'HEAD' } });
    const patch = store.createRound({ source: { kind: 'patch', text: 'x' } });
    const again = store.createRound({ source: { kind: 'worktree', scope: 'all' } });
    assert.equal(store.findOpenRound({ kind: 'worktree', scope: 'all' })?.id, again.id);
    assert.notEqual(store.findOpenRound({ kind: 'worktree', scope: 'all' })?.id, first.id);
    assert.equal(store.findOpenRound({ kind: 'range', from: 'main', to: 'HEAD' })?.id, 'r2');
    assert.equal(store.findOpenRound({ kind: 'worktree', scope: 'staged' }), undefined);
    assert.equal(store.findOpenRound({ kind: 'patch', text: 'x' }), undefined);
    assert.equal(store.findOpenRound({ kind: 'files', pairs: [{ left: 'a', right: 'b' }] }), undefined);
    assert.equal(patch.sourceLabel, 'patch');
  });

  it('moves a thread whose line shifted and keeps its comments', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, signLine, 'human', 'sign with the request secret');
    assert.equal(store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()] }), 'refreshed');
    const moved = store.thread(thread.id)!;
    assert.deepEqual(moved.anchor, { file: 'src/auth/session.ts', side: 'right', newLine: 46 });
    assert.equal(moved.detached, undefined);
    assert.equal(moved.comments[0].body, 'sign with the request secret');
  });

  it('detaches an open and a resolved thread whose line is gone, and keeps both', () => {
    const { store, roundId } = fixture();
    const open = store.addThread(roundId, ttlLine, 'human', 'name the constant');
    const done = store.addThread(roundId, ttlLine, 'human', 'and read it from config');
    store.setResolved(done.id, true);
    store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()] });
    for (const id of [open.id, done.id]) {
      const thread = store.thread(id)!;
      assert.equal(thread.detached, true);
      assert.deepEqual(thread.anchor, ttlLine);
    }
    assert.equal(store.thread(done.id)!.resolved, true);
    assert.equal(store.round(roundId)!.threads.length, 3);
    assert.equal(store.summary(roundId).detachedThreads, 2);
  });

  it('detaches every thread of a file the new snapshot lacks', () => {
    const { store, roundId } = fixture();
    const note = store.round(roundId)!.threads[0];
    store.refreshRound(roundId, { files: [sessionFile()] });
    assert.equal(store.thread(note.id)!.detached, true);
    assert.equal(store.thread(note.id)!.anchor.file, 'src/http/middleware.ts');
  });

  it('attaches a detached thread again when its line comes back', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, ttlLine, 'human', 'name the constant');
    store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()] });
    assert.equal(store.thread(thread.id)!.detached, true);
    store.refreshRound(roundId, { files: [sessionFile(), middlewareFile()] });
    const back = store.thread(thread.id)!;
    assert.equal(back.detached, undefined);
    assert.deepEqual(back.anchor, ttlLine);
  });

  it('gives up on a line that appears several times with different neighbours', () => {
    const store = new ReviewStore(memoryPersistence());
    const round = store.createRound({ source: { kind: 'worktree', scope: 'all' } });
    const brace = (content: string, kind: 'add' | 'context' = 'add') => ({ kind, content });
    store.attachFiles(round.id, [
      {
        path: 'a.ts',
        status: 'modified',
        left: '',
        right: '',
        hunks: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: [brace('if (a) {'), brace('}'), brace('x()', 'context')] }]
      }
    ]);
    const thread = store.addThread(round.id, { file: 'a.ts', side: 'right', newLine: 2 }, 'human', 'brace');
    store.refreshRound(round.id, {
      files: [
        {
          path: 'a.ts',
          status: 'modified',
          left: '',
          right: '',
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 5,
              lines: [brace('if (b) {'), brace('}'), brace('if (c) {'), brace('}'), brace('y()', 'context')]
            }
          ]
        }
      ]
    });
    assert.equal(store.thread(thread.id)!.detached, true);
  });

  it('appends the request notes as new threads, keeps old notes, and recomputes unmatched files', () => {
    const { store, roundId } = fixture();
    const before = store.round(roundId)!.threads.map((thread) => thread.id);
    store.refreshRound(roundId, {
      files: [sessionFileEdited(), middlewareFile()],
      title: 'Configurable TTL',
      notes: [
        { file: 'src/auth/session.ts', hunks: [{ newRange: [45, 45], summary: 'TTL now comes from DEFAULT_TTL' }] },
        { file: 'src/missing.ts', summary: 'nowhere' }
      ]
    });
    const round = store.round(roundId)!;
    assert.deepEqual(round.threads.slice(0, before.length).map((thread) => thread.id), before);
    assert.equal(round.threads.length, before.length + 1);
    assert.deepEqual(round.threads.at(-1)!.anchor, { file: 'src/auth/session.ts', side: 'right', newLine: 44 });
    assert.deepEqual(round.unmatchedNoteFiles, ['src/missing.ts']);
    assert.equal(round.title, 'Configurable TTL');
    assert.equal(round.notes.length, 3);
  });

  it('does not post a note again when the refreshing request resends it', () => {
    const { store, roundId } = fixture();
    const notes = store.round(roundId)!.notes;
    const count = store.round(roundId)!.threads.length;
    store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()], notes });
    assert.equal(store.round(roundId)!.threads.length, count);
    store.refreshRound(roundId, {
      files: [sessionFileEdited(), middlewareFile()],
      notes: [{ file: 'src/auth/session.ts', hunks: [{ newRange: [45, 45], summary: 'a new remark' }] }]
    });
    assert.equal(store.round(roundId)!.threads.length, count + 1);
  });

  it('clears submittedAt, stamps refreshedAt, counts refreshes, keeps the title when the request has none', () => {
    const { store, roundId } = fixture();
    store.addThread(roundId, ttlLine, 'human', 'one');
    store.markSubmitted(roundId);
    assert.ok(store.round(roundId)!.submittedAt);
    let changes = 0;
    store.onChange(() => changes++);
    store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()], partial: true });
    const summary = store.summary(roundId);
    assert.equal(summary.submittedAt, undefined);
    assert.ok(summary.refreshedAt);
    assert.equal(summary.refreshCount, 1);
    assert.equal(summary.title, undefined);
    assert.equal(store.round(roundId)!.partial, true);
    assert.equal(changes, 1);
    store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()] });
    assert.equal(store.summary(roundId).refreshCount, 2);
    assert.equal(store.round(roundId)!.partial, undefined);
  });

  it('keeps the round untouched when the new snapshot is empty', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, ttlLine, 'human', 'one');
    store.markSubmitted(roundId);
    let changes = 0;
    store.onChange(() => changes++);
    assert.equal(store.refreshRound(roundId, { files: [], notes: [{ file: 'src/auth/session.ts', summary: 'x' }] }), 'kept');
    const round = store.round(roundId)!;
    assert.ok(round.submittedAt);
    assert.equal(round.refreshedAt, undefined);
    assert.equal(round.refreshCount, 0);
    assert.equal(round.files.length, 2);
    assert.equal(round.threads.length, 2);
    assert.equal(store.thread(thread.id)!.detached, undefined);
    assert.equal(changes, 0);
  });

  it('renders detached threads with their last line and a marker, and hides lineText from the wire', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(roundId, ttlLine, 'human', 'name the constant');
    store.refreshRound(roundId, { files: [sessionFileEdited(), middlewareFile()] });
    store.markSubmitted(roundId);
    const { markdown } = store.renderReview(roundId);
    assert.match(markdown, new RegExp(`### :42 right  \\[${thread.id}\\] \\(detached\\)`));
    assert.match(markdown, /```diff\n   const ttl = options\.ttl \?\? 3600;\n```/);
    assert.equal('lineText' in store.wireRound(roundId).threads.find((entry) => entry.id === thread.id)!, false);
  });

  it('loads rounds stored before refreshes existed with a zero count', () => {
    const backing = new Map();
    const seeded = new ReviewStore(memoryPersistence(backing));
    seeded.createRound({ source: { kind: 'worktree', scope: 'all' } });
    const state = backing.get('redline.store');
    delete state.rounds[0].refreshCount;
    const store = new ReviewStore(memoryPersistence(backing));
    assert.equal(store.summary('r1').refreshCount, 0);
  });
});

describe('resolve', () => {
  it('drops a resolved thread from submit and reopening brings it back', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    assert.equal(store.setResolved(thread.id, true).resolved, true);
    assert.equal(store.summary(roundId).openThreads, 1);
    assert.equal(store.drafts(roundId).some((entry) => entry.id === thread.id), false);
    assert.doesNotMatch(store.renderReview(roundId).markdown, /\(resolved\)/);
    store.setResolved(thread.id, false);
    assert.ok(store.drafts(roundId).some((entry) => entry.id === thread.id));
    store.setResolved(thread.id, true);
    assert.match(store.renderReview(roundId, [thread.id]).markdown, /\(resolved\)/);
  });
});
