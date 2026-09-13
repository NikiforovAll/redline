import { formatDue } from './dates.mjs';
import { isOverdue, open } from './store.mjs';

export function formatItem(item) {
  const mark = item.done ? 'x' : ' ';
  const due = item.due ? ` (due ${formatDue(item.due)}${isOverdue(item) ? ', overdue' : ''})` : '';
  return `[${mark}] ${item.id}. ${item.title}${due}`;
}

export function formatList() {
  return open().map(formatItem).join('\n');
}
