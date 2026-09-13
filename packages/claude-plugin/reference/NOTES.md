# Writing notes

A note is a comment thread the reviewer reads inside the diff. VS Code renders it as markdown, so shape it for a narrow column and a fast read.

## Shape

- `summary`: one sentence, one line. It is the thread's preview in the Comments panel, so it must stand alone.
- `rationale`: a lead sentence, then a bullet per supporting point. Three bullets is the ceiling.
- Identifiers, paths, flags, and error text in backticks.
- A fenced code block only for a snippet under five lines. Set the language.
- Plain paragraphs and bullets carry the structure. Headings render oversized in a comment widget, so the text has none.

## Labels

A review report labels each finding with a category and ranks it by severity. Both travel into the note. The summary opens with the severity marker, then the category in bold brackets, then the finding itself as the report stated it. Post the notes in the report's order so the Comments panel lists the worst first.

| severity | marker |
| --- | --- |
| high, or the top of a ranked list | 🔴 |
| medium | 🟠 |
| low, nit | 🟡 |

```
🔴 **[correctness]** `install-extension.mjs` installs the latest release, not the pinned one.
```

A finding without labels keeps a plain summary.

## Links

Relative paths resolve against the workspace root, and a `#L<line>` fragment opens the file at that line:

```
[OrderRepository.cs:64](src/Repositories/OrderRepository.cs#L64)
```

Use one whenever you point at code outside the hunk: a precedent, a caller, a definition. The reviewer clicks instead of searching. Text stays `name:line`; the target carries the path.

`https://` links work the same way. Command links are dropped, so express an action in words.

## Examples

A tour note explains the change (redline-tour). Summary:

```
**[2/5]** Switches the import loop from `AddAsync` to `Add` with an analyzer pragma.
```

Rationale:

```
`AddAsync` only differs from `Add` for value generators that hit the database, and `InvoiceEntity` has none.

- Inside a 500-row loop the await was ceremony with no I/O.
- The pragma follows [OrderRepository.cs:64](src/Repositories/OrderRepository.cs#L64), which handles the same analyzer hit with a one-line reason.
```

An annotate note restates something you already told the user (redline-annotate). Summary:

```
Kept the sync `Add` call; the pragma carries the reason inline.
```
