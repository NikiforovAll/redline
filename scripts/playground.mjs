#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command, vscodeCli, vscodeProfile } from '../packages/claude-plugin/scripts/spawn.mjs';
import { discover, normalizeWorkspacePath } from '../packages/mcp/src/discover.mjs';
import { sleep } from '../packages/mcp/src/wake.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name, fallback) => {
  const index = argv.indexOf(name);
  return index === -1 ? fallback : argv[index + 1];
};

const scenario = option('--scenario', 'todo');
const fixture = join(repoRoot, 'scripts', 'playground', 'fixture', scenario);
const target = join(repoRoot, '.playground', scenario);
const WAIT_MS = Number(option('--wait', '120')) * 1000;

if (!existsSync(join(fixture, 'scenario.json'))) {
  console.error(`playground: no scenario at ${fixture}`);
  process.exit(1);
}
const spec = JSON.parse(readFileSync(join(fixture, 'scenario.json'), 'utf8'));

function git(args) {
  execFileSync('git', args, { cwd: target, stdio: 'pipe', windowsHide: true });
}

function buildRepo() {
  try {
    rmSync(target, { recursive: true, force: true });
  } catch (err) {
    // An open VS Code window holds the folder; reset the repo inside it instead.
    if (err.code !== 'EPERM' || !existsSync(join(target, '.git'))) throw err;
    git(['reset', '-q', '--hard']);
    git(['clean', '-fdq']);
    cpSync(join(fixture, 'after'), target, { recursive: true });
    console.log(`playground: reset ${target} in place, the task's edits uncommitted again`);
    return;
  }
  mkdirSync(target, { recursive: true });
  cpSync(join(fixture, 'before'), target, { recursive: true });
  git(['init', '-b', 'main']);
  git(['config', 'core.autocrlf', 'false']);
  git(['config', 'user.name', 'playground']);
  git(['config', 'user.email', 'playground@example.invalid']);
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'baseline']);
  cpSync(join(fixture, 'after'), target, { recursive: true });
  console.log(`playground: built ${target} with a baseline commit and the task's edits uncommitted`);
}

function launchVsCode() {
  const [cmd, args, extra] = command(vscodeCli(), [...vscodeProfile(), '--new-window', target]);
  const child = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true, ...extra });
  child.unref();
  console.log(`playground: launched ${vscodeCli()} on ${target}`);
}

const fileLines = new Map();

/** Resolves the first line whose trimmed text equals `match`, in the file as it is on disk now. */
function lineOf(file, match) {
  let lines = fileLines.get(file);
  if (!lines) {
    lines = readFileSync(join(target, file), 'utf8').split(/\r?\n/);
    fileLines.set(file, lines);
  }
  const index = lines.findIndex((line) => line.trim() === match.trim());
  if (index === -1) throw new Error(`playground: "${match}" not found in ${file}`);
  return index + 1;
}

function toNotes(notes) {
  return notes.map((note) => ({
    file: note.file,
    summary: note.summary,
    hunks: (note.hunks ?? []).map((hunk) => {
      const line = lineOf(note.file, hunk.match);
      return { newRange: [line, line], summary: hunk.summary, rationale: hunk.rationale };
    })
  }));
}

/** The extension's server for exactly this folder; another window of a parent folder does not count. */
async function waitForWindow() {
  const wanted = normalizeWorkspacePath(target);
  const deadline = Date.now() + WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const found = await discover(target, { ...process.env, REDLINE_VSCODE_APP: vscodeCli() === 'code-insiders' ? 'vscode-insiders' : 'vscode' });
      const folders = (found.ping.workspaceFolders ?? []).map(normalizeWorkspacePath);
      if (folders.includes(wanted)) return found;
    } catch {
      // no lock yet, or a stale one; keep polling
    }
    await sleep(1000);
  }
  throw new Error(`playground: no redline window for ${target} after ${WAIT_MS / 1000}s. Is the extension installed in ${vscodeCli()}?`);
}

async function api(window, path, body) {
  const res = await fetch(`http://127.0.0.1:${window.port}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${window.token}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const json = await res.json();
  if (!res.ok) throw new Error(`playground: ${path} answered ${res.status}: ${json.error ?? json.detail ?? ''}`);
  return json;
}

/** A reset starts from clean rounds; without it the request would refresh the one already open. */
async function dropOpenRounds(window) {
  const rounds = await api(window, '/rounds');
  for (const round of rounds.filter((r) => !r.submittedAt)) {
    await api(window, '/debug/rounds/drop', { roundId: round.id });
    console.log(`playground: dropped the open ${round.sourceLabel} round`);
  }
}

async function seedRound(window) {
  if (flag('--reset')) await dropOpenRounds(window);
  const round = await api(window, '/rounds', {
    source: { kind: 'worktree', scope: 'all' },
    title: spec.title,
    notes: toNotes(spec.notes ?? [])
  });
  console.log(`playground: ${round.message}`);
  if (flag('--no-seed')) return;
  for (const comment of spec.comments ?? []) {
    const line = lineOf(comment.file, comment.match);
    await api(window, '/debug/threads', {
      roundId: round.id,
      anchor: { file: comment.file, side: 'right', newLine: line },
      body: comment.body
    });
    console.log(`playground: seeded a reviewer comment at ${comment.file}:${line}`);
  }
}

if (!existsSync(join(target, '.git')) || flag('--reset')) buildRepo();
else console.log(`playground: reusing ${target} (pass --reset to rebuild it)`);

launchVsCode();
const window = await waitForWindow();
await seedRound(window);

console.log(`
Next:
  1. cd "${target}" and start Claude Code there.
  2. Run /redline:redline-connect so the session picks up your submits.
  3. In VS Code, read the notes and the seeded comments, add your own, and Submit.
  4. Ask Claude for the change and watch what the round does.
`);
