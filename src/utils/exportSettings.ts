import { Guest, Table, Constraints, Adjacents, Assignments } from '../types';

/**
 * Escapes a CSV field value, wrapping in quotes if necessary
 */
function escapeCSVField(value: string): string {
  if (value === null || value === undefined) {
    return '';
  }
  
  const str = String(value);
  
  // If the field contains comma, quote, or newline, wrap in quotes and escape quotes
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  
  return str;
}

/**
 * Creates a guest ID to name mapping
 */
function createGuestNameMap(guests: Guest[]): Map<string, string> {
  const map = new Map<string, string>();
  guests.forEach(guest => {
    map.set(guest.id, guest.name);
  });
  return map;
}

/**
 * Formats table assignments as a readable string
 */
function formatAssignments(assignment: string | undefined, tables: Table[]): string {
  if (!assignment || !assignment.trim()) {
    return '';
  }
  
  const tableIds = assignment
    .split(',')
    .map(id => id.trim())
    .filter(id => id.length > 0)
    .map(id => parseInt(id, 10))
    .filter(id => !isNaN(id) && id > 0)
    .sort((a, b) => a - b);
  
  if (tableIds.length === 0) {
    return '';
  }
  
  // If it's a range (consecutive numbers), format as range
  if (tableIds.length > 1) {
    const isConsecutive = tableIds.every((id, index) => 
      index === 0 || id === tableIds[index - 1] + 1
    );
    
    if (isConsecutive) {
      return `${tableIds[0]}-${tableIds[tableIds.length - 1]}`;
    }
  }
  
  return tableIds.join(',');
}

/**
 * Gets all guest names that have a MUST constraint with the given guest
 */
function getMustConstraints(guestId: string, constraints: Constraints, guestNameMap: Map<string, string>): string[] {
  const mustNames: string[] = [];
  
  // Check if this guest has constraints with others
  const guestConstraints = constraints[guestId];
  if (guestConstraints) {
    Object.entries(guestConstraints).forEach(([otherId, value]) => {
      if (value === 'must') {
        const name = guestNameMap.get(otherId);
        if (name) {
          mustNames.push(name);
        }
      }
    });
  }
  
  // Check if other guests have MUST constraints with this guest
  Object.entries(constraints).forEach(([otherId, otherConstraints]) => {
    if (otherId !== guestId && otherConstraints[guestId] === 'must') {
      const name = guestNameMap.get(otherId);
      if (name) {
        mustNames.push(name);
      }
    }
  });
  
  return mustNames.sort();
}

/**
 * Gets all guest names that have a CANNOT constraint with the given guest
 */
function getCannotConstraints(guestId: string, constraints: Constraints, guestNameMap: Map<string, string>): string[] {
  const cannotNames: string[] = [];
  
  // Check if this guest has constraints with others
  const guestConstraints = constraints[guestId];
  if (guestConstraints) {
    Object.entries(guestConstraints).forEach(([otherId, value]) => {
      if (value === 'cannot') {
        const name = guestNameMap.get(otherId);
        if (name) {
          cannotNames.push(name);
        }
      }
    });
  }
  
  // Check if other guests have CANNOT constraints with this guest
  Object.entries(constraints).forEach(([otherId, otherConstraints]) => {
    if (otherId !== guestId && otherConstraints[guestId] === 'cannot') {
      const name = guestNameMap.get(otherId);
      if (name) {
        cannotNames.push(name);
      }
    }
  });
  
  return cannotNames.sort();
}

/**
 * Gets all guest names that are adjacent to the given guest
 */
function getAdjacentGuests(guestId: string, adjacents: Adjacents, guestNameMap: Map<string, string>): string[] {
  const adjacentNames: string[] = [];
  
  // Check if this guest has adjacents
  const guestAdjacents = adjacents[guestId];
  if (guestAdjacents && Array.isArray(guestAdjacents)) {
    guestAdjacents.forEach(adjacentId => {
      const name = guestNameMap.get(adjacentId);
      if (name) {
        adjacentNames.push(name);
      }
    });
  }
  
  // Check if other guests have this guest as adjacent
  Object.entries(adjacents).forEach(([otherId, otherAdjacents]) => {
    if (otherId !== guestId && Array.isArray(otherAdjacents) && otherAdjacents.includes(guestId)) {
      const name = guestNameMap.get(otherId);
      if (name) {
        adjacentNames.push(name);
      }
    }
  });
  
  return adjacentNames.sort();
}

export interface ExportData {
  guests: Guest[];
  tables: Table[];
  constraints: Constraints;
  adjacents: Adjacents;
  assignments: Assignments;
}

/**
 * Exports settings data to CSV format for Excel import
 */
export function exportSettingsToCSV(data: ExportData, settingName?: string): string {
  const { guests, tables, constraints, adjacents, assignments } = data;
  
  const guestNameMap = createGuestNameMap(guests);
  const lines: string[] = [];
  
  // Header with setting name if provided
  if (settingName) {
    lines.push(`Seatyr Settings Export: ${settingName}`);
    lines.push(`Exported: ${new Date().toLocaleString()}`);
    lines.push('');
  }
  
  // Section 1: Guest List
  lines.push('=== GUEST LIST ===');
  lines.push('Guest Name,Party Size,Must Constraints,Cannot Constraints,Adjacent Pairs,Seating Assignments');
  
  // Sort guests alphabetically by name
  const sortedGuests = [...guests].sort((a, b) => a.name.localeCompare(b.name));
  
  sortedGuests.forEach(guest => {
    const mustConstraints = getMustConstraints(guest.id, constraints, guestNameMap);
    const cannotConstraints = getCannotConstraints(guest.id, constraints, guestNameMap);
    const adjacentGuests = getAdjacentGuests(guest.id, adjacents, guestNameMap);
    const assignmentStr = formatAssignments(assignments[guest.id], tables);
    
    const row = [
      escapeCSVField(guest.name),
      escapeCSVField(String(guest.count)),
      escapeCSVField(mustConstraints.join(', ')),
      escapeCSVField(cannotConstraints.join(', ')),
      escapeCSVField(adjacentGuests.join(', ')),
      escapeCSVField(assignmentStr)
    ];
    
    lines.push(row.join(','));
  });
  
  // Blank line between sections
  lines.push('');
  
  // Section 2: Table Information
  lines.push('=== TABLE INFORMATION ===');
  lines.push('Table ID,Seats,Table Name');
  
  // Sort tables by ID
  const sortedTables = [...tables].sort((a, b) => a.id - b.id);
  
  sortedTables.forEach(table => {
    const row = [
      escapeCSVField(String(table.id)),
      escapeCSVField(String(table.seats)),
      escapeCSVField(table.name || '')
    ];
    
    lines.push(row.join(','));
  });
  
  return lines.join('\n');
}

/**
 * Triggers a download of the CSV file
 */
export function downloadCSV(content: string, filename: string): void {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);
  
  link.setAttribute('href', url);
  link.setAttribute('download', filename);
  link.style.visibility = 'hidden';
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  
  // Clean up the URL object
  URL.revokeObjectURL(url);
}

