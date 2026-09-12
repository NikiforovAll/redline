#!/usr/bin/env node
import { packageVsix, run, version } from './vsix.mjs';

const release = version();
const tag = `v${release}`;
const publish = process.argv.includes('--publish');

console.log(`redline: building ${tag}`);
run('npm', ['run', 'build']);
run('npm', ['test']);

const vsix = packageVsix(release);
console.log(`redline: packaged ${vsix}`);

if (!publish) {
  console.log('redline: pass --publish to create the GitHub release.');
  process.exit(0);
}

run('gh', ['release', 'create', tag, vsix, '--title', tag, '--generate-notes']);
console.log(`redline: published ${tag}`);
