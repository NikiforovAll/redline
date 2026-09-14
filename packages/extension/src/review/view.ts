import * as vscode from 'vscode';
import type { RoundNavigator } from './navigator.ts';
import type { ReviewStore } from './store.ts';
import {
  decorationOf,
  fileBadge,
  fileDescription,
  fileNodes,
  formatDate,
  noteDescription,
  noteLabel,
  noteNodes,
  notesDescription,
  plural,
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
    this.view = vscode.window.createTreeView(ROUND_VIEW_ID, { treeDataProvider: this, showCollapseAll: false, canSelectMany: true });
    const unsubscribe = store.onChange(() => this.refresh());
    this.disposables.push(
      this.view,
      this.changed,
      vscode.window.registerFileDecorationProvider({
        provideFileDecoration: (uri) => {
          const parsed = this.navigator.parse(uri);
          const file = parsed && this.store.round(parsed.roundId)?.files.find((entry) => entry.path === parsed.path);
          if (!file) return undefined;
          const badge = fileBadge(file.status);
          return new vscode.FileDecoration(badge.letter, badge.tooltip, new vscode.ThemeColor(badge.color));
        }
      }),
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
    if (node.kind === 'files') return fileNodes(node.round);
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
      case 'files': {
        const item = new vscode.TreeItem('Files', vscode.TreeItemCollapsibleState.Collapsed);
        item.id = `files:${node.roundId}`;
        item.description = plural(node.round.files.length, 'file');
        item.iconPath = new vscode.ThemeIcon('files');
        item.contextValue = 'redline.files';
        return item;
      }
      case 'file': {
        const item = new vscode.TreeItem(node.file.path);
        item.id = `file:${node.roundId}:${node.file.path}`;
        item.description = fileDescription(node);
        item.resourceUri = this.navigator.uriFor(node.roundId, 'right', node.file.path);
        item.iconPath = vscode.ThemeIcon.File;
        item.tooltip = `${node.file.path} · ${fileBadge(node.file.status).tooltip.toLowerCase()}`;
        item.contextValue = 'redline.file';
        item.command = { command: 'redline.openFileDiff', title: 'Open file diff', arguments: [node.roundId, node.file.path] };
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
        item.contextValue = decorationOf(node.round, node.thread).contextValue;
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
      copy: (roundId: string) => Promise<void>;
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
      vscode.commands.registerCommand('redline.openFileDiff', (roundId: string, filePath: string) => nav.openFile(roundId, filePath)),
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
      vscode.commands.registerCommand('redline.copyRoundId', async (arg: unknown) => {
        const id = roundIdFrom(arg) ?? nav.currentRound()?.id ?? (await nav.pickRoundId('Copy the id of which Redline review round?'));
        if (id) await actions.copy(id);
      }),
      vscode.commands.registerCommand('redline.reloadView', () => this.refresh()),
      vscode.commands.registerCommand('redline.toggleView', () =>
        vscode.commands.executeCommand(this.view.visible ? 'workbench.action.closeAuxiliaryBar' : `workbench.view.extension.redline`)
      )
    );
  }
}
