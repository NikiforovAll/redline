import type { Anchor, ThreadKind } from '@redline/protocol';

export type ThreadStage = 'note' | 'draft' | 'submitted' | 'sent' | 'resolved';

export interface ThreadDecorationInput {
  kind: ThreadKind;
  resolved: boolean;
  sent: boolean;
  submitted: boolean;
  hasHumanComment: boolean;
  file: string;
  line: number;
  side: Anchor['side'];
  detached?: boolean;
}

export interface ThreadDecoration {
  stage: ThreadStage;
  label: string;
  contextValue: string;
}

export const AGENT_LABEL = 'Agent';

const BADGE: Record<ThreadStage, string> = {
  note: 'note',
  draft: 'draft',
  submitted: 'submitted',
  sent: `sent to ${AGENT_LABEL}`,
  resolved: 'resolved'
};

export function sideLabel(side: Anchor['side']): string {
  return side === 'left' ? 'old' : 'new';
}

function threadStage(input: ThreadDecorationInput): ThreadStage {
  if (input.resolved) return 'resolved';
  if (input.sent) return 'sent';
  if (input.submitted && input.hasHumanComment) return 'submitted';
  if (input.hasHumanComment) return 'draft';
  return input.kind === 'note' ? 'note' : 'draft';
}

export function threadDecoration(input: ThreadDecorationInput): ThreadDecoration {
  const stage = threadStage(input);
  const name = input.file.split('/').pop() ?? input.file;
  const place = input.detached ? `${sideLabel(input.side)}, detached` : sideLabel(input.side);
  return {
    stage,
    label: `${BADGE[stage]} · ${name}:${input.line} (${place})`,
    contextValue: `redline.${stage}`
  };
}

export const COMMENT_OPTIONS = {
  prompt: 'Comment for Agent',
  placeHolder: 'Comment'
};
