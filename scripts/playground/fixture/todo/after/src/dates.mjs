const DUE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDue(text) {
  const match = DUE.exec(text);
  if (!match) throw new Error(`due date must be YYYY-MM-DD, got ${text}`);
  return new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
}

export function isPast(date, now = new Date()) {
  return date.getTime() < now.getTime();
}

export function formatDue(date) {
  return date.toISOString().slice(0, 10);
}
