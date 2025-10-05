// src/utils/assignments.ts
// Multi-assignment utilities: robust parsing and normalization

import type { Table } from '../types';

/** Parse multi-assignment CSVs/arrays into array<string> IDs (stable). */
export function parseAssignmentIds(raw: string | string[] | undefined | null): string[] {
  if (Array.isArray(raw)) return raw.flatMap(parseAssignmentIds);
  return (raw || '')
    .split(/[,\s]+/)
    .map(s => s.trim())
    .filter(Boolean);
}

/** Accepts names/ids → resolves to deduped ID CSV; warns on unknowns. */
export function normalizeAssignmentInputToIdsWithWarnings(
  raw: string | string[] | undefined | null,
  tables: Pick<Table, 'id' | 'name'>[]
): { idCsv: string; warnings: string[] } {
  if (!raw) return { idCsv: '', warnings: [] };

  const nameToId = new Map<string, number>();
  for (const t of tables) {
    if (t?.name && typeof t.name === 'string') {
      nameToId.set(t.name.trim().toLowerCase(), t.id);
    }
  }

  const resolved = new Set<number>();
  const warnings: string[] = [];
  const tokens = (Array.isArray(raw) ? raw.join(',') : String(raw))
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  for (const tok of tokens) {
    const n = parseInt(tok, 10);
    if (Number.isFinite(n) && n > 0) {
      if (tables.some(t => t.id === n)) resolved.add(n);
      else warnings.push(`Unknown table ID: ${tok}`);
      continue;
    }
    const byName = nameToId.get(tok.toLowerCase());
    if (typeof byName === 'number') resolved.add(byName);
    else warnings.push(`Unknown table name: ${tok}`);
  }

  return { idCsv: Array.from(resolved).join(','), warnings };
}

/** Normalize assignments object to array-of-string-IDs shape for engine. */
export function normalizeAssignmentsToArrayShape(
  input: Record<string, string | string[] | undefined>
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [gid, v] of Object.entries(input || {})) {
    if (!v) continue;
    out[gid] = parseAssignmentIds(v);
  }
  return out;
}

/** If your assignments were keyed by names, migrate to ID keys safely. */
export function migrateAssignmentsToIdKeys(
  assignments: Record<string, string>,
  guests: { id: string; name: string }[]
): Record<string, string> {
  const nameToId = new Map(guests.map(g => [String(g.name || '').toLowerCase(), g.id]));
  const migrated: Record<string, string> = {};
  for (const [key, value] of Object.entries(assignments || {})) {
    const id = nameToId.get(String(key).toLowerCase()) || key;
    if (guests.some(g => g.id === id)) migrated[id] = value;
  }
  return migrated;
}