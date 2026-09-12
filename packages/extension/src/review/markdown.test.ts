import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { absolutizeLinks } from './markdown.ts';

describe('absolutizeLinks', () => {
  const toUri = (path: string) => `file:///c%3A/repo/${path}`;

  it('rewrites a relative link and keeps its line fragment', () => {
    assert.equal(
      absolutizeLinks('see [Repo.cs:64](src/Repo.cs#L64) and [x](docs/a.md)', toUri),
      'see [Repo.cs:64](file:///c%3A/repo/src/Repo.cs#L64) and [x](file:///c%3A/repo/docs/a.md)'
    );
  });

  it('leaves links that already carry a scheme alone', () => {
    const body = '[a](https://x.dev/p#f) [b](file:///c:/x.cs#L2) [c](mailto:x@y.z)';
    assert.equal(absolutizeLinks(body, toUri), body);
  });
});
