import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { chmodSync, cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import test, { after } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const pluginRoot = dirname(here);
const launcher = join(pluginRoot, 'scripts', 'launch.mjs');
const cli = join(pluginRoot, '..', 'mcp', 'src', 'cli.mjs');
const win = process.platform === 'win32';
const pinnedVersion = JSON.parse(readFileSync(join(pluginRoot, 'scripts', 'pin.json'), 'utf8'))['@nikiforovall/redline-mcp'];

const INITIALIZE = `${JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: { name: 'launch-test', version: '0' }
  }
})}\n`;

function serverInfoFrom(stdout) {
  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .find((message) => message.id === 1)?.result?.serverInfo;
}

function run(args, { input = '', timeoutMs = 5000, script = launcher, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env }
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => {
      stdout += b;
    });
    child.stderr.on('data', (b) => {
      stderr += b;
    });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input) child.stdin.write(input);
  });
}

const installedRoot = mkdtempSync(join(tmpdir(), 'redline-plugin-'));
after(() => rmSync(installedRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }));
for (const dir of ['scripts', '.claude-plugin']) {
  cpSync(join(pluginRoot, dir), join(installedRoot, dir), { recursive: true });
}
const installedLauncher = join(installedRoot, 'scripts', 'launch.mjs');

function fakeBinDir() {
  const bin = mkdtempSync(join(tmpdir(), 'redline-bin-'));
  after(() => rmSync(bin, { recursive: true, force: true }));
  if (win) {
    writeFileSync(join(bin, 'redline-mcp.cmd'), `@"${process.execPath}" "${cli}" %*\r\n`);
  } else {
    const file = join(bin, 'redline-mcp');
    writeFileSync(file, `#!/bin/sh\nexec "${process.execPath}" "${cli}" "$@"\n`);
    chmodSync(file, 0o755);
  }
  return bin;
}

test('rejects an unknown entry name', async () => {
  const { code, stderr } = await run(['nonsense']);
  assert.equal(code, 2);
  assert.match(stderr, /expects server or monitor/);
});

test('runs the checkout when packages/mcp sits beside the plugin', async () => {
  const { stdout, stderr } = await run(['server'], { input: INITIALIZE, timeoutMs: 3000 });
  assert.match(stderr, /via checkout/);
  assert.equal(serverInfoFrom(stdout)?.name, 'redline');
});

test('installed plugin execs redline-mcp from PATH', async () => {
  const script = installedLauncher;
  const bin = fakeBinDir();
  const { stdout, stderr } = await run(['server'], {
    input: INITIALIZE,
    timeoutMs: 4000,
    script,
    env: { PATH: `${bin}${delimiter}${process.env.PATH}`, Path: `${bin}${delimiter}${process.env.PATH}` }
  });
  assert.match(stderr, /via redline-mcp on PATH/);
  assert.doesNotMatch(stderr, /the plugin expects/);
  assert.equal(serverInfoFrom(stdout)?.name, 'redline');
});

test('installed plugin falls through to npx pinned to the version in pin.json', async () => {
  const script = installedLauncher;
  const path = win ? `${dirname(process.execPath)}${delimiter}C:\\Windows\\System32` : dirname(process.execPath);
  const { stderr } = await run(['server'], {
    timeoutMs: 8000,
    script,
    env: { PATH: path, Path: path, npm_config_registry: 'http://127.0.0.1:9/' }
  });
  assert.match(stderr, new RegExp(`via npx @nikiforovall/redline-mcp@${pinnedVersion.replaceAll('.', '\\.')}`));
});
