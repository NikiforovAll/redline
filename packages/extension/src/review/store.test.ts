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

    const { markdown, delivered } = store.renderReview(roundId);
    assert.deepEqual(delivered.sort(), [t1.id, t2.id, note.id].sort());
    assert.equal(
      markdown,
      [
        '# Review r1: unstaged changes, 3 comments in 2 files',
        '',
        'Resolve each with resolve_comment(id) once addressed.',
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

    const { markdown } = store.renderReview(round.id);
    assert.equal(
      markdown,
      [
        '# Review r1: unstaged changes, 1 comment in 1 file',
        '',
        'Resolve each with resolve_comment(id) once addressed.',
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
  it('lists undelivered human threads and clears after delivery', () => {
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
    const pending = store.pending();
    assert.equal(pending.length, 1);
    assert.equal(pending[0].roundId, roundId);
    assert.equal(pending[0].fileCount, 2);
    assert.equal(pending[0].threadIds.length, 2);

    const submitted = store.markSubmitted(roundId);
    assert.equal(submitted.commentCount, 2);
    assert.equal(submitted.fileCount, 2);
    assert.ok(store.summary(roundId).submittedAt);

    store.renderReview(roundId);
    assert.deepEqual(store.pending(), []);
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
      /^# Review r1: unstaged changes, 3 comments in 2 files$/m
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
    store.renderReview(roundId);
    assert.deepEqual(store.pending(), []);
    store.addComment(thread.id, 'human', 'and another thing');
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

describe('resolve', () => {
  it('toggles resolved and keeps the thread deliverable', () => {
    const { store, roundId } = fixture();
    const thread = store.addThread(
      roundId,
      { file: 'src/auth/session.ts', side: 'right', newLine: 42 },
      'human',
      'one'
    );
    assert.equal(store.setResolved(thread.id, true).resolved, true);
    assert.equal(store.summary(roundId).openThreads, 1);
    assert.match(store.renderReview(roundId).markdown, /\(resolved\)/);
  });
});
