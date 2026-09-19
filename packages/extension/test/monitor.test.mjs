import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRedlineHome, sleep, waitFor } from '../../mcp/test/harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const monitorScript = join(here, '..', '..', 'mcp', 'src', 'monitor.mjs');

const { root, redlineHome, workspace, cleanup } = makeRedlineHome('redline-monitor-');
const pluginData = join(root, 'data');
mkdirSync(pluginData, { recursive: true });

const { startServer } = await import('../out/server.mjs');

const child = spawn(process.execPath, [monitorScript], {
  cwd: workspace,
  env: {
    ...process.env,
    REDLINE_HOME: redlineHome,
    CLAUDE_PLUGIN_DATA: pluginData,
    CLAUDE_CODE_SESSION_ID: 'sid-test',
    REDLINE_MONITOR_BACKOFF_MIN_MS: '150',
    REDLINE_MONITOR_BACKOFF_MAX_MS: '400'
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

const stdoutLines = [];
let stdoutBuf = '';
child.stdout.setEncoding('utf8');
child.stdout.on('data', (chunk) => {
  stdoutBuf += chunk;
  let cut;
  while ((cut = stdoutBuf.indexOf('\n')) !== -1) {
    const line = stdoutBuf.slice(0, cut).replace(/\r$/, '');
    stdoutBuf = stdoutBuf.slice(cut + 1);
    if (line) stdoutLines.push(line);
  }
});

let stderrText = '';
child.stderr.setEncoding('utf8');
child.stderr.on('data', (chunk) => {
  stderrText += chunk;
});

after(async () => {
  const exited = new Promise((resolve) => child.on('exit', resolve));
  child.kill();
  await exited;
  await server.close();
  cleanup();
});

const details = () => `stdout: ${stdoutLines.join(' | ')}\nstderr: ${stderrText}`;
const waitForMonitor = (predicate, timeoutMs, label) =>
  waitFor(predicate, timeoutMs, label, details);

const connections = () => stderrText.split('connected').length - 1;

async function emit(server, event) {
  const res = await fetch(`http://127.0.0.1:${server.port}/debug/emit`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${server.token}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(event)
  });
  assert.equal(res.status, 200);
}

let server = await startServer({ workspaceFolders: [workspace], version: '0.0.1-test' });

test('/events rejects a request without the token', async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/events`);
  assert.equal(res.status, 401);
});

test('prints exactly one line for a review_submitted event', async () => {
  await waitForMonitor(() => connections() >= 1, 5000, 'first connection');
  await emit(server, {
    type: 'review_submitted',
    roundId: 'r3',
    commentCount: 3,
    fileCount: 2,
    sourceLabel: 'unstaged changes'
  });
  await waitForMonitor(() => stdoutLines.length >= 1, 5000, 'notification line');
  await sleep(300);
  assert.deepEqual(stdoutLines, [
    '[redline] review submitted: 3 comments in 2 files on unstaged changes (round r3). Call get_review("r3").'
  ]);
  assert.ok(stdoutLines[0].length < 200);
});

test('prints the thread_sent variant', async () => {
  await emit(server, {
    type: 'thread_sent',
    roundId: 'r3',
    threadId: 't-9f2a',
    file: 'src/auth/session.ts',
    line: 42
  });
  await waitForMonitor(() => stdoutLines.length >= 2, 5000, 'thread line');
  assert.equal(
    stdoutLines[1],
    '[redline] comment sent: src/auth/session.ts:42 (round r3, thread t-9f2a). Call get_review("r3", {threads: ["t-9f2a"]}).'
  );
});

test('points a re-sent thread at a peek', async () => {
  const before = stdoutLines.length;
  await emit(server, {
    type: 'thread_sent',
    roundId: 'r3',
    threadId: 't-9f2a',
    file: 'src/auth/session.ts',
    line: 42,
    revisit: true
  });
  await waitForMonitor(() => stdoutLines.length > before, 5000, 'revisit thread line');
  assert.equal(
    stdoutLines[before],
    '[redline] comment sent: src/auth/session.ts:42 (round r3, thread t-9f2a). Call get_review("r3", {threads: ["t-9f2a"], peek: true}).'
  );
});

test('strips control characters from event fields', async () => {
  const before = stdoutLines.length;
  await emit(server, {
    type: 'review_submitted',
    roundId: 'r4',
    commentCount: 1,
    fileCount: 1,
    sourceLabel: 'bad\nlabel'
  });
  await waitForMonitor(() => stdoutLines.length > before, 5000, 'sanitised line');
  assert.equal(
    stdoutLines[before],
    '[redline] review submitted: 1 comment in 1 file on bad label (round r4). Call get_review("r4").'
  );
});

test('uses singular nouns for a one comment, one file review', async () => {
  const before = stdoutLines.length;
  await emit(server, {
    type: 'review_submitted',
    roundId: 'r6',
    commentCount: 1,
    fileCount: 1,
    sourceLabel: 'staged changes'
  });
  await waitForMonitor(() => stdoutLines.length > before, 5000, 'singular line');
  assert.equal(
    stdoutLines[before],
    '[redline] review submitted: 1 comment in 1 file on staged changes (round r6). Call get_review("r6").'
  );
});

test('points a revisited round at a peek', async () => {
  const before = stdoutLines.length;
  await emit(server, {
    type: 'review_submitted',
    roundId: 'r7',
    commentCount: 2,
    fileCount: 1,
    sourceLabel: 'staged changes',
    revisit: true
  });
  await waitForMonitor(() => stdoutLines.length > before, 5000, 'revisit line');
  assert.equal(
    stdoutLines[before],
    '[redline] review submitted: 2 comments in 1 file on staged changes (round r7). Call get_review("r7", {peek: true}).'
  );
});

test('reconnects after a server restart without duplicating lines', async () => {
  const before = stdoutLines.length;
  const seenConnections = connections();
  await server.close();
  server = await startServer({ workspaceFolders: [workspace], version: '0.0.1-test' });
  await waitForMonitor(() => connections() > seenConnections, 8000, 'reconnection');
  await emit(server, {
    type: 'review_submitted',
    roundId: 'r5',
    commentCount: 2,
    fileCount: 1,
    sourceLabel: 'staged changes'
  });
  await waitForMonitor(() => stdoutLines.length > before, 5000, 'post-restart line');
  await sleep(500);
  assert.equal(stdoutLines.length, before + 1);
  assert.equal(
    stdoutLines[before],
    '[redline] review submitted: 2 comments in 1 file on staged changes (round r5). Call get_review("r5").'
  );
});

test('a second monitor with a fresh heartbeat lock exits immediately', async () => {
  const second = spawn(process.execPath, [monitorScript], {
    cwd: workspace,
    env: {
      ...process.env,
      REDLINE_HOME: redlineHome,
      CLAUDE_PLUGIN_DATA: pluginData,
      CLAUDE_CODE_SESSION_ID: 'sid-test'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const code = await new Promise((resolve) => second.on('exit', resolve));
  assert.equal(code, 0);
});
