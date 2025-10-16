export function stableStringify(v: any): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  const keys = Object.keys(v).sort();
  return `{${keys.map(k => JSON.stringify(k)+':'+stableStringify(v[k])).join(',')}}`;
}

export function computePlanSignature(state: any): string {
  const tablesLite = [...(state.tables || [])]
    .map((t: any) => ({ id: t.id, capacity: t.capacity }))
    .sort((a, b) => a.id - b.id);
  const guestsLite = [...(state.guests || [])]
    .map((g: any) => ({ id: g.id, count: g.count }))
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return [
    state.assignmentSignature || '',
    stableStringify(tablesLite),
    stableStringify(guestsLite),
    stableStringify(state.constraints || {}),
    stableStringify(state.adjacents || {})
  ].join('|');
}

