// src/utils/conflictsSafe.ts
// Dedup wrapper for your existing solver's conflict detection.
// Leaves your solver untouched while guaranteeing unique, well-formed results.

import { detectConstraintConflicts as baseDetect } from './seatingAlgorithm';

type ConstraintVal = 'must' | 'cannot';

export interface ConflictItem {
  id?: string;
  type: string;
  severity?: 'low' | 'medium' | 'high' | 'critical' | string;
  description?: string;
  message?: string;
  affectedGuests: string[]; // names or ids – upstream choice
  [key: string]: any;
}

export function detectConstraintConflictsSafe(
  guests: any[],
  constraints: Record<string, Record<string, ConstraintVal>>,
  tables: any[],
  checkOnly: boolean = true,
  adjacents?: Record<string, string[]>
): ConflictItem[] {
  const raw = baseDetect(guests, constraints, tables, checkOnly, adjacents);
  const list: ConflictItem[] = Array.isArray(raw) ? raw as ConflictItem[] : [];

  const seen = new Set<string>();
  const out: ConflictItem[] = [];

  for (const c of list) {
    const type = c?.type ?? 'generic';
    const affected = Array.isArray(c?.affectedGuests)
      ? Array.from(new Set(c.affectedGuests.filter(Boolean))).sort()
      : [];
    if (affected.length < 2) continue; // no self- or trivial conflicts
    const key = `${type}::${affected.join('|')}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ ...c, affectedGuests: affected });
    }
  }

  return out;
}
