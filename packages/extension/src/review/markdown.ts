const RELATIVE_LINK = /\]\((?![a-z][a-z0-9+.-]*:)([^)\s#]+)(#[^)\s]*)?\)/gi;

// VS Code resolves a relative markdown link against MarkdownString.baseUri but keeps the
// "#L<n>" fragment inside the path, so the editor looks for a file named "x.cs#L64".
export function absolutizeLinks(body: string, toUri: (relativePath: string) => string): string {
  return body.replace(RELATIVE_LINK, (_, path: string, fragment = '') => `](${toUri(path)}${fragment})`);
}
