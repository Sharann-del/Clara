/**
 * Small fuzzy ranker for the command palette: exact > prefix > word start > substring >
 * in-order subsequence. Items with no match on any field are dropped. Empty term keeps all.
 */
export function scoreMatch(text: string, term: string): number {
  const t = text.toLowerCase();
  const q = term.toLowerCase().trim();
  if (!q) return 1;
  if (t === q) return 100;
  if (t.startsWith(q)) return 80;
  if (new RegExp(`(^|[\\s\\-_/.:])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(t)) return 60;
  if (t.includes(q)) return 40;
  let i = 0;
  for (const ch of t) if (ch === q[i]) i += 1;
  return i === q.length ? 10 : 0;
}

export function rankMatches<T>(items: T[], term: string, fields: (item: T) => string[]): T[] {
  if (!term.trim()) return items;
  return items
    .map((item, index) => ({ item, index, score: Math.max(...fields(item).map((f) => scoreMatch(f, term))) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((r) => r.item);
}
