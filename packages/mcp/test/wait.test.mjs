import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRedlineHome, sleep, startProtoServer } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const mcpServer = join(packageRoot, 'src', 'mcp-server.mjs');

const { monitorArmed } = await import('../src/wake.mjs');

const PATCH = [
  'diff --git a/hello.txt b/hello.txt',
  'new file mode 100644',
  'index 0000000..ce01362',
  '--- /dev/null',
  '+++ b/hello.txt',
  '@@ -0,0 +1 @@',
  '+hello',
  ''
].join('\n');

const cleanups = [];
after(() => {
  for (const cleanup of cleanups) cleanup();
});

function startMcp(cwd, redlineHome, env = {}) {
  const child = spawn(process.execPath, [mcpServer], {
    cwd,
    env: { ...process.env, REDLINE_HOME: redlineHome, REDLINE_WAIT_POLL_MS: '100', REDLINE_MONITOR_GRACE_MS: '0', ...env },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const waiting = new Map();
  let buffer = '';
  child.stdout.on('data', (chunk) => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (!line) continue;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue;
      }
      const pending = waiting.get(message.id);
      if (pending) {
        waiting.delete(message.id);
        pending(message);
      }
    }
  });
  let nextId = 1;
  const send = (method, params) =>
    new Promise((resolve) => {
      const id = nextId++;
      waiting.set(id, resolve);
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    });
  const ready = send('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'redline-test', version: '0.0.0' }
  }).then(() => {
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  });
  const callTool = async (name, args) => {
    await ready;
    const message = await send('tools/call', { name, arguments: args });
    return message.result ?? { error: message.error };
  };
  return { child, callTool };
}

async function withServers(prefix, env, body) {
  const made = makeRedlineHome(prefix);
  cleanups.push(made.cleanup);
  const proto = await startProtoServer(made.workspace, made.redlineHome);
  const mcp = startMcp(made.workspace, made.redlineHome, env);
  try {
    await body({ proto, mcp, workspace: made.workspace });
  } finally {
    mcp.child.kill();
    proto.child.kill();
  }
}

// The request_review text names the round by its source, so the id comes from list_reviews.
const roundIdOf = async (mcp) => (await mcp.callTool('list_reviews', {})).content[0].text.match(/^(r\d+)\s/)[1];

test('request_review hands off to the connect skill', async () => {
  await withServers('redline-wait-', {}, async ({ mcp }) => {
    const opened = await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    assert.match(opened.content[0].text, /^Opened patch \(1 file, 0 notes\)\. Waiting for review in /);
    assert.doesNotMatch(opened.content[0].text, /\br\d+\b/);
    assert.match(opened.content[0].text, /Now invoke the redline:redline-connect skill/);
    const again = await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    assert.match(again.content[0].text, /^Opened patch /);
    assert.match((await mcp.callTool('list_reviews', {})).content[0].text, /^r2 /);
  });
});

test('add_notes posts under an existing round and rejects an unknown one', async () => {
  await withServers('redline-wait-', {}, async ({ mcp }) => {
    await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    const roundId = await roundIdOf(mcp);
    const posted = await mcp.callTool('add_notes', { roundId, notes: [{ file: 'hello.txt', summary: 'a remark' }] });
    assert.equal(posted.content[0].text, `Posted 1 note to ${roundId} (patch).`);
    assert.match((await mcp.callTool('list_reviews', {})).content[0].text, /^r1 {2}patch {2}1 files {2}1 open/);
    assert.match((await mcp.callTool('list_reviews', {})).content[0].text, /in review/);
    const missing = await mcp.callTool('add_notes', { roundId: 'r99', notes: [{ file: 'hello.txt', summary: 'x' }] });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /^redline: unknown round r99/);
  });
});

test('get_review with wait returns once the reviewer submits', async () => {
  await withServers('redline-wait-', {}, async ({ proto, mcp }) => {
    await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    const roundId = await roundIdOf(mcp);

    const waiting = mcp.callTool('get_review', { roundId, wait: 20 });
    await sleep(400);
    proto.command({
      cmd: 'thread',
      roundId,
      anchor: { file: 'hello.txt', side: 'right', newLine: 1 },
      body: 'say hi twice'
    });
    proto.command({ cmd: 'submit', roundId });

    const started = Date.now();
    const result = await waiting;
    assert.ok(Date.now() - started < 10000, 'returned soon after submit');
    assert.equal(result.isError, undefined);
    assert.match(result.content[0].text, /say hi twice/);
  });
});

test('get_review with wait reports the timeout without an error', async () => {
  await withServers('redline-wait-', {}, async ({ mcp }) => {
    await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    const roundId = await roundIdOf(mcp);
    const result = await mcp.callTool('get_review', { roundId, wait: 1 });
    assert.equal(result.isError, undefined);
    assert.equal(
      result.content[0].text,
      'No review submitted within 1s. Call get_review again with wait to keep waiting.'
    );
  });
});

test('get_review with wait and no roundId ignores rounds already delivered', async () => {
  await withServers('redline-wait-', { CLAUDE_CODE_SESSION_ID: 'sid-none' }, async ({ proto, mcp }) => {
    await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    const roundId = await roundIdOf(mcp);
    proto.command({
      cmd: 'thread',
      roundId,
      anchor: { file: 'hello.txt', side: 'right', newLine: 1 },
      body: 'first pass'
    });
    proto.command({ cmd: 'submit', roundId });
    await sleep(400);

    const delivered = await mcp.callTool('get_review', { wait: 5 });
    assert.match(delivered.content[0].text, /first pass/);

    const stale = await mcp.callTool('get_review', { wait: 1 });
    assert.equal(stale.content[0].text, 'No review submitted within 1s. Call get_review again with wait to keep waiting.');

    const ping = await mcp.callTool('redline_ping', {});
    assert.equal(JSON.parse(ping.content[0].text.split('\n')[0]).monitor, 'absent');
  });
});

test('reply_comment accepts text as an alias for body and names the field when both are missing', async () => {
  await withServers('redline-wait-', {}, async ({ proto, mcp }) => {
    await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    const roundId = await roundIdOf(mcp);
    proto.command({
      cmd: 'thread',
      roundId,
      anchor: { file: 'hello.txt', side: 'right', newLine: 1 },
      body: 'Test'
    });
    proto.command({ cmd: 'submit', roundId });
    const review = await mcp.callTool('get_review', { roundId, wait: 5 });
    const threadId = review.content[0].text.match(/\b(t-[0-9a-f]+)\b/)[1];

    const replied = await mcp.callTool('reply_comment', { threadId, text: 'What needs to change here?' });
    assert.equal(replied.isError, undefined, replied.content?.[0]?.text);
    assert.match(replied.content[0].text, new RegExp(`Replied in ${threadId}`));

    const missing = await mcp.callTool('reply_comment', { threadId });
    assert.equal(missing.isError, true);
    assert.match(missing.content[0].text, /needs body, a non-empty markdown string/);
  });
});

test('a monitor started after a submit announces the pending round once', async () => {
  await withServers('redline-wait-', {}, async ({ proto, mcp, workspace }) => {
    await mcp.callTool('request_review', { source: { kind: 'patch', text: PATCH } });
    const roundId = await roundIdOf(mcp);
    proto.command({
      cmd: 'thread',
      roundId,
      anchor: { file: 'hello.txt', side: 'right', newLine: 1 },
      body: 'before the monitor'
    });
    proto.command({ cmd: 'submit', roundId });
    await sleep(400);

    const monitor = spawn(process.execPath, [join(packageRoot, 'src', 'monitor.mjs')], {
      cwd: workspace,
      env: {
        ...process.env,
        CLAUDE_CODE_SESSION_ID: `sid-backlog-${process.pid}`,
        CLAUDE_PLUGIN_DATA: tmpdir(),
        REDLINE_MONITOR_BACKOFF_MIN_MS: '100'
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let out = '';
    monitor.stdout.on('data', (chunk) => (out += chunk));
    try {
      const started = Date.now();
      while (!out.includes('\n') && Date.now() - started < 10000) await sleep(100);
      await sleep(500);
      const lines = out.trim().split(/\r?\n/);
      assert.deepEqual(lines, [
        `[redline] review submitted: 1 comment in 1 file on patch (round ${roundId}). Call get_review("${roundId}").`
      ]);
    } finally {
      monitor.kill();
    }
  });
});

test('monitorArmed reads the heartbeat lock for this session, or a live one from the same folder', () => {
  const dir = tmpdir();
  const stamp = `${process.pid}-${Date.now()}`;
  const sid = `test-${stamp}`;
  const cwd = join(dir, `redline-armed-${stamp}`);
  const env = { CLAUDE_CODE_SESSION_ID: sid, CLAUDE_PLUGIN_DATA: dir };
  const now = Date.now();
  assert.equal(monitorArmed({}, now, cwd), null);
  assert.equal(monitorArmed(env, now, cwd), false);

  const lock = join(dir, `redline-monitor-${sid}.pid`);
  cleanups.push(() => unlinkSync(lock));
  writeFileSync(lock, JSON.stringify({ tag: 'redline-monitor', sid, pid: process.pid, beatAt: now }));
  assert.equal(monitorArmed(env, now, cwd), true);
  assert.equal(monitorArmed(env, now + 60000, cwd), false, 'stale heartbeat');

  const other = { ...env, CLAUDE_CODE_SESSION_ID: `${sid}-after-clear` };
  assert.equal(monitorArmed(other, now, cwd), false, 'other session, lock without cwd');
  writeFileSync(lock, JSON.stringify({ tag: 'redline-monitor', sid, pid: process.pid, cwd, beatAt: now }));
  assert.equal(monitorArmed(other, now, cwd), true, 'other session, same folder');
  assert.equal(monitorArmed(other, now, join(cwd, 'elsewhere')), false, 'other session, other folder');
});
