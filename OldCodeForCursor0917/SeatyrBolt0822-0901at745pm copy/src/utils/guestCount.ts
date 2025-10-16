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

export function countHeads(raw: string): number {
  let s = raw.trim(); if (!s) return 0;
  const baseTokens = s.split(/\s*(?:&|\+|and|plus)\s*/i).filter(Boolean);
  let count = Math.max(1, baseTokens.length);
  const paren = s.match(/\((\d+)\)\s*$/); if (paren) count = Math.max(count, parseInt(paren[1], 10));
  for (const m of s.matchAll(/[&+]\s*(\d+)\b/g)) count += parseInt(m[1], 10);
  for (const m of s.matchAll(/\b(?:plus|and)\s+(\d+)\b/gi)) count += parseInt(m[1], 10);
  const spelled = [...s.matchAll(/\b(?:plus|and)\s+(one|two|three|four|five|six|seven|eight|nine|ten)\b/gi)];
  for (const m of spelled) count += NUMBER_WORDS[m[1].toLowerCase()];
  const familyOf = s.match(/\b(?:family|household)\s+of\s+(one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/i);
  if (familyOf) { const v = familyOf[1].toLowerCase(); count = Math.max(count, NUMBER_WORDS[v] ?? parseInt(v,10)); }
  return Math.max(1, count);
}

