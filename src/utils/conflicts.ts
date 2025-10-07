import type { Guest, Table, Constraints, Assignments, GuestID, ValidationError } from '../types';
import { getCapacity } from './tables';

// Helper to find MUST groups (guests who MUST sit together)
function findMustGroups(guests: Guest[], musts: Constraints['must']): GuestID[][] {
    const mustGroups: GuestID[][] = [];
    const visited = new Set<GuestID>();
    const mustMap: Record<GuestID, GuestID[]> = {};

    if (!musts) return [];

    // Build adjacency list for MUST constraints
    for (const [g1, targets] of Object.entries(musts)) {
        if (!mustMap[g1]) mustMap[g1] = [];
        for (const g2 of targets) {
            mustMap[g1].push(g2);
            if (!mustMap[g2]) mustMap[g2] = [];
            mustMap[g2].push(g1);
        }
    }

    // Find connected components (MUST groups) using DFS
    const allGuestIds = guests.map(g => g.id);
    for (const guestId of allGuestIds) {
        if (visited.has(guestId)) continue;
        
        const group: GuestID[] = [];
        const stack: GuestID[] = [guestId];
        visited.add(guestId);

        while (stack.length > 0) {
            const current = stack.pop()!;
            group.push(current);

            // Check if current guest has any MUST links
            const neighbors = mustMap[current] || [];
            for (const neighbor of neighbors) {
                if (!visited.has(neighbor)) {
                    visited.add(neighbor);
                    stack.push(neighbor);
                }
            }
        }

        if (group.length > 1) {
            mustGroups.push(group);
        }
    }

    return mustGroups;
}

/**
 * Detects groups of guests linked by MUST constraints that cannot be satisfied.
 * This function handles two main impossible cases:
 * 1. The total size of the MUST group exceeds the capacity of *every* available table.
 * 2. The MUST group is assigned to a table that is explicitly too small for the group. (Fix C7)
 * * @param guests Full guest list.
 * @param tables Full table list (with capacity property derived via getCapacity).
 * @param musts The MUST constraints map.
 * @param assignments The assignments map.
 * @returns Array of ValidationError objects.
 */
export function detectUnsatisfiableMustGroups(
    guests: Guest[],
    tables: Table[], // Expects tables to have capacity property
    musts: Constraints['must'],
    assignments: Assignments
): ValidationError[] {
    const messages: ValidationError[] = [];
    const guestMap = new Map(guests.map(g => [g.id, g]));
    const tableCapById = new Map(tables.map(t => [t.id, getCapacity(t)]));
    
    // Find all groups where guests must sit together
    const mustGroups = findMustGroups(guests, musts);

    for (const group of mustGroups) {
        // Calculate the total size of the MUST group
        const groupSize = group.reduce((sum, gid) => sum + (guestMap.get(gid)?.count || 1), 0);
        
        // Find tables to which any member of the group is assigned (hard constraints)
    const hardTables = new Set<number>();
    for (const gid of group) {
            const tableAssignments = assignments[gid];
            if (tableAssignments) {
                const ids = tableAssignments.split(',').map(id => parseInt(id.trim(), 10)).filter(id => Number.isFinite(id));
                ids.forEach(id => hardTables.add(id));
            }
        }
        
        // --- Impossible Case #1 & #2: Group bigger than all candidate tables or explicitly assigned table ---
        const allTableIds = tables.map(t => t.id);
        const candidates = hardTables.size > 0 ? Array.from(hardTables) : allTableIds;
        
        // Check if any candidate table (assigned or all) fits the group size
    const anyCandidateFits = candidates.some(id => {
      const cap = tableCapById.get(id);
      return (typeof cap !== 'number') || cap >= groupSize;
    });

    if (!anyCandidateFits) {
            const names = group.map(gid => guestMap.get(gid)?.name || gid).join(", ");
      const single = hardTables.size === 1 ? ` (locked to table ${candidates[0]})` : "";
            messages.push({
                message: `Must-group too large: ${names}${single} requires ${groupSize} seats but no candidate table has capacity.`,
                type: 'error' as const,
                guestIds: group,
                tableId: candidates.length === 1 ? candidates[0] : undefined
            });
      continue;
    }

        // --- ADDED FIX for Root Cause C7: Assignment to an explicitly too-small table ---
        // This is a more precise message for a subset of the above conflict (VERBATIM CONSENSUS)
        if (hardTables.size === 1) {
            const assignedTableId = Array.from(hardTables)[0];
            const assignedTableCap = tableCapById.get(assignedTableId);
            
            // Check if the assigned table is explicitly too small for the group
            if (typeof assignedTableCap === 'number' && assignedTableCap < groupSize) {
                const names = group.map(gid => guestMap.get(gid)?.name || gid).join(", ");
                messages.push({
                    message: `Must-group assignment conflict: ${names} must sit together but are assigned to table ${assignedTableId} (${assignedTableCap} seats) which is too small for the group (${groupSize} seats).`,
                    type: 'error' as const,
                    guestIds: group,
                    tableId: assignedTableId
                });
                continue; 
            }
        }
        // --- End Fix C7 ---
  }

  return messages;
}