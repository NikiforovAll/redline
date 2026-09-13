import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { after, before } from 'node:test';

const root = mkdtempSync(join(tmpdir(), 'redline-routes-'));
const redlineHome = join(root, 'home', '.redline');
const workspace = join(root, 'workspace');
mkdirSync(redlineHome, { recursive: true });
mkdirSync(workspace, { recursive: true });
process.env.REDLINE_HOME = redlineHome;

const { startServer, ReviewStore, memoryPersistence, buildSnapshot } = await import(
  '../out/server.mjs'
);

const created = [];
let server;
let store;

const file = {
  path: 'src/app.ts',
  status: 'modified',
  left: 'a\n',
  right: 'b\n',
  hunks: [
    {
      oldStart: 1,
      oldLines: 2,
      newStart: 1,
      newLines: 2,
      lines: [
        { kind: 'context', content: 'header' },
        { kind: 'add', content: 'added line' }
      ]
    }
  ]
};

before(async () => {
  store = new ReviewStore(memoryPersistence());
  server = await startServer({
    workspaceFolders: [workspace],
    version: '0.0.1-test',
    store,
    hooks: {
      onRoundCreated: (round) => {
        created.push(round.id);
        store.attachFiles(round.id, [file]);
      }
    }
  });
});

after(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

async function api(path, init = {}) {
  const res = await fetch(`http://127.0.0.1:${server.port}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  return { status: res.status, body: await res.json() };
}

test('POST /rounds creates a round, runs the hook, and returns the summary', async () => {
  const { status, body } = await api('/rounds', {
    method: 'POST',
    body: JSON.stringify({
      source: { kind: 'worktree', scope: 'unstaged' },
      title: 'demo',
      notes: [{ file: 'src/app.ts', summary: 'renamed the greeting helper' }]
    })
  });
  assert.equal(status, 200);
  assert.equal(body.id, 'r1');
  assert.equal(body.sourceLabel, 'unstaged changes');
  assert.equal(body.fileCount, 1);
  assert.equal(body.outcome, 'opened');
  assert.equal(body.refreshCount, 0);
  assert.deepEqual(created, ['r1']);
});

test('POST /rounds rejects a body with no source', async () => {
  const { status, body } = await api('/rounds', { method: 'POST', body: '{}' });
  assert.equal(status, 400);
  assert.match(body.error, /needs a source/);
});

test('GET /rounds lists summaries newest first', async () => {
  const { body } = await api('/rounds');
  assert.equal(body[0].id, 'r1');
});

test('GET /rounds/{id} returns files, hunks without diff lines, and threads', async () => {
  const { body } = await api('/rounds/r1');
  assert.equal(body.files.length, 1);
  assert.equal(body.files[0].path, 'src/app.ts');
  assert.equal(body.files[0].hunks[0].lines, undefined);
  assert.equal(body.threads.length, 1);
  assert.equal(body.threads[0].kind, 'note');
});

test('GET /rounds/{id} 404s for an unknown round', async () => {
  const { status, body } = await api('/rounds/r99');
  assert.equal(status, 404);
  assert.match(body.error, /unknown round r99/);
});

test('/pending is empty until the reviewer submits', async () => {
  assert.deepEqual((await api('/pending')).body, []);
  store.addThread('r1', { file: 'src/app.ts', side: 'right', newLine: 2 }, 'human', 'rename this');
  assert.deepEqual((await api('/pending')).body, []);
  store.markSubmitted('r1');
  const { body } = await api('/pending');
  assert.equal(body.length, 1);
  assert.equal(body[0].roundId, 'r1');
  assert.equal(body[0].fileCount, 1);
});

test('GET /rounds/{id}/review returns markdown and marks threads delivered', async () => {
  const { body } = await api('/rounds/r1/review');
  assert.match(body.markdown, /^# Review: unstaged changes, 1 comment in 1 file/);
  assert.match(body.markdown, /\*\*human:\*\* rename this/);
  assert.equal(body.delivered.length, 1);
  assert.deepEqual((await api('/pending')).body, []);
});

test('GET /rounds/{id}/review honours ?threads=', async () => {
  const thread = store.addThread(
    'r1',
    { file: 'src/app.ts', side: 'right', newLine: 2 },
    'human',
    'second note'
  );
  store.addThread('r1', { file: 'src/app.ts', side: 'left', oldLine: 1 }, 'human', 'third note');
  const { body } = await api(`/rounds/r1/review?threads=${thread.id}`);
  assert.deepEqual(body.delivered, [thread.id]);
  assert.ok(body.markdown.includes('second note'));
  assert.ok(!body.markdown.includes('third note'));
});

test('POST /threads/{id}/resolve resolves the thread', async () => {
  const thread = store.addThread(
    'r1',
    { file: 'src/app.ts', side: 'right', newLine: 2 },
    'human',
    'resolve me'
  );
  const { status, body } = await api(`/threads/${thread.id}/resolve`, { method: 'POST' });
  assert.equal(status, 200);
  assert.equal(body.resolved, true);
  assert.equal(store.thread(thread.id).resolved, true);
});

test('POST /threads/{id}/resolve 404s for an unknown thread', async () => {
  const { status, body } = await api('/threads/t-deadbeef/resolve', { method: 'POST' });
  assert.equal(status, 404);
  assert.match(body.error, /unknown thread/);
});

test('POST /threads/{id}/comments appends a claude reply and leaves the thread open', async () => {
  const thread = store.addThread(
    'r1',
    { file: 'src/app.ts', side: 'right', newLine: 2 },
    'human',
    'why this?'
  );
  const { status, body } = await api(`/threads/${thread.id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Because the caller needs it.' })
  });
  assert.equal(status, 200);
  assert.equal(body.comments.length, 2);
  assert.equal(body.comments[1].author, 'claude');
  assert.equal(body.comments[1].body, 'Because the caller needs it.');
  assert.equal(body.resolved, false);
  assert.equal(store.thread(thread.id).comments.length, 2);
});

test('POST /threads/{id}/resolve with a body appends the reply and resolves in one call', async () => {
  const thread = store.addThread(
    'r1',
    { file: 'src/app.ts', side: 'right', newLine: 2 },
    'human',
    'rename this'
  );
  const { status, body } = await api(`/threads/${thread.id}/resolve`, {
    method: 'POST',
    body: JSON.stringify({ body: 'Renamed to `parseQuote`.' })
  });
  assert.equal(status, 200);
  assert.equal(body.resolved, true);
  assert.equal(body.comments.length, 2);
  assert.equal(body.comments[1].author, 'claude');
});

test('POST /threads/{id}/comments rejects an empty body', async () => {
  const thread = store.addThread(
    'r1',
    { file: 'src/app.ts', side: 'right', newLine: 2 },
    'human',
    'needs an answer'
  );
  const { status, body } = await api(`/threads/${thread.id}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body: '   ' })
  });
  assert.equal(status, 400);
  assert.match(body.error, /non-empty/);
});

test('POST /debug/threads seeds a reviewer thread and runs the hook', async () => {
  const seeded = [];
  const other = await startServer({
    workspaceFolders: [workspace],
    version: '0.0.1-test',
    store,
    hooks: { onThreadSeeded: (id) => seeded.push(id) }
  });
  try {
    const res = await fetch(`http://127.0.0.1:${other.port}/debug/threads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        roundId: 'r1',
        anchor: { file: 'src/app.ts', side: 'right', newLine: 2 },
        body: 'please rename this'
      })
    });
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.kind, 'human');
    assert.equal(body.comments[0].author, 'human');
    assert.equal(body.comments[0].body, 'please rename this');
    assert.deepEqual(seeded, [body.id]);
    assert.ok(store.drafts('r1').some((thread) => thread.id === body.id));

    const bad = await fetch(`http://127.0.0.1:${other.port}/debug/threads`, {
      method: 'POST',
      headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ roundId: 'r1', anchor: { file: 'src/app.ts' }, body: 'x' })
    });
    assert.equal(bad.status, 400);
  } finally {
    await other.close();
  }
});

test('POST /debug/rounds/drop removes the round through the hook', async () => {
  const dropped = [];
  const other = await startServer({
    workspaceFolders: [workspace],
    version: '0.0.1-test',
    store,
    hooks: {
      onRoundCreated: (round) => store.attachFiles(round.id, [file]),
      onRoundDropped: (id) => {
        dropped.push(id);
        store.removeRound(id);
      }
    }
  });
  const post = (path, payload) =>
    fetch(`http://127.0.0.1:${other.port}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    });
  try {
    const round = await post('/rounds', { source: { kind: 'patch', text: 'x' } }).then((res) => res.json());
    const res = await post('/debug/rounds/drop', { roundId: round.id });
    assert.equal(res.status, 200);
    assert.deepEqual(dropped, [round.id]);
    assert.equal(store.round(round.id), undefined);
    assert.equal((await post('/debug/rounds/drop', { roundId: round.id })).status, 404);
  } finally {
    await other.close();
  }
});

test('POST /rounds on the source of an open round refreshes it through the hook instead of opening another', async () => {
  const refreshed = [];
  const edited = {
    ...file,
    hunks: [
      {
        oldStart: 1,
        oldLines: 2,
        newStart: 1,
        newLines: 3,
        lines: [
          { kind: 'context', content: 'header' },
          { kind: 'add', content: 'a new first line' },
          { kind: 'add', content: 'added line' }
        ]
      }
    ]
  };
  const other = await startServer({
    workspaceFolders: [workspace],
    version: '0.0.1-test',
    store,
    hooks: {
      onRoundCreated: (round) => store.attachFiles(round.id, [file]),
      onRoundRefresh: (round, request) => {
        refreshed.push(request.title);
        return store.refreshRound(round.id, { files: request.title === 'empty' ? [] : [edited], title: request.title, notes: request.notes });
      }
    }
  });
  const post = (payload) =>
    fetch(`http://127.0.0.1:${other.port}/rounds`, {
      method: 'POST',
      headers: { authorization: `Bearer ${other.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    }).then((res) => res.json());
  try {
    const opened = await post({ source: { kind: 'worktree', scope: 'staged' }, title: 'first' });
    assert.equal(opened.outcome, 'opened');
    const thread = store.addThread(opened.id, { file: 'src/app.ts', side: 'right', newLine: 2 }, 'human', 'moves');
    const again = await post({
      source: { kind: 'worktree', scope: 'staged' },
      title: 'second',
      notes: [{ file: 'src/app.ts', summary: 'appended' }]
    });
    assert.equal(again.id, opened.id);
    assert.equal(again.outcome, 'refreshed');
    assert.equal(again.title, 'second');
    assert.equal(again.refreshCount, 1);
    assert.equal(again.detachedThreads, 0);
    assert.equal(store.thread(thread.id).anchor.newLine, 3);
    assert.deepEqual(refreshed, ['second']);
    const kept = await post({ source: { kind: 'worktree', scope: 'staged' }, title: 'empty' });
    assert.equal(kept.outcome, 'kept');
    assert.equal(kept.refreshCount, 1);
    const patch = await post({ source: { kind: 'patch', text: 'x' } });
    assert.equal(patch.outcome, 'opened');
    assert.notEqual(patch.id, opened.id);
  } finally {
    await other.close();
  }
});

test('routes stay behind the bearer token', async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/rounds`);
  assert.equal(res.status, 401);
});

test('POST /rounds answers 422 no_source when the folder is not a git repository', async () => {
  const nonRepo = mkdtempSync(join(tmpdir(), 'redline-nonrepo-'));
  const other = await startServer({
    workspaceFolders: [nonRepo],
    version: '0.0.1-test',
    store: new ReviewStore(memoryPersistence()),
    hooks: {
      onRoundCreated: async (round) => {
        await buildSnapshot(round.source, nonRepo);
      }
    }
  });
  try {
    const res = await fetch(`http://127.0.0.1:${other.port}/rounds`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${other.token}`,
        'content-type': 'application/json'
      },
      body: JSON.stringify({ source: { kind: 'worktree', scope: 'unstaged' } })
    });
    const body = await res.json();
    assert.equal(res.status, 422);
    assert.equal(body.code, 'no_source');
    assert.equal(body.reason, 'not_a_repo');
    assert.match(body.detail, /not a git repository/i);
  } finally {
    await other.close();
    rmSync(nonRepo, { recursive: true, force: true });
  }
});
