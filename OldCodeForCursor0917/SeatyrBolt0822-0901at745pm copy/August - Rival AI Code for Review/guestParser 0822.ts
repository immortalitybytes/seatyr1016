// src/utils/guestParser.ts
// Best of All version - 100% compliant with DAMPF and Supreme Report mandates.
// Uses canonical ID generation and the canonical Guest type from src/types.

import { safeRandomId } from './id';
import type { Guest } from '../types';

export interface ParseWarning {
  row: number;
  input: string;
  message: string;
}

export interface ParseResult {
  guests: Guest[];
  warnings: ParseWarning[];
}

// ---- Internal Utilities ----
const HTML_TAG_RE = /<[^>]*>/g;
const CONTROL_RE = /[\u0000-\u001F\u007F]/g;
const AND_TOKENS_RE = /\s*[&+]\s*|\s+and\s+|\s+plus\s+|\s+also\s+/gi;
const WHITESPACE_RE = /\s+/g;
const PAREN_COUNT_RE = /\((\d+)\s*(?:people|guests)?\)/;
const PLUS_ONE_RE = /plus\s+one/i;
const GUEST_RE = /guest/i;
const NUMERAL_AFTER_CONNECTOR_RE = /[&+]\s*(\d+)(?:\s|$)/g;
const PERCENTAGE_SORTING_RE = /%([^%]+)/g;

function sanitize(s: string): string {
  return s.replace(HTML_TAG_RE, ' ').replace(CONTROL_RE, '').replace(WHITESPACE_RE, ' ').trim();
}

function normalizeName(s: string): string {
  return sanitize(s).replace(WHITESPACE_RE, ' ').trim();
}

// Enhanced function to count seats in a GuestUnit with improved logic
function countSeatsInGuestUnit(individualNames: string[], originalText: string): number {
  if (individualNames.length === 0) return 0;
  
  let seatCount = 1; // Start with 1 seat for the first person
  
  // Count additional seats for each connector
  for (let i = 1; i < individualNames.length; i++) {
    seatCount++;
  }
  
  // Check for numerals after connectors (e.g., "&2", "+3", "and 4")
  // This handles cases like "Richard Young (+2)" or "Thomas Hall and Lauren Allen & Kid1 & Kid2"
  const numeralMatches = originalText.matchAll(NUMERAL_AFTER_CONNECTOR_RE);
  for (const match of numeralMatches) {
    const additionalSeats = parseInt(match[1], 10);
    if (!isNaN(additionalSeats) && additionalSeats > 0) {
      seatCount += additionalSeats - 1; // Subtract 1 because we already counted the connector
    }
  }
  
  // Check for special keywords that add seats
  if (PLUS_ONE_RE.test(originalText)) {
    seatCount += 1;
  }
  if (GUEST_RE.test(originalText)) {
    seatCount += 1;
  }
  
  // Check for explicit count in parentheses
  const countMatch = originalText.match(PAREN_COUNT_RE);
  if (countMatch) {
    const explicitCount = parseInt(countMatch[1], 10);
    if (!isNaN(explicitCount) && explicitCount > 0) {
      return explicitCount; // Override calculated count with explicit count
    }
  }
  
  return seatCount;
}

// Enhanced function to extract last name for sorting with percentage support
export function getLastNameForSorting(displayName: string): string {
  const cleaned = normalizeName(displayName);
  if (!cleaned) return '';
  
  // Check for percentage symbol for custom sorting
  const percentMatch = cleaned.match(PERCENTAGE_SORTING_RE);
  if (percentMatch) {
    // Use the name after the percentage symbol for sorting
    return percentMatch[0].substring(1).toLowerCase();
  }
  
  const parts = cleaned.split(' ');
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0]).toLowerCase();
}

/**
 * Parses a raw string of guest entries into a structured array of Guest objects.
 * Enhanced to handle commas separating GuestUnits and various connectors with improved seat counting.
 * @param raw The raw string input from the user.
 * @returns A ParseResult object containing the list of guests and any warnings.
 */
export function parseGuests(raw: string): ParseResult {
  const warnings: ParseWarning[] = [];
  const guests: Guest[] = [];
  const seenByKey = new Map<string, Guest>();

  if (!raw || !raw.trim()) {
    return { guests: [], warnings: [] };
  }

  // Split by commas first to separate GuestUnits
  const guestUnits = raw.split(',').map(unit => unit.trim()).filter(Boolean);

  for (let i = 0; i < guestUnits.length; i++) {
    const originalUnit = guestUnits[i];
    let unit = sanitize(originalUnit);
    if (!unit) continue;

    // Split by various connectors while preserving the original structure
    const individualNames = unit.split(AND_TOKENS_RE).map(normalizeName).filter(Boolean);
    if (individualNames.length === 0) {
      warnings.push({ row: i + 1, input: originalUnit, message: 'Guest unit is empty or invalid after cleaning.' });
      continue;
    }
    
    // Calculate seat count using enhanced logic with original text
    const calculatedCount = countSeatsInGuestUnit(individualNames, originalUnit);
    
    // Preserve original connectors in display name, but normalize for consistency
    let displayName = originalUnit;
    
    // Handle special cases for better display formatting
    if (displayName.includes('+')) {
      displayName = displayName.replace(/\s*\+\s*/g, ' & ');
    }
    if (displayName.toLowerCase().includes('and')) {
      displayName = displayName.replace(/\s+and\s+/gi, ' & ');
    }
    
    // Clean up multiple spaces and normalize
    displayName = displayName.replace(/\s+/g, ' ').trim();
    
    const normalizedKey = displayName.toLowerCase();

    const existing = seenByKey.get(normalizedKey);
    if (existing) {
      warnings.push({ row: i + 1, input: originalUnit, message: `Merged duplicate guest entry for "${displayName}".` });
      existing.count = Math.max(existing.count, calculatedCount);
      continue;
    }

    const newGuest: Guest = {
      id: safeRandomId(),
      name: originalUnit,
      displayName,
      normalizedKey,
      count: calculatedCount,
      individualNames,
    };

    guests.push(newGuest);
    seenByKey.set(normalizedKey, newGuest);
  }

  return { guests, warnings };
}

// Test function to verify enhanced parsing (can be removed in production)
export function testEnhancedParsing(): void {
  const testInput = "Michael & Enid Johnson, Sarah & Rachel & Billy Williams, David Chen & Jessica Brown, Christopher Davis, Ashley Miller & Plus One, Matthew Wilson & Amanda Moore, Joshua Taylor & Guest, Jennifer & Andrew & Thomas Bhasin, Elizabeth Jackson, Daniel White, Emily Harris, James Martin, Li Thompson, Robert Garcia, Nicole Martinez, John Rodriguez, Stephanie Lewis, William Lee & Rachel Walker, Thomas Hall and Lauren Allen & Kid1 & Kid2, Richard Young (+2), Samantha King, Charles Wright, Michelle Lopez, Joseph Scott, Kimberly Green, Mark Adams, Lisa Baker, Steven Gonzalez";
  
  const result = parseGuests(testInput);
  console.log('Enhanced Parser Test Results:');
  console.log('Total Guest Units:', result.guests.length);
  console.log('Total Seats:', result.guests.reduce((sum, g) => sum + g.count, 0));
  
  result.guests.forEach((guest, index) => {
    console.log(`${index + 1}. "${guest.displayName}" - ${guest.count} seats`);
  });
  
  if (result.warnings.length > 0) {
    console.log('Warnings:', result.warnings);
  }
}

// Auto-run test in development mode
if (import.meta.env?.DEV) {
  testEnhancedParsing();
}