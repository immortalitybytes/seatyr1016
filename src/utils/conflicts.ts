import { parseAssignmentIds } from './assignments';
import { getCapacity } from './tables';

function shareAnyTable(csvA?: string, csvB?: string): boolean {
  const setA = new Set(parseAssignmentIds(csvA || ''));
  return parseAssignmentIds(csvB || '').some(id => setA.has(id));
}

// Union-Find to build must-groups
class DSU {
  parent: Record<string, string> = {};
  find(x: string): string {
    if (!this.parent[x]) this.parent[x] = x;
    if (this.parent[x] !== x) this.parent[x] = this.find(this.parent[x]);
    return this.parent[x];
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent[rb] = ra;
  }
}

type DetectParams = {
  guests: Record<string, { partySize?: number; name?: string }>;
  tables: Array<{ id: number | string; capacity?: number }>;
  assignments: Record<string, string | undefined>;
  constraints: {
    mustPairs: () => Iterable<[string, string]>;
  };
};

// Only flag *provably impossible* groups
export function detectUnsatisfiableMustGroups(params: DetectParams): string[] {
  const { guests, tables, assignments, constraints } = params;

  // a) Build DSU over all guests that appear anywhere (must edges or assignments)
  const dsu = new DSU();
  const seen = new Set<string>();

  // Include everyone who has an assignment entry
  Object.keys(assignments).forEach(g => { seen.add(g); dsu.find(g); });

  // Include everyone that appears in must edges
  for (const [a, b] of constraints.mustPairs()) {
    seen.add(a); seen.add(b);
    dsu.union(a, b);
  }

  // b) Group members by root
  const groups: Record<string, string[]> = {};
  for (const g of seen) {
    const r = dsu.find(g);
    (groups[r] ||= []).push(g);
  }

  // c) Precompute tables and capacities with normalized IDs
  const tableCapById = new Map<number, number | undefined>();
  for (const t of tables) {
    const idNum = typeof t.id === "string" ? Number(t.id) : t.id;
    if (Number.isFinite(idNum)) {
      tableCapById.set(idNum as number, getCapacity(t));
    }
  }
  const allTableIds = [...tableCapById.keys()];
  const maxKnownCapacity =
    allTableIds.reduce((m, id) => {
      const c = tableCapById.get(id);
      return (typeof c === 'number' && c > m) ? c : m;
    }, 0) || undefined;

  // Debug logs for validator race fix (remove post-fix)
  console.log('Tables passed to validator:', tables.map(t => ({id: t.id, cap: getCapacity(t)})));
  console.log('tableCapById contents:', Array.from(tableCapById.entries()));

  // d) Evaluate each group
  const messages: string[] = [];
  for (const group of Object.values(groups)) {
    // Sum group size
    const groupSize = group.reduce((sum, gid) => {
      const ps = guests[gid]?.partySize ?? 1;
      return sum + (Number.isFinite(ps) ? (ps as number) : 1);
    }, 0);

    // Union of *hard* assigned tables across the whole group with normalized IDs
    const hardTables = new Set<number>();
    for (const gid of group) {
      for (const idStr of parseAssignmentIds(assignments[gid] || '')) {
        const idNum = Number(idStr);
        if (Number.isFinite(idNum)) hardTables.add(idNum);
      }
    }

    // Debug logs for assignment parsing (remove post-fix)
    console.log('Assignment IDs for group:', group.map(gid => ({gid, assigns: assignments[gid], parsed: parseAssignmentIds(assignments[gid] || '')})));

    // Impossible Case #1: Conflicting hard locks to different tables
    if (hardTables.size > 1) {
      // Multiple distinct hard-locked tables inside one must-group ⇒ impossible under any plan
      const names = group.map(gid => guests[gid]?.name || gid).join(", ");
      messages.push(`Must-group conflict: ${names} have conflicting hard table locks (${[...hardTables].join(", ")})`);
      continue;
    }

    // Determine candidate tables for this group with number comparison:
    // - If there is exactly one hard-locked table, that's the only candidate
    // - If no hard lock, candidates = all tables
    const candidates = (hardTables.size === 1)
      ? Array.from(hardTables)
      : Array.from(tableCapById.keys());  // All table IDs as numbers

    // If we have no table data at all, we cannot prove impossibility. Skip warning.
    if (candidates.length === 0) continue;

    // Impossible Case #2: Group bigger than every candidate table's known capacity
    // If any candidate has unknown capacity, we conservatively assume it *might* fit → no warning.
    const anyCandidateFits = candidates.some(id => {
      const cap = tableCapById.get(id);
      return (typeof cap !== 'number') || cap >= groupSize;
    });

    // Debug log for candidate fitting check (remove post-fix)
    console.log(`Group size: ${groupSize}, Candidates: ${candidates}, anyCandidateFits: ${anyCandidateFits}`);

    if (!anyCandidateFits) {
      const names = group.map(gid => guests[gid]?.name || gid).join(", ");
      const single = hardTables.size === 1 ? ` (locked to table ${candidates[0]})` : "";
      messages.push(`Must-group too large: ${names}${single} requires ${groupSize} seats but no candidate table has capacity.`);
      continue;
    }

    // Otherwise: not *provably* impossible → do not warn.
  }

  return messages;
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

