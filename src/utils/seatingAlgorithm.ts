/*
 * Adapter over engine with backward-compatible args & app types.
 * No UI changes; surfaces engine errors as {type,message}.
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
import { getCapacity } from "./tables";
import { countHeads } from "./guestCount";

export type AdapterResult = { plans: SeatingPlan[]; errors: ValidationError[] };

export async function generateSeatingPlans(...args: any[]): Promise<AdapterResult> {
  console.time("SeatingGeneration");
  try {
    const params =
      args.length === 1 && typeof args[0] === "object" && Array.isArray(args[0]?.guests)
        ? {
            guests: (args[0].guests ?? []) as Guest[],
            tables: (args[0].tables ?? []) as Table[],
            constraints: (args[0].constraints ?? {}) as Constraints,
            adjacents: (args[0].adjacents ?? {}) as Adjacents,
            assignments: (args[0].assignments ?? {}) as Assignments,
            isPremium: !!args[0].isPremium,
          }
        : {
            guests: (args[0] ?? []) as Guest[],
            tables: (args[1] ?? []) as Table[],
            constraints: (args[2] ?? {}) as Constraints,
            adjacents: (args[3] ?? {}) as Adjacents,
            assignments: (args[4] ?? {}) as Assignments,
            isPremium: !!args[5],
          };

    const { guests, tables, constraints, adjacents, assignments, isPremium } = params;

    const nameToId = new Map<string, GuestID>();
    const idToName = new Map<GuestID, string>();
    for (const g of guests) {
      nameToId.set(g.name, g.id);
      idToName.set(g.id, g.name);
    }

    const toId = (k: string): GuestID | null => {
      if (idToName.has(k as GuestID)) return k as GuestID;
      return nameToId.get(k) || null;
    };

    const engineConstraints: Engine.ConstraintsMap = {};
    Object.entries(constraints ?? {}).forEach(([k1, cons]) => {
      const id1 = toId(k1);
      if (!id1 || !cons) return;
      engineConstraints[id1] = {};
      Object.entries(cons ?? {}).forEach(([k2, v]) => {
        const id2 = toId(k2);
        if (id2 && id2 !== id1) engineConstraints[id1][id2] = v as "must" | "cannot" | "";
      });
    });

    const engineAdj: Engine.AdjRecord = {};
    Object.entries(adjacents ?? {}).forEach(([k1, list]) => {
      const id1 = toId(k1);
      if (!id1 || !list) return;
      const ids = (list as string[])
        .map((k2) => toId(k2))
        .filter((id) => id && id !== id1) as string[];
      if (ids.length) engineAdj[id1] = ids;
    });

    const engineAssignments: Engine.AssignmentsIn = {};
    const unknownErrors: ValidationError[] = [];
    Object.entries(assignments ?? {}).forEach(([guestKey, raw]) => {
      const gid = toId(guestKey);
      if (!gid || !raw) return;
      const norm = normalizeAssignmentInputToIdsWithWarnings(String(raw), tables);
      engineAssignments[gid] = norm.idCsv;
      if (norm.warnings.length > 0) {
        const gname = idToName.get(gid) || gid;
        unknownErrors.push({
          type: "warn",
          message: `Unknown tables for ${gname}: ${norm.warnings.join(", ")}`,
        });
        if (import.meta?.env?.DEV) {
          console.warn(`Unknown assignment tokens for ${gname}: ${norm.warnings.join(", ")}`);
        }
      }
    });

    const allowedTablesByGuest: Record<string, number[]> = {};
    Object.entries(engineAssignments).forEach(([gid, csv]) => {
      allowedTablesByGuest[gid] = parseAssignmentIds(String(csv));
    });

    const engineGuests = guests.map((g) => ({
      ...g,
      id: String(g.id),
      name: g.name ?? `Guest ${g.id}`,
      count: Math.max(1, Math.floor(Number(g.count ?? countHeads(g.name)) || 1)),
    }));
    const engineTables = tables.map((t) => ({
      id: t.id,
      name: t.name ?? undefined,
      seats: Array.isArray(t.seats) ? t.seats : [],
      capacity: getCapacity(t),
    }));

    const { plans: enginePlans, errors: engineErrors } = await Engine.generateSeatingPlans(
      engineGuests as any,
      engineTables as any,
      engineConstraints,
      engineAdj,
      engineAssignments,
      isPremium,
    );

    const plans: SeatingPlan[] = enginePlans
      .map((p, idx) => ({
        id: idx + 1,
        tables: p.tables
          .map((t) => {
            const appTable = tables.find((at) => String(at.id) === String(t.tableId));
            return {
              id: Number(t.tableId),
              capacity: appTable?.seats ?? 0,
              seats: Array.isArray(t.seats) ? t.seats : [],
            };
          })
          .sort((a, b) => a.id - b.id),
      }))
      .sort((a, b) => a.id - b.id);

    const errors = [
      ...unknownErrors,
      ...engineErrors.map((e) => ({
        type: mapErrorType(e.kind),
        message: e.message,
        ...(import.meta?.env?.DEV && { _originalKind: e.kind, _details: e.details }),
      })),
    ];

    return { plans, errors };
  } catch (e: unknown) {
    const err: ValidationError = { type: "error", message: "Failed to generate seating plans." };
    if (import.meta?.env?.DEV && e instanceof Error) {
      console.error("Adapter error:", e.message, e.stack);
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
  adjacents: Adjacents | null = {},
): ValidationError[] {
  const engineGuests = (guests ?? []).map((g) => ({
    ...g,
    id: String(g.id),
    name: g.name ?? `Guest ${g.id}`,
    count: Math.max(1, Math.floor(Number(g.count ?? countHeads(g.name)) || 1)),
  }));
  const engineTables = (tables ?? []).map((t) => ({
    id: t.id,
    name: t.name ?? undefined,
    seats: Array.isArray(t.seats) ? t.seats : [],
    capacity: getCapacity(t),
  }));
  const engineConstraints: Engine.ConstraintsMap = {};
  Object.entries(constraints ?? {}).forEach(([gid, row]) => {
    if (!row) return;
    engineConstraints[gid] = {};
    Object.entries(row).forEach(([other, v]) => {
      if (other !== gid) engineConstraints[gid][other] = v as "must" | "cannot" | "";
    });
  });
  const engineAdj: Engine.AdjRecord = {};
  Object.entries(adjacents ?? {}).forEach(([gid, list]) => {
    if (!list) return;
    engineAdj[gid] = (list as string[]).filter((id) => id !== gid);
  });

  const errs = Engine.detectConstraintConflicts(engineGuests as any, engineTables as any, engineConstraints, engineAdj, {});
  return errs.map((e) => ({
    type: mapErrorType(e.kind),
    message: e.message,
    ...(import.meta?.env?.DEV && { _originalKind: e.kind, _details: e.details }),
  }));
}

export function detectAdjacentPairingConflicts(
  guests: Guest[] | null,
  adjacents: Adjacents | null,
  tables: Table[] | null,
  constraints?: Constraints | null,
): ValidationError[] {
  const all = detectConstraintConflicts(guests, tables, constraints ?? {}, true, adjacents);
  return all.filter(
    (e: any) =>
      e._originalKind === "adjacency_degree_violation" ||
      e._originalKind === "adjacency_closed_loop_too_big" ||
      e._originalKind === "adjacency_closed_loop_not_exact",
  );
}

export function generatePlanSummary(plan: SeatingPlan, guests: Guest[], tables: Table[]): string {
  const enginePlan: Engine.SeatingPlanOut = {
    tables: plan.tables.map((t) => ({ tableId: String(t.id), seats: Array.isArray(t.seats) ? t.seats : [] })),
    score: 1.0,
    seedUsed: plan.id,
  };
  const engineGuests = guests.map((g) => ({
    ...g,
    id: String(g.id),
    name: g.name ?? `Guest ${g.id}`,
    count: Math.max(1, Math.floor(Number(g.count ?? countHeads(g.name)) || 1)),
  }));
  const engineTables = tables.map((t) => ({
    id: t.id,
    name: t.name ?? undefined,
    seats: Array.isArray(t.seats) ? t.seats : [],
    capacity: getCapacity(t),
  }));
  return Engine.generatePlanSummary(enginePlan, engineGuests as any, engineTables as any);
}

function mapErrorType(kind: Engine.ConflictKind): "error" | "warn" {
  switch (kind) {
    case "must_cycle":
    case "invalid_input_data":
    case "self_reference_ignored":
    case "assignment_conflict":
    case "cant_within_must_group":
    case "group_too_big_for_any_table":
    case "unknown_guest":
    case "adjacency_closed_loop_not_exact":
      return "error";
    case "adjacency_degree_violation":
    case "adjacency_closed_loop_too_big":
      return "warn";
    default:
      return "error";
  }
}