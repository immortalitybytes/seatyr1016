import type { Assignments, Table } from '../types';

/**
 * Extracts the effective last name for sorting purposes.
 * If a name contains a '%' symbol, it returns the single word immediately
 * following it. Otherwise, it returns the last word of the name.
 * 
 * This function handles edge cases gracefully and provides consistent sorting
 * behavior for guest lists.
 *
 * @param fullName The full name string of the guest.
 * @returns The name to be used for sorting, or empty string if invalid.
 * 
 * @example
 * getLastNameForSorting("John Smith") // "Smith"
 * getLastNameForSorting("Jane%Doe") // "Doe"
 * getLastNameForSorting("") // ""
 */
export function getLastNameForSorting(fullName: string): string {
  // Robust input validation
  if (!fullName || typeof fullName !== 'string') {
    return '';
  }
  
  const trimmedName = fullName.trim();
  if (!trimmedName) {
    return '';
  }
  
  // 2.a.) Priority: Look for first instance of word prefixed with % character
  const percentMatch = trimmedName.match(/%([A-Za-z][\w-]*)/);
  if (percentMatch) {
    return percentMatch[1];
  }
  
  // 2.b.) Look for multi-word guest names separated by addition signifiers
  // Split by &, +, "and", "plus" (case insensitive)
  const separators = /[&+]|\b(?:and|plus)\b/gi;
  const parts = trimmedName.split(separators);
  
  // Find the first multi-word part (more than one word)
  for (const part of parts) {
    const words = part
      .trim()
      .split(/\s+/)
      .filter(w => w.length > 0 && !/^(?:&|\+|and|plus)$/i.test(w));
    if (words.length > 1) {
      // Return the last word of the first multi-word part
      return words[words.length - 1];
    }
  }
  
  // 2.c.) If no multi-word names, treat first name as last name
  const words = trimmedName.split(/\s+/).filter(word => word.length > 0);
  return words.length > 0 ? words[0] : trimmedName;
}

/**
 * Formats a guest's table assignments into a human-readable string.
 * Provides clear, user-friendly labels for table assignments with proper
 * handling of named and unnamed tables.
 *
 * @param assignments The application's assignments map (ID-CSV format).
 * @param tables The application's list of tables with IDs and names.
 * @param guestId The stable ID of the guest.
 * @returns A formatted string of assigned tables, or a default message.
 * 
 * @example
 * formatTableAssignment(assignments, tables, "guest123")
 * // Returns: "Table #1 (Main Hall) • Table #3 • Table #5 (Sweetheart)"
 */
export function formatTableAssignment(
  assignments: Assignments | undefined,
  tables: Pick<Table, 'id' | 'name'>[],
  guestId: string
): string {
  // Input validation
  if (!assignments || !tables || !guestId) {
    return 'Table: unassigned';
  }
  
  const rawIdCsv = assignments[guestId];
  if (!rawIdCsv || typeof rawIdCsv !== 'string') {
    return 'Table: unassigned';
  }
  
  // Create efficient lookup map for table data
  const tableById = new Map<number, Pick<Table, 'id' | 'name'>>();
  tables.forEach(table => {
    if (table && typeof table.id === 'number' && table.id > 0) {
      tableById.set(table.id, table);
    }
  });
  
  // Parse and format each table assignment
  const parts = rawIdCsv
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0);
  
  if (parts.length === 0) {
    return 'Table: unassigned';
  }
  
  const labels: string[] = [];
  
  for (const token of parts) {
    const tableId = Number(token);
    
    // Validate table ID
    if (!Number.isFinite(tableId) || tableId <= 0) {
      labels.push(`Table #${token}`); // Show invalid token as-is
      continue;
    }
    
    const table = tableById.get(tableId);
    
    if (!table) {
      labels.push(`Table #${token}`); // Show unknown table as-is
      continue;
    }
    
    // Format table label with name if available
    const baseLabel = `Table #${table.id}`;
    const hasCustomName = table.name && typeof table.name === 'string' && table.name.trim().length > 0;
    
    if (hasCustomName) {
      labels.push(`${baseLabel} (${table.name.trim()})`);
    } else {
      labels.push(baseLabel);
    }
  }
  
  // Return formatted string or fallback
  return labels.length > 0 ? labels.join(' • ') : 'Table: unassigned';
}

/**
 * Splits a composite GuestUnit name into tokens to "bold" in rotation.
 * Connectors considered: " and ", " & ", " + ", " plus ", " also " (case-insensitive).
 */
export function seatingTokensFromGuestUnit(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return [raw || ''];
  
  // Remove trailing party suffix for base tokens (keep it for N-of-N expansion)
  const baseName = raw
    .replace(/\s*\(\s*\d+\s*\)\s*$/i, '')
    .replace(/\s*[&+]\s*\d+\s*$/i, '')
    .replace(/\s+(?:and|plus|\+|&)\s+(?:guest|guests?)\s*$/i, '')
    .trim();
  
  // Split by connectors while preserving the token words (no punctuation)
  const tokens = baseName.split(/\s+(?:and|&|\+|plus|also)\s+/i)
    .map(token => token.trim())
    .filter(token => token.length > 0);
  
  // Return at least one token (the whole string if split fails)
  return tokens.length > 0 ? tokens : [baseName];
}

/**
 * Converts "+N" etc to ["1st of N", "2nd of N", ...] for display only.
 */
export function nOfNTokensFromSuffix(raw: string): string[] {
  if (!raw || typeof raw !== 'string') return [];
  
  const s = raw.trim();
  if (!s) return [];
  
  // Parse +N, (N), plus/and N, plus/and guest(s) => N
  const plusNum = s.match(/[&+]\s*(\d+)\s*$/);
  const paren = s.match(/\((\d+)\)\s*$/);
  const plusGuest = /\b(?:\+|plus|and)\s+(?:guest|guests?)\s*$/i.test(s);
  const plusWord = s.match(/\b(?:\+|plus|and)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i);
  
  let n = 0;
  if (plusNum) n = parseInt(plusNum[1], 10);
  else if (paren) n = parseInt(paren[1], 10);
  else if (plusGuest) n = 1;
  else if (plusWord) {
    const map: Record<string, number> = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    n = map[plusWord[1].toLowerCase()] || 1;
  }
  
  if (n <= 0) return [];
  
  // Generate English ordinals
  const ordinals = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
  const result: string[] = [];
  
  for (let i = 1; i <= n; i++) {
    const ordinal = i <= 10 ? ordinals[i - 1] : `${i}th`;
    result.push(`${ordinal} of ${n}`);
  }
  
  return result;
}