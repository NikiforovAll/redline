let nextId = 1;
const items = [];

export function reset() {
  nextId = 1;
  items.length = 0;
}

export function add(title) {
  const item = { id: nextId, title, done: false };
  nextId += 1;
  items.push(item);
  return item;
}

export function complete(id) {
  const item = items.find((entry) => entry.id == id);
  if (!item) throw new Error(`no item ${id}`);
  item.done = true;
  return item;
}

export function list() {
  return items;
}
