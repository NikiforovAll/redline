import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import test, { after, before } from 'node:test';
import { makeRedlineHome, writeGhostLock } from '../../mcp/test/harness.mjs';

const { root, redlineHome, workspace, cleanup } = makeRedlineHome('redline-proto-');
const nested = join(workspace, 'src', 'deep');
const unrelated = join(root, 'elsewhere');

mkdirSync(nested, { recursive: true });
mkdirSync(unrelated, { recursive: true });

const { startServer, normalizeWorkspacePath } = await import('../out/server.mjs');
const { discover } = await import('../../mcp/src/discover.mjs');

let server;

before(async () => {
  server = await startServer({ workspaceFolders: [workspace], version: '0.0.1-test', app: 'vscode' });
});

after(async () => {
  await server?.close();
  cleanup();
});

test('normalises windows paths', () => {
  assert.equal(
    normalizeWorkspacePath('C:\\Users\\me\\repo\\'),
    process.platform === 'win32' ? 'c:/users/me/repo' : 'c:/Users/me/repo'
  );
  assert.equal(normalizeWorkspacePath('C:\\'), 'c:/');
  assert.equal(normalizeWorkspacePath('/home/me/repo/'), '/home/me/repo');
});

test('names the lock file per window, not per workspace folder', () => {
  assert.match(basename(server.lockPath), new RegExp(`^redline-${process.pid}-[0-9a-f]{8}\\.lock$`));
});

test('discovers from the workspace folder itself', async () => {
  const found = await discover(workspace);
  assert.equal(found.port, server.port);
  assert.equal(found.token, server.token);
  assert.equal(found.ping.ok, true);
  assert.equal(found.ping.version, '0.0.1-test');
});

test('discovers from a nested subfolder', async () => {
  const found = await discover(nested);
  assert.equal(found.port, server.port);
});

test('rejects an unauthenticated ping', async () => {
  const res = await fetch(`http://127.0.0.1:${server.port}/ping`);
  assert.equal(res.status, 401);
});

test('reports the wrong-window error for an unrelated folder', async () => {
  await assert.rejects(
    () => discover(unrelated),
    (err) => {
      assert.match(err.message, /lock found but VS Code window is not for this folder \(windows: /);
      assert.ok(err.message.includes(normalizeWorkspacePath(workspace)));
      return true;
    }
  );
});

test('ignores a lock whose pid is dead', async () => {
  const stale = writeGhostLock(redlineHome, [normalizeWorkspacePath(unrelated)], {
    name: 'stale.lock',
    token: 'dead',
    pid: 0x7ffffffe
  });
  const found = await discover(nested);
  assert.equal(found.port, server.port);
  await assert.rejects(() => discover(unrelated), /is not for this folder/);
  rmSync(stale, { force: true });
});

test('reports the stale-lock error when ping fails', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redline-stale-'));
  const ghost = writeGhostLock(redlineHome, [normalizeWorkspacePath(dir)]);
  await assert.rejects(
    () => discover(dir, { REDLINE_DISCOVER_WAIT_MS: '0' }),
    /lock stale \(ping failed: ghost\.lock port \d+: .+\), remove .*ghost\.lock/
  );
  rmSync(ghost, { force: true });
  rmSync(dir, { recursive: true, force: true });
});

test('waits through a server restart instead of failing on the stale lock', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'redline-restart-'));
  const ghost = writeGhostLock(redlineHome, [normalizeWorkspacePath(dir)]);
  let restarted;
  const restart = setTimeout(async () => {
    rmSync(ghost, { force: true });
    restarted = await startServer({ workspaceFolders: [dir], version: '0.0.1-restarted' });
  }, 1500);
  try {
    const found = await discover(dir, { REDLINE_DISCOVER_WAIT_MS: '10000' });
    assert.equal(found.ping.version, '0.0.1-restarted');
    assert.equal(found.port, restarted.port);
  } finally {
    clearTimeout(restart);
    await restarted?.close();
    rmSync(ghost, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

test('reports the no-locks error when the directory is empty', async () => {
  const emptyHome = join(root, 'empty', '.redline');
  mkdirSync(emptyHome, { recursive: true });
  const previous = process.env.REDLINE_HOME;
  process.env.REDLINE_HOME = emptyHome;
  try {
    await assert.rejects(
      () => discover(workspace),
      /no lock files in .* \(is the redline extension running in VS Code\?\)/
    );
  } finally {
    process.env.REDLINE_HOME = previous;
  }
});

test('routes the same folder to the window the caller runs in', async () => {
  const insiders = await startServer({
    workspaceFolders: [workspace],
    version: '0.0.1-insiders',
    app: 'vscode-insiders'
  });
  try {
    const byApp = await discover(workspace, { REDLINE_VSCODE_APP: 'vscode-insiders' });
    assert.equal(byApp.port, insiders.port);
    assert.equal(byApp.ping.app, 'vscode-insiders');

    const byTerminal = await discover(workspace, {
      TERM_PROGRAM: 'vscode',
      TERM_PROGRAM_VERSION: '1.106.0-insider'
    });
    assert.equal(byTerminal.port, insiders.port);

    const newest = await discover(workspace, {});
    assert.equal(newest.port, insiders.port);
  } finally {
    await insiders.close();
  }
});

test('prefers the window whose main process is VSCODE_PID over app name', async () => {
  const ghost = writeGhostLock(redlineHome, [normalizeWorkspacePath(workspace)], {
    name: 'ghost.lock',
    appPid: 424242,
    app: 'vscode-insiders'
  });
  try {
    const preferred = await discover(workspace, { VSCODE_PID: '424242', REDLINE_VSCODE_APP: 'vscode' });
    assert.equal(preferred.port, server.port, 'a dead preferred window falls through to the live one');
    const fallback = await discover(workspace, { VSCODE_PID: '1', REDLINE_VSCODE_APP: 'vscode' });
    assert.equal(fallback.port, server.port);
  } finally {
    rmSync(ghost, { force: true });
  }
});

test('picks the longest matching workspace folder across nested windows', async () => {
  const innerServer = await startServer({
    workspaceFolders: [join(workspace, 'src')],
    version: '0.0.1-inner'
  });
  try {
    const found = await discover(nested);
    assert.equal(found.port, innerServer.port);
    assert.equal(found.ping.version, '0.0.1-inner');
    const outer = await discover(workspace);
    assert.equal(outer.port, server.port);
  } finally {
    await innerServer.close();
  }
});
