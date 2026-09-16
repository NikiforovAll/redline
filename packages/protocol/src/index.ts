export type WorktreeScope = 'staged' | 'unstaged' | 'all';

export interface FilePair {
  left: string;
  right: string;
}

/** `to` values that name an uncommitted side instead of a revision: `worktree` is the files on disk, untracked included; `index` is what is staged. */
export const WORKTREE_SIDE = 'worktree';
export const INDEX_SIDE = 'index';

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
  /** A refresh could not find the anchored line in the new snapshot; the anchor keeps the last known file and line. */
  detached?: boolean;
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

/** One comment thread the agent posts on the diff. `line` numbers the new side; the thread snaps to the first changed line of the hunk that contains it. */
export interface Note {
  file: string;
  line: number;
  body: string;
}

/** `source` opens a round, or refreshes the one with the same label; `roundId` refreshes that round from its stored source. */
export type RequestReview = { title?: string; notes?: Note[] } & (
  | { source: Source; roundId?: undefined }
  | { roundId: string; source?: undefined }
);

export interface RoundSummary {
  id: string;
  title?: string;
  source: Source;
  sourceLabel: string;
  fileCount: number;
  openThreads: number;
  detachedThreads: number;
  createdAt: string;
  submittedAt?: string;
  refreshedAt?: string;
  refreshCount: number;
  /** Files named by request_review notes that the diff does not contain. */
  unmatchedNoteFiles?: string[];
}

export type RoundOutcome = 'opened' | 'refreshed' | 'kept';

/** Response of `POST /rounds`: the summary of the round the request opened, refreshed, or left as it was. */
export interface RequestReviewResult extends RoundSummary {
  outcome: RoundOutcome;
  /** One sentence on the outcome with the label and counts, no trailing period; the reviewer sees the same text as a toast. */
  message: string;
}

/** Response of `POST /rounds/{id}/notes`: the round's summary and the threads the notes became. The diff is not rebuilt. */
export interface AddNotesResult extends RoundSummary {
  threadIds: string[];
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
