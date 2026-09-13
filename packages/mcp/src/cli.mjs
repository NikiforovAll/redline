#!/usr/bin/env node
import { VERSION } from './version.mjs';

const ENTRIES = { server: './mcp-server.mjs', monitor: './monitor.mjs' };

const name = process.argv[2];

if (name === '--version') {
  process.stdout.write(`${VERSION}\n`);
  process.exit(0);
}

if (!ENTRIES[name]) {
  process.stderr.write(`redline-mcp: expected ${Object.keys(ENTRIES).join(' or ')}, got ${name ?? 'nothing'}\n`);
  process.exit(2);
}

process.argv.splice(2, 1);
await import(ENTRIES[name]);
