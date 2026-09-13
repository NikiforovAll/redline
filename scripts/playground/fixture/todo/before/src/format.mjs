import { list } from './store.mjs';

export function formatItem(item) {
  const mark = item.done ? 'x' : ' ';
  return `[${mark}] ${item.id}. ${item.title}`;
}

export function formatList() {
  return list().map(formatItem).join('\n');
}
