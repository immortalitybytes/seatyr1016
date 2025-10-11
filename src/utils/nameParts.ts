/**
 * Parse guest name into firstName and lastName components
 * Non-breaking adapter for sorting and display
 */
export function nameParts(full?: string): { firstName: string; lastName: string } {
  const s = String(full || '').trim();
  if (!s) return { firstName: '', lastName: '' };
  
  // Handle % marker for special formatting
  if (s.includes('%')) {
    const partsWithMarker = s.split('%');
    const beforeMarker = partsWithMarker[0].trim();
    const afterMarker = (partsWithMarker[1] || '').trim();
    const lastName = afterMarker.split(/\s+/)[0] || '';
    const firstName = beforeMarker.trim();
    return { firstName, lastName };
  }
  
  const parts = s.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const lastName = parts.pop()!;
  return { firstName: parts.join(' '), lastName };
}

