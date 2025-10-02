/*
 * src/utils/unsatisfiableMustValidator.ts
 * Validates MUST constraints to detect unsatisfiable groups before engine execution
 */

import { ValidationError } from '../types';
import { getCapacity } from './tables';

interface GuestInfo {
  partySize: number;
  name: string;
}

interface TableInfo {
  id: number;
  capacity: number;
}

interface MustGroup {
  guests: string[];
  totalSeats: number;
  assignedTables: Set<number>;
}

export function detectUnsatisfiableMustGroups(params: {
  guests: Record<string, GuestInfo>;
  tables: TableInfo[];
  assignments: Record<string, string>;
  constraints: {
    mustPairs: Iterable<[string, string]>;
  };
}): ValidationError[] {
  const errors: ValidationError[] = [];
  const { guests, tables, assignments, constraints } = params;
  
  // Build adjacency graph from MUST constraints
  const adjacencyMap = new Map<string, Set<string>>();
  for (const [a, b] of constraints.mustPairs) {
    if (!adjacencyMap.has(a)) adjacencyMap.set(a, new Set());
    if (!adjacencyMap.has(b)) adjacencyMap.set(b, new Set());
    adjacencyMap.get(a)!.add(b);
    adjacencyMap.get(b)!.add(a);
  }
  
  // Find connected components (MUST groups)
  const visited = new Set<string>();
  const mustGroups: MustGroup[] = [];
  
  for (const guestId of Object.keys(guests)) {
    if (visited.has(guestId)) continue;
    
    const group: string[] = [];
    const stack = [guestId];
    
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current)) continue;
      
      visited.add(current);
      group.push(current);
      
      const neighbors = adjacencyMap.get(current) || new Set();
      for (const neighbor of neighbors) {
        if (!visited.has(neighbor)) {
          stack.push(neighbor);
        }
      }
    }
    
    if (group.length > 1) { // Only groups with 2+ guests
      const totalSeats = group.reduce((sum, id) => sum + (guests[id]?.partySize || 1), 0);
      const assignedTables = new Set<number>();
      
      // Check pre-assignments
      for (const guestId of group) {
        const assignment = assignments[guestId];
        if (assignment) {
          const tableIds = assignment.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id));
          tableIds.forEach(id => assignedTables.add(id));
        }
      }
      
      mustGroups.push({
        guests: group,
        totalSeats,
        assignedTables,
      });
    }
  }
  
  // Validate each MUST group
  for (const group of mustGroups) {
    const { guests: groupGuests, totalSeats, assignedTables } = group;
    
    // Check if group is too big for any table
    const maxCapacity = Math.max(...tables.map(t => t.capacity));
    if (totalSeats > maxCapacity) {
      const guestNames = groupGuests.map(id => guests[id]?.name || id).join(', ');
      errors.push({
        type: 'error',
        message: `MUST group "${guestNames}" requires ${totalSeats} seats but largest table only has ${maxCapacity} seats.`,
      });
      continue;
    }
    
    // Check if pre-assignments conflict
    if (assignedTables.size > 1) {
      const guestNames = groupGuests.map(id => guests[id]?.name || id).join(', ');
      const tableNames = Array.from(assignedTables).map(id => `Table ${id}`).join(', ');
      errors.push({
        type: 'error',
        message: `MUST group "${guestNames}" is pre-assigned to multiple tables: ${tableNames}.`,
      });
      continue;
    }
    
    // Check if assigned table has sufficient capacity
    if (assignedTables.size === 1) {
      const assignedTableId = Array.from(assignedTables)[0];
      const table = tables.find(t => t.id === assignedTableId);
      if (table && totalSeats > table.capacity) {
        const guestNames = groupGuests.map(id => guests[id]?.name || id).join(', ');
        errors.push({
          type: 'error',
          message: `MUST group "${guestNames}" requires ${totalSeats} seats but assigned table only has ${table.capacity} seats.`,
        });
      }
    }
  }
  
  return errors;
}
