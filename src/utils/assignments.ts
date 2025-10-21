// src/utils/assignments.ts
import type { Guest, GuestID, Constraints, Adjacents } from "../types";

export function normalizeAssignmentInputToIdsWithWarnings(
  raw: string | string[] | undefined | null,
  tables: Array<{ id: number; name?: string | null }>,
  isPremium: boolean
): { idCsv: string; warnings: string[] } {
  if (!raw) return { idCsv: "", warnings: [] };
  const inputStr = Array.isArray(raw) ? raw.join(",") : String(raw);

  const nameToId = new Map<string, number>();
  const idSet = new Set<number>();
  for (const t of tables) {
    if (t?.id) idSet.add(t.id);
    if (t?.name) nameToId.set(t.name.trim().toLowerCase(), t.id);
  }

  const resolved = new Set<number>();
  const warnings: string[] = [];

  // Enhanced punctuation-tolerant parsing
  // Handles: "2. 3, College, 5" → ["2", "3", "College", "5"]
  const tokens = inputStr
    .split(/[,\s]+/)  // Split on commas and spaces only
    .map(s => s.trim())
    .filter(Boolean)
    .map(token => {
      // Handle trailing periods: "2." → "2", "College." → "College"
      return token.replace(/\.$/, '');
    });

  for (const token of tokens) {
    // Rule: numeric tokens are treated as table IDs
    const asNum = Number(token);
    if (Number.isFinite(asNum) && Number.isInteger(asNum) && asNum > 0) {
      if (idSet.has(asNum)) resolved.add(asNum);
      else warnings.push(`Unknown table ID: "${token}"`);
      continue;
    }
    // Premium allows resolving by table name
    if (isPremium) {
      const id = nameToId.get(token.toLowerCase());
      if (typeof id === 'number') resolved.add(id);
      else warnings.push(`Unknown table name: "${token}"`);
    } else {
      warnings.push(`Using table names ("${token}") requires Premium.`);
    }
  }

  const idCsv = Array.from(resolved).sort((a,b)=>a-b).join(',');
  return { idCsv, warnings };
}

export function normalizeGuestInputToIdsWithWarnings(
  raw: string | string[] | null | undefined,
  guests: Array<Pick<Guest, "id" | "name">>,
): { guestIds: string[]; warnings: string[] } {
  if (!raw) return { guestIds: [], warnings: [] };
  const inputStr = Array.isArray(raw) ? raw.join(",") : String(raw);
  const nameToId = new Map<string, string>();
  for (const g of guests) nameToId.set(g.name.trim().toLowerCase(), g.id);

  const ids: string[] = [];
  const warnings: string[] = [];
  const tokens = inputStr
    .split(/[,\s.]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const token of tokens) {
    const asLower = token.toLowerCase();
    if (nameToId.has(asLower)) {
      ids.push(nameToId.get(asLower)!);
    } else if (guests.some((g) => g.id === token)) {
      ids.push(token);
    } else {
      warnings.push(`Unknown guest: ${token}`);
    }
  }

  const seen = new Set<string>();
  const uniq = ids.filter((id) => (seen.has(id) ? false : (seen.add(id), true)));
  return { guestIds: uniq, warnings };
}

export function parseAssignmentIds(csv: string | undefined | null): number[] {
  if (!csv) return [];
  return String(csv)
    .split(/[,\s.]+/)
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export function isAssignedToTable(assignmentCsv: string | undefined, tableId: number): boolean {
  return parseAssignmentIds(assignmentCsv).includes(tableId);
}

const norm = (s: string) => (s?.normalize("NFC").trim() ?? s);
const squash = (s: string) => norm(s).replace(/\s+/g, " ");

export function migrateAssignmentsToIdKeys(
  assignments: Record<string, string>,
  guests: Guest[],
): Record<string, string> {
  const out: Record<string, string> = {};
  const nameToId = new Map<string, string>();
  const validIds = new Set(guests.map((g) => g.id));
  for (const g of guests) nameToId.set(g.name.trim().toLowerCase(), g.id);

  for (const [k, v] of Object.entries(assignments || {})) {
    if (validIds.has(k)) out[k] = v;
    else {
      const id = nameToId.get(k.toLowerCase());
      if (id) out[id] = v;
      // (Optional) could collect warnings for dropped keys; no UI drift now
    }
  }
  return out;
}

export function migrateState(state: {
  guests: Guest[];
  constraints: any;
  adjacents: any;
}): { constraints: Constraints; adjacents: Adjacents } {
  if (!state || !Array.isArray(state.guests)) return { constraints: {}, adjacents: {} };

  const guestNameToId = new Map<string, GuestID>(state.guests.map((g) => [squash(g.name), g.id]));
  const validIds = new Set<GuestID>(state.guests.map((g) => g.id));

  const constraints: Constraints = {};
  for (const [k1, row] of Object.entries(state.constraints || {})) {
    const id1 = validIds.has(k1 as GuestID) ? (k1 as GuestID) : guestNameToId.get(squash(k1));
    if (!id1) continue;

    for (const [k2, value] of Object.entries(row || {})) {
      const id2 = validIds.has(k2 as GuestID) ? (k2 as GuestID) : guestNameToId.get(squash(k2));
      if (!id2 || id1 === id2) continue;
      if (["must", "cannot", ""].includes(value)) {
        (constraints[id1] ||= {})[id2] = value;
        (constraints[id2] ||= {})[id1] = value;
      }
    }
  }

  const adjacents: Adjacents = {};
  for (const [key, value] of Object.entries(state.adjacents || {})) {
    const id = validIds.has(key as GuestID) ? (key as GuestID) : guestNameToId.get(squash(key));
    if (!id) continue;
    const partners: GuestID[] = Array.isArray(value) ? value : Object.keys(value || {});
    const ok: GuestID[] = [];
    for (const adj of partners) {
      const adjId = validIds.has(adj as GuestID) ? (adj as GuestID) : guestNameToId.get(squash(adj as unknown as string));
      if (adjId && adjId !== id) ok.push(adjId);
    }
    if (ok.length) adjacents[id] = [...new Set(ok)];
  }

  return { constraints, adjacents };
}

export function mergeAssignments(assignments: string[]): string {
  const all = new Set<number>();
  for (const a of assignments) for (const id of parseAssignmentIds(a)) all.add(id);
  return Array.from(all).sort((a, b) => a - b).join(",");
}
