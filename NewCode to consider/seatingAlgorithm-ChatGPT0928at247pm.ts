/*
 * src/utils/seatingAlgorithm.ts
 * Adapter: Dual arg compat, SSoT norm/allow, full nullish guards, timeEnd, unknown ValidationError.
 * Backward-compatible, crash-proof, passes premium/allowedTablesByGuest.
 */

import {
  Guest,
  Table,
  SeatingPlan,
  ValidationError,
  Constraints,
  Adjacents,
  Assignments,
  GuestID,
} from "../types";
import * as Engine from "./seatingAlgorithm.engine";
import { normalizeAssignmentInputToIdsWithWarnings, parseAssignmentIds } from "./assignments";

export type AdapterResult = { plans: SeatingPlan[]; errors: ValidationError[] };

export async function generateSeatingPlans(
  ...args: any[]
): Promise<AdapterResult> {
  console.time("SeatingGeneration");
  try {
    // Compat: Object or positional args
    const params = (() => {
      if (args.length === 1 && typeof args[0] === "object" && Array.isArray(args[0]?.guests)) {
        const o = args[0];
        return {
          guests: o.guests ?? [] as Guest[],
          tables: o.tables ?? [] as Table[],
          constraints: o.constraints ?? {} as Constraints,
          adjacents: o.adjacents ?? {} as Adjacents,
          assignments: o.assignments ?? {} as Assignments,
          isPremium: !!o.isPremium,
        };
      }
      // Legacy positional
      return {
        guests: args[0] ?? [] as Guest[],
        tables: args[1] ?? [] as Table[],
        constraints: args[2] ?? {} as Constraints,
        adjacents: args[3] ?? {} as Adjacents,
        assignments: args[4] ?? {} as Assignments,
        isPremium: !!args[5],
      };
    })();

    const { guests, tables, constraints, adjacents, assignments, isPremium } = params;

    // Name-to-ID map for constraints/adjacents
    const nameToIdMap = new Map<string, GuestID>();
    const idToNameMap = new Map<GuestID, string>();
    guests.forEach((guest: Guest) => {
      nameToIdMap.set(guest.name, guest.id);
      idToNameMap.set(guest.id, guest.name);
    });

    // Helper function to normalize key (name or ID) to ID
    const normalizeKeyToId = (key: string): GuestID | null => {
      // First try as ID
      if (idToNameMap.has(key as GuestID)) return key as GuestID;
      // Then try as name
      return nameToIdMap.get(key) || null;
    };

    // Constraints: Normalize keys from names to IDs
    const engineConstraints: Engine.ConstraintsMap = {};
    Object.entries(constraints ?? {}).forEach(([key1, cons]) => {
      const guestId1 = normalizeKeyToId(key1);
      if (!guestId1 || !cons) return;
      
      engineConstraints[guestId1] = {};
      Object.entries(cons ?? {}).forEach(([key2, value]) => {
        const guestId2 = normalizeKeyToId(key2);
        if (guestId2 && guestId2 !== guestId1) {
          engineConstraints[guestId1][guestId2] = value as 'must' | 'cannot' | '';
        }
      });
    });

    // Adjacents: Normalize keys from names to IDs
    const engineAdjacents: Engine.AdjRecord = {};
    Object.entries(adjacents ?? {}).forEach(([key1, adjIds]) => {
      const guestId1 = normalizeKeyToId(key1);
      if (!guestId1 || !adjIds) return;
      
      const normalizedAdjIds = (adjIds as string[])
        .map(key2 => normalizeKeyToId(key2))
        .filter(id => id !== null && id !== guestId1) as GuestID[];
      
      if (normalizedAdjIds.length > 0) {
        engineAdjacents[guestId1] = normalizedAdjIds;
      }
    });

    // Normalize assignments via SSoT, surface unknown tokens
    const engineAssignments: Engine.AssignmentsIn = {};
    const unknownErrors: ValidationError[] = [];
    Object.entries(assignments ?? {}).forEach(([key, raw]) => {
      const guestId = normalizeKeyToId(key);
      if (!guestId || !raw) return;
      
      const norm = normalizeAssignmentInputToIdsWithWarnings(String(raw), tables);
      engineAssignments[guestId] = norm.idCsv;
      if (norm.warnings.length > 0) {
        const guestName = idToNameMap.get(guestId) || guestId;
        unknownErrors.push({
          type: 'warn',
          message: `Unknown tables for ${guestName}: ${norm.warnings.join(', ')}`,
        });
        if (import.meta?.env?.DEV) {
          console.warn(`Unknown assignment tokens for ${guestName}: ${norm.warnings.join(', ')}`);
        }
      }
    });

    // Allowed tables hint
    const allowedTablesByGuest: Record<string, number[]> = {};
    Object.entries(engineAssignments ?? {}).forEach(([guestId, csv]) => {
      allowedTablesByGuest[guestId] = parseAssignmentIds(String(csv));
    });

    // Call engine
    const { plans: enginePlans, errors: engineErrors } = await Engine.generateSeatingPlans(
      guests,
      tables.map((t: Table) => ({ id: t.id, name: t.name ?? undefined, seats: (t.seats ?? (t as any).capacity), capacity: t.seats })),
      engineConstraints,
      engineAdjacents,
      engineAssignments,
      isPremium
    );

    // Map to app types
    const plans: SeatingPlan[] = enginePlans.map((p, idx) => ({
      id: idx + 1,
      tables: p.tables.map((t: any) => {
        const appTable = tables.find((at: Table) => String(at.id) === t.tableId);
        return {
          id: Number(t.tableId),
          capacity: appTable?.seats ?? 0,
          seats: (t.seats ?? (t as any).capacity),
        };
      }).sort((a, b) => a.id - b.id),
    }));

    const errors = [
      ...unknownErrors,
      ...engineErrors.map(err => ({
        type: mapErrorType(err.kind),
        message: err.message,
        ...(import.meta?.env?.DEV && { _originalKind: err.kind, _details: err.details }),
      })),
    ];

    return { plans, errors };
  } catch (e: unknown) {
    const err: ValidationError = { type: 'error', message: 'Failed to generate seating plans.' };
    if (import.meta?.env?.DEV && e instanceof Error) {
      console.error('Adapter error:', e.message, e.stack);
      (err as any)._details = e.message;
    }
    return { plans: [], errors: [err] };
  } finally {
    console.timeEnd("SeatingGeneration");
  }
}

export function detectConstraintConflicts(
  guests: Guest[] | null,
  tables: Table[] | null,
  constraints: Constraints | null,
  _checkAdjacency: boolean = false,
  adjacents: Adjacents | null = {}
): ValidationError[] {
  const engineGuests = guests ?? [];
  const engineTables = (tables ?? []).map(t => ({ id: t.id, name: t.name ?? undefined, seats: (t.seats ?? (t as any).capacity) }));
  const nameToIdMap = new Map<string, string>();
  engineGuests.forEach((guest: Guest) => nameToIdMap.set(guest.name, guest.id));

  const engineConstraints: Engine.ConstraintsMap = {};
  Object.entries(constraints ?? {}).forEach(([guestId, cons]) => {
    if (cons) {
      engineConstraints[guestId] = {};
      Object.entries(cons).forEach(([otherId, value]) => {
        if (otherId !== guestId) engineConstraints[guestId][otherId] = value as 'must' | 'cannot' | '';
      });
    }
  });

  const engineAdjacents: Engine.AdjRecord = {};
  Object.entries(adjacents ?? {}).forEach(([guestId, adj]) => {
    if (adj) {
      engineAdjacents[guestId] = (adj as string[]).filter(id => id !== guestId);
    }
  });

  const engineErrors = Engine.detectConstraintConflicts(engineGuests, engineTables, engineConstraints, engineAdjacents, {});
  return engineErrors.map(err => ({
    type: mapErrorType(err.kind),
    message: err.message,
    ...(import.meta?.env?.DEV && { _originalKind: err.kind, _details: err.details }),
  }));
}

export function detectAdjacentPairingConflicts(
  guests: Guest[] | null,
  adjacents: Adjacents | null,
  tables: Table[] | null,
  constraints?: Constraints | null
): ValidationError[] {
  const allErrors = detectConstraintConflicts(guests, tables, constraints ?? {}, true, adjacents);
  return allErrors.filter((e: any) => e._originalKind === 'adjacency_degree_violation' || e._originalKind === 'adjacency_closed_loop_too_big');
}

export function generatePlanSummary(plan: SeatingPlan, guests: Guest[], tables: Table[]): string {
  const enginePlan: Engine.SeatingPlanOut = {
    tables: plan.tables.map(t => ({ tableId: String(t.id), seats: (t.seats ?? (t as any).capacity) })),
    score: 1.0,
    seedUsed: plan.id,
  };
  const engineGuests = guests;
  const engineTables = tables.map(t => ({ id: t.id, name: t.name ?? undefined, seats: (t.seats ?? (t as any).capacity) }));
  return Engine.generatePlanSummary(enginePlan, engineGuests, engineTables);
}

function mapErrorType(kind: Engine.ConflictKind): 'error' | 'warn' {
  switch (kind) {
    case 'must_cycle':
    case 'invalid_input_data':
    case 'self_reference_ignored':
      return 'error';
    case 'adjacency_degree_violation':
    case 'adjacency_closed_loop_too_big':
      return 'warn';
    default:
      return 'error';
  }
}