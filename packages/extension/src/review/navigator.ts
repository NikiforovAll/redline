import { existsSync } from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Thread } from '@redline/protocol';
import { REDLINE_SCHEME, parseQuery, roundUri, toUri, type ParsedRedlineUri, type UriSide } from '../diff/index.ts';
import { threadLine, type ReviewStore, type StoredRound } from './store.ts';
import { notePosition, openNotes, stepIndex } from './tour.ts';
import { roundDescription, roundLabel } from './view-model.ts';

export interface TourCursor {
  roundId: string;
  threadId: string;
}

export interface Caret {
  roundId: string;
  path: string;
  line: number;
}

/** Opens rounds and files in the diff editors and owns the reviewer's position: the caret and the tour cursor. */
export class RoundNavigator implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly cursorEmitter = new vscode.EventEmitter<TourCursor | undefined>();
  private readonly caretEmitter = new vscode.EventEmitter<Caret | undefined>();
  readonly onDidChangeCursor = this.cursorEmitter.event;
  readonly onDidChangeCaret = this.caretEmitter.event;
  private cursor: TourCursor | undefined;
  /** Where the caret last was in a redline document. Survives the multi-diff remounting its editors and focus moving into a comment widget or the Comments panel. */
  private caretPosition: Caret | undefined;

  constructor(
    private readonly store: ReviewStore,
    private readonly repoRoot: string | undefined,
    private readonly onRevealed?: (threadId: string) => void
  ) {
    this.disposables.push(
      this.cursorEmitter,
      this.caretEmitter,
      vscode.window.onDidChangeTextEditorSelection((event) => this.trackCaret(event.textEditor))
    );
    this.trackCaret(vscode.window.activeTextEditor);
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  get caret(): Caret | undefined {
    return this.caretPosition;
  }

  get tourCursor(): TourCursor | undefined {
    return this.cursor;
  }

  parse(uri: vscode.Uri): ParsedRedlineUri | null {
    return uri.scheme === REDLINE_SCHEME ? parseQuery(uri.query) : null;
  }

  uriFor(roundId: string, side: UriSide, filePath: string): vscode.Uri {
    return vscode.Uri.parse(toUri(roundId, side, filePath));
  }

  private labelFor(filePath: string, fallback: vscode.Uri): vscode.Uri {
    if (!this.repoRoot) return fallback;
    const onDisk = path.join(this.repoRoot, filePath);
    return existsSync(onDisk) ? vscode.Uri.file(onDisk) : fallback;
  }

  private trackCaret(editor: vscode.TextEditor | undefined): void {
    const parsed = editor ? this.parse(editor.document.uri) : null;
    if (!parsed) return;
    const line = editor!.selection.active.line + 1;
    const last = this.caretPosition;
    if (last && last.roundId === parsed.roundId && last.path === parsed.path && last.line === line) return;
    this.caretPosition = { roundId: parsed.roundId, path: parsed.path, line };
    this.caretEmitter.fire(this.caretPosition);
  }

  caretRound(): StoredRound | undefined {
    return this.caretPosition ? this.store.round(this.caretPosition.roundId) : undefined;
  }

  /** The round the reviewer is in, else the newest one. */
  currentRound(): StoredRound | undefined {
    return this.caretRound() ?? this.store.rounds().at(-1);
  }

  roundTitle(round: StoredRound): string {
    return `Redline: ${roundLabel(round)}`;
  }

  /**
   * `_workbench.openMultiDiffEditor` is internal, but `vscode.changes` opens a fresh tab each time.
   * A stable `multiDiffSourceUri` per round makes VS Code reuse the same editor.
   */
  private async openMultiDiff(round: StoredRound): Promise<void> {
    await vscode.commands.executeCommand('_workbench.openMultiDiffEditor', {
      title: this.roundTitle(round),
      multiDiffSourceUri: vscode.Uri.parse(roundUri(round.id)),
      resources: round.files.map((file) => ({
        originalUri: this.uriFor(round.id, 'left', file.path),
        modifiedUri: this.uriFor(round.id, 'right', file.path)
      }))
    });
  }

  private openSingleDiff(
    round: StoredRound,
    filePath: string,
    options: { preview: boolean; selection?: vscode.Range }
  ): Thenable<unknown> {
    return vscode.commands.executeCommand(
      'vscode.diff',
      this.uriFor(round.id, 'left', filePath),
      this.uriFor(round.id, 'right', filePath),
      `${filePath} (${round.sourceLabel})`,
      options
    );
  }

  async openRound(roundId: string): Promise<void> {
    const round = this.store.round(roundId);
    if (!round) return;
    try {
      await this.openMultiDiff(round);
    } catch {
      // internal command missing or changed; fall through to the public commands
      try {
        const resources = round.files.map((file) => {
          const left = this.uriFor(roundId, 'left', file.path);
          const right = this.uriFor(roundId, 'right', file.path);
          return [this.labelFor(file.path, right), left, right];
        });
        await vscode.commands.executeCommand('vscode.changes', this.roundTitle(round), resources);
      } catch (err) {
        void vscode.window.showWarningMessage(
          `Redline: vscode.changes failed (${String(err)}), opening single diffs.`
        );
        for (const file of round.files) await this.openSingleDiff(round, file.path, { preview: false });
        return;
      }
    }
    // Neither multi-diff command takes editor options, so the tab opens as a preview and the next
    // Explorer click replaces it. keepEditor pins whatever tab is active, which is this one.
    await vscode.commands.executeCommand('workbench.action.keepEditor');
  }

  async openLatestRound(): Promise<void> {
    const latest = this.store.rounds().at(-1);
    if (!latest) {
      void vscode.window.showInformationMessage('Redline: no rounds yet.');
      return;
    }
    await this.openRound(latest.id);
  }

  /** Quick pick over `rounds` (default: all, newest first); undefined when there are none or the user escapes. */
  async pickRoundId(placeHolder: string, rounds: readonly StoredRound[] = this.store.rounds()): Promise<string | undefined> {
    if (rounds.length === 0) {
      void vscode.window.showInformationMessage('Redline: no rounds yet.');
      return undefined;
    }
    const picked = await vscode.window.showQuickPick(
      [...rounds].reverse().map((round) => ({ label: roundLabel(round), description: roundDescription(round), id: round.id })),
      { placeHolder }
    );
    return picked?.id;
  }

  async pickRound(): Promise<void> {
    const id = await this.pickRoundId('Open a redline review round');
    if (id) await this.openRound(id);
  }

  async stepNote(delta: 1 | -1): Promise<void> {
    const round = this.currentRound();
    if (!round) {
      void vscode.window.showInformationMessage('Redline: no rounds yet.');
      return;
    }
    const ordered = openNotes(round);
    if (ordered.length === 0) {
      void vscode.window.showInformationMessage(`Redline: ${round.sourceLabel} has no open comments.`);
      return;
    }
    const current =
      this.cursor?.roundId === round.id
        ? ordered.findIndex((thread) => thread.id === this.cursor?.threadId)
        : -1;
    await this.revealThread(round, ordered[stepIndex(current === -1 ? undefined : current, delta, ordered.length)]);
  }

  async revealNote(roundId: string, threadId: string): Promise<void> {
    const round = this.store.round(roundId);
    const thread = round?.threads.find((entry) => entry.id === threadId);
    if (round && thread) await this.revealThread(round, thread);
  }

  private async revealThread(round: StoredRound, stored: Thread): Promise<void> {
    this.cursor = { roundId: round.id, threadId: stored.id };
    this.cursorEmitter.fire(this.cursor);
    const line = threadLine(round, stored);
    const range = new vscode.Range(line - 1, 0, line - 1, 0);
    // A single diff instead of a reveal inside the multi-diff: the multi-diff scrolls from
    // estimated heights of editors it has not laid out yet and keeps correcting after the
    // reveal, which fights the reviewer's own scrolling. One preview tab serves every step.
    this.onRevealed?.(stored.id);
    await this.openSingleDiff(round, stored.anchor.file, { preview: true, selection: range });
    vscode.window.setStatusBarMessage(`Redline: note ${notePosition(round, stored)}`, 3000);
  }
}
