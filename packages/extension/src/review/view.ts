import * as vscode from 'vscode';
import type { RoundNavigator } from './navigator.ts';
import type { ReviewStore } from './store.ts';
import {
  formatDate,
  noteDescription,
  noteLabel,
  noteNodes,
  notesDescription,
  roundChildren,
  roundDescription,
  roundLabel,
  rootNodes,
  type RoundNode
} from './view-model.ts';

export const ROUND_VIEW_ID = 'redline.rounds';

/** Tree with one node per round; the active round is expanded and lists its open notes in reading order. */
export class RoundView implements vscode.TreeDataProvider<RoundNode>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<RoundNode | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private readonly view: vscode.TreeView<RoundNode>;
  private readonly disposables: vscode.Disposable[] = [];
  private activeRoundId: string | undefined;

  constructor(
    private readonly store: ReviewStore,
    private readonly navigator: RoundNavigator
  ) {
    this.view = vscode.window.createTreeView(ROUND_VIEW_ID, { treeDataProvider: this, showCollapseAll: false });
    const unsubscribe = store.onChange(() => this.refresh());
    this.disposables.push(
      this.view,
      this.changed,
      { dispose: unsubscribe },
      navigator.onDidChangeCursor(() => this.refresh()),
      navigator.onDidChangeCaret((caret) => {
        if (caret?.roundId !== this.activeRoundId) this.refresh();
      })
    );
    this.refresh();
  }

  dispose(): void {
    for (const item of this.disposables) item.dispose();
  }

  refresh(): void {
    const active = this.navigator.currentRound();
    this.activeRoundId = active?.id;
    const count = this.store.rounds().length;
    this.view.description = active ? `${active.sourceLabel} active` : undefined;
    this.view.badge = count > 0 ? { value: count, tooltip: `${count} review round${count === 1 ? '' : 's'}` } : undefined;
    void vscode.commands.executeCommand('setContext', 'redline.hasRounds', count > 0);
    this.changed.fire(undefined);
  }

  getChildren(node?: RoundNode): RoundNode[] {
    if (!node) return rootNodes(this.store.rounds(), this.activeRoundId);
    if (node.kind === 'round') return roundChildren(node.round, this.navigator.tourCursor);
    if (node.kind === 'notes') return noteNodes(node.round, this.navigator.tourCursor);
    return [];
  }

  getTreeItem(node: RoundNode): vscode.TreeItem {
    switch (node.kind) {
      case 'round': {
        const item = new vscode.TreeItem(
          roundLabel(node.round),
          node.active ? vscode.TreeItemCollapsibleState.Expanded : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.id = `round:${node.round.id}`;
        item.description = roundDescription(node.round);
        item.iconPath = new vscode.ThemeIcon(node.round.submittedAt ? 'pass-filled' : node.active ? 'circle-large-filled' : 'circle-large-outline');
        item.contextValue = node.round.submittedAt ? 'redline.round.submitted' : 'redline.round.open';
        item.tooltip = [node.round.title, node.round.sourceLabel, `Opened ${formatDate(node.round.createdAt)}`, node.round.refreshedAt && `Refreshed ${formatDate(node.round.refreshedAt)}`]
          .filter(Boolean)
          .join('\n');
        item.command = { command: 'redline.openRoundById', title: 'Open round', arguments: [node.round.id] };
        return item;
      }
      case 'info': {
        const item = new vscode.TreeItem(node.label);
        item.iconPath = new vscode.ThemeIcon(node.icon);
        item.contextValue = 'redline.info';
        return item;
      }
      case 'notes': {
        const item = new vscode.TreeItem('Notes', vscode.TreeItemCollapsibleState.Expanded);
        item.id = `notes:${node.roundId}`;
        item.description = notesDescription(node.round);
        item.iconPath = new vscode.ThemeIcon('list-ordered');
        item.contextValue = 'redline.notes';
        return item;
      }
      case 'note': {
        const item = new vscode.TreeItem(`${node.index}. ${noteLabel(node.thread)}`);
        item.id = `note:${node.roundId}:${node.thread.id}`;
        item.description = noteDescription(node);
        item.iconPath = new vscode.ThemeIcon(
          node.current
            ? 'debug-stackframe'
            : node.thread.detached
              ? 'debug-disconnect'
              : node.thread.resolved
                ? 'pass'
                : node.answered
                  ? 'comment-discussion'
                  : 'circle-small',
          node.current ? new vscode.ThemeColor('list.highlightForeground') : undefined
        );
        item.tooltip = new vscode.MarkdownString(node.thread.comments[0]?.body ?? '');
        item.contextValue = 'redline.note';
        item.command = { command: 'redline.revealNote', title: 'Go to note', arguments: [node.roundId, node.thread.id] };
        return item;
      }
    }
  }

  register(
    context: vscode.ExtensionContext,
    actions: {
      submit: (roundId: string) => Promise<void>;
      drop: (roundId: string) => Promise<void>;
      refresh: (roundId: string) => Promise<void>;
    }
  ): void {
    const nav = this.navigator;
    const roundIdFrom = (arg: unknown): string | undefined =>
      typeof arg === 'string' ? arg : (arg as RoundNode | undefined)?.roundId;
    context.subscriptions.push(
      this,
      vscode.commands.registerCommand('redline.openRoundById', (arg: unknown) => {
        const id = roundIdFrom(arg);
        return id ? nav.openRound(id) : undefined;
      }),
      vscode.commands.registerCommand('redline.revealNote', (roundId: string, threadId: string) =>
        nav.revealNote(roundId, threadId)
      ),
      vscode.commands.registerCommand('redline.submitRound', (arg: unknown) => {
        const id = roundIdFrom(arg) ?? nav.currentRound()?.id;
        return id ? actions.submit(id) : undefined;
      }),
      vscode.commands.registerCommand('redline.dropRound', async (arg: unknown) => {
        const id = roundIdFrom(arg) ?? (await nav.pickRoundId('Drop which Redline review round?'));
        if (id) await actions.drop(id);
      }),
      vscode.commands.registerCommand('redline.refreshRound', async (arg: unknown) => {
        const id = roundIdFrom(arg) ?? nav.currentRound()?.id ?? (await nav.pickRoundId('Refresh which Redline review round?'));
        if (id) await actions.refresh(id);
      }),
      vscode.commands.registerCommand('redline.reloadView', () => this.refresh())
    );
  }
}
