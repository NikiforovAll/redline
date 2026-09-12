import { existsSync } from 'node:fs';
import { userInfo } from 'node:os';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { Anchor, Author, Thread } from '@redline/protocol';
import { REDLINE_SCHEME, parseQuery, toUri, type ParsedRedlineUri, type UriSide } from '../diff/index.ts';
import { attachSnapshot } from '../server/snapshot.ts';
import { AGENT_LABEL, COMMENT_OPTIONS, sideLabel, threadDecoration } from './decoration.ts';
import { absolutizeLinks } from './markdown.ts';
import { anchorLine, hasHumanComment, type ReviewStore, type StoredRound } from './store.ts';
import { stepIndex, tourOrder } from './tour.ts';

export interface UiEvent {
  emitSubmitted: (payload: {
    roundId: string;
    commentCount: number;
    fileCount: number;
    sourceLabel: string;
  }) => void;
  emitThreadSent: (payload: {
    roundId: string;
    threadId: string;
    file: string;
    line: number;
  }) => void;
}

function humanName(): string {
  try {
    return userInfo().username || 'You';
  } catch {
    return 'You';
  }
}

export class ReviewUi implements vscode.Disposable {
  private readonly controller: vscode.CommentController;
  private readonly byThreadId = new Map<string, vscode.CommentThread>();
  private readonly idByThread = new Map<vscode.CommentThread, string>();
  private readonly roundIdByThreadId = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly sentThreadIds = new Set<string>();
  private tourCursor: { roundId: string; threadId: string } | undefined;
  private readonly authorName = humanName();
  private readonly rootUri: vscode.Uri | undefined;
  private readonly agentIcon: vscode.Uri | undefined;
  private readonly humanIcon: vscode.Uri | undefined;

  constructor(
    private readonly store: ReviewStore,
    private readonly repoRoot: string | undefined,
    private readonly events: UiEvent,
    private readonly mediaRoot?: vscode.Uri
  ) {
    this.rootUri = repoRoot ? vscode.Uri.file(repoRoot) : undefined;
    this.agentIcon = this.icon('claude-sunburst.svg');
    this.humanIcon = this.icon('human-minimal.svg');
    this.controller = vscode.comments.createCommentController('redline', 'Redline review');
    this.controller.options = COMMENT_OPTIONS;
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.commentingRanges(document)
    };

    this.disposables.push(
      this.controller,
      vscode.workspace.registerTextDocumentContentProvider(REDLINE_SCHEME, {
        provideTextDocumentContent: (uri) => this.contentFor(uri)
      })
    );

    this.rebuildThreads();
  }

  dispose(): void {
    this.disposeThreads();
    for (const item of this.disposables) item.dispose();
  }

  private parse(uri: vscode.Uri): ParsedRedlineUri | null {
    return uri.scheme === REDLINE_SCHEME ? parseQuery(uri.query) : null;
  }

  private contentFor(uri: vscode.Uri): string {
    const parsed = this.parse(uri);
    if (!parsed) return '';
    const file = this.store.file(parsed.roundId, parsed.path);
    if (!file) return '';
    return (parsed.side === 'left' ? file.left : file.right) ?? '';
  }

  private commentingRanges(document: vscode.TextDocument): vscode.Range[] {
    const parsed = this.parse(document.uri);
    if (!parsed) return [];
    const file = this.store.file(parsed.roundId, parsed.path);
    if (!file) return [];
    const ranges: vscode.Range[] = [];
    for (const hunk of file.hunks) {
      const start = parsed.side === 'left' ? hunk.oldStart : hunk.newStart;
      const count = parsed.side === 'left' ? hunk.oldLines : hunk.newLines;
      if (count <= 0) continue;
      const from = Math.max(0, start - 1);
      const to = Math.min(Math.max(document.lineCount - 1, 0), from + count - 1);
      ranges.push(new vscode.Range(from, 0, to, 0));
    }
    return ranges;
  }

  private uriFor(roundId: string, side: UriSide, filePath: string): vscode.Uri {
    return vscode.Uri.parse(toUri(roundId, side, filePath));
  }

  private labelFor(filePath: string, fallback: vscode.Uri): vscode.Uri {
    if (!this.repoRoot) return fallback;
    const onDisk = path.join(this.repoRoot, filePath);
    return existsSync(onDisk) ? vscode.Uri.file(onDisk) : fallback;
  }

  async materialize(round: StoredRound): Promise<void> {
    await attachSnapshot(this.store, round, this.repoRoot);
    this.rebuildRound(round.id);
    await this.openRound(round.id);
  }

  async openRound(roundId: string): Promise<void> {
    const round = this.store.round(roundId);
    if (!round) return;
    const resources = round.files.map((file) => {
      const left = this.uriFor(roundId, 'left', file.path);
      const right = this.uriFor(roundId, 'right', file.path);
      return [this.labelFor(file.path, right), left, right];
    });
    const title = `Redline ${round.id}: ${round.title ?? round.sourceLabel}`;
    try {
      await vscode.commands.executeCommand('vscode.changes', title, resources);
      // vscode.changes takes no editor options, so the tab opens as a preview and the next
      // Explorer click replaces it. keepEditor pins whatever tab is active, which is this one.
      await vscode.commands.executeCommand('workbench.action.keepEditor');
    } catch (err) {
      void vscode.window.showWarningMessage(
        `Redline: vscode.changes failed (${String(err)}), opening single diffs.`
      );
      for (const file of round.files) {
        await vscode.commands.executeCommand(
          'vscode.diff',
          this.uriFor(roundId, 'left', file.path),
          this.uriFor(roundId, 'right', file.path),
          `${file.path} (${roundId})`,
          { preview: false }
        );
      }
    }
  }

  private disposeThreads(): void {
    for (const thread of this.byThreadId.values()) thread.dispose();
    this.byThreadId.clear();
    this.idByThread.clear();
    this.roundIdByThreadId.clear();
  }

  rebuildThreads(): void {
    this.disposeThreads();
    for (const round of this.store.rounds()) {
      for (const thread of round.threads) this.createThread(round, thread);
    }
  }

  rebuildRound(roundId: string): void {
    const round = this.store.round(roundId);
    if (!round) return;
    for (const [id, entry] of this.byThreadId) {
      if (this.roundIdByThreadId.get(id) !== roundId) continue;
      entry.dispose();
      this.byThreadId.delete(id);
      this.idByThread.delete(entry);
      this.roundIdByThreadId.delete(id);
    }
    for (const thread of round.threads) this.createThread(round, thread);
  }

  private icon(name: string): vscode.Uri | undefined {
    return this.mediaRoot ? vscode.Uri.joinPath(this.mediaRoot, 'media', name) : undefined;
  }

  private markdown(body: string): vscode.MarkdownString {
    const root = this.rootUri;
    return new vscode.MarkdownString(
      root ? absolutizeLinks(body, (path) => vscode.Uri.joinPath(root, path).toString()) : body
    );
  }

  private commentsOf(thread: Thread): vscode.Comment[] {
    const side = sideLabel(thread.anchor.side);
    return thread.comments.map((comment) => {
      const fromClaude = comment.author === 'claude';
      return {
        author: fromClaude
          ? { name: AGENT_LABEL, iconPath: this.agentIcon }
          : { name: this.authorName, iconPath: this.humanIcon },
        body: this.markdown(comment.body),
        mode: vscode.CommentMode.Preview,
        label: side,
        timestamp: new Date(comment.createdAt),
        contextValue: fromClaude ? 'redline.claude' : 'redline.human'
      };
    });
  }

  private decorate(round: StoredRound, stored: Thread, thread: vscode.CommentThread): void {
    const file = round.files.find((entry) => entry.path === stored.anchor.file);
    const decoration = threadDecoration({
      kind: stored.kind,
      resolved: stored.resolved,
      sent: this.sentThreadIds.has(stored.id),
      submitted: round.submittedAt !== undefined,
      hasHumanComment: hasHumanComment(stored),
      file: stored.anchor.file,
      line: anchorLine(stored.anchor, file, 1),
      side: stored.anchor.side
    });
    thread.label = decoration.label;
    thread.contextValue = decoration.contextValue;
    thread.state = stored.resolved
      ? vscode.CommentThreadState.Resolved
      : vscode.CommentThreadState.Unresolved;
  }

  refreshThread(threadId: string): void {
    const thread = this.byThreadId.get(threadId);
    const stored = this.store.thread(threadId);
    if (!thread || !stored) return;
    const round = this.store.round(stored.roundId);
    if (!round) return;
    thread.comments = this.commentsOf(stored);
    this.decorate(round, stored, thread);
  }

  private refreshRound(roundId: string): void {
    const round = this.store.round(roundId);
    if (!round) return;
    for (const stored of round.threads) this.refreshThread(stored.id);
  }

  private createThread(round: StoredRound, stored: Thread): void {
    const file = round.files.find((entry) => entry.path === stored.anchor.file);
    const line = Math.max(0, anchorLine(stored.anchor, file, 1) - 1);
    const uri = this.uriFor(round.id, stored.anchor.side, stored.anchor.file);
    const thread = this.controller.createCommentThread(
      uri,
      new vscode.Range(line, 0, line, 0),
      this.commentsOf(stored)
    );
    thread.canReply = {
      name: this.authorName,
      iconPath: this.humanIcon
    };
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.decorate(round, stored, thread);
    this.byThreadId.set(stored.id, thread);
    this.idByThread.set(thread, stored.id);
    this.roundIdByThreadId.set(stored.id, round.id);
  }

  private anchorOf(uri: vscode.Uri, line: number): { roundId: string; anchor: Anchor } | undefined {
    const parsed = this.parse(uri);
    if (!parsed) return undefined;
    const anchor: Anchor = { file: parsed.path, side: parsed.side };
    if (parsed.side === 'left') anchor.oldLine = line + 1;
    else anchor.newLine = line + 1;
    return { roundId: parsed.roundId, anchor };
  }

  private reply(reply: vscode.CommentReply): void {
    const text = reply.text.trim();
    if (text.length === 0) return;
    const existing = this.idByThread.get(reply.thread);
    const author: Author = 'human';
    if (existing) {
      this.store.addComment(existing, author, text);
      this.sentThreadIds.delete(existing);
      this.refreshThread(existing);
      reply.thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
      return;
    }
    const placed = this.anchorOf(reply.thread.uri, reply.thread.range?.start.line ?? 0);
    if (!placed) {
      void vscode.window.showWarningMessage('Redline: this document is not part of a review round.');
      return;
    }
    const stored = this.store.addThread(placed.roundId, placed.anchor, author, text);
    reply.thread.dispose();
    const round = this.store.round(placed.roundId);
    if (round) this.createThread(round, stored);
  }

  private threadIdOf(thread: vscode.CommentThread | undefined): string | undefined {
    return thread ? this.idByThread.get(thread) : undefined;
  }

  private roundIdOfThread(thread: vscode.CommentThread | undefined): string | undefined {
    const id = this.threadIdOf(thread);
    return id ? this.store.thread(id)?.roundId : undefined;
  }

  private roundIdOfActiveEditor(): string | undefined {
    const active = vscode.window.activeTextEditor;
    if (!active) return undefined;
    const parsed = this.parse(active.document.uri);
    if (!parsed) return undefined;
    return this.store.round(parsed.roundId) ? parsed.roundId : undefined;
  }

  private async resolveRoundId(thread?: vscode.CommentThread): Promise<string | undefined> {
    const fromThread = this.roundIdOfThread(thread);
    if (fromThread) return fromThread;
    const fromEditor = this.roundIdOfActiveEditor();
    if (fromEditor) return fromEditor;

    const open = this.store.rounds().filter((round) => round.submittedAt === undefined);
    const choices = open.length > 0 ? open : this.store.rounds();
    if (choices.length === 0) return undefined;
    if (choices.length === 1) return choices[0].id;
    const picked = await vscode.window.showQuickPick(
      [...choices].reverse().map((round) => ({
        label: `${round.id}: ${round.sourceLabel}`,
        description: `${round.files.length} files, ${
          round.threads.filter((entry) => !entry.resolved).length
        } open`,
        detail: round.title,
        id: round.id
      })),
      { placeHolder: 'Which Redline review round?' }
    );
    return picked?.id;
  }

  private async submit(thread?: vscode.CommentThread): Promise<void> {
    const roundId = await this.resolveRoundId(thread);
    if (!roundId) {
      void vscode.window.showInformationMessage('Redline: no review round to submit.');
      return;
    }
    const result = this.store.markSubmitted(roundId);
    if (result.threadIds.length === 0) {
      void vscode.window.showInformationMessage('Redline: no new comments to send.');
      return;
    }
    this.events.emitSubmitted({
      roundId: result.roundId,
      commentCount: result.commentCount,
      fileCount: result.fileCount,
      sourceLabel: result.sourceLabel
    });
    this.refreshRound(result.roundId);
    void vscode.window.showInformationMessage(
      `Redline: sent ${result.commentCount} comment${result.commentCount === 1 ? '' : 's'} in ${
        result.fileCount
      } file${result.fileCount === 1 ? '' : 's'} to ${AGENT_LABEL}.`
    );
  }

  private sendThread(thread: vscode.CommentThread): void {
    const id = this.threadIdOf(thread);
    const stored = id ? this.store.thread(id) : undefined;
    if (!stored) {
      void vscode.window.showWarningMessage('Redline: this thread is not tracked yet.');
      return;
    }
    const file = this.store.file(stored.roundId, stored.anchor.file);
    this.events.emitThreadSent({
      roundId: stored.roundId,
      threadId: stored.id,
      file: stored.anchor.file,
      line: anchorLine(stored.anchor, file, 1)
    });
    this.sentThreadIds.add(stored.id);
    this.refreshThread(stored.id);
    void vscode.window.showInformationMessage(`Redline: sent ${stored.id} to ${AGENT_LABEL}.`);
  }

  private toggleResolved(thread: vscode.CommentThread): void {
    const id = this.threadIdOf(thread);
    if (!id) return;
    const stored = this.store.thread(id);
    if (!stored) return;
    this.store.setResolved(id, !stored.resolved);
    this.refreshThread(id);
  }

  private async pickRound(): Promise<void> {
    const summaries = this.store.summaries();
    if (summaries.length === 0) {
      void vscode.window.showInformationMessage('Redline: no rounds yet.');
      return;
    }
    const picked = await vscode.window.showQuickPick(
      summaries.map((summary) => ({
        label: `${summary.id}: ${summary.sourceLabel}`,
        description: `${summary.fileCount} files, ${summary.openThreads} open`,
        detail: summary.title,
        id: summary.id
      })),
      { placeHolder: 'Open an redline review round' }
    );
    if (picked) await this.openRound(picked.id);
  }

  private currentRound(): StoredRound | undefined {
    const active = vscode.window.activeTextEditor?.document.uri;
    const parsed = active ? this.parse(active) : null;
    const fromEditor = parsed ? this.store.round(parsed.roundId) : undefined;
    return fromEditor ?? this.store.rounds().at(-1);
  }

  private async stepNote(delta: 1 | -1): Promise<void> {
    const round = this.currentRound();
    if (!round) {
      void vscode.window.showInformationMessage('Redline: no rounds yet.');
      return;
    }
    const ordered = tourOrder(
      round.threads,
      round.files.map((file) => file.path)
    );
    if (ordered.length === 0) {
      void vscode.window.showInformationMessage(`Redline: ${round.id} has no comments.`);
      return;
    }
    const current =
      this.tourCursor?.roundId === round.id
        ? ordered.findIndex((thread) => thread.id === this.tourCursor?.threadId)
        : -1;
    const target = ordered[stepIndex(current === -1 ? undefined : current, delta, ordered.length)];
    this.tourCursor = { roundId: round.id, threadId: target.id };
    await this.revealThread(round, target, `${ordered.indexOf(target) + 1}/${ordered.length}`);
  }

  private async revealThread(round: StoredRound, stored: Thread, position: string): Promise<void> {
    const file = round.files.find((entry) => entry.path === stored.anchor.file);
    const line = Math.max(0, anchorLine(stored.anchor, file, 1) - 1);
    const range = new vscode.Range(line, 0, line, 0);
    await vscode.commands.executeCommand(
      'vscode.diff',
      this.uriFor(round.id, 'left', stored.anchor.file),
      this.uriFor(round.id, 'right', stored.anchor.file),
      `${stored.anchor.file} (${round.id})`,
      { preview: false, selection: range }
    );
    const thread = this.byThreadId.get(stored.id);
    if (thread) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    vscode.window.setStatusBarMessage(`Redline: note ${position}`, 3000);
  }

  private async openLatestRound(): Promise<void> {
    const latest = this.store.rounds().at(-1);
    if (!latest) {
      void vscode.window.showInformationMessage('Redline: no rounds yet.');
      return;
    }
    await this.openRound(latest.id);
  }

  private async reviewWorktree(): Promise<void> {
    const round = this.store.createRound({
      source: { kind: 'worktree', scope: 'all' },
      title: 'manual worktree review'
    });
    try {
      await this.materialize(round);
    } catch (err) {
      void vscode.window.showErrorMessage(`Redline: ${String(err)}`);
    }
  }

  register(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
      this,
      vscode.commands.registerCommand('redline.reply', (reply: vscode.CommentReply) =>
        this.reply(reply)
      ),
      vscode.commands.registerCommand('redline.submitReview', (thread?: vscode.CommentThread) =>
        this.submit(thread)
      ),
      vscode.commands.registerCommand('redline.sendThread', (thread: vscode.CommentThread) =>
        this.sendThread(thread)
      ),
      vscode.commands.registerCommand('redline.resolveThread', (thread: vscode.CommentThread) =>
        this.toggleResolved(thread)
      ),
      vscode.commands.registerCommand('redline.reopenThread', (thread: vscode.CommentThread) =>
        this.toggleResolved(thread)
      ),
      vscode.commands.registerCommand('redline.openRound', () => this.pickRound()),
      vscode.commands.registerCommand('redline.openLatestRound', () => this.openLatestRound()),
      vscode.commands.registerCommand('redline.nextNote', () => this.stepNote(1)),
      vscode.commands.registerCommand('redline.previousNote', () => this.stepNote(-1)),
      vscode.commands.registerCommand('redline.reviewWorktree', () => this.reviewWorktree())
    );
  }
}
