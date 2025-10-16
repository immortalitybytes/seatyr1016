// utils/formatters.ts — canonical helper for "Table #X" display
export type Table = { id: number; seats: number; name?: string };

export function formatTableAssignment(
  assignments: Record<string, string> | undefined,
  tables: { id: number; name?: string }[],
  guestName: string
): string {
  const raw = assignments?.[guestName];
  if (!raw) return '';
  const tokens = raw.split(',').map(s => s.trim()).filter(Boolean);
  const labels = tokens.map(tok => {
    const id = Number(tok);
    const t = tables.find(x => x.id === id);
    if (!t) return `Table #${tok}`;
    return t.name ? `Table #${t.id} (${t.name})` : `Table #${t.id}`;
  });
  return labels.join(' • ');
}

/**
 * For last name sorting, return the word after the % symbol if present.
 * Enhanced to handle percentage symbol for custom sorting as specified
 * E.g., "Carlos De la %Cruz" => "Cruz", "Tatiana %Sokolov Boyko" => "Sokolov"
 * If no %, return the last word in the name.
 */
export const getLastNameForSorting = (fullName: string): string => {
  if (!fullName || typeof fullName !== 'string') return '';
  
  const firstPersonName = fullName.trim();
  
  // Enhanced percentage symbol support for multi-word surnames
  if (firstPersonName.includes('%')) {
    const afterPercent = firstPersonName.split('%')[1];
    if (afterPercent) {
      // Get the word immediately after the % symbol
      const lastNamePart = afterPercent.trim().split(/\s+/)[0];
      // Filter out numerals and special characters, keep only letters
      return lastNamePart.replace(/[^a-zA-Z]/g, '').toLowerCase();
    }
  }
  
  // Default behavior: return the last word, filtering out numerals and special characters
  const words = firstPersonName.split(/\s+/).filter(word => word.trim());
  if (words.length > 0) {
    const lastWord = words[words.length - 1];
    // Filter out numerals and special characters (&, +), keep only letters
    return lastWord.replace(/[^a-zA-Z]/g, '').toLowerCase();
  }
  return '';
};