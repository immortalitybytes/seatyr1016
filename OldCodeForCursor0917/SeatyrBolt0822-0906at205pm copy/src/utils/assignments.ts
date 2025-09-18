import type { Table } from '../types';

/**
 * Normalizes free-form assignment input into a stable, sorted, de-duplicated ID-CSV.
 * Accepts numeric IDs and case-insensitive table names. Unknown tokens are silently ignored.
 * 
 * Examples:
 * - "1, 3, Alpha, 5" → "1,3,5" (if Alpha matches a table name)
 * - "Table A, 2, VIP" → "2,5" (if Table A=5 and VIP=2)
 * - "invalid, 1, 2" → "1,2" (ignores invalid tokens)
 * 
 * @param rawInput The raw string input from the user
 * @param tables The application's list of tables to resolve names against
 * @returns A normalized, sorted ID-CSV string
 */
export function normalizeAssignmentInputToIds(
  rawInput: string,
  tables: Pick<Table, 'id' | 'name'>[]
): string {
  if (!rawInput || typeof rawInput !== 'string') return '';

  // Build efficient name-to-id lookup map
  const nameToId = new Map<string, number>();
  for (const t of tables) {
    const label = (t.name ?? '').trim();
    if (label) nameToId.set(label.toLowerCase(), t.id);
  }

  // Parse tokens and resolve to IDs
  const ids = new Set<number>();
  for (const token of rawInput.split(',').map(s => s.trim()).filter(Boolean)) {
    // Try parsing as number first (most efficient)
    const asNum = Number(token);
    if (Number.isFinite(asNum) && asNum > 0) {
      ids.add(Math.floor(asNum)); // Ensure integer
      continue;
    }

    // Try resolving by name (case-insensitive)
    const byName = nameToId.get(token.toLowerCase());
    if (typeof byName === 'number') ids.add(byName);
  }

  // Return sorted, deduped CSV
  return Array.from(ids).sort((a, b) => a - b).join(',');
}

/**
 * Validates that an assignment string only contains valid table IDs.
 * Useful for pre-save validation and error reporting.
 * 
 * @param assignmentCsv The normalized assignment CSV string
 * @param validTableIds Array of valid table IDs to check against
 * @returns Validation result with list of invalid IDs
 */
export function validateAssignmentIds(
  assignmentCsv: string,
  validTableIds: number[]
): { valid: boolean; invalidIds: number[] } {
  if (!assignmentCsv) return { valid: true, invalidIds: [] };

  const validSet = new Set(validTableIds);
  const invalidIds: number[] = [];

  const ids = assignmentCsv.split(',').map(s => Number(s.trim())).filter(Number.isFinite);

  for (const id of ids) {
    if (!validSet.has(id)) {
      invalidIds.push(id);
    }
  }

  return {
    valid: invalidIds.length === 0,
    invalidIds
  };
}

/**
 * Formats assignment data for human-readable display in the UI.
 * Converts ID-CSV back to user-friendly table references.
 * 
 * Examples:
 * - "1" → "Table #1"
 * - "1,3" → "Tables: 1, 3"
 * - "1,3" → "Tables: 1 (VIP), 3 (Main)" (if names exist)
 * 
 * @param assignmentCsv The normalized assignment CSV string
 * @param tables The application's list of tables for name resolution
 * @returns Human-readable assignment description
 */
export function formatAssignmentForDisplay(
  assignmentCsv: string,
  tables: { id: number; name?: string | null }[]
): string {
  if (!assignmentCsv) return 'No assignment';

  const tableMap = new Map<number, { id: number; name?: string | null }>();
  tables.forEach(t => tableMap.set(t.id, t));

  const ids = assignmentCsv.split(',').map(s => Number(s.trim())).filter(Number.isFinite);

  if (ids.length === 0) return 'No assignment';
  
  if (ids.length === 1) {
    const table = tableMap.get(ids[0]);
    if (!table) return `Table ${ids[0]} (not found)`;
    return table.name ? `Table #${table.id} (${table.name})` : `Table #${table.id}`;
  }

  const labels = ids.map(id => {
    const table = tableMap.get(id);
    if (!table) return `${id}?`;
    return table.name ? `${id} (${table.name})` : `${id}`;
  });

  return `Tables: ${labels.join(', ')}`;
}

/**
 * Parses an assignment CSV string into an array of table IDs.
 * Useful for programmatic access to individual table assignments.
 * 
 * @param assignmentCsv The normalized assignment CSV string
 * @returns Array of table IDs
 */
export function parseAssignmentIds(assignmentCsv: string): number[] {
  if (!assignmentCsv) return [];
  return assignmentCsv.split(',').map(s => Number(s.trim())).filter(Number.isFinite);
}

/**
 * Checks if a specific table ID is included in an assignment.
 * Useful for conditional logic and validation.
 * 
 * @param assignmentCsv The normalized assignment CSV string
 * @param tableId The table ID to check for
 * @returns True if the table is assigned
 */
export function isTableAssigned(assignmentCsv: string, tableId: number): boolean {
  if (!assignmentCsv) return false;
  const ids = parseAssignmentIds(assignmentCsv);
  return ids.includes(tableId);
}

/**
 * Merges multiple assignment CSV strings into a single normalized string.
 * Useful for combining assignments from different sources.
 * 
 * @param assignments Array of assignment CSV strings
 * @returns Single normalized assignment CSV string
 */
export function mergeAssignments(assignments: string[]): string {
  const allIds = new Set<number>();
  
  for (const assignment of assignments) {
    const ids = parseAssignmentIds(assignment);
    ids.forEach(id => allIds.add(id));
  }
  
  return Array.from(allIds).sort((a, b) => a - b).join(',');
}

