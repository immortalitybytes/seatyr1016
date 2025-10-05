import type { Table } from "../types";

// Robust parser: accepts string | string[], returns string[]; splits CSV/whitespace
export function parseAssignmentIds(raw: string | string[] | undefined | null): string[] {
  if (Array.isArray(raw)) return raw.flatMap(parseAssignmentIds);
  return (raw || "").split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
}

export function normalizeAssignmentInputToIdsWithWarnings(
  raw: string | string[] | undefined | null,
  tables: Pick<Table, "id" | "name">[]
): { idCsv: string; warnings: string[] } {
  if (!raw) return { idCsv: "", warnings: [] };
  const inputStr = Array.isArray(raw) ? raw.join(",") : String(raw);
  const nameToId = new Map<string, number>();
  tables.forEach(t => { if (t.name) nameToId.set(t.name.trim().toLowerCase(), t.id); });

  const out = new Set<number>();
  const warnings: string[] = [];
  const tokens = inputStr.split(",").map(s => s.trim()).filter(Boolean);

  tokens.forEach(tok => {
    const num = parseInt(tok, 10);
    if (Number.isFinite(num) && num > 0) {
      if (tables.some(t => t.id === num)) out.add(num); else warnings.push(`Unknown table ID: ${tok}`);
    } else {
      const id = nameToId.get(tok.toLowerCase());
      if (typeof id === "number") out.add(id); else warnings.push(`Unknown table name: ${tok}`);
    }
  });
  return { idCsv: Array.from(out).join(","), warnings };
}

export function normalizeAssignmentsToArrayShape(a: Record<string, string | string[] | undefined>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [gid, v] of Object.entries(a || {})) {
    if (!v) continue;
    out[gid] = parseAssignmentIds(v);
  }
  return out;
}

export function migrateAssignmentsToIdKeys(assignments: Record<string, string>, guests: { id: string; name: string }[]): Record<string, string> {
  const nameToId = new Map<string, string>(guests.map(g => [g.name.toLowerCase(), g.id]));
  const migrated: Record<string, string> = {};
  for (const [key, value] of Object.entries(assignments)) {
    const id = nameToId.get(key.toLowerCase()) || key;
    if (guests.some(g => g.id === id)) migrated[id] = value;
  }
  return migrated;
}