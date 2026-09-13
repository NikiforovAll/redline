import { userInfo } from 'node:os';
import * as vscode from 'vscode';
import type { Anchor, Author, RequestReview, Thread } from '@redline/protocol';
import { REDLINE_SCHEME } from '../diff/index.ts';
import { attachSnapshot, refreshSnapshot } from '../server/snapshot.ts';
import { AGENT_LABEL, COMMENT_OPTIONS, sideLabel, threadDecoration } from './decoration.ts';
import { absolutizeLinks } from './markdown.ts';
import { RoundNavigator } from './navigator.ts';
import { hasHumanComment, threadLine, type RefreshOutcome, type ReviewStore, type StoredRound } from './store.ts';
import { plural, roundMessage } from './view-model.ts';

/** Each emitter returns whether at least one agent stream received the event. */
export interface UiEvent {
  emitSubmitted: (payload: {
    roundId: string;
    commentCount: number;
    fileCount: number;
    sourceLabel: string;
  }) => boolean;
  emitThreadSent: (payload: {
    roundId: string;
    threadId: string;
    file: string;
    line: number;
  }) => boolean;
}

const QUEUED_HINT = 'Queued; /redline:redline-connect in Claude Code picks it up.';

function humanName(): string {
  try {
    return userInfo().username || 'You';
  } catch {
    return 'You';
  }
}

export class ReviewUi implements vscode.Disposable {
  readonly navigator: RoundNavigator;
  private readonly controller: vscode.CommentController;
  private readonly byThreadId = new Map<string, vscode.CommentThread>();
  private readonly idByThread = new Map<vscode.CommentThread, string>();
  private readonly roundIdByThreadId = new Map<string, string>();
  private readonly disposables: vscode.Disposable[] = [];
  private readonly contentChanged = new vscode.EventEmitter<vscode.Uri>();
  private human: vscode.CommentAuthorInformation;
  private readonly localIdentity: vscode.CommentAuthorInformation;
  private readonly rootUri: vscode.Uri | undefined;
  private readonly agentIcon: vscode.Uri | undefined;

  constructor(
    private readonly store: ReviewStore,
    private readonly repoRoot: string | undefined,
    private readonly events: UiEvent,
    private readonly mediaRoot?: vscode.Uri
  ) {
    this.rootUri = repoRoot ? vscode.Uri.file(repoRoot) : undefined;
    this.navigator = new RoundNavigator(store, repoRoot, (threadId) => this.focusThread(threadId));
    this.agentIcon = this.icon('claude-sunburst.svg');
    this.localIdentity = { name: humanName(), iconPath: this.icon('human-minimal.svg') };
    this.human = this.localIdentity;
    this.controller = vscode.comments.createCommentController('redline', 'Redline review');
    this.controller.options = COMMENT_OPTIONS;
    this.controller.commentingRangeProvider = {
      provideCommentingRanges: (document) => this.commentingRanges(document)
    };

    this.disposables.push(
      this.navigator,
      this.controller,
      this.contentChanged,
      vscode.workspace.registerTextDocumentContentProvider(REDLINE_SCHEME, {
        onDidChange: this.contentChanged.event,
        provideTextDocumentContent: (uri) => this.contentFor(uri)
      }),
      vscode.authentication.onDidChangeSessions((event) => {
        if (event.provider.id === 'github') void this.resolveHumanIdentity();
      }),
      vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration('redline.avatar')) void this.resolveHumanIdentity();
      })
    );

    this.rebuildThreads();
    void this.resolveHumanIdentity();
  }

  /** Reviewer identity shown on human comments. Reads the GitHub account VS Code is already signed in with; a fresh sign-in is never requested, so the local user stays until one exists. `getAccounts` lists accounts regardless of granted scopes, where `getSession` would need a scope match. */
  private async resolveHumanIdentity(): Promise<void> {
    const next = (await this.githubIdentity()) ?? this.localIdentity;
    if (next === this.human) return;
    this.human = next;
    for (const [threadId, thread] of this.byThreadId) {
      thread.canReply = this.human;
      this.refreshThread(threadId);
    }
  }

  private async githubIdentity(): Promise<vscode.CommentAuthorInformation | undefined> {
    if (vscode.workspace.getConfiguration('redline').get<string>('avatar', 'github') !== 'github') return undefined;
    try {
      const account = (await vscode.authentication.getAccounts('github'))[0];
      if (!account) return undefined;
      if (this.human.name === account.label && this.human !== this.localIdentity) return this.human;
      // The account id is the numeric GitHub user id, which survives renames; the label may not be a login.
      return {
        name: account.label,
        iconPath: vscode.Uri.parse(`https://avatars.githubusercontent.com/u/${encodeURIComponent(account.id)}?s=64`)
      };
    } catch {
      return undefined;
    }
  }

  dispose(): void {
    this.disposeThreads();
    for (const item of this.disposables) item.dispose();
  }

  private contentFor(uri: vscode.Uri): string {
    const parsed = this.navigator.parse(uri);
    if (!parsed) return '';
    const file = this.store.file(parsed.roundId, parsed.path);
    if (!file) return '';
    return (parsed.side === 'left' ? file.left : file.right) ?? '';
  }

  private commentingRanges(document: vscode.TextDocument): vscode.Range[] {
    const parsed = this.navigator.parse(document.uri);
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

  async materialize(round: StoredRound): Promise<void> {
    await attachSnapshot(this.store, round, this.repoRoot);
    this.rebuildRound(round.id);
    await this.navigator.openRound(round.id);
  }

  /** Reruns the round's snapshot; a request from the agent brings a title and notes, the reviewer's Refresh brings none. */
  async refresh(round: StoredRound, request?: Pick<RequestReview, 'title' | 'notes'>): Promise<RefreshOutcome> {
    const before = round.files.map((file) => file.path);
    const outcome = await refreshSnapshot(this.store, round, this.repoRoot, request);
    if (outcome === 'refreshed') {
      // Open diff documents keep the text they were opened with until the provider says it changed.
      for (const path of new Set([...before, ...round.files.map((file) => file.path)])) {
        this.contentChanged.fire(this.navigator.uriFor(round.id, 'left', path));
        this.contentChanged.fire(this.navigator.uriFor(round.id, 'right', path));
      }
      this.rebuildRound(round.id);
    }
    await this.navigator.openRound(round.id);
    return outcome;
  }

  async refreshFromSource(roundId: string): Promise<void> {
    const round = this.store.round(roundId);
    if (!round) return;
    try {
      const outcome = await this.refresh(round);
      void vscode.window.showInformationMessage(`Redline: ${roundMessage(round, outcome)}.`);
    } catch (err) {
      void vscode.window.showErrorMessage(`Redline: ${String(err)}`);
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

  /** Recreates the widgets of one round; for a round no longer in the store it only removes them. */
  rebuildRound(roundId: string): void {
    for (const [id, entry] of this.byThreadId) {
      if (this.roundIdByThreadId.get(id) !== roundId) continue;
      entry.dispose();
      this.byThreadId.delete(id);
      this.idByThread.delete(entry);
      this.roundIdByThreadId.delete(id);
    }
    const round = this.store.round(roundId);
    if (!round) return;
    for (const thread of round.threads) this.createThread(round, thread);
  }

  async dropRound(roundId: string): Promise<void> {
    const round = this.store.round(roundId);
    if (!round) return;
    const open = round.threads.filter((thread) => !thread.resolved).length;
    const pick = await vscode.window.showWarningMessage(
      `Redline: drop ${round.sourceLabel}${round.title ? ` (${round.title})` : ''} with ${plural(open, 'open comment')}?`,
      { modal: true },
      'Drop'
    );
    if (pick !== 'Drop') return;
    this.removeRound(roundId);
  }

  removeRound(roundId: string): void {
    if (!this.store.round(roundId)) return;
    this.store.removeRound(roundId);
    this.rebuildRound(roundId);
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
          : this.human,
        body: this.markdown(comment.body),
        mode: vscode.CommentMode.Preview,
        label: side,
        timestamp: new Date(comment.createdAt),
        contextValue: fromClaude ? 'redline.claude' : 'redline.human'
      };
    });
  }

  private decorate(round: StoredRound, stored: Thread, thread: vscode.CommentThread): void {
    const decoration = threadDecoration({
      kind: stored.kind,
      resolved: stored.resolved,
      sent: stored.sent && round.submittedAt === undefined,
      submitted: round.submittedAt !== undefined,
      hasHumanComment: hasHumanComment(stored),
      file: stored.anchor.file,
      line: threadLine(round, stored),
      side: stored.anchor.side
    });
    thread.label = decoration.label;
    thread.contextValue = `${decoration.contextValue}.${stored.id}`;
    thread.state = stored.resolved
      ? vscode.CommentThreadState.Resolved
      : vscode.CommentThreadState.Unresolved;
  }

  /** Creates the widget for a stored thread that has none yet, or refreshes the one it has. */
  showThread(threadId: string): void {
    if (this.byThreadId.has(threadId)) {
      this.refreshThread(threadId);
      return;
    }
    const stored = this.store.thread(threadId);
    const round = stored ? this.store.round(stored.roundId) : undefined;
    if (stored && round) this.createThread(round, stored);
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

  expandThread(threadId: string): void {
    const thread = this.byThreadId.get(threadId);
    if (thread) thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
  }

  /** Several threads can share a line. The stepped-to one is the only expanded widget there, so the reader sees which note the cursor is on. */
  private focusThread(threadId: string): void {
    const stored = this.store.thread(threadId);
    const round = stored ? this.store.round(stored.roundId) : undefined;
    if (!stored || !round) return;
    const line = threadLine(round, stored);
    for (const other of round.threads) {
      if (other.id === threadId || other.anchor.file !== stored.anchor.file || other.anchor.side !== stored.anchor.side) continue;
      if (threadLine(round, other) !== line) continue;
      const widget = this.byThreadId.get(other.id);
      if (widget) widget.collapsibleState = vscode.CommentThreadCollapsibleState.Collapsed;
    }
    this.expandThread(threadId);
  }

  private redecorateRound(roundId: string): void {
    const round = this.store.round(roundId);
    if (!round) return;
    for (const stored of round.threads) this.refreshThread(stored.id);
  }

  /** A detached thread has no line to sit on, so it gets no widget; the Redline panel lists it. */
  private createThread(round: StoredRound, stored: Thread): void {
    if (stored.detached) return;
    const line = threadLine(round, stored) - 1;
    const uri = this.navigator.uriFor(round.id, stored.anchor.side, stored.anchor.file);
    const thread = this.controller.createCommentThread(
      uri,
      new vscode.Range(line, 0, line, 0),
      this.commentsOf(stored)
    );
    thread.canReply = this.human;
    thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    this.decorate(round, stored, thread);
    this.byThreadId.set(stored.id, thread);
    this.idByThread.set(thread, stored.id);
    this.roundIdByThreadId.set(stored.id, round.id);
  }

  private anchorOf(uri: vscode.Uri, line: number): { roundId: string; anchor: Anchor } | undefined {
    const parsed = this.navigator.parse(uri);
    if (!parsed) return undefined;
    const anchor: Anchor = { file: parsed.path, side: parsed.side };
    if (parsed.side === 'left') anchor.oldLine = line + 1;
    else anchor.newLine = line + 1;
    return { roundId: parsed.roundId, anchor };
  }

  /** Stores the typed text and returns the thread id, or undefined when nothing was stored. */
  private reply(reply: vscode.CommentReply): string | undefined {
    const text = reply.text.trim();
    const existing = this.threadIdOf(reply.thread);
    if (text.length === 0) return existing;
    const author: Author = 'human';
    if (existing) {
      this.store.addComment(existing, author, text);
      this.refreshThread(existing);
      this.expandThread(existing);
      return existing;
    }
    const placed = this.anchorOf(reply.thread.uri, reply.thread.range?.start.line ?? 0);
    if (!placed) {
      void vscode.window.showWarningMessage('Redline: this document is not part of a review round.');
      return undefined;
    }
    const stored = this.store.addThread(placed.roundId, placed.anchor, author, text);
    reply.thread.dispose();
    const round = this.store.round(placed.roundId);
    if (round) this.createThread(round, stored);
    return stored.id;
  }

  private isReply(value: vscode.CommentThread | vscode.CommentReply | undefined): value is vscode.CommentReply {
    return typeof (value as vscode.CommentReply | undefined)?.text === 'string';
  }

  /** The stored id rides in `contextValue` (`redline.<stage>.<id>`), so a thread VS Code hands back as a rebuilt object still resolves exactly. */
  private threadIdOf(thread: vscode.CommentThread | undefined): string | undefined {
    if (!thread) return undefined;
    const id = this.idByThread.get(thread) ?? thread.contextValue?.split('.')[2];
    return id && this.store.thread(id) ? id : undefined;
  }

  private roundIdOfThread(thread: vscode.CommentThread | undefined): string | undefined {
    const id = this.threadIdOf(thread);
    return id ? this.store.thread(id)?.roundId : undefined;
  }

  private async resolveRoundId(thread?: vscode.CommentThread): Promise<string | undefined> {
    const fromThread = this.roundIdOfThread(thread);
    if (fromThread) return fromThread;
    const fromCaret = this.navigator.caretRound()?.id;
    if (fromCaret) return fromCaret;

    const open = this.store.rounds().filter((round) => round.submittedAt === undefined);
    const choices = open.length > 0 ? open : this.store.rounds();
    if (choices.length === 0) return undefined;
    if (choices.length === 1) return choices[0].id;
    return this.navigator.pickRoundId('Which Redline review round?', choices);
  }

  /** `roundId` comes from the round view; the Comments panel passes a thread instead. */
  async submit(thread?: vscode.CommentThread, roundId?: string): Promise<void> {
    const target = roundId ?? (await this.resolveRoundId(thread));
    if (!target) {
      void vscode.window.showInformationMessage('Redline: no review round to submit.');
      return;
    }
    if (this.store.drafts(target).length === 0) {
      void vscode.window.showInformationMessage(
        `Redline: nothing to send in ${this.store.round(target)?.sourceLabel ?? target}. Only open threads with your comment are sent.`
      );
      return;
    }
    const result = this.store.markSubmitted(target);
    const heard = this.events.emitSubmitted({
      roundId: result.roundId,
      commentCount: result.commentCount,
      fileCount: result.fileCount,
      sourceLabel: result.sourceLabel
    });
    this.redecorateRound(result.roundId);
    const what = `${plural(result.commentCount, 'comment')} in ${plural(result.fileCount, 'file')}`;
    void vscode.window.showInformationMessage(
      heard ? `Redline: sent ${what} to ${AGENT_LABEL}.` : `Redline: submitted ${what}. ${QUEUED_HINT}`
    );
  }

  /** Warns and returns undefined when no thread can be found; callers just return. */
  private focusedThreadId(
    thread: vscode.CommentThread | undefined,
    prefer?: (entry: Thread) => boolean
  ): string | undefined {
    const fromArgument = this.threadIdOf(thread);
    if (fromArgument) return fromArgument;
    const caret = this.navigator.caret;
    const round = this.navigator.caretRound();
    let found: string | undefined;
    if (caret && round) {
      const cursor = this.navigator.tourCursor;
      // Several threads can share a line, so ties go to a thread the command can act on, then the stepped-to note, then an open one.
      found = round.threads
        .filter((entry) => entry.anchor.file === caret.path)
        .map((entry) => ({
          id: entry.id,
          distance: Math.abs(threadLine(round, entry) - caret.line),
          rejected: prefer && !prefer(entry) ? 1 : 0,
          rank: entry.id === cursor?.threadId ? 0 : entry.resolved ? 2 : 1
        }))
        .sort((a, b) => a.distance - b.distance || a.rejected - b.rejected || a.rank - b.rank)[0]?.id;
    }
    if (!found) void vscode.window.showWarningMessage('Redline: no comment thread under the cursor.');
    return found;
  }

  /** The inline button hands over a CommentReply with the unsaved text; store it before sending. */
  private sendThread(target: vscode.CommentThread | vscode.CommentReply | undefined): void {
    const id = this.isReply(target) ? this.reply(target) : this.focusedThreadId(target, hasHumanComment);
    const stored = id ? this.store.thread(id) : undefined;
    if (!stored) return;
    if (!hasHumanComment(stored)) {
      void vscode.window.showInformationMessage('Redline: reply to the note first, then send it.');
      return;
    }
    const round = this.store.round(stored.roundId);
    if (!round) return;
    this.store.markSent(stored.id);
    const heard = this.events.emitThreadSent({
      roundId: stored.roundId,
      threadId: stored.id,
      file: stored.anchor.file,
      line: threadLine(round, stored)
    });
    this.refreshThread(stored.id);
    void vscode.window.showInformationMessage(
      heard ? `Redline: sent ${stored.id} to ${AGENT_LABEL}.` : `Redline: ${stored.id} queued. ${QUEUED_HINT}`
    );
  }

  private toggleResolved(thread: vscode.CommentThread | undefined): void {
    const id = this.focusedThreadId(thread);
    if (!id) return;
    const stored = this.store.thread(id);
    if (!stored) return;
    this.store.setResolved(id, !stored.resolved);
    this.refreshThread(id);
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
    const nav = this.navigator;
    context.subscriptions.push(
      this,
      vscode.commands.registerCommand('redline.reply', (reply: vscode.CommentReply) =>
        this.reply(reply)
      ),
      vscode.commands.registerCommand('redline.submitReview', (thread?: vscode.CommentThread) =>
        this.submit(thread)
      ),
      vscode.commands.registerCommand('redline.sendThread', (target?: vscode.CommentThread | vscode.CommentReply) =>
        this.sendThread(target)
      ),
      vscode.commands.registerCommand('redline.resolveThread', (thread?: vscode.CommentThread) =>
        this.toggleResolved(thread)
      ),
      vscode.commands.registerCommand('redline.reopenThread', (thread?: vscode.CommentThread) =>
        this.toggleResolved(thread)
      ),
      vscode.commands.registerCommand('redline.openRound', () => nav.pickRound()),
      vscode.commands.registerCommand('redline.openLatestRound', () => nav.openLatestRound()),
      vscode.commands.registerCommand('redline.nextNote', () => nav.stepNote(1)),
      vscode.commands.registerCommand('redline.previousNote', () => nav.stepNote(-1)),
      vscode.commands.registerCommand('redline.reviewWorktree', () => this.reviewWorktree())
    );
  }
}
