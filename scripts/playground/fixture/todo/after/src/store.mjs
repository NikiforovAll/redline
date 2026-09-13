import { parseDue } from './dates.mjs';

let nextId = 1;
const items = [];

export function reset() {
  nextId = 1;
  items.length = 0;
}

export function add(title, due) {
  const item = { id: nextId, title, done: false, due: due ? parseDue(due) : undefined };
  nextId += 1;
  items.push(item);
  return item;
}

export function complete(id) {
  const item = items.find((entry) => entry.id === id);
  if (!item) throw new Error(`no item ${id}`);
  item.done = true;
  return item;
}

export function open() {
  return items.filter((item) => !item.done);
}

export function all() {
  return items;
}

export function isOverdue(item, now = new Date()) {
  if (!item.due || item.done) return false;
  return item.due.toISOString().slice(0, 10) < now.toISOString().slice(0, 10);
}
