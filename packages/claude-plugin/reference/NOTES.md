# Writing notes

A note is one comment thread the reviewer reads inside the diff: `{ file, line, body }`. `line` is on the new side of the diff, and the thread snaps to the first changed line of the hunk that contains it. VS Code renders `body` as markdown, so shape it for a narrow column and a fast read.

## Shape

- First line of `body`: one sentence. It is the thread's preview in the Comments panel, so it must stand alone.
- The rest, after a blank line, only when the first line needs support: a lead sentence, then a bullet per supporting point. Three bullets is the ceiling.
- A file that needs a sentence about its role gets that sentence in the body of the note on its first hunk. There is no separate file note.
- Identifiers, paths, flags, and error text in backticks.
- A fenced code block only for a snippet under five lines. Set the language.
- Plain paragraphs and bullets carry the structure. Headings render oversized in a comment widget, so the text has none.

## Labels

A review report labels each finding with a category and ranks it by severity. Both travel into the note. The first line opens with the severity marker, then the category in bold brackets, then the finding itself as the report stated it. Post the notes in the report's order so the Comments panel lists the worst first.

| severity | marker |
| --- | --- |
| high, or the top of a ranked list | 🔴 |
| medium | 🟠 |
| low, nit | 🟡 |

```
🔴 **[correctness]** `install-extension.mjs` installs the latest release, not the pinned one.
```

A finding without labels keeps a plain first line.

## Links

Relative paths resolve against the workspace root, and a `#L<line>` fragment opens the file at that line:

```
[OrderRepository.cs:64](src/Repositories/OrderRepository.cs#L64)
```

Use one whenever you point at code outside the hunk: a precedent, a caller, a definition. The reviewer clicks instead of searching. Text stays `name:line`; the target carries the path.

`https://` links work the same way. Command links are dropped, so express an action in words.

## Examples

A tour note explains the change (redline-tour). Body:

```
**[2/5]** Switches the import loop from `AddAsync` to `Add` with an analyzer pragma.

`AddAsync` only differs from `Add` for value generators that hit the database, and `InvoiceEntity` has none.

- Inside a 500-row loop the await was ceremony with no I/O.
- The pragma follows [OrderRepository.cs:64](src/Repositories/OrderRepository.cs#L64), which handles the same analyzer hit with a one-line reason.
```

An annotate note restates something you already told the user (redline-annotate). Body:

```
Kept the sync `Add` call; the pragma carries the reason inline.
```
