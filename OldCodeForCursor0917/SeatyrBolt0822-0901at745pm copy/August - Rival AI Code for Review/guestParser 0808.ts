import {
  validateGuestName,
  normalizeGuestName,
  getLastNameForSorting,
  extractIndividualNames,
  determineGuestCount,
  parseGuest,
  parseGuestInput,
  mergeDuplicateGuests,
  splitLargeGroups,
  exportGuestList,
} from '../src/utils/guestParser';
import { Guest } from '../src/types/types';
import { logError } from '../src/lib/logError';

jest.mock('../src/lib/logError');

describe('guestParser utils', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('validateGuestName', () => {
    it('validates correct single names', () => {
      expect(validateGuestName('John Doe')).toEqual({ isValid: true });
      expect(validateGuestName('Alice Smith')).toEqual({ isValid: true });
    });

    it('validates names with common separators', () => {
      expect(validateGuestName('Alice & Bob')).toEqual({ isValid: true });
      expect(validateGuestName('Carol and David')).toEqual({ isValid: true });
      expect(validateGuestName('Dan, Maria & Josh')).toEqual({ isValid: true });
    });

    it('accepts names with common punctuation and emojis', () => {
      expect(validateGuestName("Dr. O'Malley-Smith, Jr.")).toEqual({ isValid: true });
      expect(validateGuestName('Team 🎉')).toEqual({ isValid: true });
      expect(validateGuestName('José & María')).toEqual({ isValid: true });
      expect(validateGuestName('Mr. & Mrs. Johnson')).toEqual({ isValid: true });
    });

    it('handles edge cases with separators', () => {
      expect(validateGuestName('Alice & & Bob')).toEqual({ isValid: true });
      expect(validateGuestName('Alice and and Bob')).toEqual({ isValid: true });
    });

    it('rejects empty or whitespace-only names', () => {
      expect(validateGuestName('')).toEqual({ 
        isValid: false, 
        error: 'Guest name cannot be empty' 
      });
      expect(validateGuestName('   ')).toEqual({ 
        isValid: false, 
        error: 'Guest name cannot be empty' 
      });
      expect(validateGuestName('\n\t')).toEqual({ 
        isValid: false, 
        error: 'Guest name cannot be empty' 
      });
      expect(logError).toHaveBeenCalled();
    });

    it('rejects names that are too long', () => {
      const longName = 'a'.repeat(201);
      expect(validateGuestName(longName)).toEqual({ 
        isValid: false, 
        error: 'Guest name is too long (max 200 characters)' 
      });
      expect(logError).toHaveBeenCalled();
    });

    it('rejects names with script tags to prevent XSS', () => {
      expect(validateGuestName('<script>alert("xss")</script>')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(validateGuestName('John<script>alert(1)</script>')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(logError).toHaveBeenCalled();
    });

    it('rejects names with HTML event handlers', () => {
      expect(validateGuestName('Guest<img src=x onerror=alert(1)>')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(validateGuestName('<div onclick="malicious()">Name</div>')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(logError).toHaveBeenCalled();
    });

    it('rejects names with javascript: protocol', () => {
      expect(validateGuestName('javascript:alert(1)')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(validateGuestName('a href="javascript:alert(1)"')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(logError).toHaveBeenCalled();
    });

    it('rejects other HTML injection attempts', () => {
      expect(validateGuestName('<iframe src="malicious"></iframe>')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(validateGuestName('<object data="malicious"></object>')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(validateGuestName('<embed src="malicious">')).toEqual({
        isValid: false,
        error: 'Guest name contains unsafe content or script tags',
      });
      expect(logError).toHaveBeenCalled();
    });

    it('rejects names with too many special characters', () => {
      expect(validateGuestName('Alice!@#$%^&*')).toEqual({
        isValid: false,
        error: 'Guest name contains too many special characters',
      });
      expect(validateGuestName('Bob{}<>[]|`~')).toEqual({
        isValid: false,
        error: 'Guest name contains too many special characters',
      });
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('normalizeGuestName', () => {
    it('normalizes valid names consistently', () => {
      expect(normalizeGuestName('Alice Smith')).toBe('alice smith');
      expect(normalizeGuestName('  Bob & Carol  ')).toBe('bob & carol');
      expect(normalizeGuestName('DAVID')).toBe('david');
      expect(normalizeGuestName('José García')).toBe('jose garcia');
      expect(normalizeGuestName('   Multiple   Spaces   ')).toBe('multiple spaces');
    });

    it('handles accented characters', () => {
      expect(normalizeGuestName('Café')).toBe('cafe');
      expect(normalizeGuestName('naïve')).toBe('naive');
      expect(normalizeGuestName('Zürich')).toBe('zurich');
    });

    it('handles invalid inputs', () => {
      expect(normalizeGuestName('')).toBe('');
      expect(normalizeGuestName(null as any)).toBe('');
      expect(normalizeGuestName(undefined as any)).toBe('');
      expect(normalizeGuestName(123 as any)).toBe('');
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('getLastNameForSorting', () => {
    it('extracts last name correctly', () => {
      expect(getLastNameForSorting('John Doe')).toBe('Doe');
      expect(getLastNameForSorting('Jane Marie Smith')).toBe('Smith');
      expect(getLastNameForSorting('Smith Family (4)')).toBe('Smith');
      expect(getLastNameForSorting('Alice')).toBe('Alice');
      expect(getLastNameForSorting('Madonna')).toBe('Madonna');
    });

    it('handles names with separators', () => {
      expect(getLastNameForSorting('Bob & Carol Johnson')).toBe('Bob');
      expect(getLastNameForSorting('Ted and Alice Smith')).toBe('Ted');
    });

    it('handles invalid inputs', () => {
      expect(getLastNameForSorting('')).toBe('');
      expect(getLastNameForSorting(null as any)).toBe(null);
      expect(getLastNameForSorting(undefined as any)).toBe(undefined);
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('extractIndividualNames', () => {
    it('extracts single name', () => {
      expect(extractIndividualNames('Alice Smith')).toEqual(['Alice Smith']);
    });

    it('extracts multiple names with various separators', () => {
      expect(extractIndividualNames('Alice & Bob')).toEqual(['Alice', 'Bob']);
      expect(extractIndividualNames('Carol and David')).toEqual(['Carol', 'David']);
      expect(extractIndividualNames('Dan, Maria & Josh')).toEqual(['Dan', 'Maria', 'Josh']);
      expect(extractIndividualNames('A & B and C')).toEqual(['A', 'B', 'C']);
      expect(extractIndividualNames('Alice, Bob; Carol & Dave and Eve')).toEqual(['Alice', 'Bob', 'Carol', 'Dave', 'Eve']);
    });

    it('handles chained ampersands correctly', () => {
      expect(extractIndividualNames('Dan & Maria & Josh')).toEqual(['Dan', 'Maria', 'Josh']);
      expect(extractIndividualNames('A & B & C & D')).toEqual(['A', 'B', 'C', 'D']);
    });

    it('handles mixed case separators', () => {
      expect(extractIndividualNames('Carol AND David')).toEqual(['Carol', 'David']);
      expect(extractIndividualNames('Carol And David')).toEqual(['Carol', 'David']);
    });

    it('handles family size notation', () => {
      expect(extractIndividualNames('Smith Family (4)')).toEqual(['Smith Family']);
      expect(extractIndividualNames('Johnson Group (10 people)')).toEqual(['Johnson Group']);
    });

    it('handles invalid inputs', () => {
      expect(extractIndividualNames('')).toEqual(['']);
      expect(extractIndividualNames('Alice#Bob')).toEqual([]);
      expect(extractIndividualNames('Test123')).toEqual([]);
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('determineGuestCount', () => {
    it('counts single guest', () => {
      expect(determineGuestCount('Alice Smith')).toBe(1);
    });

    it('counts multiple guests', () => {
      expect(determineGuestCount('Alice & Bob')).toBe(2);
      expect(determineGuestCount('Alice & Bob and Charlie')).toBe(3);
      expect(determineGuestCount('Dan, Maria & Josh')).toBe(3);
    });

    it('respects explicit count with parentheses', () => {
      expect(determineGuestCount('Smith Family (4)')).toBe(4);
      expect(determineGuestCount('Johnson Group (10 people)')).toBe(10);
      expect(determineGuestCount('Team (8 guests)')).toBe(8);
      expect(determineGuestCount('Party (25 pax)')).toBe(25);
    });

    it('handles bare number formats', () => {
      expect(determineGuestCount('4 guests')).toBe(4);
      expect(determineGuestCount('10 people')).toBe(10);
      expect(determineGuestCount('5 persons')).toBe(5);
      expect(determineGuestCount('3 pax')).toBe(3);
    });

    it('handles edge cases', () => {
      expect(determineGuestCount('Smith Family (0)')).toBe(1); // Invalid count, falls back
      expect(determineGuestCount('Group (100)')).toBe(1); // Exceeds max, falls back
      expect(determineGuestCount('')).toBe(1);
      expect(determineGuestCount('   ')).toBe(1);
      expect(logError).toHaveBeenCalled();
    });

    it('handles invalid inputs', () => {
      expect(determineGuestCount(null as any)).toBe(1);
      expect(determineGuestCount(undefined as any)).toBe(1);
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('parseGuest', () => {
    it('parses single guest correctly', () => {
      const result = parseGuest('John Doe');
      expect(result).toMatchObject({
        name: 'John Doe',
        displayName: 'John Doe',
        count: 1,
        individualNames: ['John Doe'],
        normalizedKey: 'john doe',
      });
      expect(result.id).toBeDefined();
      expect(result.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    });

    it('parses group with multiple separators', () => {
      const result = parseGuest('Jane & John and Mary');
      expect(result).toMatchObject({
        name: 'Jane & John & Mary',
        displayName: 'Jane & John & Mary',
        count: 3,
        individualNames: ['Jane', 'John', 'Mary'],
        normalizedKey: 'jane & john & mary',
      });
    });

    it('generates unique IDs for each guest', () => {
      const guest1 = parseGuest('Alice');
      const guest2 = parseGuest('Bob');
      const guest3 = parseGuest('Alice'); // Same name, different ID
      
      expect(guest1.id).toBeDefined();
      expect(guest2.id).toBeDefined();
      expect(guest3.id).toBeDefined();
      expect(guest1.id).not.toBe(guest2.id);
      expect(guest1.id).not.toBe(guest3.id);
      expect(guest2.id).not.toBe(guest3.id);
    });

    it('handles family notation', () => {
      const result = parseGuest('Smith Family (4)');
      expect(result).toMatchObject({
        name: 'Smith Family',
        displayName: 'Smith Family',
        count: 4,
        individualNames: ['Smith Family'],
      });
    });

    it('handles bare guest count', () => {
      const result = parseGuest('4 guests');
      expect(result.count).toBe(4);
    });

    it('handles invalid input gracefully', () => {
      const result = parseGuest('');
      expect(result).toMatchObject({
        name: '',
        displayName: '',
        count: 1,
        individualNames: [''],
        normalizedKey: '',
      });
      expect(logError).toHaveBeenCalled();
    });

    it('handles XSS attempts gracefully', () => {
      const result = parseGuest('<script>alert(1)</script>');
      expect(result.name).toBe('<script>alert(1)</script>');
      expect(result.count).toBe(1);
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('parseGuestInput', () => {
    it('parses multi-line input correctly', () => {
      const input = 'Alice Smith\nBob & Carol\nSmith Family (4)';
      const result = parseGuestInput(input);
      
      expect(result.isValid).toBe(true);
      expect(result.guests).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
      
      expect(result.guests[0]).toMatchObject({
        name: 'Alice Smith',
        count: 1,
      });
      expect(result.guests[1]).toMatchObject({
        name: 'Bob & Carol',
        count: 2,
      });
      expect(result.guests[2]).toMatchObject({
        name: 'Smith Family',
        count: 4,
      });
    });

    it('handles empty lines gracefully', () => {
      const input = 'Alice\n\n\nBob\n\n';
      const result = parseGuestInput(input);
      
      expect(result.guests).toHaveLength(2);
      expect(result.guests[0].name).toBe('Alice');
      expect(result.guests[1].name).toBe('Bob');
    });

    it('handles whitespace-only input as invalid', () => {
      const result = parseGuestInput('   \n   ');
      expect(result.isValid).toBe(false);
      expect(result.errors).toContain('Invalid input');
    });

    it('detects duplicate guests', () => {
      const input = 'Alice Smith\nAlice Smith\nBob Jones';
      const result = parseGuestInput(input);
      
      expect(result.errors).toContain('Duplicate guest names detected');
      expect(result.guests).toHaveLength(3); // Still includes duplicates
    });

    it('detects case-insensitive duplicates', () => {
      const input = 'Alice\nBob\nALICE';
      const result = parseGuestInput(input);
      expect(result.errors).toContain('Duplicate guest names detected');
    });

    it('handles large guest counts with warnings', () => {
      const largeInput = Array(100).fill('Guest').map((g, i) => `${g} ${i}`).join('\n');
      const result = parseGuestInput(largeInput);
      
      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('enforces total guest limit', () => {
      const hugeInput = Array(500).fill('Large Group (10)').join('\n');
      const result = parseGuestInput(hugeInput);
      
      expect(result.errors).toContain('Total guest count exceeds system limits (2000)');
    });

    it('reports invalid guest names with line numbers', () => {
      const input = 'Alice\n<script>alert("xss")</script>\nBob';
      const result = parseGuestInput(input);
      
      expect(result.guests).toHaveLength(3);
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors[0]).toContain('Line 2');
    });

    it('handles suspicious entries', () => {
      const input = 'Normal Guest\nSuspicious Group (30)\n' + 'A'.repeat(150);
      const result = parseGuestInput(input);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('may need review');
    });

    it('handles invalid input types', () => {
      const result = parseGuestInput('');
      expect(result).toEqual({
        isValid: false,
        guests: [],
        errors: ['Invalid input'],
        warnings: [],
      });
      
      const nullResult = parseGuestInput(null as any);
      expect(nullResult.isValid).toBe(false);
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('mergeDuplicateGuests', () => {
    it('merges exact duplicates', () => {
      const guests: Guest[] = [
        { 
          id: '1', 
          name: 'Alice Smith', 
          count: 1, 
          individualNames: ['Alice Smith'], 
          normalizedKey: 'alice smith',
          displayName: 'Alice Smith' 
        },
        { 
          id: '2', 
          name: 'Alice Smith', 
          count: 1, 
          individualNames: ['Alice Smith'], 
          normalizedKey: 'alice smith',
          displayName: 'Alice Smith' 
        },
      ];
      
      const result = mergeDuplicateGuests(guests);
      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        count: 2,
        name: 'Alice Smith; Alice Smith',
        displayName: 'Alice Smith; Alice Smith',
      });
    });

    it('merges case-insensitive duplicates', () => {
      const guests: Guest[] = [
        { 
          id: '1', 
          name: 'Bob Jones', 
          count: 1, 
          individualNames: ['Bob Jones'], 
          normalizedKey: 'bob jones',
          displayName: 'Bob Jones' 
        },
        { 
          id: '2', 
          name: 'BOB JONES', 
          count: 2, 
          individualNames: ['BOB JONES'], 
          normalizedKey: 'bob jones',
          displayName: 'BOB JONES' 
        },
      ];
      
      const result = mergeDuplicateGuests(guests);
      expect(result).toHaveLength(1);
      expect(result[0].count).toBe(3);
    });

    it('preserves unique guests', () => {
      const guests: Guest[] = [
        { 
          id: '1', 
          name: 'Alice', 
          count: 1, 
          individualNames: ['Alice'], 
          normalizedKey: 'alice',
          displayName: 'Alice' 
        },
        { 
          id: '2', 
          name: 'Bob', 
          count: 1, 
          individualNames: ['Bob'], 
          normalizedKey: 'bob',
          displayName: 'Bob' 
        },
      ];
      
      const result = mergeDuplicateGuests(guests);
      expect(result).toHaveLength(2);
    });

    it('handles empty array', () => {
      const result = mergeDuplicateGuests([]);
      expect(result).toEqual([]);
    });

    it('merges individual names correctly', () => {
      const guests: Guest[] = [
        { 
          id: '1', 
          name: 'Smith Family', 
          count: 2, 
          individualNames: ['John Smith', 'Jane Smith'], 
          normalizedKey: 'smith family',
          displayName: 'Smith Family' 
        },
        { 
          id: '2', 
          name: 'Smith Family', 
          count: 1, 
          individualNames: ['Bob Smith'], 
          normalizedKey: 'smith family',
          displayName: 'Smith Family' 
        },
      ];
      
      const result = mergeDuplicateGuests(guests);
      expect(result[0].individualNames).toEqual(['John Smith', 'Jane Smith', 'Bob Smith']);
    });
  });

  describe('splitLargeGroups', () => {
    it('splits large group evenly', () => {
      const guests: Guest[] = [
        {
          id: '1',
          name: 'Large Group',
          displayName: 'Large Group',
          count: 20,
          individualNames: Array(20).fill('Person'),
          normalizedKey: 'large group',
        },
      ];
      
      const result = splitLargeGroups(guests, 8);
      expect(result).toHaveLength(3);
      expect(result[0].count).toBe(7);
      expect(result[1].count).toBe(7);
      expect(result[2].count).toBe(6);
      expect(result[0].displayName).toContain('Large Group');
      expect(result[0].displayName).toContain('Group 1');
    });

    it('preserves small groups', () => {
      const guests: Guest[] = [
        {
          id: '1',
          name: 'Small Group',
          displayName: 'Small Group',
          count: 5,
          individualNames: Array(5).fill('Person'),
          normalizedKey: 'small group',
        },
      ];
      
      const result = splitLargeGroups(guests, 8);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(guests[0]);
    });

    it('handles exactly max size', () => {
      const guests: Guest[] = [
        {
          id: '1',
          name: 'Exact Group',
          displayName: 'Exact Group',
          count: 8,
          individualNames: Array(8).fill('Person'),
          normalizedKey: 'exact group',
        },
      ];
      
      const result = splitLargeGroups(guests, 8);
      expect(result).toHaveLength(1);
      expect(result[0]).toEqual(guests[0]);
    });

    it('splits groups larger than max size correctly', () => {
      const guests: Guest[] = [
        {
          id: '1',
          name: 'Group',
          displayName: 'Group',
          count: 10,
          individualNames: Array(10).fill('Member'),
          normalizedKey: 'group',
        },
      ];
      
      const split = splitLargeGroups(guests, 4);
      expect(split.every(g => g.count <= 4)).toBe(true);
      expect(split.length).toBe(Math.ceil(10 / 4));
      const totalCount = split.reduce((sum, g) => sum + g.count, 0);
      expect(totalCount).toBe(10);
    });

    it('handles invalid maxGroupSize', () => {
      const guests: Guest[] = [
        { 
          id: '1', 
          name: 'Alice', 
          displayName: 'Alice',
          count: 10, 
          individualNames: ['Alice'], 
          normalizedKey: 'alice' 
        }
      ];
      
      expect(splitLargeGroups(guests, 0)).toEqual(guests);
      expect(splitLargeGroups(guests, -5)).toEqual(guests);
      expect(splitLargeGroups(guests, NaN)).toEqual(guests);
      expect(logError).toHaveBeenCalled();
    });

    it('generates unique IDs for split groups', () => {
      const guests: Guest[] = [
        {
          id: '1',
          name: 'Big Group',
          displayName: 'Big Group',
          count: 16,
          individualNames: Array(16).fill('Person'),
          normalizedKey: 'big group',
        },
      ];
      
      const result = splitLargeGroups(guests, 8);
      expect(result[0].id).not.toBe(result[1].id);
      expect(result[0].id).not.toBe('1');
    });
  });

  describe('exportGuestList', () => {
    const guests: Guest[] = [
      { 
        id: '1', 
        name: 'Alice Smith', 
        displayName: 'Alice Smith',
        count: 1, 
        individualNames: ['Alice Smith'], 
        normalizedKey: 'alice smith' 
      },
      { 
        id: '2', 
        name: 'Bob & Carol', 
        displayName: 'Bob & Carol',
        count: 2, 
        individualNames: ['Bob', 'Carol'], 
        normalizedKey: 'bob & carol' 
      },
      {
        id: '3',
        name: 'Smith Family',
        displayName: 'Smith Family',
        count: 4,
        individualNames: ['John', 'Jane', 'Jim', 'Joan'],
        normalizedKey: 'smith family',
      },
    ];

    describe('JSON export', () => {
      it('exports to valid JSON format', () => {
        const result = exportGuestList(guests, 'json');
        const parsed = JSON.parse(result);
        
        expect(parsed).toMatchObject({
          totalEntries: 3,
          totalGuests: 7,
          guests: expect.any(Array),
        });
        expect(parsed.exportedAt).toBeDefined();
        expect(parsed.guests).toHaveLength(3);
        expect(parsed.guests[0]).toMatchObject({
          id: '1',
          name: 'Alice Smith',
          count: 1,
          individualNames: ['Alice Smith'],
        });
      });

      it('uses JSON as default format', () => {
        const result = exportGuestList(guests);
        expect(() => JSON.parse(result)).not.toThrow();
      });
    });

    describe('CSV export', () => {
      it('exports to CSV format with headers', () => {
        const result = exportGuestList(guests, 'csv');
        const lines = result.split('\n');
        
        expect(lines[0]).toBe('Name,Count,Individual Names');
        expect(lines[1]).toBe('"Alice Smith",1,"Alice Smith"');
        expect(lines[2]).toBe('"Bob & Carol",2,"Bob; Carol"');
        expect(lines[3]).toBe('"Smith Family",4,"John; Jane; Jim; Joan"');
      });

      it('escapes quotes in CSV', () => {
        const guestsWithQuotes: Guest[] = [{
          id: '1',
          name: 'John "Johnny" Doe',
          displayName: 'John "Johnny" Doe',
          count: 1,
          individualNames: ['John "Johnny" Doe'],
          normalizedKey: 'john johnny doe',
        }];
        
        const result = exportGuestList(guestsWithQuotes, 'csv');
        expect(result).toContain('"John ""Johnny"" Doe"');
      });
    });

    describe('TXT export', () => {
      it('exports to plain text format', () => {
        const result = exportGuestList(guests, 'txt');
        const lines = result.split('\n');
        
        expect(lines[0]).toBe('Alice Smith');
        expect(lines[1]).toBe('Bob & Carol (2 people)');
        expect(lines[2]).toBe('Smith Family (4 people)');
      });

      it('handles single guests without count suffix', () => {
        const singleGuest: Guest[] = [{
          id: '1',
          name: 'Solo Guest',
          displayName: 'Solo Guest',
          count: 1,
          individualNames: ['Solo Guest'],
          normalizedKey: 'solo guest',
        }];
        
        const result = exportGuestList(singleGuest, 'txt');
        expect(result).toBe('Solo Guest');
      });
    });

    it('handles empty guest list', () => {
      expect(exportGuestList([], 'json')).toContain('"guests": []');
      expect(exportGuestList([], 'csv')).toBe('Name,Count,Individual Names\n');
      expect(exportGuestList([], 'txt')).toBe('');
    });

    it('handles invalid format gracefully', () => {
      const result = exportGuestList(guests, 'invalid' as any);
      expect(() => JSON.parse(result)).not.toThrow(); // Defaults to JSON
    });

    it('handles errors gracefully', () => {
      const invalidGuests = null as any;
      expect(exportGuestList(invalidGuests, 'json')).toBe('');
      expect(logError).toHaveBeenCalled();
    });
  });

  describe('Integration tests', () => {
    it('handles full guest parsing pipeline', () => {
      const input = `Alice Smith
Bob & Carol Johnson
Smith Family (4)
Dan, Maria & Josh
Team 🎉 (10 people)`;

      const result = parseGuestInput(input);
      expect(result.isValid).toBe(true);
      expect(result.guests).toHaveLength(5);
      
      const totalCount = result.guests.reduce((sum, g) => sum + g.count, 0);
      expect(totalCount).toBe(20);

      const merged = mergeDuplicateGuests(result.guests);
      expect(merged).toHaveLength(5);

      const split = splitLargeGroups(merged, 8);
      expect(split.length).toBeGreaterThan(5); // Team of 10 gets split

      const json = exportGuestList(split, 'json');
      const parsed = JSON.parse(json);
      expect(parsed.totalGuests).toBe(20);
    });

    it('handles edge case with all invalid input', () => {
      const input = `<script>alert(1)</script>
<iframe src="bad"></iframe>
javascript:void(0)`;

      const result = parseGuestInput(input);
      expect(result.guests).toHaveLength(3);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('handles complex real-world scenario', () => {
      const input = `Dr. O'Malley-Smith, Jr.
Mr. & Mrs. Johnson
Smith Family (4)
José & María García
Team 🎉
Bob and Carol and Ted and Alice
4 guests
Large Group (25 people)`;

      const result = parseGuestInput(input);
      expect(result.isValid).toBe(true);
      
      // Verify counts
      const counts = result.guests.map(g => g.count);
      expect(counts).toContain(1); // Dr. O'Malley-Smith
      expect(counts).toContain(2); // Mr. & Mrs. Johnson
      expect(counts).toContain(4); // Smith Family, Bob/Carol/Ted/Alice, 4 guests
      expect(counts).toContain(25); // Large Group

      // Test splitting large groups
      const split = splitLargeGroups(result.guests, 8);
      const largeGroupSplits = split.filter(g => g.displayName.includes('Large Group'));
      expect(largeGroupSplits.length).toBeGreaterThan(1);

      // Test export formats
      const csv = exportGuestList(split, 'csv');
      expect(csv).toContain('Name,Count,Individual Names');
      
      const txt = exportGuestList(split, 'txt');
      expect(txt).toContain('Dr. O\'Malley-Smith, Jr.');
      
      const json = exportGuestList(split, 'json');
      const jsonData = JSON.parse(json);
      expect(jsonData.totalGuests).toBeGreaterThanOrEqual(40);
    });
  });

  describe('Error handling and edge cases', () => {
    it('handles null and undefined gracefully throughout', () => {
      expect(() => validateGuestName(null as any)).not.toThrow();
      expect(() => normalizeGuestName(undefined as any)).not.toThrow();
      expect(() => getLastNameForSorting(null as any)).not.toThrow();
      expect(() => extractIndividualNames(undefined as any)).not.toThrow();
      expect(() => determineGuestCount(null as any)).not.toThrow();
      expect(() => parseGuest(undefined as any)).not.toThrow();
      expect(() => parseGuestInput(null as any)).not.toThrow();
      expect(() => mergeDuplicateGuests(undefined as any)).not.toThrow();
      expect(() => splitLargeGroups(null as any)).not.toThrow();
      expect(() => exportGuestList(undefined as any)).not.toThrow();
    });

    it('maintains data integrity through multiple operations', () => {
      const originalInput = 'Alice & Bob\nCarol and David\nEve';
      
      // Parse
      const parsed = parseGuestInput(originalInput);
      expect(parsed.guests).toHaveLength(3);
      
      // Merge (no duplicates, should be same)
      const merged = mergeDuplicateGuests(parsed.guests);
      expect(merged).toHaveLength(3);
      
      // Split (all small, should be same)
      const split = splitLargeGroups(merged, 8);
      expect(split).toHaveLength(3);
      
      // Export and verify counts preserved
      const json = JSON.parse(exportGuestList(split, 'json'));
      expect(json.totalGuests).toBe(5); // 2 + 2 + 1
    });

    it('handles very large guest lists efficiently', () => {
      const largeList = Array(500)
        .fill(null)
        .map((_, i) => `Guest ${i}`)
        .join('\n');
      
      const startTime = Date.now();
      const result = parseGuestInput(largeList);
      const endTime = Date.now();
      
      expect(result.guests).toHaveLength(500);
      expect(endTime - startTime).toBeLessThan(1000); // Should complete in < 1 second
    });
  });
});