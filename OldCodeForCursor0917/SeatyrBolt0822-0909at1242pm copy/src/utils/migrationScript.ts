// src/utils/migrationScript.ts
// One-time helper to convert mixed name/ID keys to canonical ID keys while
// preserving adjacency symmetry and degree ≤ 2. Call from your app shell if desired.

const norm = (s: string) => s?.normalize('NFC').trim() ?? s;
const squash = (s: string) => norm(s).replace(/\s+/g, ' ');

export function migrateState(state: any) {
  if (!state || !Array.isArray(state.guests)) return { constraints: {}, adjacents: {} };

  const guestIdToName = new Map(state.guests.map((g: any) => [g.id, squash(g.name)]));
  const guestNameToId = new Map(state.guests.map((g: any) => [squash(g.name), g.id]));
  const validIds = new Set(state.guests.map((g: any) => g.id));

  // Constraints → ID-keyed, symmetric
  const migratedConstraints: Record<string, Record<string, any>> = {};
  for (const [k1, row] of Object.entries(state.constraints || {})) {
    const id1 = validIds.has(k1) ? k1 : (guestNameToId.get(squash(k1)) || null);
    if (!id1 || !guestIdToName.has(id1)) continue;
    for (const [k2, value] of Object.entries(row || {})) {
      const id2 = validIds.has(k2) ? k2 : (guestNameToId.get(squash(k2)) || null);
      if (!id2 || !guestIdToName.has(id2) || id1 === id2) continue;
      (migratedConstraints[id1] ||= {})[id2] = value;
      (migratedConstraints[id2] ||= {})[id1] = value;
    }
  }

  // Adjacents → ID-keyed, symmetric, degree ≤ 2
  const acc: Record<string, Set<string>> = {};
  for (const [key, value] of Object.entries(state.adjacents || {})) {
    const id = validIds.has(key) ? key : (guestNameToId.get(squash(key)) || null);
    if (!id || !guestIdToName.has(id)) continue;
    const partners = Array.isArray(value) ? value : Object.keys(value || {});
    for (const adj of partners) {
      const adjId = validIds.has(adj) ? adj : (guestNameToId.get(squash(adj)) || null);
      if (!adjId || !guestIdToName.has(adjId) || adjId === id) continue;
      (acc[id] ||= new Set()).add(adjId);
      (acc[adjId] ||= new Set()).add(id);
    }
  }
  const migratedAdjacents: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(acc)) {
    migratedAdjacents[k] = Array.from(set).slice(0, 2);
  }

  return { constraints: migratedConstraints, adjacents: migratedAdjacents };
}
