import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';
import { makeRedlineHome, startProtoServer, writeGhostLock } from './harness.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(here);
const mcpServer = join(packageRoot, 'src', 'mcp-server.mjs');

const { normalizeWorkspacePath } = await import('../src/discover.mjs');

const cleanups = [];

function tempWorkspace(prefix) {
  const made = makeRedlineHome(prefix);
  cleanups.push(made.cleanup);
  return made;
}

after(() => {
  for (const cleanup of cleanups) cleanup();
});

function requestReview(cwd, redlineHome) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [mcpServer], {
      cwd,
      env: { ...process.env, REDLINE_HOME: redlineHome },
      stdio: ['pipe', 'pipe', 'pipe']
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error('mcp-server timed out'));
    }, 30000);
    let buffer = '';
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
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
        if (message.id === 1) {
          child.stdin.write(
            `${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`
          );
          child.stdin.write(
            `${JSON.stringify({
              jsonrpc: '2.0',
              id: 2,
              method: 'tools/call',
              params: {
                name: 'request_review',
                arguments: { source: { kind: 'worktree', scope: 'all' } }
              }
            })}\n`
          );
        } else if (message.id === 2) {
          clearTimeout(timer);
          child.kill();
          resolve(message.result ?? { error: message.error, stderr });
        }
      }
    });
    child.on('error', reject);
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'redline-test', version: '0.0.0' }
        }
      })}\n`
    );
  });
}

test('missing lock tells Claude to open the folder in VS Code', async () => {
  const { redlineHome, workspace } = tempWorkspace('redline-nolock-');

  const result = await requestReview(workspace, redlineHome);
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.match(text, /^redline: no VS Code window has this folder open with the redline extension\./);
  assert.match(text, /Open .+ in VS Code \(extension active\), then retry\. Do not retry automatically\.$/);
});

test('stale lock tells Claude to reload the window', async () => {
  const { redlineHome, workspace } = tempWorkspace('redline-stale-');
  writeGhostLock(redlineHome, [normalizeWorkspacePath(workspace)]);

  const result = await requestReview(workspace, redlineHome);
  assert.equal(result.isError, true);
  const text = result.content[0].text;
  assert.equal(
    text,
    `redline: the VS Code window for ${normalizeWorkspacePath(workspace)} is not answering (stale lock). ` +
      'Reload that window (Developer: Reload Window), then retry.'
  );
});

test('a live window outside a git repository asks for an explicit source', async () => {
  const { redlineHome, workspace } = tempWorkspace('redline-nogit-');

  const { child } = await startProtoServer(workspace, redlineHome);
  try {
    const result = await requestReview(workspace, redlineHome);
    assert.equal(result.isError, true);
    const text = result.content[0].text;
    assert.equal(
      text,
      'redline: this folder is not a git repository. Pass an explicit source (patch or file pairs) or run from a git repository.'
    );
  } finally {
    child.kill();
  }
});
