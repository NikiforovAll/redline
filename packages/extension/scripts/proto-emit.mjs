#!/usr/bin/env node
import { discover } from '@nikiforovall/redline-mcp/discover';

const json = process.argv[2];
if (!json) {
  console.error('usage: node proto-emit.mjs \'{"type":"review_submitted",...}\'');
  process.exit(2);
}

let event;
try {
  event = JSON.parse(json);
} catch (err) {
  console.error(`redline: argument is not JSON (${err.message})`);
  process.exit(2);
}

let found;
try {
  found = await discover(process.cwd());
} catch (err) {
  console.error(err.message);
  process.exit(1);
}

const res = await fetch(`http://127.0.0.1:${found.port}/debug/emit`, {
  method: 'POST',
  headers: { authorization: `Bearer ${found.token}`, 'content-type': 'application/json' },
  body: JSON.stringify(event)
});
console.log(`${res.status} ${await res.text()}`);
process.exit(res.ok ? 0 : 1);
