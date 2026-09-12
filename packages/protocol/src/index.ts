export type WorktreeScope = 'staged' | 'unstaged' | 'all';

export interface FilePair {
  left: string;
  right: string;
}

export type Source =
  | { kind: 'worktree'; scope: WorktreeScope }
  | { kind: 'range'; from: string; to: string }
  | { kind: 'patch'; text: string }
  | { kind: 'files'; pairs: FilePair[] };

export type Side = 'left' | 'right';

export interface Anchor {
  file: string;
  side: Side;
  hunk?: number;
  oldLine?: number;
  newLine?: number;
}

export type Author = 'human' | 'claude';

export interface Comment {
  id: string;
  threadId: string;
  author: Author;
  body: string;
  createdAt: string;
}

export type ThreadKind = 'human' | 'note';

export interface Thread {
  id: string;
  roundId: string;
  anchor: Anchor;
  comments: Comment[];
  resolved: boolean;
  /** The reviewer handed the thread to the agent: round submit or send-thread. A new human comment clears it. */
  sent: boolean;
  delivered: boolean;
  kind: ThreadKind;
}

export type FileStatus = 'added' | 'modified' | 'deleted' | 'renamed' | 'binary';

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
}

export interface RoundFile {
  path: string;
  oldPath?: string;
  status: FileStatus;
  hunks: Hunk[];
}

export interface NoteHunk {
  newRange: [number, number];
  summary: string;
  rationale?: string;
}

export interface Note {
  file: string;
  summary?: string;
  hunks?: NoteHunk[];
}

export interface RequestReview {
  source: Source;
  title?: string;
  notes?: Note[];
}

export interface RoundSummary {
  id: string;
  title?: string;
  sourceLabel: string;
  fileCount: number;
  openThreads: number;
  createdAt: string;
  submittedAt?: string;
  /** Files named by request_review notes that the diff does not contain. */
  unmatchedNoteFiles?: string[];
}

export interface Round extends RoundSummary {
  source: Source;
  files: RoundFile[];
  threads: Thread[];
  partial?: boolean;
}

export interface ReviewSubmittedEvent {
  type: 'review_submitted';
  roundId: string;
  commentCount: number;
  fileCount: number;
  sourceLabel: string;
}

export interface ThreadSentEvent {
  type: 'thread_sent';
  roundId: string;
  threadId: string;
  file: string;
  line: number;
}

export type ReviewEvent = ReviewSubmittedEvent | ThreadSentEvent;

export interface PendingSummary {
  roundId: string;
  sourceLabel: string;
  threadIds: string[];
  fileCount: number;
}

export interface LockFile {
  port: number;
  token: string;
  workspaceFolders: string[];
  pid: number;
  /** Pid of the VS Code main process, which children of the window see as `VSCODE_PID`. */
  appPid?: number;
  /** `vscode.env.uriScheme`: `vscode` or `vscode-insiders`. */
  app?: string;
  version: string;
}
