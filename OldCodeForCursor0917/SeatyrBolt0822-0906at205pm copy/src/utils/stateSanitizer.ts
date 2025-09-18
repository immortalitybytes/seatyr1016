// src/utils/stateSanitizer.ts
// Non-destructive phantom-key pruning + normalized duplicate-name reporting.
// Safe to call anywhere; DOES NOT rewrite keys inside app state.

export type ConstraintValue = 'must' | 'cannot' | '';

// Normalize helpers shared across features (sorting, migration, sanitization)
export const norm = (s: string) => (s || '').normalize('NFC').trim();
export const squash = (s: string) => norm(s).replace(/\s+/g, ' ');

export interface SanitizationReport {
  removedConstraints: number;
  removedAdjacents: number;
  removedAssignments: number;
  phantomKeys: string[];
  duplicateNames: string[]; // normalized duplicates
}

export function sanitizeState(
  guests: Array<{ id: string; name: string }>,
  constraints: Record<string, Record<string, ConstraintValue | any>> | undefined,
  adjacents: Record<string, any> | undefined,
  assignments: Record<string, string> | undefined
): {
  constraints: Record<string, Record<string, ConstraintValue>>;
  adjacents: Record<string, string[]>;
  assignments: Record<string, string>;
  report: SanitizationReport;
} {
  const nameCounts = new Map<string, number>();
  guests.forEach(g => nameCounts.set(squash(g.name), (nameCounts.get(squash(g.name)) || 0) + 1));
  const duplicates = Array.from(nameCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([name]) => name);

  const valid = new Set<string>([
    ...guests.map(g => g.id),
    ...guests.map(g => g.name),
  ]);

  const report: SanitizationReport = {
    removedConstraints: 0,
    removedAdjacents: 0,
    removedAssignments: 0,
    phantomKeys: [],
    duplicateNames: duplicates,
  };

  // Clean constraints – remove phantom outer/inner keys, keep only valid values
  const cleanConstraints: Record<string, Record<string, ConstraintValue>> = {};
  for (const [k1, row] of Object.entries(constraints || {})) {
    if (!valid.has(k1)) { report.phantomKeys.push(k1); report.removedConstraints++; continue; }
    const outRow: Record<string, ConstraintValue> = {};
    for (const [k2, v] of Object.entries(row || {})) {
      if (!valid.has(k2) || k1 === k2) { report.removedConstraints++; continue; }
      if (v === 'must' || v === 'cannot' || v === '') outRow[k2] = v as ConstraintValue;
    }
    if (Object.keys(outRow).length) cleanConstraints[k1] = outRow;
  }

  // Clean adjacents – accept array or object; enforce symmetry and degree ≤ 2
  const acc: Record<string, Set<string>> = {};
  for (const [ka, vv] of Object.entries(adjacents || {})) {
    if (!valid.has(ka)) { report.removedAdjacents++; continue; }
    const partners: string[] = Array.isArray(vv) ? vv : Object.keys(vv || {});
    for (const kb of partners) {
      if (!valid.has(kb) || ka === kb) { report.removedAdjacents++; continue; }
      (acc[ka] ||= new Set()).add(kb);
      (acc[kb] ||= new Set()).add(ka);
    }
  }
  const cleanAdjacents: Record<string, string[]> = {};
  for (const [k, set] of Object.entries(acc)) {
    const arr = Array.from(set).slice(0, 2);
    if (arr.length) cleanAdjacents[k] = arr;
  }

  // Clean assignments – prune phantom keys
  const cleanAssignments: Record<string, string> = {};
  for (const [key, value] of Object.entries(assignments || {})) {
    if (valid.has(key)) cleanAssignments[key] = value; else report.removedAssignments++;
  }

  return { constraints: cleanConstraints, adjacents: cleanAdjacents, assignments: cleanAssignments, report };
}
