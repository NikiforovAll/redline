import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

export interface Fixture {
  root: string;
  dispose(): void;
}

function run(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe', windowsHide: true });
}

function write(root: string, relative: string, content: string): void {
  writeFileSync(path.join(root, relative), content, { encoding: 'utf8' });
}

const A_V1 = ['line1', 'line2', 'line3', 'line4', 'line5', 'line6'].join('\n') + '\n';
const A_V2 = ['line1', 'line2', 'line3-commit2', 'line4', 'line5', 'line6'].join('\n') + '\n';
const A_V3 = ['line1', 'line2', 'line3-commit2', 'line4', 'line5-dirty', 'line6'].join('\n') + '\n';
const NUL_V1 = ['const sep = "a\0b";', 'export const one = 1;'].join('\n') + '\n';
const NUL_V2 = ['const sep = "a\0b";', 'export const one = 2;'].join('\n') + '\n';

export const fixtureContents = { A_V1, A_V2, A_V3, NUL_V1, NUL_V2 };

export function createFixture(): Fixture {
  const root = mkdtempSync(path.join(tmpdir(), 'redline-fixture-'));

  run(root, ['init', '-b', 'main']);
  run(root, ['config', 'core.autocrlf', 'false']);
  run(root, ['config', 'user.name', 'redline test']);
  run(root, ['config', 'user.email', 'redline@example.com']);
  run(root, ['config', 'commit.gpgsign', 'false']);

  write(root, 'a.txt', A_V1);
  write(root, 'keep.txt', 'keep one\nkeep two\n');
  write(root, 'old.txt', 'old body\n');
  write(root, 'gone.txt', 'gone body\n');
  run(root, ['add', '.']);
  run(root, ['commit', '-m', 'commit1']);

  write(root, 'a.txt', A_V2);
  write(root, 'added.txt', 'added body\n');
  run(root, ['rm', '-q', 'gone.txt']);
  run(root, ['add', '.']);
  run(root, ['commit', '-m', 'commit2']);

  write(root, 'keep.txt', 'keep one\nkeep two changed\n');
  run(root, ['add', 'keep.txt']);
  run(root, ['mv', 'old.txt', 'renamed.txt']);
  write(root, 'a.txt', A_V3);
  write(root, 'untracked.txt', 'untracked body\n');

  return {
    root,
    dispose: () => rmSync(root, { recursive: true, force: true })
  };
}
