/*
 * Seatyr — Ultimate Best-of-All Seating Algorithm ENGINE
 * Date: 2025-09-04
 *
 * This is the core engine, containing the definitive synthesis of all AI Red Team contributions.
 * It is designed to be called by a backward-compatible adapter, not used directly by the application.
 */

import { getCapacity } from './tables';

// ========================= Engine-Internal Types =========================

type ID = string;

export interface GuestUnit { id: ID; name: string; count: number; }
export interface TableIn { id: ID | number; name?: string; seats?: number; capacity?: number; }
export type ConstraintsMap = Record<string, Record<string, "must" | "cannot" | "">>;
export type AdjRecord = Record<string, string[]>;
export type AssignmentsIn = Record<string, string | string[]>;

export interface PlanSeat { name: string; partyIndex: number }
export interface PlanTableOut { tableId: ID; seats: PlanSeat[] }
export interface SeatingPlanOut { tables: PlanTableOut[]; score?: number; adjacencySatisfaction?: number; capacityUtilization?: number; balance?: number; seedUsed?: number; attemptsUsed?: number }

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

export interface ValidationError { kind: ConflictKind; message: string; details?: any }
export interface GenerateReturn { plans: SeatingPlanOut[]; errors: ValidationError[] }

// ========================= Core Implementation =========================

class RNG {
  private x: number;
  constructor(seed = 12345) { this.x = (seed >>> 0) || 0x9e3779b9; }
  nextU32(): number { let x = this.x >>> 0; x ^= x << 13; x >>>= 0; x ^= x >> 17; x >>>= 0; x ^= x << 5; x >>>= 0; this.x = x; return x >>> 0; }
  next(): number { return (this.nextU32() & 0xffffffff) / 0x1_0000_0000; }
  shuffle<T>(arr: T[]): void { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } }
}

class DSU {
  parent = new Map<ID, ID>();
  rank = new Map<ID, number>();
  find(a: ID): ID { const p = this.parent.get(a); if (!p || p === a) { this.parent.set(a, a); this.rank.set(a, this.rank.get(a) ?? 0); return a; } const r = this.find(p); this.parent.set(a, r); return r; }
  union(a: ID, b: ID) { if (a === b) return; const ra = this.find(a), rb = this.find(b); if (ra === rb) return; const ar = this.rank.get(ra) ?? 0, br = this.rank.get(rb) ?? 0; if (ar < br) this.parent.set(ra, rb); else if (ar > br) this.parent.set(rb, ra); else { this.parent.set(rb, ra); this.rank.set(ra, ar + 1); } }
}

interface SafeGuest { id: ID; name: string; count: number; }
interface SafeTable { id: ID; name?: string; capacity: number }
interface Pair { 0: ID; 1: ID }
interface ConstraintsPairs { mustPairs: Pair[]; cantPairs: Pair[] }
interface AdjacencyPairs { pairs: Pair[] }
interface GroupInfo { root: ID; members: ID[]; size: number; cantNeighbors: Set<ID>; adjacencyDegree: number; preassignedTable?: ID; }
interface ValidateCtx { idToGuest: Map<ID, SafeGuest>; idToTable: Map<ID, SafeTable> }
interface TableState { table: SafeTable; remaining: number; occupants: ID[] }
interface PlacementState { placed: Map<ID, ID>; tables: TableState[] }

function normalizeGuests(rawGuests: GuestUnit[]): { guests: SafeGuest[], errors: ValidationError[] } {
  const guests: SafeGuest[] = [];
  const errors: ValidationError[] = [];
  const guestIdSet = new Set<ID>();
  for (const g of rawGuests || []) {
    try {
      const id = String(g?.id ?? '').trim();
      if (!id) { errors.push({ kind: "invalid_input_data", message: `Guest missing or invalid id`, details: { guest: g } }); continue; }
      if (guestIdSet.has(id)) { errors.push({ kind: "invalid_input_data", message: `Duplicate guest id: ${id}`, details: { guest: g } }); continue; }
      const name = String(g?.name ?? '').trim() || `Guest ${id}`;
      const count = Math.max(1, Math.floor(Number(g?.count) || 1));
      guests.push({ id, name, count });
      guestIdSet.add(id);
    } catch (e) {
      errors.push({ kind: "invalid_input_data", message: `Failed to parse guest`, details: { guest: g, error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return { guests, errors };
}

function normalizeTables(rawTables: TableIn[]): { tables: SafeTable[], errors: ValidationError[] } {
  const tables: SafeTable[] = [];
  const errors: ValidationError[] = [];
  const tableIdSet = new Set<ID>();
  for (const t of rawTables || []) {
    try {
      const id = String(t?.id ?? '').trim();
      if (!id) { errors.push({ kind: "invalid_input_data", message: `Table missing or invalid id`, details: { table: t } }); continue; }
      if (tableIdSet.has(id)) { errors.push({ kind: "invalid_input_data", message: `Duplicate table id: ${id}`, details: { table: t } }); continue; }
      const name = String(t?.name ?? '').trim() || `Table ${id}`;
      const capacity = Math.max(1, Math.floor(Number(t?.capacity ?? t?.seats) || 1));
      tables.push({ id, name, capacity });
      tableIdSet.add(id);
    } catch (e) {
      errors.push({ kind: "invalid_input_data", message: `Failed to parse table`, details: { table: t, error: e instanceof Error ? e.message : String(e) } });
    }
  }
  return { tables, errors };
}

function toPairsFromConstraints(map: ConstraintsMap | undefined): ConstraintsPairs {
  const must: Pair[] = [], cant: Pair[] = [];
  if (!map) return { mustPairs: must, cantPairs: cant };
  for (const a of Object.keys(map)) {
    const row = map[a] || {};
    for (const b of Object.keys(row)) {
      const v = row[b]; if (a === b) continue;
      if (v === "must") must.push([String(a), String(b)]);
      else if (v === "cannot") cant.push([String(a), String(b)]);
    }
  }
  return { mustPairs: dedupUndirected(must), cantPairs: dedupUndirected(cant) };
}

function toPairsFromAdj(adjs: AdjRecord | undefined): AdjacencyPairs {
  const pairs: Pair[] = [];
  if (adjs) for (const a of Object.keys(adjs)) for (const b of adjs[a] || []) if (a !== b) pairs.push([String(a), String(b)]);
  return { pairs: dedupUndirected(pairs) };
}

function dedupUndirected(pairs: Pair[]): Pair[] {
  const s = new Set<string>(); const out: Pair[] = [];
  for (const [a,b] of pairs) { const A = String(a), B = String(b); const k = A < B ? `${A}|${B}` : `${B}|${A}`; if (!s.has(k)) { s.add(k); out.push([A,B]); } }
  return out;
}

function buildUndirectedMap(pairs: Pair[]): Map<ID, Set<ID>> {
  const m = new Map<ID, Set<ID>>();
  for (const [a, b] of pairs) { if (a === b) continue; if (!m.has(a)) m.set(a, new Set()); if (!m.has(b)) m.set(b, new Set()); m.get(a)!.add(b); m.get(b)!.add(a); }
  return m;
}

function deg(map: Map<ID, Set<ID>>, id: ID): number { return map.get(id)?.size ?? 0; }

function checkAdjacencyCyclesUndirected(
  adjMap: Map<ID, Set<ID>>,
  idToGuest: Map<ID, SafeGuest>,
  capacities: number[],
  maxCap: number
): ValidationError[] {
  const errors: ValidationError[] = [];
  const visited = new Set<ID>();
  const nodes = Array.from(adjMap.keys());

  for (const startNode of nodes) {
    if (visited.has(startNode)) continue;
    
    const component: ID[] = [];
    const queue: ID[] = [startNode];
    visited.add(startNode);
    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      component.push(u);
      for (const v of adjMap.get(u) || []) {
        if (!visited.has(v)) {
          visited.add(v);
          queue.push(v);
        }
      }
    }

    if (component.length <= 2) continue;

    const isSimpleCycle = component.every(nodeId => deg(adjMap, nodeId) === 2);
    if (!isSimpleCycle) continue;

    const seats = component.reduce((sum, gid) => sum + (idToGuest.get(gid)?.count ?? 1), 0);

    if (seats > maxCap) {
      errors.push({ 
        kind: "adjacency_closed_loop_too_big", 
        message: `A closed adjacency loop requires ${seats} seats, but the largest table only has ${maxCap}.`, 
        details: { ids: component, seats, capacities } 
      });
    } else if (!capacities.some(c => c === seats)) {
      errors.push({
        kind: "adjacency_closed_loop_not_exact",
        message: `A closed adjacency loop requires ${seats} seats, but no table has exactly ${seats} seats.`,
        details: { ids: component, seats, capacities }
      });
    }
  }
  return errors;
}

function validateAndGroup(guests: SafeGuest[], tables: SafeTable[], constr: ConstraintsPairs, adj: AdjacencyPairs, assignments: AssignmentsIn): { groups: GroupInfo[]; errors: ValidationError[]; ctx: ValidateCtx; cantMap: Map<ID, Set<ID>>; adjMap: Map<ID, Set<ID>> } {
  const errors: ValidationError[] = [];
  const idToGuest = new Map<ID, SafeGuest>(guests.map(g => [g.id, g]));
  const idToTable = new Map<ID, SafeTable>(tables.map(t => [t.id, t]));
  const cantMap = buildUndirectedMap(constr.cantPairs);
  const adjMap = buildUndirectedMap(adj.pairs);
  const dsu = new DSU();
  for (const g of guests) dsu.find(g.id);
  // Group must constraints together
  for (const [a,b] of constr.mustPairs) dsu.union(a, b);
  // Group adjacent pairings together (they must sit at the same table)
  for (const [a,b] of adj.pairs) dsu.union(a, b);
  const byRoot = new Map<ID, GroupInfo>();
  for (const g of guests) {
    const r = dsu.find(g.id);
    if (!byRoot.has(r)) byRoot.set(r, { root: r, members: [], size: 0, cantNeighbors: new Set(), adjacencyDegree: 0 });
    const gi = byRoot.get(r)!; gi.members.push(g.id); gi.size += g.count; gi.adjacencyDegree += deg(adjMap, g.id);
  }
  for (const gi of byRoot.values()) {
    for (const m of gi.members) for (const v of (cantMap.get(m) || [])) gi.cantNeighbors.add(v);
    for (let i=0;i<gi.members.length;i++) for (let j=i+1;j<gi.members.length;j++) {
      const a = gi.members[i], b = gi.members[j];
      if (cantMap.get(a)?.has(b)) errors.push({ kind: "cant_within_must_group", message: `CANNOT within MUST group`, details: { group: gi.members, pair: [a,b] } });
    }
  }
  for (const gi of byRoot.values()) {
    const tablesSet = new Set<ID>();
    for (const m of gi.members) {
      const raw = assignments[m]; if (!raw) continue;
      const list = Array.isArray(raw) ? raw : String(raw).split(/[\s,]+/).filter(Boolean);
      const first = list.find(tid => idToTable.has(String(tid)));
      if (first) tablesSet.add(String(first));
    }
    if (tablesSet.size > 1) errors.push({ kind: "assignment_conflict", message: `Conflicting preassignments in group`, details: { group: gi.members, tables: Array.from(tablesSet) } });
    else if (tablesSet.size === 1) gi.preassignedTable = Array.from(tablesSet)[0];
  }
  for (const [id, s] of adjMap.entries()) if (s.size > 2) errors.push({ kind: "adjacency_degree_violation", message: `Adjacency degree > 2 for ${id}`, details: { id, degree: s.size } });
  
  // UPDATE THESE THREE LINES to pass capacities to the validation function
  const capacities = tables.map(t => getCapacity(t));
  const maxCap = Math.max(0, ...capacities);
  errors.push(...checkAdjacencyCyclesUndirected(adjMap, idToGuest, capacities, maxCap));
  
  for (const gi of byRoot.values()) if (gi.size > maxCap) errors.push({ kind: "group_too_big_for_any_table", message: `Group size ${gi.size} exceeds max table capacity ${maxCap}`, details: { group: gi.members } });
  const guestIds = new Set(guests.map(g => g.id));
  const checkSelf = (pairs: Pair[], kind: string) => pairs.forEach(([a,b]) => { if (a === b) errors.push({ kind: "self_reference_ignored", message: `Ignored self reference in ${kind}: ${a}` }); });
  checkSelf(constr.mustPairs, "must"); checkSelf(constr.cantPairs, "cannot"); checkSelf(adj.pairs, "adjacent");
  const checkUnknown = (pairs: Pair[], where: string) => pairs.forEach(([a,b]) => { if (!guestIds.has(a) || !guestIds.has(b)) errors.push({ kind: "unknown_guest", message: `Unknown guest in ${where}: ${a}-${b}` }); });
  checkUnknown(constr.mustPairs, "must"); checkUnknown(constr.cantPairs, "cannot"); checkUnknown(adj.pairs, "adjacent");
  for (const gid of Object.keys(assignments)) if (!guestIds.has(gid)) errors.push({ kind: "unknown_guest", message: `Unknown assignment guest: ${gid}` });
  const groups = Array.from(byRoot.values()).sort((a,b) => {
    const aHard = a.size + a.cantNeighbors.size + a.adjacencyDegree - (a.preassignedTable ? 1000 : 0);
    const bHard = b.size + b.cantNeighbors.size + b.adjacencyDegree - (b.preassignedTable ? 1000 : 0);
    return bHard - aHard;
  });
  return { groups, errors, ctx: { idToGuest, idToTable }, cantMap, adjMap };
}

function canPlaceGroup(gi: GroupInfo, ts: TableState, cantMap: Map<ID, Set<ID>>): boolean {
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

function placeGroups(groups: GroupInfo[], tables: SafeTable[], cantMap: Map<ID, Set<ID>>, adjMap: Map<ID, Set<ID>>, rng: RNG, attemptCap: number, deadline: number): { success: boolean; state: PlacementState; attempts: number } {
  const state: PlacementState = { placed: new Map(), tables: tables.map(t => ({ table: t, remaining: getCapacity(t), occupants: [] })) };
  let attempts = 0;
  for (const gi of groups) {
    if (!gi.preassignedTable) continue;
    const ts = state.tables.find(s => s.table.id === gi.preassignedTable); if (!ts) return { success: false, state, attempts };
    if (!canPlaceGroup(gi, ts, cantMap)) return { success: false, state, attempts };
    ts.remaining -= gi.size; ts.occupants.push(...gi.members); for (const m of gi.members) state.placed.set(m, ts.table.id);
  }
  function backtrack(idx: number): boolean {
    if (Date.now() > deadline || attempts > attemptCap) return false;
    if (idx >= groups.length) return true;
    const gi = groups[idx];
    if (gi.preassignedTable && gi.members.every(m => state.placed.has(m))) return backtrack(idx + 1);
    const candidates: { ts: TableState; score: number }[] = [];
    const partnerSet = new Set<ID>();
    for (const m of gi.members) for (const v of (adjMap.get(m) || [])) partnerSet.add(v);
    for (const ts of state.tables) {
      if (!canPlaceGroup(gi, ts, cantMap)) continue;
      let overlap = 0; for (const occ of ts.occupants) if (partnerSet.has(occ)) overlap++;
      candidates.push({ ts, score: overlap * 10 - (ts.remaining - gi.size) });
    }
    if (!candidates.length) return false;
    candidates.sort((a,b)=> b.score - a.score || a.ts.table.id.localeCompare(b.ts.table.id));
    let i=0; const orderedTs: TableState[] = [];
    while (i < candidates.length) {
      let j=i+1; while (j < candidates.length && candidates[j].score === candidates[i].score) j++;
      const bucket = candidates.slice(i,j).map(x=>x.ts); rng.shuffle(bucket); orderedTs.push(...bucket); i=j;
    }
    for (const ts of orderedTs) {
      attempts++;
      ts.remaining -= gi.size; ts.occupants.push(...gi.members); for (const m of gi.members) state.placed.set(m, ts.table.id);
      if (backtrack(idx + 1)) return true;
      ts.remaining += gi.size; const rm = new Set(gi.members); ts.occupants = ts.occupants.filter(id => !rm.has(id)); for (const m of gi.members) state.placed.delete(m);
    }
    return false;
  }
  const success = backtrack(0);
  return { success, state, attempts };
}

function orderTableCircular(guestIds: ID[], localAdj: Map<ID, Set<ID>>): ID[] {
  if (!guestIds || guestIds.length <= 1) return guestIds?.slice() || [];
  const start = guestIds.slice().sort((a,b)=> (deg(localAdj,b)-deg(localAdj,a)) || a.localeCompare(b))[0];
  const remaining = new Set(guestIds); remaining.delete(start);
  const ordered: ID[] = [start];
  while (remaining.size > 0) {
    const last = ordered[ordered.length-1];
    let next = [...(localAdj.get(last) || [])].find(n => remaining.has(n));
    if (!next) {
      let best: { id: ID; gain: number } | undefined;
      for (const c of remaining) {
        let gain = ((localAdj.get(c)?.has(last) ? 1 : 0) + (localAdj.get(c)?.has(ordered[0]) ? 1 : 0)) + deg(localAdj, c) * 0.01;
        if (!best || gain > best.gain || (gain === best.gain && c < best.id)) best = { id: c, gain };
      }
      next = best?.id || Array.from(remaining)[0]; // null-safe fallback
    }
    ordered.push(next); remaining.delete(next);
  }
  let bestOrder = ordered.slice(), bestScore = adjacencyPairsSatisfied(bestOrder, localAdj);
  for (let r=1; r<ordered.length; r++) {
    const rot = ordered.slice(r).concat(ordered.slice(0,r));
    const score = adjacencyPairsSatisfied(rot, localAdj);
    if (score > bestScore) { bestScore = score; bestOrder = rot; }
  }
  return bestOrder;
}

function adjacencyPairsSatisfied(order: ID[], adj: Map<ID, Set<ID>>): number {
  if (order.length < 2) return 1;
  let totalPairs = 0;
  const occupants = new Set(order), seenPairs = new Set<string>();
  for (const a of occupants) for (const b of (adj.get(a) || [])) if (occupants.has(b)) {
    const k = a < b ? `${a}|${b}` : `${b}|${a}`; if (!seenPairs.has(k)) { seenPairs.add(k); totalPairs++; }
  }
  if (totalPairs === 0) return 1;
  let satisfied = 0;
  const satisfiedPairs = new Set<string>();
  for (let i=0;i<order.length;i++) { const a = order[i], b = order[(i+1)%order.length]; const k = a < b ? `${a}|${b}` : `${b}|${a}`; if ((adj.get(a)?.has(b) || adj.get(b)?.has(a)) && !satisfiedPairs.has(k)) { satisfiedPairs.add(k); satisfied++; } }
  return satisfied / totalPairs;
}

function buildPlanTables(state: PlacementState, tables: SafeTable[], idToGuest: Map<ID, SafeGuest>, adjMap: Map<ID, Set<ID>>) {
  const byTable = new Map<ID, ID[]>();
  for (const [gid, tid] of state.placed) { if (!byTable.has(tid)) byTable.set(tid, []); byTable.get(tid)!.push(gid); }
  const planTables: PlanTableOut[] = [];
  let totalAdjSat = 0, totalAdjTables = 0, used = 0, totalCap = 0;
  let balanceSum = 0, countNonEmpty = 0;
  for (const t of tables) totalCap += getCapacity(t);
  for (const t of tables) {
    const occ = (byTable.get(t.id) || []);
    if (occ.length === 0) { planTables.push({ tableId: t.id, seats: [] }); continue; }
    const localAdj = new Map<ID, Set<ID>>();
    for (const gid of occ) {
      const within = new Set(Array.from(adjMap.get(gid) || []).filter(v => occ.includes(v)));
      if (within.size > 0) localAdj.set(gid, within);
    }
    const orderedUnits = orderTableCircular(occ, localAdj);
    const seats: PlanSeat[] = [];
    for (const uid of orderedUnits) { const gu = idToGuest.get(uid)!; for (let pi=0; pi<gu.count; pi++) seats.push({ name: gu.name, partyIndex: pi }); }
    used += seats.length;
    const sat = adjacencyPairsSatisfied(orderedUnits, localAdj);
    totalAdjSat += sat; totalAdjTables++;
    const fill = getCapacity(t) > 0 ? seats.length / getCapacity(t) : 1;
    balanceSum += Math.abs(0.8 - fill);
    countNonEmpty++;
    planTables.push({ tableId: t.id, seats });
  }
  const adjSat = totalAdjTables > 0 ? totalAdjSat / totalAdjTables : 1;
  const capUtil = totalCap > 0 ? used / totalCap : 1;
  const balance = countNonEmpty > 0 ? 1 - (balanceSum / countNonEmpty) : 1;
  return { planTables, adjSat, capUtil, balance, byTable };
}

interface EngineOptions { seed?: number; timeBudgetMs?: number; targetPlans?: number; maxAttemptsPerRun?: number; runsMultiplier?: number; weights?: { adj: number; util: number; balance: number } }

/**
 * @description The core seating algorithm engine. It is internally consistent and should not be called directly by the application.
 * @param {GuestUnit[]} appGuests - Normalized guest data.
 * @param {TableIn[]} appTables - Normalized table data.
 * @param {ConstraintsMap} appConstraints - Constraints between guests.
 * @param {AdjRecord} appAdjacents - Adjacency requirements.
 * @param {AssignmentsIn} appAssignments - Pre-assignments of guests to tables.
 * @param {boolean} isPremium - Flag for premium features.
 * @returns {Promise<GenerateReturn>} A promise that resolves to the generated plans and any errors.
 */
export async function generateSeatingPlans(
  appGuests: GuestUnit[], appTables: TableIn[], appConstraints: ConstraintsMap, appAdjacents: AdjRecord,
  appAssignments: AssignmentsIn = {}, isPremium: boolean = false
): Promise<GenerateReturn> {
  const start = Date.now();
  const defaults: Required<EngineOptions> = { seed: 12345, timeBudgetMs: isPremium ? 3500 : 1500, targetPlans: isPremium ? 30 : 10, maxAttemptsPerRun: 7500, runsMultiplier: 3, weights: { adj: 0.6, util: 0.3, balance: 0.1 } };
  const { guests, errors: normGuestErrors } = normalizeGuests(appGuests);
  const { tables, errors: normTableErrors } = normalizeTables(appTables);
  const constr = toPairsFromConstraints(appConstraints);
  const adj = toPairsFromAdj(appAdjacents);
  const initialErrors = [...normGuestErrors, ...normTableErrors];
  const { groups, errors: validationErrors, ctx, cantMap, adjMap } = validateAndGroup(guests, tables, constr, adj, appAssignments);
  const allErrors = [...initialErrors, ...validationErrors];
  const fatalErrors = allErrors.filter(e => e.kind !== "self_reference_ignored");
  if (fatalErrors.length > 0) return { plans: [], errors: fatalErrors };
  const rngBase = new RNG(defaults.seed);
  const deadline = start + defaults.timeBudgetMs;
  const bestByKey = new Map<number, SeatingPlanOut>();
  const maxRuns = Math.max(defaults.targetPlans * defaults.runsMultiplier, defaults.targetPlans + 5);
  const hashOccupantSignature = (occupantsByTable: Map<ID, ID[]>): number => {
    let hash = 0;
    const sortedTableIds = Array.from(occupantsByTable.keys()).sort();
    for (const tableId of sortedTableIds) {
        for (let i = 0; i < tableId.length; i++) hash = ((hash << 5) - hash + tableId.charCodeAt(i)) | 0;
        const guestIds = (occupantsByTable.get(tableId) || []).slice().sort();
        for (const guestId of guestIds) {
            for (let i = 0; i < guestId.length; i++) hash = ((hash << 5) - hash + guestId.charCodeAt(i)) | 0;
        }
    }
    return hash | 0;
  };
  for (let run=0; run < maxRuns; run++) {
    if (Date.now() > deadline || bestByKey.size >= defaults.targetPlans) break;
    const seedOffset = rngBase.nextU32();
    const rng = new RNG(seedOffset);
    const runDeadline = Math.min(deadline, Date.now() + Math.max(60, Math.floor(defaults.timeBudgetMs / maxRuns)));
    const { success, state, attempts } = placeGroups(groups, tables, cantMap, adjMap, rng, defaults.maxAttemptsPerRun, runDeadline);
    if (!success) continue;
    const { planTables, adjSat, capUtil, balance, byTable } = buildPlanTables(state, tables, ctx.idToGuest, adjMap);
    const k = hashOccupantSignature(byTable);
    const score = defaults.weights.adj * adjSat + defaults.weights.util * capUtil + defaults.weights.balance * balance;
    const prev = bestByKey.get(k);
    if (prev && (prev.score ?? 0) >= score) continue;
    const plan: SeatingPlanOut = { tables: planTables, score, adjacencySatisfaction: adjSat, capacityUtilization: capUtil, balance, seedUsed: seedOffset, attemptsUsed: attempts };
    bestByKey.set(k, plan);
  }
  const plans = Array.from(bestByKey.values()).sort((a,b)=> (b.score ?? 0) - (a.score ?? 0));
  return { plans, errors: allErrors };
}

/**
 * @description Detects conflicts in constraints, guests, and tables without generating full plans.
 * @param {GuestUnit[]} guestsIn - The application's guest list.
 * @param {TableIn[]} tablesIn - The application's table list.
 * @param {ConstraintsMap} constraints - The constraints object.
 * @param {AdjRecord} adjacents - The adjacencies object.
 * @param {AssignmentsIn} assignments - The assignments object.
 * @returns {ValidationError[]} A list of identified conflicts.
 */
export function detectConstraintConflicts(
  guestsIn: GuestUnit[], tablesIn: TableIn[], constraints: ConstraintsMap, adjacents: AdjRecord, assignments: AssignmentsIn
): ValidationError[] {
  const { guests, errors: gErr } = normalizeGuests(guestsIn);
  const { tables, errors: tErr } = normalizeTables(tablesIn);
  const constrPairs = toPairsFromConstraints(constraints);
  const adjPairs = toPairsFromAdj(adjacents);
  const { errors: vErr } = validateAndGroup(guests, tables, constrPairs, adjPairs, assignments);
  return [...gErr, ...tErr, ...vErr];
}

/**
 * @description Detects conflicts specifically related to adjacency constraints.
 * @param {GuestUnit[]} guests - The application's guest list.
 * @param {AdjRecord} adjacents - The adjacencies object.
 * @param {TableIn[]} tables - The application's table list.
 * @param {ConstraintsMap} [constraints] - Optional constraints object.
 * @returns {ValidationError[]} A list of identified adjacency-related conflicts.
 */
export function detectAdjacentPairingConflicts(guests: GuestUnit[], adjacents: AdjRecord, tables: TableIn[], constraints?: ConstraintsMap): ValidationError[] {
  const errs = detectConstraintConflicts(guests, tables, constraints || {}, adjacents, {});
  return errs.filter(e => e.kind === "adjacency_degree_violation" || e.kind === "adjacency_closed_loop_too_big" || e.kind === "adjacency_closed_loop_not_exact");
}

/**
 * @description Generates a human-readable summary of a single seating plan.
 * @param {SeatingPlanOut} plan - The plan to summarize.
 * @param {GuestUnit[]} guests - The list of all guests.
 * @param {TableIn[]} tables - The list of all tables.
 * @returns {string} A formatted summary string.
 */
export function generatePlanSummary(plan: SeatingPlanOut, guests: GuestUnit[], tables: TableIn[]): string {
  const idToGuest = new Map(guests.map(g => [g.id, g]));
  const nameToId = new Map(guests.map(g => [g.name, g.id]));
  const tableMap = new Map(tables.map(t => [String(t.id), t]));
  const totalSeatsAssigned = plan.tables.reduce((sum, t) => sum + t.seats.length, 0);
  const totalCapacity = tables.reduce((sum, t) => sum + getCapacity(t), 0);
  const utilization = totalCapacity > 0 ? (totalSeatsAssigned / totalCapacity * 100).toFixed(1) : 'N.A.';
  let summary = `Seating Plan Summary:\n`;
  summary += `- Score: ${((plan.score ?? 0)*100).toFixed(1)}/100 | Adjacency: ${((plan.adjacencySatisfaction ?? 0) * 100).toFixed(0)}% | Utilization: ${utilization}% | Balance: ${(((plan.balance ?? 0) * 100)).toFixed(0)}%\n\n`;
  const byTableName = (t: PlanTableOut) => (tableMap.get(t.tableId)?.name ?? String(t.tableId));
  const sortedTables = plan.tables.filter(t => t.seats.length > 0).sort((a, b) => byTableName(a).localeCompare(byTableName(b)));
  for (const table of sortedTables) {
    const tinfo = tableMap.get(table.tableId);
    const tName = tinfo?.name || `Table ${table.tableId}`;
    const tCap = getCapacity(tinfo || {});
    summary += `Table: "${tName}" (${table.seats.length} / ${tCap} seats)\n`;
    const orderedNames: string[] = [], seenNames = new Set<string>();
    for (const seat of table.seats) if (!seenNames.has(seat.name)) { orderedNames.push(seat.name); seenNames.add(seat.name); }
    for (const name of orderedNames) {
      const guestId = nameToId.get(name);
      const guest = guestId ? idToGuest.get(guestId) : undefined;
      const count = guest?.count ?? 1;
      summary += `  - ${name}${count > 1 ? ` (party of ${count})` : ''}\n`;
    }
    summary += `\n`;
  }
  return summary;
}