#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ENTRIES = { server: './mcp-server.mjs', monitor: './monitor.mjs' };

const name = process.argv[2];

if (name === '--version') {
  const here = dirname(fileURLToPath(import.meta.url));
  const { version } = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));
  process.stdout.write(`${version}\n`);
  process.exit(0);
}

if (!ENTRIES[name]) {
  process.stderr.write(`redline-mcp: expected ${Object.keys(ENTRIES).join(' or ')}, got ${name ?? 'nothing'}\n`);
  process.exit(2);
}

process.argv.splice(2, 1);
await import(ENTRIES[name]);
