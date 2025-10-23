/*
 * Seatyr — Seating Algorithm ENGINE (stable, best-of-all)
 * Key changes for this handoff:
 *  - Tokenizer updated to /[,\s.]+/ so engine tolerates period/space/comma input.
 */

import { getCapacity } from "./tables";

type ID = string;

export interface GuestUnit {
  id: ID;
  name: string;
  count: number;
}
export interface TableIn {
  id: ID | number;
  name?: string;
  seats?: number;
  capacity?: number;
}
export type ConstraintsMap = Record<string, Record<string, "must" | "cannot" | "">>;
export type AdjRecord = Record<string, string[]>;
export type AssignmentsIn = Record<string, string | string[]>;

export interface PlanSeat {
  name: string;
  partyIndex: number;
}
export interface PlanTableOut {
  tableId: ID;
  seats: PlanSeat[];
}
export interface SeatingPlanOut {
  tables: PlanTableOut[];
  score?: number;
  adjacencySatisfaction?: number;
  capacityUtilization?: number;
  balance?: number;
  seedUsed?: number;
  attemptsUsed?: number;
}

export type ConflictKind =
  | "must_cycle"
  | "adjacency_degree_violation"
  | "adjacency_closed_loop_too_big"
  | "adjacency_closed_loop_not_exact"
  | "assignment_conflict"
  | "cant_within_must_group"
  | "group_too_big_for_any_table"
  | "unknown_guest"
  | "invalid_input_data"
  | "self_reference_ignored";

export interface ValidationError {
  kind: ConflictKind;
  message: string;
  details?: any;
}
export interface GenerateReturn {
  plans: SeatingPlanOut[];
  errors: ValidationError[];
}

class RNG {
  private x: number;
  constructor(seed = 12345) {
    this.x = (seed >>> 0) || 0x9e3779b9;
  }
  nextU32(): number {
    let x = this.x >>> 0;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >> 17;
    x >>>= 0;
    x ^= x << 5;
    x >>>= 0;
    this.x = x;
    return x >>> 0;
  }
  next(): number {
    return (this.nextU32() & 0xffffffff) / 0x1_0000_0000;
  }
  shuffle<T>(arr: T[]): void {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
  }
}

class DSU {
  parent = new Map<ID, ID>();
  rank = new Map<ID, number>();
  find(a: ID): ID {
    const p = this.parent.get(a);
    if (!p || p === a) {
      this.parent.set(a, a);
      this.rank.set(a, this.rank.get(a) ?? 0);
      return a;
    }
    const r = this.find(p);
    this.parent.set(a, r);
    return r;
  }
  union(a: ID, b: ID) {
    if (a === b) return;
    const ra = this.find(a),
      rb = this.find(b);
    if (ra === rb) return;
    const ar = this.rank.get(ra) ?? 0,
      br = this.rank.get(rb) ?? 0;
    if (ar < br) this.parent.set(ra, rb);
    else if (ar > br) this.parent.set(rb, ra);
    else {
      this.parent.set(rb, ra);
      this.rank.set(ra, ar + 1);
    }
  }
}

interface SafeGuest {
  id: ID;
  name: string;
  count: number;
}
interface SafeTable {
  id: ID;
  name?: string;
  capacity: number;
}
interface Pair {
  0: ID;
  1: ID;
}
interface ConstraintsPairs {
  mustPairs: Pair[];
  cantPairs: Pair[];
}
interface AdjacencyPairs {
  pairs: Pair[];
}
interface GroupInfo {
  root: ID;
  members: ID[];
  size: number;
  cantNeighbors: Set<ID>;
  adjacencyDegree: number;
  preassignedTable?: ID;
  allowedTables?: Set<ID>;
}
interface ValidateCtx {
  idToGuest: Map<ID, SafeGuest>;
  idToTable: Map<ID, SafeTable>;
}
interface TableState {
  table: SafeTable;
  remaining: number;
  occupants: ID[];
}
interface PlacementState {
  placed: Map<ID, ID>;
  tables: TableState[];
}

function normalizeGuests(
  rawGuests: GuestUnit[],
): { guests: SafeGuest[]; errors: ValidationError[] } {
  const guests: SafeGuest[] = [];
  const errors: ValidationError[] = [];
  const ids = new Set<ID>();
  for (const g of rawGuests || []) {
    try {
      const id = String(g?.id ?? "").trim();
      if (!id) {
        errors.push({
          kind: "invalid_input_data",
          message: "Guest missing or invalid id",
          details: { guest: g },
        });
        continue;
      }
      if (ids.has(id)) {
        errors.push({
          kind: "invalid_input_data",
          message: `Duplicate guest id: ${id}`,
          details: { guest: g },
        });
        continue;
      }
      const name = String(g?.name ?? "").trim() || `Guest ${id}`;
      const count = Math.max(1, Math.floor(Number(g?.count) || 1));
      guests.push({ id, name, count });
      ids.add(id);
    } catch (e) {
      errors.push({
        kind: "invalid_input_data",
        message: "Failed to parse guest",
        details: { guest: g, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return { guests, errors };
}

function normalizeTables(
  rawTables: TableIn[],
): { tables: SafeTable[]; errors: ValidationError[] } {
  const tables: SafeTable[] = [];
  const errors: ValidationError[] = [];
  const ids = new Set<ID>();
  for (const t of rawTables || []) {
    try {
      const id = String(t?.id ?? "").trim();
      if (!id) {
        errors.push({
          kind: "invalid_input_data",
          message: "Table missing or invalid id",
          details: { table: t },
        });
        continue;
      }
      if (ids.has(id)) {
        errors.push({
          kind: "invalid_input_data",
          message: `Duplicate table id: ${id}`,
          details: { table: t },
        });
        continue;
      }
      const name = String(t?.name ?? "").trim() || `Table ${id}`;
      const capacity = Math.max(1, Math.floor(Number(t?.capacity ?? t?.seats) || 1));
      tables.push({ id, name, capacity });
      ids.add(id);
    } catch (e) {
      errors.push({
        kind: "invalid_input_data",
        message: "Failed to parse table",
        details: { table: t, error: e instanceof Error ? e.message : String(e) },
      });
    }
  }
  return { tables, errors };
}

function dedupUndirected(pairs: Pair[]): Pair[] {
  const s = new Set<string>();
  const out: Pair[] = [];
  for (const [a, b] of pairs) {
    const A = String(a),
      B = String(b);
    const k = A < B ? `${A}|${B}` : `${B}|${A}`;
    if (!s.has(k)) {
      s.add(k);
      out.push([A, B]);
    }
  }
  return out;
}

function toPairsFromConstraints(map: ConstraintsMap | undefined): ConstraintsPairs {
  const must: Pair[] = [];
  const cant: Pair[] = [];
  if (!map) return { mustPairs: must, cantPairs: cant };
  for (const a of Object.keys(map)) {
    const row = map[a] || {};
    for (const b of Object.keys(row)) {
      const v = row[b];
      if (a === b) continue;
      if (v === "must") must.push([String(a), String(b)]);
      else if (v === "cannot") cant.push([String(a), String(b)]);
    }
  }
  return { mustPairs: dedupUndirected(must), cantPairs: dedupUndirected(cant) };
}

function toPairsFromAdj(adjs: AdjRecord | undefined): AdjacencyPairs {
  const pairs: Pair[] = [];
  if (adjs)
    for (const a of Object.keys(adjs))
      for (const b of adjs[a] || []) if (a !== b) pairs.push([String(a), String(b)]);
  return { pairs: dedupUndirected(pairs) };
}

function buildUndirectedMap(pairs: Pair[]): Map<ID, Set<ID>> {
  const m = new Map<ID, Set<ID>>();
  for (const [a, b] of pairs) {
    if (a === b) continue;
    if (!m.has(a)) m.set(a, new Set());
    if (!m.has(b)) m.set(b, new Set());
    m.get(a)!.add(b);
    m.get(b)!.add(a);
  }
  return m;
}
function deg(map: Map<ID, Set<ID>>, id: ID): number {
  return map.get(id)?.size ?? 0;
}

function checkAdjacencyCyclesUndirected(
  adjMap: Map<ID, Set<ID>>,
  idToGuest: Map<ID, GuestUnit>,
  capacities: number[],
  maxCap: number,
): ValidationError[] {
  const errors: ValidationError[] = [];
  const visited = new Set<ID>();
  const nodes = Array.from(adjMap.keys());
  for (const startNode of nodes) {
    if (visited.has(startNode)) continue;
    const component: ID[] = [];
    const q: ID[] = [startNode];
    visited.add(startNode);
    let head = 0;
    while (head < q.length) {
      const u = q[head++];
      component.push(u);
      for (const v of adjMap.get(u) || []) {
        if (!visited.has(v)) {
          visited.add(v);
          q.push(v);
        }
      }
    }
    if (component.length <= 2) continue;
    const isSimpleCycle = component.every((n) => deg(adjMap, n) === 2);
    if (!isSimpleCycle) continue;

    const seats = component.reduce((sum, gid) => sum + (idToGuest.get(gid)?.count ?? 1), 0);

    if (seats > maxCap) {
      errors.push({
        kind: "adjacency_closed_loop_too_big",
        message: `A closed adjacency loop requires ${seats} seats, but the largest table only has ${maxCap}.`,
        details: { ids: component, seats, capacities },
      });
    } else if (!capacities.some((c) => c === seats)) {
      errors.push({
        kind: "adjacency_closed_loop_not_exact",
        message: `A closed adjacency loop requires ${seats} seats, but no table has exactly ${seats} seats.`,
        details: { ids: component, seats, capacities },
      });
    }
  }
  return errors;
}

function validateAndGroup(
  guests: GuestUnit[],
  tables: TableIn[],
  constr: ConstraintsPairs,
  adj: AdjacencyPairs,
  assignments: AssignmentsIn,
): {
  groups: any[];
  errors: ValidationError[];
  ctx: { idToGuest: Map<ID, GuestUnit>; idToTable: Map<ID, TableIn> };
  cantMap: Map<ID, Set<ID>>;
  adjMap: Map<ID, Set<ID>>;
} {
  const errors: ValidationError[] = [];
  const idToGuest = new Map<ID, GuestUnit>(guests.map((g) => [String(g.id), g]));
  const idToTable = new Map<ID, TableIn>(tables.map((t) => [String(t.id), t as any]));
  const cantMap = buildUndirectedMap(constr?.cantPairs || []);
  const adjMap = buildUndirectedMap(adj?.pairs || []);

  const dsu = new DSU();
  for (const g of guests) dsu.find(String(g.id));
  for (const [a, b] of constr?.mustPairs || []) dsu.union(a, b);
  for (const [a, b] of adj?.pairs || []) dsu.union(a, b);

  // DIAGNOSTIC: Input summary
  console.group('[Algorithm Start]');
  console.log('Total guests:', guests.length, 'Total people:', guests.reduce((sum, g) => sum + (g.groupSize || 0), 0));
  console.log('Tables:', tables.map(t => `${t.id}:${getCapacity(t)}seats`).join(', '));
  console.log('Total capacity:', tables.reduce((sum, t) => sum + getCapacity(t), 0));
  console.log('isPremium:', isPremium);
  console.log('MUST pairs:', constr?.mustPairs?.length || 0);
  console.log('ADJ pairs:', adj?.pairs?.length || 0);
  
  // DIAGNOSTIC: Check guest structure
  if (guests.length > 0) {
    console.log('First guest structure:', JSON.stringify(guests[0]));
    console.log('Guest groupSize values:', guests.map(g => `${g.name || g.id}: ${g.groupSize || 'undefined'}`).slice(0, 5));
  }
  console.groupEnd();

  const byRoot = new Map<ID, { root: ID; members: ID[]; size: number; adjacencyDegree: number; cantNeighbors: Set<ID>; preassignedTable?: ID; allowedTables?: Set<ID> }>();

  for (const g of guests) {
    const r = dsu.find(String(g.id));
    if (!byRoot.has(r)) byRoot.set(r, { root: r, members: [], size: 0, adjacencyDegree: 0, cantNeighbors: new Set() });
    const gi = byRoot.get(r)!;
    gi.members.push(String(g.id));
    gi.size += g.count;
    gi.adjacencyDegree += deg(adjMap, String(g.id));
  }

  for (const gi of byRoot.values()) {
    for (const m of gi.members) for (const v of (cantMap.get(m) || [])) gi.cantNeighbors.add(v);
    for (let i = 0; i < gi.members.length; i++)
      for (let j = i + 1; j < gi.members.length; j++) {
        const a = gi.members[i],
          b = gi.members[j];
        if (cantMap.get(a)?.has(b))
          errors.push({
            kind: "cant_within_must_group",
            message: "CANNOT within MUST/adjacency group",
            details: { group: gi.members, pair: [a, b] },
          });
      }
  }

  // DIAGNOSTIC: Assignment intersection with detailed logging
  console.group('[Assignment Intersection]');
  for (const gi of byRoot.values()) {
    let groupAllowed: Set<ID> | null = null;
    const assignedMembers: string[] = [];
    const unassignedMembers: string[] = [];
    
    for (const m of gi.members) {
      const raw = assignments[m];
      if (!raw) {
        unassignedMembers.push(m);
        console.log(`Member ${m}: No assignment (flexible)`);
        continue;
      }
      
      assignedMembers.push(m);
      const list = (Array.isArray(raw) ? raw : String(raw).split(/[,\s]+/).filter(Boolean))
        .map((t) => String(t).replace(/\.$/, '')) // Remove trailing periods
        .map((t) => String(t))
        .filter((tid) => idToTable.has(String(tid)));
      const memberAllowed = new Set<ID>(list);
      
      console.log(`Member ${m}: "${raw}" → [${Array.from(memberAllowed).join(',')}]`);
      
      if (memberAllowed.size === 0) {
        console.log(`  → Skipping (no valid tables)`);
        continue;
      }
      
      if (groupAllowed === null) {
        groupAllowed = memberAllowed;
        console.log(`  → Initial group allowed: [${Array.from(groupAllowed).join(',')}]`);
      } else {
        const before = Array.from(groupAllowed).join(',');
        const next = new Set<ID>();
        for (const tid of groupAllowed) if (memberAllowed.has(tid)) next.add(tid);
        groupAllowed = next;
        console.log(`  → Intersection: [${before}] ∩ [${Array.from(memberAllowed).join(',')}] = [${Array.from(groupAllowed).join(',')}]`);
      }
    }
    
    if (assignedMembers.length > 0) {
      console.log(`Group [${gi.members.join(',')}]: ${gi.size} people`);
      console.log(`  Assigned members: [${assignedMembers.join(',')}]`);
      if (unassignedMembers.length > 0) {
        console.log(`  Unassigned members: [${unassignedMembers.join(',')}] (flexible)`);
      }
      console.log(`  Final intersection: [${groupAllowed ? Array.from(groupAllowed).join(',') : 'NONE'}]`);
      
      if (groupAllowed && groupAllowed.size === 0) {
        console.error(`  ❌ CONFLICT: No common table for assigned members`);
      } else if (groupAllowed && groupAllowed.size === 1) {
        console.log(`  ✓ Pre-assigned to table: ${Array.from(groupAllowed)[0]}`);
      } else if (groupAllowed && groupAllowed.size > 1) {
        console.log(`  ✓ Can be placed at tables: [${Array.from(groupAllowed).join(',')}]`);
      }
    } else {
      console.log(`Group [${gi.members.join(',')}]: ${gi.size} people, No assignments (can be placed anywhere)`);
    }
    
    // Only apply assignment restrictions if there are assigned members
    if (assignedMembers.length > 0) {
      if (groupAllowed && groupAllowed.size === 0) {
        errors.push({
          kind: "assignment_conflict",
          message: "No common allowed table for grouped guests",
          details: { group: gi.members },
        });
      } else if (groupAllowed && groupAllowed.size === 1) {
        gi.preassignedTable = Array.from(groupAllowed)[0];
        gi.allowedTables = groupAllowed;
      } else if (groupAllowed && groupAllowed.size > 1) {
        gi.allowedTables = groupAllowed;
      }
    }
    // If no assigned members, group can be placed anywhere (no restrictions)
  }
  console.groupEnd();

  for (const [id, s] of adjMap.entries())
    if (s.size > 2)
      errors.push({
        kind: "adjacency_degree_violation",
        message: `Adjacency degree > 2 for ${id}`,
        details: { id, degree: s.size },
      });

  const capacities = tables.map((t) => getCapacity(t as any));
  const maxCap = Math.max(0, ...capacities);
  errors.push(...checkAdjacencyCyclesUndirected(adjMap, idToGuest as any, capacities, maxCap));

  for (const gi of byRoot.values())
    if (gi.size > maxCap)
      errors.push({
        kind: "group_too_big_for_any_table",
        message: `Group size ${gi.size} exceeds max table capacity ${maxCap}`,
        details: { group: gi.members },
      });

  const guestIds = new Set(guests.map((g) => String(g.id)));
  const checkSelf = (pairs: Pair[], kind: string) =>
    pairs.forEach(([a, b]) => {
      if (a === b)
        errors.push({ kind: "self_reference_ignored", message: `Ignored self reference in ${kind}: ${a}` });
    });
  checkSelf(constr?.mustPairs || [], "must");
  checkSelf(constr?.cantPairs || [], "cannot");
  checkSelf(adj?.pairs || [], "adjacent");

  const checkUnknown = (pairs: Pair[], where: string) =>
    pairs.forEach(([a, b]) => {
      if (!guestIds.has(a) || !guestIds.has(b))
        errors.push({ kind: "unknown_guest", message: `Unknown guest in ${where}: ${a}-${b}` });
    });
  checkUnknown(constr?.mustPairs || [], "must");
  checkUnknown(constr?.cantPairs || [], "cannot");
  checkUnknown(adj?.pairs || [], "adjacent");

  for (const gid of Object.keys(assignments))
    if (!guestIds.has(gid))
      errors.push({ kind: "unknown_guest", message: `Unknown assignment guest: ${gid}` });

  // order groups (harder first)
  const groups = Array.from(byRoot.values()).sort((a, b) => {
    const ah = a.size + a.cantNeighbors.size + a.adjacencyDegree - (a.preassignedTable ? 1000 : 0);
    const bh = b.size + b.cantNeighbors.size + b.adjacencyDegree - (b.preassignedTable ? 1000 : 0);
    return bh - ah;
  });

  return { groups, errors, ctx: { idToGuest: idToGuest as any, idToTable }, cantMap, adjMap };
}

function canPlaceGroup(gi: any, ts: any, cantMap: Map<ID, Set<ID>>): boolean {
  if (gi.size > ts.remaining) return false;
  for (const m of gi.members) {
    const cset = cantMap.get(m);
    if (!cset) continue;
    for (const occ of ts.occupants) {
      if (cset.has(occ)) return false;
    }
  }
  return true;
}

function placeGroups(
  groups: any[],
  tables: TableIn[],
  cantMap: Map<ID, Set<ID>>,
  adjMap: Map<ID, Set<ID>>,
  rng: RNG,
  attemptCap: number,
  deadline: number,
): { success: boolean; state: any; attempts: number } {
  const state = {
    placed: new Map<ID, ID>(),
    tables: tables.map((t: any) => ({ table: t, remaining: getCapacity(t), occupants: [] as ID[] })),
  };
  let attempts = 0;

  // DIAGNOSTIC: Pre-assignment phase
  const preassignedGroups = groups.filter(g => g.preassignedTable);
  console.log(`[Pre-assignment Phase] ${preassignedGroups.length} groups to pre-assign`);
  
  for (const gi of groups) {
    if (!gi.preassignedTable) continue;
    const ts = state.tables.find((s: any) => String(s.table.id) === String(gi.preassignedTable));
    if (!ts) {
      console.error(`❌ Cannot find table ${gi.preassignedTable} for pre-assigned group [${gi.members.join(',')}]`);
      return { success: false, state, attempts };
    }
    if (!canPlaceGroup(gi, ts, cantMap)) {
      console.error(`❌ Cannot place pre-assigned group [${gi.members.join(',')}] at table ${gi.preassignedTable}: Need ${gi.size} seats, Available: ${ts.remaining}`);
      return { success: false, state, attempts };
    }
    console.log(`✓ Placed group [${gi.members.join(',')}] (${gi.size} people) at table ${gi.preassignedTable}`);
    ts.remaining -= gi.size;
    ts.occupants.push(...gi.members);
    for (const m of gi.members) state.placed.set(m, ts.table.id);
  }

  function backtrack(idx: number): boolean {
    if (Date.now() > deadline || attempts > attemptCap) return false;
    if (idx >= groups.length) return true;

    const gi = groups[idx];
    if (gi.preassignedTable && gi.members.every((m: ID) => state.placed.has(m)))
      return backtrack(idx + 1);

    const candidates: { ts: any; score: number }[] = [];
    const partnerSet = new Set<ID>();
    for (const m of gi.members) for (const v of (adjMap.get(m) || [])) partnerSet.add(v);

    for (const ts of state.tables) {
      if (gi.allowedTables && gi.allowedTables.size > 0 && !gi.allowedTables.has(String(ts.table.id)))
        continue;
      if (!canPlaceGroup(gi, ts, cantMap)) continue;
      let overlap = 0;
      for (const occ of ts.occupants) if (partnerSet.has(occ)) overlap++;
      candidates.push({ ts, score: overlap * 10 - (ts.remaining - gi.size) });
    }

    if (!candidates.length) return false;

    candidates.sort((a, b) => b.score - a.score || String(a.ts.table.id).localeCompare(String(b.ts.table.id)));
    let i = 0;
    const orderedTs: any[] = [];
    while (i < candidates.length) {
      let j = i + 1;
      while (j < candidates.length && candidates[j].score === candidates[i].score) j++;
      const bucket = candidates.slice(i, j).map((x) => x.ts);
      rng.shuffle(bucket);
      orderedTs.push(...bucket);
      i = j;
    }

    for (const ts of orderedTs) {
      attempts++;
      ts.remaining -= gi.size;
      ts.occupants.push(...gi.members);
      for (const m of gi.members) state.placed.set(m, ts.table.id);
      if (backtrack(idx + 1)) return true;

      ts.remaining += gi.size;
      const rm = new Set(gi.members);
      ts.occupants = ts.occupants.filter((id: ID) => !rm.has(id));
      for (const m of gi.members) state.placed.delete(m);
    }

    return false;
  }

  const success = backtrack(0);
  return { success, state, attempts };
}

function orderTableCircular(guestIds: ID[], localAdj: Map<ID, Set<ID>>): ID[] {
  if (guestIds.length <= 1) return guestIds.slice();
  const start = guestIds
    .slice()
    .sort((a, b) => (deg(localAdj, b) - deg(localAdj, a)) || String(a).localeCompare(String(b)))[0];
  const remaining = new Set(guestIds);
  remaining.delete(start);
  const ordered: ID[] = [start];

  while (remaining.size > 0) {
    const last = ordered[ordered.length - 1];
    let next = [...(localAdj.get(last) || [])].find((n) => remaining.has(n));
    if (!next) {
      let best: { id: ID; gain: number } | undefined;
      for (const c of remaining) {
        const gain =
          (localAdj.get(c)?.has(last) ? 1 : 0) +
          (localAdj.get(c)?.has(ordered[0]) ? 1 : 0) +
          deg(localAdj, c) * 0.01;
        if (!best || gain > best.gain || (gain === best.gain && String(c) < String(best.id)))
          best = { id: c, gain };
      }
      next = best!.id;
    }
    ordered.push(next);
    remaining.delete(next);
  }

  let bestOrder = ordered.slice(),
    bestScore = adjacencyPairsSatisfied(bestOrder, localAdj);
  for (let r = 1; r < ordered.length; r++) {
    const rot = ordered.slice(r).concat(ordered.slice(0, r));
    const score = adjacencyPairsSatisfied(rot, localAdj);
    if (score > bestScore) {
      bestScore = score;
      bestOrder = rot;
    }
  }
  return bestOrder;
}

function adjacencyPairsSatisfied(order: ID[], adj: Map<ID, Set<ID>>): number {
  if (order.length < 2) return 1;
  let totalPairs = 0;
  const occupants = new Set(order),
    seenPairs = new Set<string>();
  for (const a of occupants)
    for (const b of adj.get(a) || []) {
      if (occupants.has(b)) {
        const k = String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
        if (!seenPairs.has(k)) {
          seenPairs.add(k);
          totalPairs++;
        }
      }
    }
  if (totalPairs === 0) return 1;

  let satisfied = 0;
  const satPairs = new Set<string>();
  for (let i = 0; i < order.length; i++) {
    const a = order[i],
      b = order[(i + 1) % order.length];
    const k = String(a) < String(b) ? `${a}|${b}` : `${b}|${a}`;
    if ((adj.get(a)?.has(b) || adj.get(b)?.has(a)) && !satPairs.has(k)) {
      satPairs.add(k);
      satisfied++;
    }
  }
  return satisfied / totalPairs;
}

function buildPlanTables(
  state: PlacementState,
  tables: TableIn[],
  idToGuest: Map<ID, GuestUnit>,
  adjMap: Map<ID, Set<ID>>,
) {
  const byTable = new Map<ID, ID[]>();
  for (const [gid, tid] of state.placed) {
    if (!byTable.has(tid)) byTable.set(tid, []);
    byTable.get(tid)!.push(gid);
  }
  const planTables: any[] = [];
  let totalAdjSat = 0,
    totalAdjTables = 0,
    used = 0,
    totalCap = 0,
    balanceSum = 0,
    countNonEmpty = 0;

  for (const t of tables) totalCap += getCapacity(t as any);

  for (const t of tables) {
    const occ = byTable.get(String(t.id)) || [];
    if (occ.length === 0) {
      planTables.push({ tableId: String(t.id), seats: [] });
      continue;
    }
    const localAdj = new Map<ID, Set<ID>>();
    for (const gid of occ) {
      const within = new Set(Array.from(adjMap.get(gid) || []).filter((v) => occ.includes(v)));
      if (within.size > 0) localAdj.set(gid, within);
    }
    const orderedUnits = orderTableCircular(occ, localAdj);
    const seats: any[] = [];
    for (const uid of orderedUnits) {
      const gu = idToGuest.get(uid)!;
      for (let pi = 0; pi < gu.count; pi++) seats.push({ name: gu.name, partyIndex: pi });
    }
    used += seats.length;
    const sat = adjacencyPairsSatisfied(orderedUnits, localAdj);
    totalAdjSat += sat;
    totalAdjTables++;
    const cap = getCapacity(t as any);
    const fill = cap > 0 ? seats.length / cap : 1;
    balanceSum += Math.abs(0.8 - fill);
    countNonEmpty++;
    planTables.push({ tableId: String(t.id), seats });
  }

  const adjSat = totalAdjTables > 0 ? totalAdjSat / totalAdjTables : 1;
  const capUtil = totalCap > 0 ? used / totalCap : 1;
  const balance = countNonEmpty > 0 ? 1 - balanceSum / countNonEmpty : 1;

  return { planTables, adjSat, capUtil, balance, byTable };
}

interface EngineOptions {
  seed?: number;
  timeBudgetMs?: number;
  targetPlans?: number;
  maxAttemptsPerRun?: number;
  runsMultiplier?: number;
  weights?: { adj: number; util: number; balance: number };
}

export async function generateSeatingPlans(
  appGuests: GuestUnit[],
  appTables: TableIn[],
  appConstraints: ConstraintsMap,
  appAdjacents: AdjRecord,
  appAssignments: AssignmentsIn = {},
  isPremium: boolean = false,
): Promise<GenerateReturn> {
  const start = Date.now();
  const defaults: Required<EngineOptions> = {
    seed: 12345,
    timeBudgetMs: isPremium ? 3500 : 1500,
    targetPlans: isPremium ? 30 : 10,
    maxAttemptsPerRun: 7500,
    runsMultiplier: 3,
    weights: { adj: 0.6, util: 0.3, balance: 0.1 },
  };

  const { guests, errors: gErr } = normalizeGuests(appGuests);
  const { tables, errors: tErr } = normalizeTables(appTables);

  const constr = toPairsFromConstraints(appConstraints);
  const adj = toPairsFromAdj(appAdjacents);

  const initialErrors = [...gErr, ...tErr];

  const { groups, errors: vErr, ctx, cantMap, adjMap } = validateAndGroup(
    guests,
    tables,
    constr,
    adj,
    appAssignments,
  );

  const allErrors = [...initialErrors, ...vErr];
  const fatal = allErrors.filter((e) => e.kind !== "self_reference_ignored");
  
  // DIAGNOSTIC: Validation errors
  if (fatal.length > 0) {
    console.group('[Validation Errors]');
    fatal.forEach(err => console.error(`${err.kind}:`, err.message, err.details));
    console.groupEnd();
    console.log('❌ Returning 0 plans due to validation errors');
    return { plans: [], errors: fatal };
  }

  const rngBase = new RNG(defaults.seed);
  const deadline = start + defaults.timeBudgetMs;

  const bestByKey = new Map<number, SeatingPlanOut>();
  const maxRuns = Math.max(defaults.targetPlans * defaults.runsMultiplier, defaults.targetPlans + 5);

  const hashOccupants = (byTable: Map<ID, ID[]>): number => {
    let h = 0;
    const tids = Array.from(byTable.keys()).sort();
    for (const tid of tids) {
      for (let i = 0; i < tid.length; i++) h = ((h << 5) - h + tid.charCodeAt(i)) | 0;
      const gids = (byTable.get(tid) || []).slice().sort();
      for (const gid of gids)
        for (let i = 0; i < gid.length; i++) h = ((h << 5) - h + gid.charCodeAt(i)) | 0;
    }
    return h | 0;
  };

  for (let run = 0; run < maxRuns; run++) {
    if (Date.now() > deadline || bestByKey.size >= defaults.targetPlans) break;

    const seedOffset = rngBase.nextU32();
    const rng = new RNG(seedOffset);
    const runDeadline = Math.min(deadline, Date.now() + Math.max(60, Math.floor(defaults.timeBudgetMs / maxRuns)));

    const { success, state, attempts } = placeGroups(
      groups,
      tables,
      cantMap,
      adjMap,
      rng,
      defaults.maxAttemptsPerRun,
      runDeadline,
    );

    if (!success) continue;

    const { planTables, adjSat, capUtil, balance, byTable } = buildPlanTables(
      state as any,
      tables,
      ctx.idToGuest as any,
      adjMap,
    );

    const key = hashOccupants(byTable);
    const score = defaults.weights.adj * adjSat + defaults.weights.util * capUtil + defaults.weights.balance * balance;

    const prev = bestByKey.get(key);
    if (prev && (prev.score ?? 0) >= score) continue;

    bestByKey.set(key, {
      tables: planTables,
      score,
      adjacencySatisfaction: adjSat,
      capacityUtilization: capUtil,
      balance,
      seedUsed: seedOffset,
      attemptsUsed: attempts,
    });
  }

  const plans = Array.from(bestByKey.values()).sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return { plans, errors: allErrors };
}

export function detectConstraintConflicts(
  guestsIn: GuestUnit[],
  tablesIn: TableIn[],
  constraints: ConstraintsMap,
  adjacents: AdjRecord,
  assignments: AssignmentsIn,
): ValidationError[] {
  const { guests, errors: gErr } = normalizeGuests(guestsIn);
  const { tables, errors: tErr } = normalizeTables(tablesIn);
  const constrPairs = toPairsFromConstraints(constraints);
  const adjPairs = toPairsFromAdj(adjacents);
  const { errors: vErr } = validateAndGroup(guests, tables, constrPairs, adjPairs, assignments);
  return [...gErr, ...tErr, ...vErr];
}

export function detectAdjacentPairingConflicts(
  guests: GuestUnit[],
  adjacents: AdjRecord,
  tables: TableIn[],
  constraints?: ConstraintsMap,
): ValidationError[] {
  const errs = detectConstraintConflicts(guests, tables, constraints || {}, adjacents, {});
  return errs.filter(
    (e) =>
      e.kind === "adjacency_degree_violation" ||
      e.kind === "adjacency_closed_loop_too_big" ||
      e.kind === "adjacency_closed_loop_not_exact",
  );
}

export function generatePlanSummary(
  plan: SeatingPlanOut,
  guests: GuestUnit[],
  tables: TableIn[],
): string {
  const idToGuest = new Map(guests.map((g) => [String(g.id), g]));
  const nameToId = new Map(guests.map((g) => [g.name, String(g.id)]));
  const tMap = new Map(tables.map((t) => [String(t.id), t]));
  const totalSeats = plan.tables.reduce((s, t) => s + t.seats.length, 0);
  const totalCap = tables.reduce((s, t) => s + getCapacity(t as any), 0);
  const util = totalCap > 0 ? ((totalSeats / totalCap) * 100).toFixed(1) : "N.A.";

  let summary = `Seating Plan Summary:\n`;
  summary += `- Score: ${((plan.score ?? 0) * 100).toFixed(1)}/100 | Adjacency: ${(
    (plan.adjacencySatisfaction ?? 0) * 100
  ).toFixed(0)}% | Utilization: ${util}% | Balance: ${(((plan.balance ?? 0) * 100) as number).toFixed(0)}%\n\n`;

  const byName = (t: any) => (tMap.get(String(t.tableId))?.name ?? String(t.tableId));
  const tablesSorted = plan.tables
    .filter((t) => t.seats.length > 0)
    .sort((a, b) => byName(a).localeCompare(byName(b)));

  for (const t of tablesSorted) {
    const tinfo = tMap.get(String(t.tableId));
    const tName = tinfo?.name || `Table ${t.tableId}`;
    const cap = getCapacity(tinfo as any);
    summary += `Table: "${tName}" (${t.seats.length} / ${cap} seats)\n`;
    const namesOrdered: string[] = [];
    const seen = new Set<string>();
    for (const seat of t.seats) {
      if (!seen.has(seat.name)) {
        namesOrdered.push(seat.name);
        seen.add(seat.name);
      }
    }
    for (const name of namesOrdered) {
      const gid = nameToId.get(name);
      const guest = gid ? idToGuest.get(gid) : undefined;
      const count = guest?.count ?? 1;
      summary += `  - ${name}${count > 1 ? ` (party of ${count})` : ""}\n`;
    }
    summary += `\n`;
  }

  return summary;
}