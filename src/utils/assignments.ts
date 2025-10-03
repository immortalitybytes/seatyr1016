
export function parseAssignmentIds(csv: string | undefined | null): number[] {
  if (!csv) return [];
  return csv.split(',').map(id => parseInt(id.trim(), 10)).filter(id => Number.isFinite(id) && id > 0);
}

export function normalizeAssignmentInputToIdsWithWarnings(
  raw: string | string[] | undefined | null,
  tables: Pick<{ id: number; name?: string }, 'id' | 'name'>[]
): { idCsv: string; warnings: string[] } {
  if (!raw) return { idCsv: '', warnings: [] };
  const inputStr = Array.isArray(raw) ? raw.join(',') : String(raw);
  const nameToId = new Map<string, number>();
  tables.forEach(table => {
    if (table.name && typeof table.name === 'string') {
      nameToId.set(table.name.trim().toLowerCase(), table.id);
    }
  });
  
  const tokens = inputStr.split(',').map(t => t.trim()).filter(Boolean);
  const ids: number[] = [];
  const warnings: string[] = [];
  
  for (const token of tokens) {
    const idNum = parseInt(token, 10);
    if (Number.isFinite(idNum) && idNum > 0) {
      ids.push(idNum);
    } else {
      const lowerToken = token.toLowerCase();
      const tableId = nameToId.get(lowerToken);
      if (tableId) {
        ids.push(tableId);
      } else {
        warnings.push(token);
      }
    }
  }
  
  return { idCsv: ids.join(','), warnings };
}

export function normalizeAssignmentsToArrayShape(a: Record<string,string|string[]|undefined>) {
  const out: Record<string,string[]> = {};
  for (const [gid, v] of Object.entries(a || {})) {
    if (!v) continue;
    out[gid] = Array.isArray(v) ? v : [v];
  }
  return out;
}

export function migrateAssignmentsToIdKeys(assignments: Record<string, string>, guests: { id: string; name: string }[]): Record<string, string> {
  const migrated: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  guests.forEach(guest => nameToId.set(guest.name.trim().toLowerCase(), guest.id));
  const validIds = new Set(guests.map(g => g.id));
  
  Object.entries(assignments).forEach(([key, value]) => {
    const isId = validIds.has(key);
    if (isId) {
      migrated[key] = value;
    } else {
      const guestId = nameToId.get(key.toLowerCase());
      if (guestId) {
        migrated[guestId] = value;
      } else if (import.meta.env.DEV) {
        console.warn(`Unresolved assignment key: "${key}"`);
      }
    }
  });
  
  return migrated;
}

const norm = (s: string) => (s?.normalize('NFC').trim() ?? s);
const squash = (s: string) => norm(s).replace(/\s+/g, ' ');

export function migrateState(state: { guests: { id: string; name: string }[]; constraints: any; adjacents: any }): { constraints: Record<string, Record<string, string>>; adjacents: Record<string, string[]> } {
  if (!state || !Array.isArray(state.guests)) return { constraints: {}, adjacents: {} };
  const guestIdToName = new Map<string, string>(state.guests.map((g: any) => [g.id, squash(g.name)]));
  const guestNameToId = new Map<string, string>(state.guests.map((g: any) => [squash(g.name), g.id]));
  const validIds = new Set<string>(state.guests.map((g: any) => g.id));
  
  const migratedConstraints: Record<string, Record<string, string>> = {};
  for (const [k1, row] of Object.entries(state.constraints || {})) {
    const id1 = validIds.has(k1) ? k1 : (guestNameToId.get(squash(k1)) || null);
    if (!id1 || !guestIdToName.has(id1)) continue;
    for (const [k2, value] of Object.entries(row || {})) {
      const id2 = validIds.has(k2) ? k2 : (guestNameToId.get(squash(k2)) || null);
      if (!id2 || !guestIdToName.has(id2) || id1 === id2) continue;
      if (value === 'must' || value === 'cannot' || value === '') {
        (migratedConstraints[id1] ||= {})[id2] = value as string;
        (migratedConstraints[id2] ||= {})[id1] = value as string;
      }
    }
  }
  const migratedAdjacents: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(state.adjacents || {})) {
    const id = validIds.has(key) ? key : (guestNameToId.get(squash(key)) || null);
    if (!id || !guestIdToName.has(id)) continue;
    const partners: string[] = Array.isArray(value) ? value : Object.keys(value || {});
    const validPartners: string[] = [];
    for (const adj of partners) {
      const adjId = validIds.has(adj) ? adj : (guestNameToId.get(squash(adj)) || null);
      if (!adjId || !guestIdToName.has(adjId) || adjId === id) continue;
      validPartners.push(adjId);
    }
    if (validPartners.length) migratedAdjacents[id] = validPartners;
  }
  return { constraints: migratedConstraints, adjacents: migratedAdjacents };
}