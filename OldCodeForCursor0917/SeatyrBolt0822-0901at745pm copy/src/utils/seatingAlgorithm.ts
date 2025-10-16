import { Guest, Table, SeatingPlan, ConstraintConflict } from '../types';

// Add missing types
interface AtomicGroup {
  units: Guest[];
  totalCount: number;
  priority: number;
}

// ---------- CAPACITY ENFORCEMENT FUNCTIONS (Batch 1) ----------
type TablePlan = { id: number; name?: string; capacity: number; seats: string[] };

const DEFAULT_TABLE_CAPACITY = 8; // keep or unify if defined elsewhere

function makeRemainingCapacity(tables: TablePlan[]): Map<number, number> {
  const m = new Map<number, number>();
  for (const t of tables) m.set(t.id, t.capacity);
  return m;
}

function pickTableFirstFit(
  candidateTableIds: number[],
  remaining: Map<number, number>,
  needed: number
): number | null {
  for (const id of candidateTableIds) {
    const left = remaining.get(id) ?? 0;
    if (left >= needed) return id;
  }
  return null;
}

function appendSeats(planTables: Map<number, TablePlan>, tableId: number, guestName: string) {
  const t = planTables.get(tableId);
  if (!t) return;
  t.seats.push(guestName);
}

function normalizeEmittedTables(planTables: Map<number, TablePlan>): TablePlan[] {
  const out = Array.from(planTables.values());
  out.sort((a, b) => a.id - b.id);
  return out;
}

function resolveTableTokenToId(
  token: string,
  tables: { id: number; name?: string }[]
): number | null {
  const tok = token.trim();
  const n = Number(tok);
  if (!Number.isNaN(n)) return tables.find(t => t.id === n) ? n : null;
  const found = tables.find(t => (t.name || '').toLowerCase() === tok.toLowerCase());
  return found ? found.id : null;
}

// Simple Union-Find implementation
class OptimizedUnionFind {
  private parent: Map<string, string> = new Map();
  private rank: Map<string, number> = new Map();

  find(key: string): string {
    if (!this.parent.has(key)) {
      this.parent.set(key, key);
      this.rank.set(key, 0);
    }
    if (this.parent.get(key) !== key) {
      this.parent.set(key, this.find(this.parent.get(key)!));
    }
    return this.parent.get(key)!;
  }

  union(key1: string, key2: string): boolean {
    const root1 = this.find(key1);
    const root2 = this.find(key2);
    if (root1 === root2) return false;

    const rank1 = this.rank.get(root1) || 0;
    const rank2 = this.rank.get(root2) || 0;

    if (rank1 < rank2) {
      this.parent.set(root1, root2);
    } else if (rank1 > rank2) {
      this.parent.set(root2, root1);
    } else {
      this.parent.set(root2, root1);
      this.rank.set(root1, rank1 + 1);
    }
    return true;
  }

  getGroups(): string[][] {
    const groups = new Map<string, string[]>();
    for (const key of this.parent.keys()) {
      const root = this.find(key);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root)!.push(key);
    }
    return Array.from(groups.values());
  }
}

// ---------- MUST groups: capacity-only (no "circular" spam) ----------
type _Guest = { name: string; count: number };
type _Table = { id: number; seats: number; name?: string };
type _Constraint = 'must' | 'cannot' | '';

type _Conflict =
  | { type: 'must_group_capacity_violation'; group: string[]; seats: number; maxTableCapacity: number }
  | { type: 'cannot_violation'; pair: [string, string] }
  | { type: 'adjacency_degree_violation'; guest: string; degree: number }
  | { type: 'adjacency_closed_loop'; chain: string[] }
  | { type: 'adjacency_capacity_violation'; chain: string[]; seats: number; minTableCapacity: number };

export function detectMustGroupConflicts(
  guests: _Guest[],
  tables: _Table[],
  constraints: Record<string, Record<string, _Constraint>>,
): _Conflict[] {
  const conflicts: _Conflict[] = [];
  if (!tables.length) return conflicts;

  const names = guests.map(g => g.name);
  const idx = new Map(names.map((n, i) => [n, i]));
  const parent = names.map((_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const unite = (a: number, b: number) => { a = find(a); b = find(b); if (a !== b) parent[b] = a; };

  // Build undirected components for MUST relations; skip self edges
  for (const [a, row] of Object.entries(constraints)) {
    for (const [b, rel] of Object.entries(row || {})) {
      if (rel !== 'must') continue;
      if (!idx.has(a) || !idx.has(b)) continue;
      if (a === b) continue;
      unite(idx.get(a)!, idx.get(b)!);
    }
  }

  // Bucket by component root
  const buckets = new Map<number, string[]>();
  for (const n of names) {
    const r = find(idx.get(n)!);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(n);
  }

  // Flag only when group > largest table
  const countOf = new Map(guests.map(g => [g.name, g.count ?? 1]));
  const maxTableCap = Math.max(...tables.map(t => t.seats));
  for (const group of buckets.values()) {
    const hasMustEdge = group.some(a => group.some(b => a !== b && constraints[a]?.[b] === 'must'));
    if (!hasMustEdge) continue;
    const seats = group.reduce((s, n) => s + (countOf.get(n) ?? 1), 0);
    if (seats > maxTableCap) {
      conflicts.push({ type: 'must_group_capacity_violation', group: [...group].sort(), seats, maxTableCapacity: maxTableCap });
    }
  }
  return conflicts;
}

// ---------- Adjacency validator: degree cap, endpoints, smallest table ----------
export function detectAdjacentPairingConflicts(
  guests: _Guest[],
  tables: _Table[],
  adjacents: Record<string, string[]>,
): _Conflict[] {
  const conflicts: _Conflict[] = [];
  if (!tables.length) return conflicts;

  const minCap = Math.min(...tables.map(t => t.seats));
  const present = new Set(guests.map(g => g.name));
  const countBy = new Map(guests.map(g => [g.name, g.count ?? 1]));

  // Build restricted undirected graph on present guests
  const G = new Map<string, Set<string>>();
  for (const n of present) G.set(n, new Set());
  for (const [a, list] of Object.entries(adjacents)) {
    if (!present.has(a)) continue;
    for (const b of list || []) {
      if (!present.has(b) || a === b) continue;
      G.get(a)!.add(b);
      G.get(b)!.add(a);
    }
  }

  // Degree cap (collect; do not short-circuit)
  for (const [n, nbrs] of G.entries()) {
    if (nbrs.size > 2) conflicts.push({ type: 'adjacency_degree_violation', guest: n, degree: nbrs.size });
  }

  // Components
  const seen = new Set<string>();
  for (const s of G.keys()) {
    if (seen.has(s)) continue;
    const comp: string[] = [];
    const stack = [s];
    let hasEdge = G.get(s)!.size > 0;
    seen.add(s);

    while (stack.length) {
      const v = stack.pop()!;
      comp.push(v);
      for (const w of G.get(v) || []) {
        if (!seen.has(w)) { seen.add(w); stack.push(w); hasEdge = true; }
      }
    }
    if (!hasEdge) continue; // isolated node has no adjacency

    const seats = comp.reduce((sum, n) => sum + (countBy.get(n) ?? 1), 0);

    if (comp.length === 2) {
      // Axiom: not a loop; only capacity gate vs smallest table
      if (seats > minCap) {
        conflicts.push({ type: 'adjacency_capacity_violation', chain: [...comp].sort(), seats, minTableCapacity: minCap });
      }
      continue;
    }

    // 3+ chain: capacity + endpoints
    if (seats > minCap) {
      conflicts.push({ type: 'adjacency_capacity_violation', chain: [...comp].sort(), seats, minTableCapacity: minCap });
    }
    const endpoints = comp.filter(n => (G.get(n)!.size === 1)).length;
    const maxDeg = Math.max(...comp.map(n => G.get(n)!.size));
    if (maxDeg <= 2 && endpoints < 2) {
      conflicts.push({ type: 'adjacency_closed_loop', chain: [...comp].sort() });
    }
  }

  return conflicts;
}

// ---------- Seat ordering: build simple paths from endpoints ----------
export function orderByAdjacencyEndpoints(
  units: _Guest[],
  adjacents: Record<string, string[]>
): _Guest[] {
  const present = new Set(units.map(u => u.name));
  const nameTo = new Map(units.map(u => [u.name, u]));
  const G = new Map<string, Set<string>>();
  for (const n of present) G.set(n, new Set());
  for (const [a, list] of Object.entries(adjacents)) {
    if (!present.has(a)) continue;
    for (const b of list || []) if (present.has(b) && a !== b) {
      G.get(a)!.add(b); G.get(b)!.add(a);
    }
  }

  const used = new Set<string>();
  const ordered: _Guest[] = [];
  const seen = new Set<string>();

  for (const start of present) {
    if (seen.has(start)) continue;
    const stack = [start]; seen.add(start);
    const comp: string[] = []; let hasEdge = G.get(start)!.size > 0;
    while (stack.length) {
      const v = stack.pop()!; comp.push(v);
      for (const w of G.get(v) || []) if (!seen.has(w)) { seen.add(w); stack.push(w); hasEdge = true; }
    }
    if (!hasEdge) continue;

    // Pick endpoint if exists; else arbitrary node
    const deg = (n: string) => (G.get(n) || new Set()).size;
    let cur: string | null = comp.find(n => deg(n) === 1) || comp[0] || null;

    const path: string[] = [];
    const visited = new Set<string>();
    let prev: string | null = null;

    while (cur && !visited.has(cur)) {
      path.push(cur); visited.add(cur);
      const nbrs = [...(G.get(cur) || new Set())].filter(x => !visited.has(x));
      let next: string | null = null;
      if (prev) next = nbrs.find(x => x !== prev) || null;
      if (!next) next = nbrs[0] || null;
      prev = cur; cur = next;
    }

    for (const n of path) if (!used.has(n)) { used.add(n); const u = nameTo.get(n); if (u) ordered.push(u); }
  }

  // Append unconstrained units in original order
  for (const u of units) if (!used.has(u.name)) ordered.push(u);
  return ordered;
}

// ---------- Neighbor-true adjacency scoring (block-aware) ----------
export function scoreAdjacencyNeighbors(
  plan: { tables: { id: number; seats: _Guest[] }[] },
  adjacents: Record<string, string[]>
): number {
  let satisfied = 0;
  for (const table of plan.tables) {
    const order = table.seats;
    const n = order.length; if (!n) continue;
    for (let i = 0; i < n; i++) {
      const U = order[i], L = order[(i - 1 + n) % n], R = order[(i + 1) % n];
      const want = new Set(adjacents[U.name] || []);
      if (want.has(L.name)) satisfied++;
      if (want.has(R.name)) satisfied++;
    }
  }
  return Math.floor(satisfied / 2); // each satisfied pair counted twice
}

// Enhanced conflict detection using the new superior logic
export function detectConstraintConflicts(
  guests: Guest[],
  constraints: Record<string, Record<string, 'must' | 'cannot' | ''>>,
  tables: Table[],
  checkAdjacents: boolean = false,
  adjacents: Record<string, string[]> = {}
): ConstraintConflict[] {
  const conflicts: ConstraintConflict[] = [];
  if (guests.length === 0 || tables.length === 0) return [];

  // Validate input data
  if (!constraints || typeof constraints !== 'object') {
    console.warn('Invalid constraints object provided to detectConstraintConflicts');
    return [];
  }

  // 1) MUST groups: capacity-only (no more "circular dependency" spam)
  const mustConflicts = detectMustGroupConflicts(guests as _Guest[], tables as _Table[], constraints);
  for (const conflict of mustConflicts) {
    if (conflict.type === 'must_group_capacity_violation') {
      conflicts.push({
        id: `must-capacity-${Date.now()}-${Math.random()}`,
        type: 'capacity_violation',
        severity: 'high',
        description: `Must-sit group too large: ${conflict.group.join(', ')} need ${conflict.seats} seats; largest table is ${conflict.maxTableCapacity}.`,
        affectedGuests: conflict.group,
      });
    }
  }

  // 2) CANNOT violations (keep existing logic)
  const checkedPairs = new Set<string>();
  for (const [guest1, guestConstraints] of Object.entries(constraints)) {
    for (const [guest2, constraint1] of Object.entries(guestConstraints)) {
      const pairKey = [guest1, guest2].sort().join('--');
      if (checkedPairs.has(pairKey)) continue;

      const reverseConstraint = constraints[guest2]?.[guest1];
      if ((constraint1 === 'must' && reverseConstraint === 'cannot') || 
          (constraint1 === 'cannot' && reverseConstraint === 'must')) {
        conflicts.push({
          id: `contradictory-${Date.now()}-${Math.random()}`,
          type: 'impossible',
          severity: 'high',
          description: `Contradictory constraints between ${guest1} and ${guest2}`,
          affectedGuests: [guest1, guest2],
        });
      }
      checkedPairs.add(pairKey);
    }
  }

  // 3) ADJACENCY (degree + endpoints + smallest table capacity)
  if (checkAdjacents && adjacents && Object.keys(adjacents).length > 0) {
    const adjConflicts = detectAdjacentPairingConflicts(guests as _Guest[], tables as _Table[], adjacents);
    for (const conflict of adjConflicts) {
      if (conflict.type === 'adjacency_capacity_violation') {
        conflicts.push({
          id: `adj-capacity-${Date.now()}-${Math.random()}`,
          type: 'capacity_violation',
          severity: 'high',
          description: `Adjacent-pairing chain won't fit the smallest table: ${conflict.chain.join(', ')} total ${conflict.seats} > smallest ${conflict.minTableCapacity}.`,
          affectedGuests: conflict.chain,
        });
      } else if (conflict.type === 'adjacency_closed_loop') {
        conflicts.push({
          id: `adj-loop-${Date.now()}-${Math.random()}`,
          type: 'circular',
          severity: 'high',
          description: `Adjacent-pairing forms a closed loop: pick two ends (or remove a link) so the chain has endpoints.`,
          affectedGuests: conflict.chain,
        });
      } else if (conflict.type === 'adjacency_degree_violation') {
        conflicts.push({
          id: `adj-degree-${Date.now()}-${Math.random()}`,
          type: 'impossible',
          severity: 'critical',
          description: `Too many neighbors: ${conflict.guest} has ${conflict.degree}; max is 2.`,
          affectedGuests: [conflict.guest],
        });
      }
    }
  }

  return conflicts;
}

// Build atomic groups that must sit together (including implicit adjacency groups)
function buildAtomicGroups(
  guests: Guest[],
  constraints: Record<string, Record<string, 'must' | 'cannot' | ''>>,
  adjacents: Record<string, string[]>
): AtomicGroup[] {
  const uf = new OptimizedUnionFind();
  const guestMap = new Map(guests.map(g => [g.name, g]));
  guests.forEach(g => uf.find(g.name));

  // Union guests that must sit together (explicit must constraints)
  for (const [key1, guestConstraints] of Object.entries(constraints)) {
    for (const [key2, constraint] of Object.entries(guestConstraints)) {
      if (constraint === 'must') uf.union(key1, key2);
    }
  }

  // Union guests that must be adjacent (implicit must - adjacency implies co-table)
  for (const [a, list] of Object.entries(adjacents)) {
    for (const b of list || []) {
      if (a === b) continue;
      if (guestMap.has(a) && guestMap.has(b)) {
        uf.union(a, b);
      }
    }
  }

  return uf.getGroups().map((groupNames: string[]) => {
    const units = groupNames.map((name: string) => guestMap.get(name)).filter((g): g is Guest => !!g);
    const totalCount = units.reduce((sum, u) => sum + u.count, 0);
    const priority = units.some(u => /bride|groom/i.test(u.name)) ? 25 : 0;
    return { units, totalCount, priority };
  });
}

export function generateSinglePlan(
  guests: Guest[],
  tables: Table[],
  constraints: Record<string, Record<string, 'must' | 'cannot' | ''>>,
  adjacents: Record<string, string[]>,
  assignments: Record<string, string>
): SeatingPlan | null {
  if (guests.length === 0 || tables.length === 0) return null;
  
  const initialTables = tables.map(t => ({ id: t.id, name: t.name, capacity: t.seats }));
  const planTables = new Map<number, TablePlan>();
  for (const t of initialTables) planTables.set(t.id, { ...t, seats: [] });

  const remaining = makeRemainingCapacity(Array.from(planTables.values()));

  // 1) Pre-seat explicit assignments (id or name), capacity-checked
  const assignedGuests = new Set<string>();
  const assignmentMap = assignments || {};
  for (const [guestLabel, raw] of Object.entries(assignmentMap)) {
    if (!raw) continue;
    const party = guests.find(g => g.name === guestLabel);
    const partyCount = Math.max(1, party?.count ?? 1);
    const toks = String(raw).split(',').map(s => s.trim()).filter(Boolean);
    const candidateIds: number[] = [];
    for (const tok of toks) {
      const id = resolveTableTokenToId(tok, initialTables);
      if (id != null && !candidateIds.includes(id)) candidateIds.push(id);
    }
    const chosenId = pickTableFirstFit(candidateIds, remaining, partyCount);
    if (chosenId != null) {
      // Add the guest to the table
      const table = planTables.get(chosenId);
      if (table) {
        for (let i = 0; i < partyCount; i++) {
          table.seats.push(guestLabel);
        }
      }
      remaining.set(chosenId, (remaining.get(chosenId) ?? 0) - partyCount);
      assignedGuests.add(guestLabel);
    }
  }

  // 2) Place remaining guests, capacity-checked
  const unassigned = guests.filter(g => !assignedGuests.has(g.name));
  const allTableIds = Array.from(planTables.keys()); // keep your heuristic if you have one
  for (const g of unassigned) {
    const count = Math.max(1, g.count ?? 1);
    const chosenId = pickTableFirstFit(allTableIds, remaining, count);
    if (chosenId != null) {
      // Add the guest to the table
      const table = planTables.get(chosenId);
      if (table) {
        for (let i = 0; i < count; i++) {
          table.seats.push(g.name);
        }
      }
      remaining.set(chosenId, (remaining.get(chosenId) ?? 0) - count);
    } else {
      // optional: collect unplaced
    }
  }

  // Convert internal TablePlan to expected TableAssignment format
  const convertedTables = normalizeEmittedTables(planTables).map(t => ({
    id: t.id,
    capacity: t.capacity,
    seats: t.seats.map(name => ({ name, count: 1 }))
  }));
  
  return { id: Date.now(), tables: convertedTables };
}

// Generate multiple seating plans using different strategies
export async function generateSeatingPlans(
  guests: Guest[],
  tables: Table[],
  constraints: Record<string, Record<string, 'must' | 'cannot' | ''>>,
  adjacents: Record<string, string[]>,
  assignments: Record<string, string>,
  isPremium: boolean = false
): Promise<{ plans: SeatingPlan[], errors: any[] }> {
  // For now, generate a single plan using the new logic
  const plan = generateSinglePlan(guests, tables, constraints, adjacents, assignments);
  
  if (!plan) {
    return { 
      plans: [], 
      errors: [
        {
          message: 'No valid seating plans could be generated. Try relaxing constraints or reducing adjacency links.',
          type: 'error'
        }
      ]
    };
  }
  
  return { plans: [plan], errors: [] };
}