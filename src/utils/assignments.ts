import type { Table, Guest, GuestID, Constraints, Adjacents } from '../types';

export function normalizeAssignmentInputToIdsWithWarnings(
  raw: string | string[] | undefined | null,
  tables: Pick<Table, 'id' | 'name'>[]
): { idCsv: string; warnings: string[] } {
  if (!raw) return { idCsv: '', warnings: [] };
  const inputStr = Array.isArray(raw) ? raw.join(',') : String(raw);
  const nameToId = new Map<string, number>();
  tables.forEach(table => {
    if (table.name && typeof table.name === 'string') {
      nameToId.set(table.name.trim().toLowerCase(), table.id);
    }
  });
  const resolvedIds = new Set<number>();
  const warnings: string[] = [];
  const tokens = inputStr.split(',').map(token => token.trim()).filter(token => token.length > 0);
  
  tokens.forEach(token => {
    const numericId = parseInt(token, 10);
    if (Number.isFinite(numericId) && numericId > 0) {
      if (tables.some(t => t.id === numericId)) {
        resolvedIds.add(numericId);
      } else {
        warnings.push(`Unknown table ID: ${token}`);
      }
    } else {
      const id = nameToId.get(token.toLowerCase());
      if (typeof id === 'number') {
        resolvedIds.add(id);
      } else {
        warnings.push(`Unknown table name: ${token}`);
      }
    }
  });
  
  return { idCsv: Array.from(resolvedIds).sort((a, b) => a - b).join(','), warnings };
}

export function normalizeGuestInputToIdsWithWarnings(
  raw: string | string[] | null | undefined,
  guests: Array<Pick<Guest, 'id' | 'name'>>
): { guestIds: string[]; warnings: string[] } {
  if (!raw) return { guestIds: [], warnings: [] };
  const inputStr = Array.isArray(raw) ? raw.join(',') : String(raw);
  const nameToId = new Map<string, string>();
  guests.forEach(g => nameToId.set(g.name.trim().toLowerCase(), g.id));
  const guestIds: string[] = [];
  const warnings: string[] = [];
  
  inputStr.split(',').map(s => s.trim()).filter(Boolean).forEach(token => {
    const asId = token;
    if (nameToId.has(token.toLowerCase())) {
      guestIds.push(nameToId.get(token.toLowerCase())!);
    } else if (guests.some(g => g.id === asId)) {
      guestIds.push(asId);
    } else {
      warnings.push(`Unknown guest: ${token}`);
    }
  });
  
  const seen = new Set<string>();
  const uniq = guestIds.filter(id => (seen.has(id) ? false : (seen.add(id), true)));
  return { guestIds: uniq, warnings };
}

export function parseAssignmentIds(csv: string | undefined | null): number[] {
  if (!csv) return [];
  return csv.split(',').map(id => parseInt(id.trim(), 10)).filter(id => Number.isFinite(id) && id > 0);
}

export function isAssignedToTable(assignmentCsv: string | undefined, tableId: number): boolean {
  return parseAssignmentIds(assignmentCsv).includes(tableId);
}

const norm = (s: string) => (s?.normalize('NFC').trim() ?? s);
const squash = (s: string) => norm(s).replace(/\s+/g, ' ');

export function migrateAssignmentsToIdKeys(assignments: Record<string, string>, guests: Guest[]): Record<string, string> {
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

export function migrateState(state: { guests: Guest[]; constraints: any; adjacents: any }): { constraints: Constraints; adjacents: Adjacents } {
  if (!state || !Array.isArray(state.guests)) return { constraints: {}, adjacents: {} };
  const guestIdToName = new Map<GuestID, string>(state.guests.map((g: Guest) => [g.id, squash(g.name)]));
  const guestNameToId = new Map<string, GuestID>(state.guests.map((g: Guest) => [squash(g.name), g.id]));
  const validIds = new Set<GuestID>(state.guests.map((g: Guest) => g.id));
  
  const migratedConstraints: Constraints = {};
  for (const [k1, row] of Object.entries(state.constraints || {})) {
    const id1 = validIds.has(k1) ? k1 : (guestNameToId.get(squash(k1)) || null);
    if (!id1 || !guestIdToName.has(id1)) continue;
    for (const [k2, value] of Object.entries(row || {})) {
      const id2 = validIds.has(k2) ? k2 : (guestNameToId.get(squash(k2)) || null);
      if (!id2 || !guestIdToName.has(id2) || id1 === id2) continue;
      if (value === 'must' || value === 'cannot' || value === '') {
        (migratedConstraints[id1] ||= {})[id2] = value;
        (migratedConstraints[id2] ||= {})[id1] = value;
      }
    }
  }
  const migratedAdjacents: Adjacents = {};
  for (const [key, value] of Object.entries(state.adjacents || {})) {
    const id = validIds.has(key) ? key : (guestNameToId.get(squash(key)) || null);
    if (!id || !guestIdToName.has(id)) continue;
    const partners: GuestID[] = Array.isArray(value) ? value : Object.keys(value || {});
    const validPartners: GuestID[] = [];
    for (const adj of partners) {
      const adjId = validIds.has(adj) ? adj : (guestNameToId.get(squash(adj)) || null);
      if (!adjId || !guestIdToName.has(adjId) || adjId === id) continue;
      validPartners.push(adjId);
    }
    if (validPartners.length) migratedAdjacents[id] = validPartners; // No cap unless 0910 enforces
  }
  return { constraints: migratedConstraints, adjacents: migratedAdjacents };
}

export function mergeAssignments(assignments: string[]): string {
  const allIds = new Set<number>();
  for (const assignment of assignments) {
    const ids = parseAssignmentIds(assignment);
    ids.forEach(id => allIds.add(id));
  }
  return Array.from(allIds).sort((a, b) => a - b).join(',');
}