const NUMBER_WORDS: Record<string, number> = {
  one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10
};

export function getDisplayName(raw: string): string {
  return raw
    .replace(/\s*\(\s*\d+\s*\)\s*$/i, '')
    .replace(/\s*[&+]\s*\d+\s*$/i, '')
    .replace(/\s+(?:and|plus|\+|&)\s+(?:guest|guests?)\s*$/i, '')
    .trim();
}

export function extractPartySuffix(raw: string): string | null {
  const s = String(raw).trim();
  if (!s) return null;

  // numeric suffix forms: +2, & 2, (2)
  const plusNum = s.match(/[&+]\s*(\d+)\s*$/);
  const paren = s.match(/\((\d+)\)\s*$/);

  // verbal forms: "+guest", "+ guest", "plus one", "and two"
  const plusGuestDirect = /[&+]\s*(?:guest|guests?)\s*$/i.test(s);
  const plusGuest = /\b(?:\+|plus|and)\s+(?:guest|guests?)\s*$/i.test(s);
  const plusWord = s.match(/\b(?:\+|plus|and)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\s*$/i);

  if (plusNum) return `+${parseInt(plusNum[1], 10)}`;
  if (paren)    return `+${parseInt(paren[1], 10)}`;
  if (plusGuestDirect) return '+1';
  if (plusGuest) return '+1';
  if (plusWord) {
    const map: Record<string, number> = {one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10};
    return `+${map[plusWord[1].toLowerCase()] || 1}`;
  }
  return null;
}

export function countHeads(raw: string): number {
  let s = raw.trim(); if (!s) return 0;
  
  // Check for explicit numeric suffixes first (highest priority)
  const paren = s.match(/\((\d+)\)\s*$/);
  if (paren) return Math.max(1, parseInt(paren[1], 10));
  
  // Check for +N patterns (like "John +2")
  const plusNum = s.match(/[&+]\s*(\d+)\s*$/);
  if (plusNum) {
    const baseName = s.replace(/[&+]\s*\d+\s*$/, '').trim();
    // Count actual number of people in base name by splitting on connectors
    // Use word boundaries to avoid matching "and" inside names like "Anderson"
    const baseTokens = baseName.split(/\s*(?:&|\+|\b(?:and|plus)\b)\s*/i).filter(Boolean);
    const baseCount = baseTokens.length > 0 ? baseTokens.length : (baseName ? 1 : 0);
    return Math.max(1, baseCount + parseInt(plusNum[1], 10));
  }
  
  // Check for "plus N" patterns (like "John plus 2")
  const plusWord = s.match(/\b(?:plus|and)\s+(\d+)\b/gi);
  if (plusWord) {
    const baseName = s.replace(/\b(?:plus|and)\s+\d+\b/gi, '').trim();
    // Count actual number of people in base name by splitting on connectors
    // Use word boundaries to avoid matching "and" inside names like "Anderson"
    const baseTokens = baseName.split(/\s*(?:&|\+|\b(?:and|plus)\b)\s*/i).filter(Boolean);
    const baseCount = baseTokens.length > 0 ? baseTokens.length : (baseName ? 1 : 0);
    const digitMatch = plusWord[0].match(/\d+/);
    return Math.max(1, baseCount + (digitMatch ? parseInt(digitMatch[0], 10) : 0));
  }
  
  // Check for spelled numbers (like "John plus one")
  const spelled = [...s.matchAll(/\b(?:plus|and)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)];
  if (spelled.length > 0) {
    const baseName = s.replace(/\b(?:plus|and)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi, '').trim();
    // Count actual number of people in base name by splitting on connectors
    // Use word boundaries to avoid matching "and" inside names like "Anderson"
    const baseTokens = baseName.split(/\s*(?:&|\+|\b(?:and|plus)\b)\s*/i).filter(Boolean);
    const baseCount = baseTokens.length > 0 ? baseTokens.length : (baseName ? 1 : 0);
    const spelledCount = NUMBER_WORDS[spelled[0][1].toLowerCase()];
    return Math.max(1, baseCount + spelledCount);
  }
  
  // Check for "+guest" patterns (like "John +guest", "John + guest")
  const plusGuestDirect = /[&+]\s*(?:guest|guests?)\s*$/i.test(s);
  if (plusGuestDirect) {
    const baseName = s.replace(/[&+]\s*(?:guest|guests?)\s*$/i, '').trim();
    const baseCount = baseName ? 1 : 0; // Base person if there's a name
    return Math.max(1, baseCount + 1);
  }
  
  // Check for "plus guest" patterns (like "John plus guest")
  const plusGuest = /\b(?:plus|and)\s+(?:guest|guests?)\s*$/i.test(s);
  if (plusGuest) {
    const baseName = s.replace(/\b(?:plus|and)\s+(?:guest|guests?)\s*$/i, '').trim();
    const baseCount = baseName ? 1 : 0; // Base person if there's a name
    return Math.max(1, baseCount + 1);
  }
  
  // Check for family/household patterns
  const familyOf = s.match(/\b(?:family|household)\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (familyOf) { 
    const v = familyOf[1].toLowerCase(); 
    return Math.max(1, NUMBER_WORDS[v] ?? parseInt(v,10)); 
  }
  
  // Default: count base tokens (for names like "John & Jane")
  const baseTokens = s.split(/\s*(?:&|\+|and|plus)\s*/i).filter(Boolean);
  return Math.max(1, baseTokens.length);
}

