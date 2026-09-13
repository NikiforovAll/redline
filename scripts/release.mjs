#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { packageVsix, run, version } from './vsix.mjs';

const release = version();
const tag = `v${release}`;
const pushTag = process.argv.includes('--tag');

console.log(`redline: building ${tag}`);
run('npm', ['run', 'build']);
run('npm', ['test']);

const vsix = packageVsix(release);
console.log(`redline: packaged ${vsix}`);

if (!pushTag) {
  console.log('redline: pass --tag to push the tag; the Release workflow publishes from it.');
  process.exit(0);
}

const dirty = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
if (dirty) {
  console.error('redline: commit or stash the working tree before tagging.');
  process.exit(1);
}

run('git', ['tag', '-a', tag, '-m', tag]);
run('git', ['push', 'origin', tag]);
console.log(`redline: pushed ${tag}. Follow the run with: gh run watch`);
