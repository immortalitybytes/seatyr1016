```typescript
import { GuestUnit, Table, SeatingPlan, Constraint, SeatingError, ConstraintConflict } from '../types';
import { normalizeGuestName } from './guestParser';
import { v4 as uuidv4 } from 'uuid';
import seedrandom from 'seedrandom';

/**
 * Constants for seating plan generation
 */
const MAX_PLANS_TO_GENERATE = (guestCount: number) => Math.min(200, 100 + 2 * guestCount);
const MAX_PLANS_TO_RETURN = 30;
const MAX_BACKTRACK_ATTEMPTS = 2000;
const UNIQUENESS_THRESHOLD = (plans: number, guestCount: number) => Math.max(0.3, 0.8 - 0.004 * guestCount);

/**
 * Logging utility for errors and info with Sentry integration
 */
const logError = (message: string, details?: any) => {
  if (process.env.NODE_ENV === 'development') {
    console.error(`[seatingAlgorithm ${new Date().toISOString()}] ${message}`, details);
  }
  // Sentry integration (uncomment when configured)
  // import * as Sentry from '@sentry/react';
  // Sentry.captureException(new Error(message), { extra: details });
};

const logInfo = (message: string, details?: any) => {
  if (process.env.NODE_ENV === 'development') {
    console.log(`[seatingAlgorithm ${new Date().toISOString()}] ${message}`, details);
  }
  // Sentry info logging (optional)
  // import * as Sentry from '@sentry/react';
  // Sentry.captureMessage(message, { level: 'info', extra: details });
};

/**
 * Types and interfaces
 */
interface SeatedTable {
  id: number;
  name: string;
  seats: GuestUnit[];
  capacity: number;
  remainingSeats: number;
}

interface SeatingResult {
  plans: SeatingPlan[];
  errors: SeatingError[];
  conflicts: ConstraintConflict[];
}

interface AtomicGroup {
  units: GuestUnit[];
  totalCount: number;
  priority: number;
  constraintCount: number;
}

type DiversityStrategy = 'shuffle' | 'reverse' | 'size-first' | 'size-last' | 'random-pairs' | 'priority-first' | 'vip-scatter' | 'constraint-heavy-first';

/**
 * Optimized Union-Find for grouping guests with must constraints or adjacencies
 */
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

/**
 * Validates input data for guests, tables, constraints, and adjacencies
 */
function validateInputs(
  guests: GuestUnit[],
  tables: Table[],
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>
): SeatingError[] {
  const errors: SeatingError[] = [];
  
  if (guests.length === 0) {
    logError('No guests provided');
    errors.push({ type: 'error', message: 'No guests provided.' });
  }
  
  if (tables.length === 0) {
    logError('No tables provided');
    errors.push({ type: 'error', message: 'No tables provided.' });
  }
  
  if (tables.some(t => t.capacity <= 0)) {
    logError('Invalid table capacity');
    errors.push({ type: 'error', message: 'One or more tables have invalid capacity.' });
  }
  
  for (const guest1 in constraints) {
    if (!guests.some(g => g.normalizedKey === guest1)) {
      logError(`Constraint references unknown guest: ${guest1}`);
      errors.push({ type: 'error', message: `Constraint references unknown guest: ${guest1}` });
    }
    for (const guest2 in constraints[guest1]) {
      if (!guests.some(g => g.normalizedKey === guest2)) {
        logError(`Constraint references unknown guest: ${guest2}`);
        errors.push({ type: 'error', message: `Constraint references unknown guest: ${guest2}` });
      }
    }
  }
  
  for (const guest in adjacents) {
    if (!guests.some(g => g.normalizedKey === guest)) {
      logError(`Adjacency references unknown guest: ${guest}`);
      errors.push({ type: 'error', message: `Adjacency references unknown guest: ${guest}` });
    }
    for (const adj of adjacents[guest]) {
      if (!guests.some(g => g.normalizedKey === adj)) {
        logError(`Adjacency references unknown guest: ${adj}`);
        errors.push({ type: 'error', message: `Adjacency references unknown guest: ${adj}` });
      }
    }
  }
  
  return errors;
}

/**
 * Detects conflicts in constraints (circular, contradictory, capacity, adjacency)
 */
export function detectConstraintConflicts(
  guests: GuestUnit[],
  constraints: Record<string, Record<string, Constraint>>,
  tables: Table[],
  checkAdjacents: boolean = false,
  adjacents: Record<string, string[]> = {}
): ConstraintConflict[] {
  const conflicts: ConstraintConflict[] = [];
  if (guests.length === 0 || tables.length === 0) return [];

  const guestMap = new Map(guests.map(g => [g.normalizedKey, g]));

  // Circular dependencies
  const visited = new Set<string>();
  const recursionStack = new Set<string>();

  const detectCycle = (guestKey: string, path: string[]): void => {
    visited.add(guestKey);
    recursionStack.add(guestKey);

    const guestConstraints = constraints[guestKey] || {};
    for (const [otherGuestKey, constraint] of Object.entries(guestConstraints)) {
      if (constraint === 'must' && guestMap.has(otherGuestKey)) {
        if (recursionStack.has(otherGuestKey)) {
          const cycleStart = path.indexOf(otherGuestKey);
          const cycle = [...path.slice(cycleStart), otherGuestKey];
          if (!conflicts.some(c => c.type === 'circular' && c.affectedGuests.join() === cycle.join())) {
            logError('Circular dependency detected', { cycle });
            conflicts.push({
              id: uuidv4(),
              type: 'circular',
              severity: 'high',
              description: `Circular dependency: ${cycle.map(key => guestMap.get(key)?.displayName || key).join(' → ')}`,
              affectedGuests: cycle,
            });
          }
        } else if (!visited.has(otherGuestKey)) {
          detectCycle(otherGuestKey, [...path, guestKey]);
        }
      }
    }
    recursionStack.delete(guestKey);
  };

  for (const guest of guestMap.keys()) {
    if (!visited.has(guest)) {
      detectCycle(guest, [guest]);
    }
  }

  // Contradictory constraints
  const checkedPairs = new Set<string>();
  for (const [guest1, guestConstraints] of Object.entries(constraints)) {
    for (const [guest2, constraint1] of Object.entries(guestConstraints)) {
      const pairKey = [guest1, guest2].sort().join('--');
      if (checkedPairs.has(pairKey)) continue;

      const reverseConstraint = constraints[guest2]?.[guest1];
      if ((constraint1 === 'must' && reverseConstraint === 'cannot') || 
          (constraint1 === 'cannot' && reverseConstraint === 'must')) {
        logError('Contradictory constraints', { guest1, guest2 });
        conflicts.push({
          id: uuidv4(),
          type: 'impossible',
          severity: 'critical',
          description: `Contradictory constraints between ${guestMap.get(guest1)?.displayName} and ${guestMap.get(guest2)?.displayName}.`,
          affectedGuests: [guest1, guest2],
        });
      }
      checkedPairs.add(pairKey);
    }
  }

  // Capacity violations
  const uf = new OptimizedUnionFind();
  guests.forEach(g => uf.find(g.normalizedKey));
  for (const [guest1, guestConstraints] of Object.entries(constraints)) {
    for (const [guest2, constraint] of Object.entries(guestConstraints)) {
      if (constraint === 'must') {
        uf.union(guest1, guest2);
      }
    }
  }
  const groups = uf.getGroups();
  const maxTableCapacity = Math.max(...tables.map(t => t.capacity), 0);
  for (const group of groups) {
    const totalSize = group.reduce((sum, key) => sum + (guestMap.get(key)?.count || 0), 0);
    if (totalSize > maxTableCapacity) {
      logError('Capacity violation', { group, totalSize, maxTableCapacity });
      conflicts.push({
        id: uuidv4(),
        type: 'capacity_violation',
        severity: 'critical',
        description: `Group of ${totalSize} (${group.map(key => guestMap.get(key)?.displayName).join(', ')}) exceeds largest table capacity of ${maxTableCapacity}.`,
        affectedGuests: group,
      });
    }
  }

  // Adjacency conflicts
  if (checkAdjacents && Object.keys(adjacents).length > 0) {
    const adjacencyConflicts = new Set<string>();
    for (const [guest1, adjacentList] of Object.entries(adjacents)) {
      const guest1Count = guestMap.get(guest1)?.count || 0;
      const totalAdjacentSeats = adjacentList.reduce((sum, adj) => sum + (guestMap.get(adj)?.count || 0), 0);
      if (totalAdjacentSeats + guest1Count > maxTableCapacity) {
        const conflictKey = [guest1, ...adjacentList].sort().join('--');
        if (!adjacencyConflicts.has(conflictKey)) {
          logError('Adjacency capacity violation', { guest1, adjacentList });
          conflicts.push({
            id: uuidv4(),
            type: 'adjacency_violation',
            severity: 'high',
            description: `Adjacency preferences for ${guestMap.get(guest1)?.displayName} (${totalAdjacentSeats + guest1Count} seats) exceed largest table capacity of ${maxTableCapacity}.`,
            affectedGuests: [guest1, ...adjacentList],
          });
          adjacencyConflicts.add(conflictKey);
        }
      }
    }
  }

  return conflicts;
}

/**
 * Calculates the number of constraints for a group
 */
function calculateConstraintCount(
  group: GuestUnit[],
  constraints: Record<string, Record<string, Constraint>>
): number {
  return group.reduce((count, unit) => {
    const guestConstraints = constraints[unit.normalizedKey] || {};
    return count + Object.keys(guestConstraints).length;
  }, 0);
}

/**
 * Builds atomic groups of guests that must sit together
 */
function buildAtomicGroups(
  guests: GuestUnit[],
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>
): AtomicGroup[] {
  const uf = new OptimizedUnionFind();
  const guestMap = new Map(guests.map(g => [g.normalizedKey, g]));
  guests.forEach(g => uf.find(g.normalizedKey));

  for (const [key1, guestConstraints] of Object.entries(constraints)) {
    for (const [key2, constraint] of Object.entries(guestConstraints)) {
      if (constraint === 'must') uf.union(key1, key2);
    }
  }
  for (const [key1, adjacentGuests] of Object.entries(adjacents)) {
    for (const key2 of adjacentGuests) {
      uf.union(key1, key2);
    }
  }

  return uf.getGroups().map(groupKeys => {
    const units = groupKeys.map(key => guestMap.get(key)).filter((g): g is GuestUnit => !!g);
    const totalCount = units.reduce((sum, u) => sum + u.count, 0);
    const priority = units.some(u => /bride|groom/i.test(u.displayName)) ? 25 : 0;
    const constraintCount = calculateConstraintCount(units, constraints);
    return { units, totalCount, priority, constraintCount };
  }).sort((a, b) => (b.priority - a.priority) || (b.totalCount - a.totalCount));
}

/**
 * Checks if a group can be placed on a table without violating constraints
 */
function canPlaceGroupOnTable(
  group: GuestUnit[],
  table: SeatedTable,
  constraints: Record<string, Record<string, Constraint>>
): boolean {
  for (const newGuest of group) {
    for (const existingGuest of table.seats) {
      if (
        constraints[newGuest.normalizedKey]?.[existingGuest.normalizedKey] === 'cannot' ||
        constraints[existingGuest.normalizedKey]?.[newGuest.normalizedKey] === 'cannot'
      ) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Scores a seating plan based on constraints and preferences
 */
function scorePlan(
  plan: SeatingPlan,
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>
): number {
  let score = 0;
  const totalGuests = plan.tables.flatMap(t => t.seats).length + plan.unseatedGuests.length;

  // Seated percentage
  if (totalGuests > 0) {
    score += (plan.tables.flatMap(t => t.seats).length / totalGuests) * 1000;
  }

  // Table utilization balance
  const utilizations = plan.tables.map(t => {
    const used = t.seats.reduce((sum, g) => sum + g.count, 0);
    return t.capacity > 0 ? used / t.capacity : 0;
  });
  if (utilizations.length > 1) {
    const avg = utilizations.reduce((sum, util) => sum + util, 0) / utilizations.length;
    const variance = utilizations.reduce((sum, util) => sum + Math.pow(util - avg, 2), 0) / utilizations.length;
    score -= variance * 100;
  }

  // Must constraints
  plan.tables.forEach(table => {
    for (let i = 0; i < table.seats.length; i++) {
      for (let j = i + 1; j < table.seats.length; j++) {
        const g1 = table.seats[i].normalizedKey;
        const g2 = table.seats[j].normalizedKey;
        if (constraints[g1]?.[g2] === 'must' || constraints[g2]?.[g1] === 'must') {
          score += 500;
        }
      }
    }
  });

  // Cannot constraints
  let violatedCannot = 0;
  plan.tables.forEach(table => {
    for (let i = 0; i < table.seats.length; i++) {
      for (let j = i + 1; j < table.seats.length; j++) {
        const g1 = table.seats[i].normalizedKey;
        const g2 = table.seats[j].normalizedKey;
        if (constraints[g1]?.[g2] === 'cannot' || constraints[g2]?.[g1] === 'cannot') {
          violatedCannot++;
        }
      }
    }
  });
  score -= violatedCannot * 150;

  // Adjacency preferences
  plan.tables.forEach(table => {
    const seatedKeys = table.seats.map(g => g.normalizedKey);
    for (const guest of table.seats) {
      const desiredAdjacents = adjacents[guest.normalizedKey] || [];
      const satisfied = desiredAdjacents.filter(adj => seatedKeys.includes(adj)).length;
      score += satisfied * 50;
    }
  });

  // Priority bonus
  plan.tables.forEach(table => {
    if (table.seats.some(g => /bride|groom/i.test(g.displayName))) {
      score += 100;
    }
  });

  return Math.max(0, Math.round(score));
}

/**
 * Checks if a plan is sufficiently unique compared to existing plans
 */
function isPlanSufficientlyUnique(
  newPlan: SeatingPlan,
  existingPlans: SeatingPlan[],
  threshold: number
): boolean {
  const layoutHash = newPlan.tables
    .map(t => t.seats.map(g => g.normalizedKey).sort().join(','))
    .sort()
    .join('|');
  for (const plan of existingPlans) {
    const planHash = plan.tables
      .map(t => t.seats.map(g => g.normalizedKey).sort().join(','))
      .sort()
      .join('|');
    if (planHash === layoutHash) return false;

    let matchingGuests = 0;
    const totalGuests = newPlan.tables.flatMap(t => t.seats).length;
    for (const newTable of newPlan.tables) {
      const matchingTable = plan.tables.find(t => t.id === newTable.id);
      if (matchingTable) {
        const newGuests = new Set(newTable.seats.map(g => g.normalizedKey));
        const existingGuests = new Set(matchingTable.seats.map(g => g.normalizedKey));
        const intersection = [...newGuests].filter(g => existingGuests.has(g)).length;
        matchingGuests += intersection;
      }
    }
    if (totalGuests > 0 && matchingGuests / totalGuests > threshold) {
      return false;
    }
  }
  return true;
}

/**
 * Shuffles an array using a seedable RNG
 */
function enhancedShuffle<T>(array: T[]): T[] {
  const rng = process.env.SEED_RANDOM ? seedrandom(process.env.SEED_RANDOM) : Math.random;
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Interleaves two arrays for diversity strategies
 */
function interleaveArrays<T>(array1: T[], array2: T[]): T[] {
  const result: T[] = [];
  const maxLength = Math.max(array1.length, array2.length);
  for (let i = 0; i < maxLength; i++) {
    if (i < array1.length) result.push(array1[i]);
    if (i < array2.length) result.push(array2[i]);
  }
  return result;
}

/**
 * Applies a diversity strategy to reorder groups
 */
function applyDiversityStrategy(
  groups: AtomicGroup[],
  strategy: DiversityStrategy,
  constraints: Record<string, Record<string, Constraint>>
): AtomicGroup[] {
  switch (strategy) {
    case 'shuffle':
      return enhancedShuffle(groups);
    case 'reverse':
      return [...groups].reverse();
    case 'size-first':
      return [...groups].sort((a, b) => b.totalCount - a.totalCount);
    case 'size-last':
      return [...groups].sort((a, b) => a.totalCount - b.totalCount);
    case 'random-pairs':
      const paired = [];
      const shuffled = enhancedShuffle(groups);
      for (let i = 0; i < shuffled.length; i += 2) {
        paired.push(shuffled[i]);
        if (i + 1 < shuffled.length) paired.push(shuffled[i + 1]);
      }
      return paired;
    case 'priority-first':
      return [...groups].sort((a, b) => b.priority - a.priority || b.totalCount - a.totalCount);
    case 'vip-scatter':
      const vips = groups.filter(g => g.priority > 0);
      const regular = groups.filter(g => g.priority === 0);
      return interleaveArrays(vips, regular);
    case 'constraint-heavy-first':
      return [...groups].sort((a, b) => b.constraintCount - a.constraintCount);
    default:
      return groups;
  }
}

/**
 * Optimizes seating order on a table based on adjacency preferences
 */
function optimizeSeatingOrder(
  table: SeatedTable,
  adjacents: Record<string, string[]>
): GuestUnit[] {
  const orderedSeats: GuestUnit[] = [];
  const availableGuests = new Set(table.seats.map(g => g.normalizedKey));
  const guestMap = new Map(table.seats.map(g => [g.normalizedKey, g]));

  let currentGuest = table.seats.find(g => /bride|groom/i.test(g.displayName)) || table.seats[0];
  if (!currentGuest) return table.seats;

  orderedSeats.push(currentGuest);
  availableGuests.delete(currentGuest.normalizedKey);

  while (availableGuests.size > 0) {
    const desiredAdjacents = adjacents[currentGuest.normalizedKey] || [];
    const nextGuestKey = desiredAdjacents.find(adj => availableGuests.has(adj));
    if (nextGuestKey && guestMap.has(nextGuestKey)) {
      currentGuest = guestMap.get(nextGuestKey)!;
      orderedSeats.push(currentGuest);
      availableGuests.delete(nextGuestKey);
    } else {
      const next = availableGuests.values().next().value;
      if (!next) break;
      currentGuest = guestMap.get(next)!;
      orderedSeats.push(currentGuest);
      availableGuests.delete(next);
    }
  }

  return orderedSeats;
}

/**
 * Enhances a plan with optimized seating order
 */
function enhancePlanWithOptimizations(
  plan: SeatingPlan,
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>
): SeatingPlan {
  const optimizedTables = plan.tables.map(table => ({
    ...table,
    seats: optimizeSeatingOrder(table, adjacents),
  }));
  return {
    ...plan,
    tables: optimizedTables,
    score: scorePlan({ ...plan, tables: optimizedTables }, constraints, adjacents),
  };
}

/**
 * Creates a seating plan from tables and unseated guests
 */
function createSeatingPlan(
  tables: SeatedTable[],
  unseated: GuestUnit[],
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>
): SeatingPlan {
  const plan = {
    id: uuidv4(),
    tables: tables.map(t => ({ id: t.id, name: t.name, capacity: t.capacity, seats: t.seats })),
    unseatedGuests: unseated,
    diagnostics: [],
    score: 0,
  };
  return enhancePlanWithOptimizations(plan, constraints, adjacents);
}

/**
 * Generates a single plan using iterative backtracking for large groups
 */
function generateSinglePlanIterative(
  atomicGroups: AtomicGroup[],
  tables: Table[],
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>,
  allowPartial: boolean
): SeatingPlan | null {
  const emptyTables: SeatedTable[] = tables
    .map(t => ({ id: t.id, name: t.name, seats: [], capacity: t.capacity, remainingSeats: t.capacity }))
    .sort((a, b) => b.capacity - a.capacity);

  const stack: { groupIndex: number; currentTables: SeatedTable[]; attempts: number }[] = [
    { groupIndex: 0, currentTables: emptyTables.map(t => ({ ...t })), attempts: 0 },
  ];
  const result = { success: false, tables: emptyTables, unseated: [] as GuestUnit[] };

  while (stack.length > 0) {
    const { groupIndex, currentTables, attempts } = stack.pop()!;
    if (attempts >= MAX_BACKTRACK_ATTEMPTS) {
      logError('Backtracking limit reached for strategy', { groupIndex });
      continue;
    }

    if (groupIndex >= atomicGroups.length) {
      result.success = true;
      result.tables = currentTables;
      break;
    }

    const currentGroup = atomicGroups[groupIndex];
    let placed = false;
    for (let i = 0; i < currentTables.length; i++) {
      const table = currentTables[i];
      if (table.remainingSeats >= currentGroup.totalCount && canPlaceGroupOnTable(currentGroup.units, table, constraints)) {
        const newTables = currentTables.map(t => ({ ...t, seats: [...t.seats] }));
        newTables[i].seats.push(...currentGroup.units);
        newTables[i].remainingSeats -= currentGroup.totalCount;

        stack.push({ groupIndex: groupIndex + 1, currentTables: newTables, attempts: attempts + 1 });
        placed = true;
      }
    }

    if (!placed && allowPartial) {
      const newTables = currentTables.map(t => ({ ...t, seats: [...t.seats] }));
      stack.push({ groupIndex: groupIndex + 1, currentTables: newTables, attempts: attempts + 1 });
      result.unseated.push(...currentGroup.units);
    }
  }

  if (result.success) {
    return createSeatingPlan(result.tables, result.unseated, constraints, adjacents);
  }
  return null;
}

/**
 * Generates a single seating plan using recursive or iterative backtracking
 */
function generateSinglePlan(
  atomicGroups: AtomicGroup[],
  tables: Table[],
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>,
  allowPartial: boolean
): SeatingPlan | null {
  if (atomicGroups.length > 200) {
    return generateSinglePlanIterative(atomicGroups, tables, constraints, adjacents, allowPartial);
  }

  const emptyTables: SeatedTable[] = tables
    .map(t => ({ id: t.id, name: t.name, seats: [], capacity: t.capacity, remainingSeats: t.capacity }))
    .sort((a, b) => b.capacity - a.capacity);

  const result = { success: false, tables: emptyTables, unseated: [] as GuestUnit[] };

  function backtrack(groupIndex: number, currentTables: SeatedTable[], attempts: number): boolean {
    if (attempts >= MAX_BACKTRACK_ATTEMPTS) {
      logError('Backtracking limit reached for strategy', { groupIndex });
      return false;
    }

    if (groupIndex >= atomicGroups.length) {
      result.success = true;
      result.tables = currentTables;
      return true;
    }

    const currentGroup = atomicGroups[groupIndex];
    for (let i = 0; i < currentTables.length; i++) {
      const table = currentTables[i];
      if (table.remainingSeats >= currentGroup.totalCount && canPlaceGroupOnTable(currentGroup.units, table, constraints)) {
        table.seats.push(...currentGroup.units);
        table.remainingSeats -= currentGroup.totalCount;

        if (backtrack(groupIndex + 1, currentTables, attempts + 1)) return true;

        table.seats.splice(table.seats.length - currentGroup.units.length, currentGroup.units.length);
        table.remainingSeats += currentGroup.totalCount;
      }
    }

    if (allowPartial) {
      result.unseated.push(...currentGroup.units);
      if (backtrack(groupIndex + 1, currentTables, attempts + 1)) return true;
      result.unseated.splice(result.unseated.length - currentGroup.units.length, currentGroup.units.length);
    }

    return false;
  }

  if (backtrack(0, emptyTables, 0)) {
    return createSeatingPlan(result.tables, result.unseated, constraints, adjacents);
  }
  return null;
}

/**
 * Generates a constraint-free seating plan
 */
function generateConstraintFreePlan(
  atomicGroups: AtomicGroup[],
  tables: Table[],
  adjacents: Record<string, string[]>
): SeatingPlan | null {
  return generateSinglePlan(atomicGroups, tables, {}, adjacents, true);
}

/**
 * Generates multiple seating plans with diverse arrangements
 */
export async function generateSeatingPlans(
  guests: GuestUnit[],
  tables: Table[],
  constraints: Record<string, Record<string, Constraint>>,
  adjacents: Record<string, string[]>,
  allowPartialSolutions: boolean = false
): Promise<SeatingResult> {
  const startTime = Date.now();
  logInfo('Starting seating plan generation', {
    guestCount: guests.length,
    tableCount: tables.length,
    constraintCount: Object.keys(constraints).length,
    adjacencyCount: Object.keys(adjacents).length,
  });

  // Input validation
  const errors = validateInputs(guests, tables, constraints, adjacents);
  const conflicts = detectConstraintConflicts(guests, constraints, tables, true, adjacents);

  if (errors.length > 0) {
    logError('Input validation failed', { errors });
    return { plans: [], errors, conflicts };
  }

  // Check for critical conflicts
  const criticalConflicts = conflicts.filter(c => c.severity === 'critical');
  if (criticalConflicts.length > 0 && !allowPartialSolutions) {
    logError('Critical constraints prevent plan generation', { conflicts: criticalConflicts });
    errors.push({
      type: 'error',
      message: 'Cannot generate plans due to critical constraints.',
      details: { conflicts: criticalConflicts },
    });
    return { plans: [], errors, conflicts };
  }

  // Build atomic groups
  const atomicGroups = buildAtomicGroups(guests, constraints, adjacents);
  let allPlans: SeatingPlan[] = [];
  const coreStrategies: DiversityStrategy[] = ['shuffle', 'reverse', 'size-first', 'size-last', 'random-pairs'];
  const advancedStrategies: DiversityStrategy[] = ['priority-first', 'vip-scatter', 'constraint-heavy-first'];

  // Phase 1: Core strategies
  const usedStrategies = new Set<string>();
  for (const strategy of coreStrategies) {
    if (allPlans.length >= MAX_PLANS_TO_RETURN) break;
    if (!usedStrategies.has(strategy)) {
      const diversifiedGroups = applyDiversityStrategy(atomicGroups, strategy, constraints);
      const newPlan = generateSinglePlan(diversifiedGroups, tables, constraints, adjacents, allowPartialSolutions);
      if (newPlan && isPlanSufficientlyUnique(newPlan, allPlans, UNIQUENESS_THRESHOLD(allPlans.length, guests.length))) {
        allPlans.push(newPlan);
        usedStrategies.add(strategy);
        logInfo(`Generated plan using ${strategy} strategy`, { score: newPlan.score });
      }
    }
  }

  // Phase 2: Advanced strategies
  for (const strategy of advancedStrategies) {
    if (allPlans.length >= MAX_PLANS_TO_RETURN) break;
    if (!usedStrategies.has(strategy)) {
      const diversifiedGroups = applyDiversityStrategy(atomicGroups, strategy, constraints);
      const newPlan = generateSinglePlan(diversifiedGroups, tables, constraints, adjacents, allowPartialSolutions);
      if (newPlan && isPlanSufficientlyUnique(newPlan, allPlans, UNIQUENESS_THRESHOLD(allPlans.length, guests.length))) {
        allPlans.push(newPlan);
        usedStrategies.add(strategy);
        logInfo(`Generated plan using ${strategy} strategy`, { score: newPlan.score });
      }
    }
  }

  // Phase 3: Fallbacks
  if (allPlans.length === 0 && allowPartialSolutions) {
    logError('No perfect solution found, ignoring cannot constraints');
    errors.push({ type: 'warning', message: 'No perfect solution found. Ignoring cannot constraints.' });
    const mustOnlyConstraints = Object.fromEntries(
      Object.entries(constraints).map(([key, value]) => [
        key,
        Object.fromEntries(Object.entries(value).filter(([, val]) => val === 'must')),
      ])
    );
    const fallbackPlan1 = generateSinglePlan(atomicGroups, tables, mustOnlyConstraints, adjacents, true);
    if (fallbackPlan1 && isPlanSufficientlyUnique(fallbackPlan1, allPlans, UNIQUENESS_THRESHOLD(allPlans.length, guests.length))) {
      allPlans.push(fallbackPlan1);
      usedStrategies.add('must-only');
      logInfo('Generated fallback plan (must-only constraints)', { score: fallbackPlan1.score });
    }
  }

  if (allPlans.length === 0 && allowPartialSolutions) {
    logError('No solution found with constraints, generating constraint-free plan');
    errors.push({ type: 'warning', message: 'No solution found with constraints. Generating constraint-free plan.' });
    const fallbackPlan2 = generateConstraintFreePlan(atomicGroups, tables, adjacents);
    if (fallbackPlan2 && isPlanSufficientlyUnique(fallbackPlan2, allPlans, UNIQUENESS_THRESHOLD(allPlans.length, guests.length))) {
      allPlans.push(fallbackPlan2);
      usedStrategies.add('constraint-free');
      logInfo('Generated fallback plan (constraint-free)', { score: fallbackPlan2.score });
    }
  }

  // Phase 4: Additional diverse plans
  for (let attempt = 0; attempt < MAX_PLANS_TO_GENERATE(guests.length) && allPlans.length < MAX_PLANS_TO_RETURN; attempt++) {
    const strategy = coreStrategies[attempt % coreStrategies.length];
    const diversifiedGroups = applyDiversityStrategy(atomicGroups, strategy, constraints);
    const newPlan = generateSinglePlan(diversifiedGroups, tables, constraints, adjacents, allowPartialSolutions);
    if (newPlan && isPlanSufficientlyUnique(newPlan, allPlans, UNIQUENESS_THRESHOLD(allPlans.length, guests.length))) {
      allPlans.push(newPlan);
      usedStrategies.add(strategy);
      logInfo(`Generated additional plan using ${strategy} strategy`, { score: newPlan.score });
    }
    if (attempt % 10 === 0 && attempt > 0) {
      logInfo(`Generation progress: ${allPlans.length} plans after ${attempt} attempts`, { usedStrategies: [...usedStrategies] });
    }
  }

  // Sort plans by score with diversity tiebreaker
  const sortedPlans = allPlans.sort((a, b) => {
    const scoreDiff = b.score - a.score;
    if (scoreDiff !== 0) return scoreDiff;
    const aGuests = new Set(a.tables.flatMap(t => t.seats.map(g => g.normalizedKey)));
    const bGuests = new Set(b.tables.flatMap(t => t.seats.map(g => g.normalizedKey)));
    const matchingGuests = [...aGuests].filter(g => bGuests.has(g)).length;
    return matchingGuests;
  }).slice(0, MAX_PLANS_TO_RETURN);

  // Final validation
  if (sortedPlans.length === 0 && errors.length === 0) {
    logError('No valid seating arrangements generated');
    errors.push({ type: 'warning', message: 'Could not generate any valid seating arrangements.' });
  }

  const endTime = Date.now();
  logInfo('Seating plan generation completed', {
    plansGenerated: sortedPlans.length,
    executionTime: `${endTime - startTime}ms`,
    bestScore: sortedPlans[0]?.score || 0,
    hasErrors: errors.length > 0,
    hasConflicts: conflicts.length > 0,
    usedStrategies: [...usedStrategies],
  });

  return {
    plans: sortedPlans,
    errors,
    conflicts,
  };
}
```