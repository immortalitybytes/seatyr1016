import { parseAssignmentIds } from './assignments';

function shareAnyTable(csvA?: string, csvB?: string): boolean {
  const setA = new Set(parseAssignmentIds(csvA || ''));
  return parseAssignmentIds(csvB || '').some(id => setA.has(id));
}

export function detectConflicts(
  assignments: Record<string, string>,
  constraints: Record<string, Record<string, 'must' | 'cannot' | ''>>
): string[] {
  const warnings = new Set<string>();
  for (const [a, row] of Object.entries(constraints || {})) {
    for (const [b, val] of Object.entries(row || {})) {
      if (!val || a === b) continue;
      const [x, y] = a < b ? [a, b] : [b, a]; // Stable order
      if (val === 'must' && !shareAnyTable(assignments[x], assignments[y])) {
        warnings.add(`Must-sit violated: ${x} & ${y}`);
      }
      if (val === 'cannot' && shareAnyTable(assignments[x], assignments[y])) {
        warnings.add(`Cannot-sit violated: ${x} & ${y}`);
      }
    }
  }
  return Array.from(warnings);
}

