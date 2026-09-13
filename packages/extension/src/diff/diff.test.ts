import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { createFixture, fixtureContents, type Fixture } from './fixture.ts';
import { parsePatch, sideFromHunks } from './parse.ts';
import { buildSnapshot, git, splitRange, type SnapshotFile } from './sources.ts';
import { URI } from 'vscode-uri';
import { parseQuery, parseUri, toUri } from './uri.ts';

let fixture: Fixture;

function byPath(files: SnapshotFile[]): Map<string, SnapshotFile> {
  return new Map(files.map((file) => [file.path, file]));
}

before(() => {
  fixture = createFixture();
});

after(() => {
  fixture.dispose();
});

describe('worktree staged', () => {
  it('lists staged modification and rename with both sides', async () => {
    const snapshot = await buildSnapshot({ kind: 'worktree', scope: 'staged' }, fixture.root);
    const files = byPath(snapshot.files);

    assert.deepEqual([...files.keys()].sort(), ['keep.txt', 'renamed.txt']);

    const keep = files.get('keep.txt')!;
    assert.equal(keep.status, 'modified');
    assert.equal(keep.left, 'keep one\nkeep two\n');
    assert.equal(keep.right, 'keep one\nkeep two changed\n');
    assert.deepEqual(
      keep.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
      [[1, 2, 1, 2]]
    );

    const renamed = files.get('renamed.txt')!;
    assert.equal(renamed.status, 'renamed');
    assert.equal(renamed.oldPath, 'old.txt');
    assert.equal(renamed.left, 'old body\n');
    assert.equal(renamed.right, 'old body\n');
    assert.deepEqual(renamed.hunks, []);
  });
});

describe('worktree unstaged', () => {
  it('lists the dirty file against the index, plus untracked files', async () => {
    const snapshot = await buildSnapshot({ kind: 'worktree', scope: 'unstaged' }, fixture.root);
    const files = byPath(snapshot.files);

    assert.deepEqual([...files.keys()], ['a.txt', 'untracked.txt']);
    assert.equal(files.get('untracked.txt')!.status, 'added');
    const a = files.get('a.txt')!;
    assert.equal(a.status, 'modified');
    assert.equal(a.left, fixtureContents.A_V2);
    assert.equal(a.right, fixtureContents.A_V3);
    assert.deepEqual(
      a.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
      [[2, 5, 2, 5]]
    );
    assert.deepEqual(
      a.hunks[0].lines.filter((line) => line.kind !== 'context').map((line) => [line.kind, line.content]),
      [
        ['del', 'line5'],
        ['add', 'line5-dirty']
      ]
    );
  });
});

describe('worktree all', () => {
  it('covers staged, unstaged and untracked files', async () => {
    const snapshot = await buildSnapshot({ kind: 'worktree', scope: 'all' }, fixture.root);
    const files = byPath(snapshot.files);

    assert.deepEqual([...files.keys()].sort(), ['a.txt', 'keep.txt', 'renamed.txt', 'untracked.txt']);

    const a = files.get('a.txt')!;
    assert.equal(a.left, fixtureContents.A_V2);
    assert.equal(a.right, fixtureContents.A_V3);

    const untracked = files.get('untracked.txt')!;
    assert.equal(untracked.status, 'added');
    assert.equal(untracked.left, null);
    assert.equal(untracked.right, 'untracked body\n');
    assert.deepEqual(
      untracked.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
      [[0, 0, 1, 1]]
    );

    const renamed = files.get('renamed.txt')!;
    assert.equal(renamed.status, 'renamed');
    assert.equal(renamed.oldPath, 'old.txt');
  });
});

describe('range', () => {
  it('reports add, modify and delete between two commits', async () => {
    const snapshot = await buildSnapshot({ kind: 'range', from: 'HEAD~1', to: 'HEAD' }, fixture.root);
    const files = byPath(snapshot.files);

    assert.deepEqual([...files.keys()].sort(), ['a.txt', 'added.txt', 'gone.txt']);

    const a = files.get('a.txt')!;
    assert.equal(a.status, 'modified');
    assert.equal(a.left, fixtureContents.A_V1);
    assert.equal(a.right, fixtureContents.A_V2);
    assert.deepEqual(
      a.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
      [[1, 6, 1, 6]]
    );

    const added = files.get('added.txt')!;
    assert.equal(added.status, 'added');
    assert.equal(added.left, null);
    assert.equal(added.right, 'added body\n');

    const gone = files.get('gone.txt')!;
    assert.equal(gone.status, 'deleted');
    assert.equal(gone.left, 'gone body\n');
    assert.equal(gone.right, null);
  });
});

describe('range against uncommitted work', () => {
  it('compares a ref with the files on disk, untracked included', async () => {
    const snapshot = await buildSnapshot({ kind: 'range', from: 'HEAD~1', to: 'worktree' }, fixture.root);
    const files = byPath(snapshot.files);

    assert.deepEqual([...files.keys()].sort(), ['a.txt', 'added.txt', 'gone.txt', 'keep.txt', 'renamed.txt', 'untracked.txt']);
    const a = files.get('a.txt')!;
    assert.equal(a.left, fixtureContents.A_V1);
    assert.equal(a.right, fixtureContents.A_V3);
    assert.equal(files.get('untracked.txt')!.status, 'added');
  });

  it('compares a ref with the index and skips untracked and unstaged work', async () => {
    const snapshot = await buildSnapshot({ kind: 'range', from: 'HEAD~1', to: 'index' }, fixture.root);
    const files = byPath(snapshot.files);

    assert.deepEqual([...files.keys()].sort(), ['a.txt', 'added.txt', 'gone.txt', 'keep.txt', 'renamed.txt']);
    const a = files.get('a.txt')!;
    assert.equal(a.left, fixtureContents.A_V1);
    assert.equal(a.right, fixtureContents.A_V2);
    assert.equal(files.get('keep.txt')!.right, 'keep one\nkeep two changed\n');
  });

  it('normalizes every spelling of a range to one spec', () => {
    assert.equal(splitRange('main', 'HEAD').spec, 'main..HEAD');
    assert.equal(splitRange('main...', 'feature').spec, 'main...feature');
    assert.equal(splitRange('main...feature', '').spec, 'main...feature');
    assert.deepEqual(splitRange('main..', 'feature'), { spec: 'main..feature', threeDot: false, leftRev: 'main', rightRev: 'feature' });
    assert.deepEqual(splitRange('main', 'worktree'), { spec: 'main..worktree', threeDot: false, leftRev: 'main', rightRev: 'worktree' });
  });
});

describe('patch', () => {
  it('reconstructs sides from hunks only and marks the snapshot partial', async () => {
    const text = await git(fixture.root, ['diff', '--no-color', 'HEAD~1', 'HEAD', '--', 'a.txt']);
    const snapshot = await buildSnapshot({ kind: 'patch', text }, fixture.root);

    assert.equal(snapshot.partial, true);
    assert.equal(snapshot.files.length, 1);
    const a = snapshot.files[0];
    assert.equal(a.path, 'a.txt');
    assert.equal(a.status, 'modified');
    assert.equal(a.left, fixtureContents.A_V1);
    assert.equal(a.right, fixtureContents.A_V2);
    assert.deepEqual(
      a.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
      [[1, 6, 1, 6]]
    );
  });
});

describe('files', () => {
  let dir: string;

  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'redline-pairs-'));
    writeFileSync(path.join(dir, 'left.txt'), 'one\ntwo\n', 'utf8');
    writeFileSync(path.join(dir, 'right.txt'), 'one\ntwo changed\n', 'utf8');
  });

  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads both paths and diffs them', async () => {
    const left = path.join(dir, 'left.txt');
    const right = path.join(dir, 'right.txt');
    const snapshot = await buildSnapshot({ kind: 'files', pairs: [{ left, right }] }, fixture.root);

    assert.equal(snapshot.files.length, 1);
    const entry = snapshot.files[0];
    assert.equal(entry.status, 'modified');
    assert.equal(entry.left, 'one\ntwo\n');
    assert.equal(entry.right, 'one\ntwo changed\n');
    assert.deepEqual(
      entry.hunks.map((hunk) => [hunk.oldStart, hunk.oldLines, hunk.newStart, hunk.newLines]),
      [[1, 2, 1, 2]]
    );
  });
});

describe('parsePatch', () => {
  it('handles binary files', () => {
    const text = [
      'diff --git a/logo.png b/logo.png',
      'index 1111111..2222222 100644',
      'Binary files a/logo.png and b/logo.png differ',
      ''
    ].join('\n');
    const [file] = parsePatch(text);
    assert.equal(file.binary, true);
    assert.equal(file.newPath, 'logo.png');
    assert.deepEqual(file.hunks, []);
  });

  it('handles a missing trailing newline', () => {
    const text = [
      'diff --git a/n.txt b/n.txt',
      '--- a/n.txt',
      '+++ b/n.txt',
      '@@ -1 +1 @@',
      '-one',
      '+two',
      '\\ No newline at end of file',
      ''
    ].join('\n');
    const [file] = parsePatch(text);
    assert.equal(sideFromHunks(file.hunks, 'left'), 'one\n');
    assert.equal(sideFromHunks(file.hunks, 'right'), 'two');
  });

  it('handles a pure rename', () => {
    const text = [
      'diff --git a/x.txt b/y.txt',
      'similarity index 100%',
      'rename from x.txt',
      'rename to y.txt',
      ''
    ].join('\n');
    const [file] = parsePatch(text);
    assert.equal(file.status, 'renamed');
    assert.equal(file.oldPath, 'x.txt');
    assert.equal(file.newPath, 'y.txt');
  });
});

describe('uri', () => {
  it('round-trips round id, side and path', () => {
    const uri = toUri('round-2', 'right', 'src/a b/file.ts');
    assert.deepEqual(parseUri(uri), { roundId: 'round-2', side: 'right', path: 'src/a b/file.ts' });
    assert.ok(uri.startsWith('redline:/src/'));
  });

  it('keeps rounds distinct for the same path', () => {
    assert.notEqual(toUri('r1', 'left', 'a.ts'), toUri('r2', 'left', 'a.ts'));
  });

  it('rejects foreign uris', () => {
    assert.equal(parseUri('file:///a.ts'), null);
    assert.equal(parseUri('redline:/a.ts'), null);
  });

  // vscode.Uri.toString() percent-encodes '=' and '&' in the query, so the UI must read
  // uri.query (already decoded) rather than re-serialising the uri.
  it('parses the query vscode hands back, which toString() would have mangled', () => {
    const uri = URI.parse(toUri('r1', 'right', 'src/app.ts'));
    assert.equal(parseUri(uri.toString()), null);
    assert.deepEqual(parseQuery(uri.query), {
      roundId: 'r1',
      side: 'right',
      path: 'src/app.ts'
    });
  });
});
