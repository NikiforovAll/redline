#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { command } from './spawn.mjs';

const ENTRIES = { server: 'mcp-server.mjs', monitor: 'monitor.mjs' };
const BIN = 'redline-mcp';
const PACKAGE = '@nikiforovall/redline-mcp';

const name = process.argv[2];
const rest = process.argv.slice(3);
if (!ENTRIES[name]) {
  process.stderr.write(`redline: launch.mjs expects ${Object.keys(ENTRIES).join(' or ')}\n`);
  process.exit(2);
}

const here = dirname(fileURLToPath(import.meta.url));

const pluginVersion = () =>
  JSON.parse(readFileSync(join(here, '..', '.claude-plugin', 'plugin.json'), 'utf8')).version;

function binVersion() {
  const [file, args, extra] = command(BIN, ['--version']);
  const out = spawnSync(file, args, { encoding: 'utf8', ...extra });
  return out.status === 0 ? out.stdout.trim() : null;
}

function launch(file, args, via) {
  process.stderr.write(`redline: ${name} via ${via}\n`);
  const [cmd, argv, extra] = command(file, args);
  const child = spawn(cmd, argv, { stdio: 'inherit', ...extra });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 0);
  });
  child.on('error', (err) => {
    process.stderr.write(`redline: could not start ${file} (${err.message})\n`);
    process.exit(1);
  });
}

const checkout = resolve(here, '..', '..', 'mcp', 'src', ENTRIES[name]);

if (existsSync(checkout)) {
  launch(process.execPath, [checkout, ...rest], 'checkout');
} else {
  const expected = pluginVersion();
  const found = binVersion();
  if (found) {
    if (found !== expected) {
      process.stderr.write(`redline: ${BIN} on PATH is ${found}, the plugin expects ${expected}\n`);
    }
    launch(BIN, [name, ...rest], `${BIN} on PATH`);
  } else {
    launch('npx', ['-y', `${PACKAGE}@${expected}`, name, ...rest], `npx ${PACKAGE}@${expected}`);
  }
}
