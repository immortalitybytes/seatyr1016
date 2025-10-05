export function sanitizeGuestUnitName(raw: string): string {
  let s = (raw ?? '').trim();
  s = s.replace(/\b(and|also|plus)\b/gi, '+');   // words → '+'
  s = s.replace(/([&+])\s*([&+])+/g, '$1');     // collapse multi connectors
  s = s.replace(/\s*([&+])\s*/g, ' $1 ');       // exactly one space around connectors
  s = s.replace(/\s{2,}/g, ' ');                // collapse spaces
  return s;
}

export function getLastNameForSorting(name: string): string {
  // Simple implementation - return the last word
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] || '';
}

export function formatTableAssignment(assignment: string | undefined): string {
  if (!assignment) return 'Unassigned';
  const ids = assignment.split(',').map(id => id.trim()).filter(Boolean);
  if (ids.length === 0) return 'Unassigned';
  if (ids.length === 1) return `Table ${ids[0]}`;
  return `Tables ${ids.join(', ')}`;
}

export function seatingTokensFromGuestUnit(name: string): string[] {
  // Simple implementation - split by common separators
  const parts = name.split(/[&+]/).map(p => p.trim()).filter(Boolean);
  return parts.length > 0 ? parts : [name];
}

export function nOfNTokensFromSuffix(name: string): string[] {
  // Simple implementation - look for +N patterns
  const match = name.match(/\+(\d+)/);
  if (match) {
    const count = parseInt(match[1], 10);
    return Array.from({ length: count }, (_, i) => `+${i + 1}`);
  }
  return [];
}