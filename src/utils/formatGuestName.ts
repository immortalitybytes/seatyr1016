// Tag: 1011-GuestUnit-AutoFormat
/**
 * Automatically formats GuestUnit names to ensure consistent spacing
 * around connection characters and normalize connection words.
 */

export function formatGuestUnitName(name: string): string {
  if (!name) return '';
  
  let formatted = name.trim();
  
  // Step 1: Add spaces around connection characters (&, +) if missing
  // Match connection character not preceded by space
  formatted = formatted.replace(/([^\s%])([&+])/g, '$1 $2');
  // Match connection character not followed by space
  formatted = formatted.replace(/([&+])([^\s])/g, '$1 $2');
  
  // Step 2: Normalize connection words with spaces on both sides → +
  // Only replace when the word has spaces on BOTH sides (to avoid "Regland", "Balso", etc.)
  formatted = formatted.replace(/\s+(and|also|plus)\s+/gi, ' + ');
  
  // Step 3: Collapse multiple spaces to single space
  formatted = formatted.replace(/\s{2,}/g, ' ');
  
  // Step 4: Deduplicate consecutive connection characters
  // Match any combination of & and + (with optional spaces between) and keep only the first
  formatted = formatted.replace(/([&+])\s*[&+]+/g, '$1');
  
  // Step 5: Final cleanup - ensure no trailing/leading spaces
  return formatted.trim();
}

