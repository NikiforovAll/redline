#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, vscodeCli, vscodeProfile } from './spawn.mjs';

const EXTENSION_ID = 'nikiforovall.redline-extension';

const here = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(
  readFileSync(resolve(here, '..', '.claude-plugin', 'plugin.json'), 'utf8')
);

const repo =
  process.env.REDLINE_REPO ??
  manifest.repository?.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');

const profile = vscodeProfile();
const code = vscodeCli();

function exec(file, args, options = {}) {
  const [cmd, argv, extra] = command(file, args);
  return execFileSync(cmd, argv, { ...extra, ...options });
}

const capture = (file, args) => exec(file, args, { encoding: 'utf8' }).trim();

function fail(message) {
  console.error(`redline: ${message}`);
  process.exit(1);
}

let installed = null;
try {
  const line = capture(code, [...profile, '--list-extensions', '--show-versions'])
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.toLowerCase().startsWith(`${EXTENSION_ID.toLowerCase()}@`));
  installed = line ? line.split('@').pop() : null;
} catch {
  fail(`the "${code}" command is not on PATH. In VS Code run "Shell Command: Install '${code}' command in PATH".`);
}

let latest;
try {
  latest = JSON.parse(capture('gh', ['release', 'view', '--repo', repo, '--json', 'tagName']))
    .tagName.replace(/^v/, '');
} catch {
  fail(
    `could not read the latest release of ${repo}. Install the GitHub CLI and run "gh auth login" ` +
      'with access to the repository.'
  );
}

if (installed === latest) {
  console.log(`redline: extension ${installed} is current.`);
  process.exit(0);
}

console.log(
  installed
    ? `redline: updating the extension ${installed} -> ${latest}`
    : `redline: installing the extension ${latest}`
);

const staging = mkdtempSync(join(tmpdir(), 'redline-vsix-'));
try {
  exec(
    'gh',
    ['release', 'download', `v${latest}`, '--repo', repo, '--pattern', '*.vsix', '--dir', staging],
    { stdio: 'inherit' }
  );
  const vsix = readdirSync(staging).find((name) => name.endsWith('.vsix'));
  if (!vsix) fail(`release v${latest} has no .vsix asset.`);
  exec(code, [...profile, '--install-extension', join(staging, vsix), '--force'], {
    stdio: 'inherit'
  });
  console.log(`redline: extension ${latest} installed via ${code}. Reload VS Code to activate it.`);
} finally {
  rmSync(staging, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}
