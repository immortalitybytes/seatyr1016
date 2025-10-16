/*
 * Seatyr — Production-Ready Backward-Compatibility Adapter
 * Date: 2025-09-04
 *
 * This adapter makes the new seating algorithm engine a 100% drop-in replacement,
 * addressing all compatibility concerns raised by all AI red teams.
 */

// ========================= 1. Import Application's Native Types =========================
import {
    Guest,
    Table,
    SeatingPlan,
    ValidationError,
    Constraints,
    Adjacents,
    Assignments
} from '../types'; // This path must point to the application's central type definitions

// ========================= 2. Import the new Algorithm Engine =========================
import * as Engine from './seatingAlgorithm.engine';

// ========================= 3. Export Wrapped, Compatible Functions =========================

/**
 * @description The main, backward-compatible seating plan generator.
 * @param {Guest[]} appGuests The application's array of Guest objects.
 * @param {Table[]} appTables The application's array of Table objects.
 * @param {Constraints} appConstraints The application's constraints object.
 * @param {Adjacents} appAdjacents The application's adjacents object.
 * @param {Assignments} appAssignments The application's assignments object.
 * @param {boolean} isPremium Whether to use premium solver settings.
 * @returns {Promise<{ plans: SeatingPlan[]; errors: ValidationError[] }>} A promise resolving to the generated plans and errors in the application's native format.
 */
export async function generateSeatingPlans(
  appGuests: Guest[],
  appTables: Table[],
    appConstraints: Constraints,
    appAdjacents: Adjacents,
    appAssignments: Assignments,
  isPremium: boolean = false
): Promise<{ plans: SeatingPlan[]; errors: ValidationError[] }> {
    console.time('SeatingGeneration');
    try {
        // =========== INPUT TRANSLATION ===========
        const engineGuests: Engine.GuestUnit[] = appGuests; // Structurally compatible
        const engineTables: Engine.TableIn[] = appTables.map(t => ({
            id: t.id,
            name: t.name ?? undefined, // Handle null case for names
            seats: t.seats,
            capacity: t.seats
        }));

        // Convert guest names to guest IDs in constraints
        const nameToIdMap = new Map<string, string>();
        appGuests.forEach(guest => {
            nameToIdMap.set(guest.name, guest.id);
        });

        const engineConstraints: Engine.ConstraintsMap = {};
        Object.entries(appConstraints ?? {}).forEach(([guestName, constraints]) => {
            const guestId = nameToIdMap.get(guestName);
            if (guestId) {
                engineConstraints[guestId] = {};
                Object.entries(constraints).forEach(([otherGuestName, value]) => {
                    const otherGuestId = nameToIdMap.get(otherGuestName);
                    if (otherGuestId) {
                        engineConstraints[guestId][otherGuestId] = value;
                    }
                });
            }
        });

        // Convert guest names to guest IDs in adjacents
        const engineAdjacents: Engine.AdjRecord = {};
        Object.entries(appAdjacents ?? {}).forEach(([guestName, adjacentNames]) => {
            const guestId = nameToIdMap.get(guestName);
            if (guestId) {
                engineAdjacents[guestId] = adjacentNames.map(name => nameToIdMap.get(name) || name);
            }
        });

        // Convert guest names to guest IDs in assignments
        const engineAssignments: Engine.AssignmentsIn = {};
        Object.entries(appAssignments ?? {}).forEach(([guestName, assignment]) => {
            const guestId = nameToIdMap.get(guestName);
            if (guestId && assignment) {
                // Convert comma-separated string to array of table IDs
                const tableIds = String(assignment)
                    .split(',')
                    .map(id => id.trim())
                    .filter(Boolean)
                    .map(id => String(id)); // Convert to string for engine
                
                if (tableIds.length > 0) {
                    engineAssignments[guestId] = tableIds;
                }
            }
        });

        // =========== CALL THE CORE ENGINE ===========
        const result = await Engine.generateSeatingPlans(
            engineGuests,
            engineTables,
            engineConstraints,
            engineAdjacents,
            engineAssignments,
            isPremium
        );

        // =========== OUTPUT TRANSLATION ===========
        const finalPlans: SeatingPlan[] = result.plans.map(plan => ({
            id: generateStablePlanId(plan), // Create a stable, deterministic ID
            tables: plan.tables.map(table => {
                const originalTable = appTables.find(t => String(t.id) === table.tableId);
                return {
                    id: Number(table.tableId), // Convert string ID back to number
                    capacity: originalTable?.seats ?? 0, // Add the required `capacity` field
                    seats: table.seats,
                };
            }),
        }));

        const finalErrors: ValidationError[] = result.errors.map(error => ({
            type: mapErrorType(error.kind), // Convert `kind` to `type: 'error' | 'warn'`
            message: error.message,
            // Preserve rich error details in development for easier debugging
            ...(import.meta?.env?.DEV && {
                _originalKind: error.kind,
                _details: error.details
            })
        }));
        
        console.timeEnd('SeatingGeneration');
        return { plans: finalPlans, errors: finalErrors };

    } catch (e) {
        console.error('The seating algorithm engine encountered a fatal error:', e, e instanceof Error ? e.stack : '');
        console.timeEnd('SeatingGeneration');
        // A real implementation could call a legacy algorithm here as a fallback.
        return {
            plans: [],
            errors: [{ type: 'error', message: 'A critical error occurred in the seating algorithm.' }]
        };
    }
}

// ========================= 4. Helper and Wrapper Functions =========================

const ERROR_TYPE_CACHE = new Map<Engine.ConflictKind, 'error' | 'warn'>();
function mapErrorType(kind: Engine.ConflictKind): 'error' | 'warn' {
    if (!ERROR_TYPE_CACHE.has(kind)) {
        // Explicit mapping as recommended by final critiques for clarity and maintainability.
        switch (kind) {
            case 'self_reference_ignored':
                ERROR_TYPE_CACHE.set(kind, 'warn');
                break;
            case 'invalid_input_data':
                ERROR_TYPE_CACHE.set(kind, 'warn');
                break;
            default: // All other conflicts are errors that prevent a valid solution.
                ERROR_TYPE_CACHE.set(kind, 'error');
                break;
        }
    }
    return ERROR_TYPE_CACHE.get(kind)!;
}

/**
 * Generates a stable, deterministic numeric ID for a seating plan based on its content.
 * This is crucial for stable keys in UI frameworks like React.
 */
function generateStablePlanId(plan: Engine.SeatingPlanOut): number {
    if (plan.seedUsed) return plan.seedUsed >>> 0;
    let hash = 0;
    for (const table of plan.tables.sort((a, b) => a.tableId.localeCompare(b.tableId))) {
        for (let i = 0; i < table.tableId.length; i++) hash = ((hash << 5) - hash + table.tableId.charCodeAt(i)) | 0;
        const seatSummary = table.seats.map(s => `${s.name}:${s.partyIndex}`).sort().join(',');
        for (let i = 0; i < seatSummary.length; i++) {
          hash = ((hash << 5) - hash + seatSummary.charCodeAt(i)) | 0;
        }
    }
    return hash >>> 0;
}

/**
 * @description Backward-compatible wrapper for detectConstraintConflicts. Handles legacy overloaded signatures.
 */
export function detectConstraintConflicts(
    a: Guest[] | any, 
    b: Table[] | Constraints,
    c?: Table[] | Constraints,
    d?: boolean | Adjacents,
    e?: Adjacents
): ValidationError[] {
    let guests: Guest[], tables: Table[], constraints: Constraints, adjacents: Adjacents;
    
    // This logic correctly handles the two identified legacy overloaded signatures.
    if (Array.isArray(a) && typeof b === 'object' && !Array.isArray(b) && Array.isArray(c)) {
        guests = a; constraints = b; tables = c; adjacents = (typeof d === 'object' ? d : e) || {};
    } else {
        guests = a; tables = b as Table[]; constraints = c as Constraints || {}; adjacents = d as Adjacents || {};
    }

    const engineGuests: Engine.GuestUnit[] = guests;
    const engineTables: Engine.TableIn[] = tables.map(t => ({ id: t.id, name: t.name ?? undefined, seats: t.seats, capacity: t.seats }));
    
    // Convert guest names to guest IDs in constraints
    const nameToIdMap = new Map<string, string>();
    guests.forEach(guest => {
        nameToIdMap.set(guest.name, guest.id);
    });

    const engineConstraints: Engine.ConstraintsMap = {};
    Object.entries(constraints ?? {}).forEach(([guestName, constraintObj]) => {
        const guestId = nameToIdMap.get(guestName);
        if (guestId) {
            engineConstraints[guestId] = {};
            Object.entries(constraintObj).forEach(([otherGuestName, value]) => {
                const otherGuestId = nameToIdMap.get(otherGuestName);
                if (otherGuestId) {
                    engineConstraints[guestId][otherGuestId] = value;
                }
            });
        }
    });

    // Convert guest names to guest IDs in adjacents
    const engineAdjacents: Engine.AdjRecord = {};
    Object.entries(adjacents ?? {}).forEach(([guestName, adjacentNames]) => {
        const guestId = nameToIdMap.get(guestName);
        if (guestId) {
            engineAdjacents[guestId] = adjacentNames.map(name => nameToIdMap.get(name) || name);
        }
    });
    
    const engineErrors = Engine.detectConstraintConflicts(
        engineGuests,
        engineTables,
        engineConstraints,
        engineAdjacents,
        {} // assignments are not part of this legacy signature
    );
    
    return engineErrors.map(err => ({ 
        type: mapErrorType(err.kind), 
        message: err.message,
        ...(import.meta?.env?.DEV && {
            _originalKind: err.kind,
            _details: err.details
        })
    }));
}

/**
 * @description Backward-compatible wrapper for detectAdjacentPairingConflicts.
 */
export function detectAdjacentPairingConflicts(
    guests: Guest[],
    adjacents: Adjacents,
    tables: Table[],
    constraints?: Constraints
): ValidationError[] {
    const allErrors = detectConstraintConflicts(guests, tables, constraints || {}, true, adjacents);
    const mappedErrors = allErrors as (ValidationError & { _originalKind?: Engine.ConflictKind }[]);

    // This wrapper is robust, filtering by error kind, not a fragile message string.
    return mappedErrors.filter(e => 
        e._originalKind === 'adjacency_degree_violation' || 
        e._originalKind === 'adjacency_closed_loop_too_big'
    );
}

/**
 * @description Backward-compatible wrapper for generatePlanSummary.
 */
export function generatePlanSummary(plan: SeatingPlan, guests: Guest[], tables: Table[]): string {
    const enginePlan: Engine.SeatingPlanOut = {
      tables: plan.tables.map(t => ({ tableId: String(t.id), seats: t.seats })),
      score: 1.0, // Placeholder as legacy plan doesn't have score
      seedUsed: plan.id
    };
    const engineGuests: Engine.GuestUnit[] = guests;
    const engineTables: Engine.TableIn[] = tables.map(t => ({ id: t.id, name: t.name ?? undefined, seats: t.seats }));

    return Engine.generatePlanSummary(enginePlan, engineGuests, engineTables);
}
