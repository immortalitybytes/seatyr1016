// __tests__/utils/guestParser.test.ts
// Comprehensive unit tests for guest parsing and validation

import { 
  parseGuest, 
  validateGuestName, 
  parseGuestList,
  validateGuestList,
  findGuestByKey,
  normalizeGuestKey,
  GUEST_SEPARATOR_REGEX 
} from '../../src/utils/guestParser';

describe('guestParser', () => {
  describe('validateGuestName', () => {
    it('should accept a valid single name', () => {
      expect(validateGuestName('John Doe')).toEqual({ isValid: true });
    });

    it('should accept valid names with common separators', () => {
      expect(validateGuestName('Alice & Bob')).toEqual({ isValid: true });
      expect(validateGuestName('Carol and David')).toEqual({ isValid: true });
    });

    it('should reject an empty or whitespace-only name', () => {
      expect(validateGuestName('')).toEqual({ 
        isValid: false, 
        error: 'Guest name cannot be empty.' 
      });
      expect(validateGuestName('   ')).toEqual({ 
        isValid: false, 
        error: 'Guest name cannot be empty.' 
      });
    });

    it('should reject a name that is too long', () => {
      const longName = 'a'.repeat(101);
      expect(validateGuestName(longName)).toEqual({ 
        isValid: false, 
        error: 'Guest name is too long (max 100 characters).' 
      });
    });

    it('should reject names with script tags to prevent XSS', () => {
      expect(validateGuestName('<script>alert("xss")</script>')).toEqual({
        isValid: false,
        error: 'Guest name contains invalid characters or script tags.',
      });
    });

    it('should reject names with HTML event handlers like onerror', () => {
      expect(validateGuestName('Guest<img src=x onerror=alert(1)>')).toEqual({
        isValid: false,
        error: 'Guest name contains invalid characters or script tags.',
      });
    });

    it('should reject names with the javascript: protocol', () => {
      expect(validateGuestName('a href="javascript:alert(1)"')).toEqual({
        isValid: false,
        error: 'Guest name contains invalid characters or script tags.',
      });
    });

    it('should reject other HTML injection attempts', () => {
      expect(validateGuestName('<iframe src="malicious"></iframe>')).toEqual({
        isValid: false,
        error: 'Guest name contains invalid characters or script tags.',
      });
      expect(validateGuestName('<div onclick="malicious()">Name</div>')).toEqual({
        isValid: false,
        error: 'Guest name contains invalid characters or script tags.',
      });
    });

    it('should reject a guest unit with more than 8 individuals', () => {
      const largeGroup = 'A&B&C&D&E&F&G&H&I'; // 9 people
      expect(validateGuestName(largeGroup)).toEqual({
        isValid: false,
        error: 'A single guest unit cannot contain more than 8 people.'
      });
    });

    // Enhancement suggested by ChatGPT critique
    it('should accept names with common punctuation and emojis', () => {
      expect(validateGuestName("Dr. O'Malley-Smith, Jr.")).toEqual({ isValid: true });
      expect(validateGuestName("Team 🎉")).toEqual({ isValid: true });
      expect(validateGuestName("José & María")).toEqual({ isValid: true });
      expect(validateGuestName("Mr. & Mrs. Johnson")).toEqual({ isValid: true });
    });

    it('should handle edge cases with separators', () => {
      expect(validateGuestName("Alice & & Bob")).toEqual({ isValid: true }); // Extra separator
      expect(validateGuestName("Alice and and Bob")).toEqual({ isValid: true }); // Double 'and'
    });
  });

  describe('parseGuest', () => {
    it('should correctly parse a single guest name', () => {
      const guestUnit = parseGuest('Alice');
      expect(guestUnit.name).toBe('Alice');
      expect(guestUnit.count).toBe(1);
      expect(guestUnit.individualNames).toEqual(['Alice']);
      expect(guestUnit.normalizedKey).toBe('alice');
      expect(guestUnit.displayName).toBe('Alice');
      expect(guestUnit.id).toBeDefined();
      expect(guestUnit.id).toMatch(/^guest_/);
    });

    it('should correctly parse a couple with "&"', () => {
      const guestUnit = parseGuest('Bob & Carol');
      expect(guestUnit.name).toBe('Bob & Carol');
      expect(guestUnit.count).toBe(2);
      expect(guestUnit.individualNames).toEqual(['Bob', 'Carol']);
      expect(guestUnit.normalizedKey).toBe('bob & carol');
    });

    it('should correctly parse a couple with "and"', () => {
      const guestUnit = parseGuest('Ted and Alice');
      expect(guestUnit.name).toBe('Ted and Alice');
      expect(guestUnit.count).toBe(2);
      expect(guestUnit.individualNames).toEqual(['Ted', 'Alice']);
      expect(guestUnit.normalizedKey).toBe('ted and alice');
    });

    it('should handle extra whitespace gracefully', () => {
      const guestUnit = parseGuest('  David & Eve  ');
      expect(guestUnit.name).toBe('David & Eve');
      expect(guestUnit.count).toBe(2);
      expect(guestUnit.individualNames).toEqual(['David', 'Eve']);
    });

    it('should parse a larger group with mixed separators', () => {
      const guestUnit = parseGuest('Frank and Grace & Heidi');
      expect(guestUnit.name).toBe('Frank and Grace & Heidi');
      expect(guestUnit.count).toBe(3);
      expect(guestUnit.individualNames).toEqual(['Frank', 'Grace', 'Heidi']);
    });

    it('should handle complex names with multiple separators', () => {
      const guestUnit = parseGuest('John & Jane and Bob & Alice');
      expect(guestUnit.count).toBe(4);
      expect(guestUnit.individualNames).toEqual(['John', 'Jane', 'Bob', 'Alice']);
    });

    it('should throw an error for invalid names during parsing', () => {
      expect(() => parseGuest('<script>')).toThrow('Guest name contains invalid characters or script tags.');
      expect(() => parseGuest('')).toThrow('Guest name cannot be empty.');
    });

    it('should generate unique IDs for each guest unit', () => {
      const guest1 = parseGuest('Alice');
      const guest2 = parseGuest('Bob');
      expect(guest1.id).not.toBe(guest2.id);
    });
  });

  describe('GUEST_SEPARATOR_REGEX', () => {
    it('should match ampersands with surrounding spaces', () => {
      expect('Alice & Bob'.split(GUEST_SEPARATOR_REGEX)).toEqual(['Alice', 'Bob']);
    });

    it('should match "and" with surrounding spaces', () => {
      expect('Carol and David'.split(GUEST_SEPARATOR_REGEX)).toEqual(['Carol', 'David']);
    });

    it('should be case insensitive for "and"', () => {
      expect('Carol AND David'.split(GUEST_SEPARATOR_REGEX)).toEqual(['Carol', 'David']);
      expect('Carol And David'.split(GUEST_SEPARATOR_REGEX)).toEqual(['Carol', 'David']);
    });

    it('should handle multiple separators', () => {
      expect('A & B and C'.split(GUEST_SEPARATOR_REGEX)).toEqual(['A', 'B', 'C']);
    });
  });

  describe('parseGuestList', () => {
    it('should parse multiple guests from newline-separated input', () => {
      const input = 'Alice\nBob & Carol\nDavid';
      const result = parseGuestList(input);
      
      expect(result.guests).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
      expect(result.guests[0].name).toBe('Alice');
      expect(result.guests[1].name).toBe('Bob & Carol');
      expect(result.guests[2].name).toBe('David');
    });

    it('should parse multiple guests from comma-separated input', () => {
      const input = 'Alice, Bob & Carol, David';
      const result = parseGuestList(input);
      
      expect(result.guests).toHaveLength(3);
      expect(result.errors).toHaveLength(0);
    });

    it('should handle empty input', () => {
      const result = parseGuestList('');
      expect(result.guests).toHaveLength(0);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect and report duplicates', () => {
      const input = 'Alice\nBob\nALICE'; // Case insensitive duplicate
      const result = parseGuestList(input);
      
      expect(result.guests).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Duplicate guest');
    });

    it('should report invalid guest names', () => {
      const input = 'Alice\n<script>alert("xss")</script>\nBob';
      const result = parseGuestList(input);
      
      expect(result.guests).toHaveLength(2);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('Invalid guest');
    });
  });

  describe('validateGuestList', () => {
    it('should accept a valid guest list', () => {
      const guests = [parseGuest('Alice'), parseGuest('Bob & Carol')];
      expect(validateGuestList(guests)).toEqual({ isValid: true });
    });

    it('should reject an empty guest list', () => {
      expect(validateGuestList([])).toEqual({
        isValid: false,
        error: 'At least one guest is required.'
      });
    });

    it('should reject too many guests', () => {
      const guests = Array.from({ length: 1001 }, (_, i) => parseGuest(`Guest ${i}`));
      expect(validateGuestList(guests)).toEqual({
        isValid: false,
        error: 'Too many guests (maximum 1000 guests supported).'
      });
    });

    it('should reject when total people exceeds limit', () => {
      // Create guests that total more than 2000 people
      const guests = Array.from({ length: 300 }, (_, i) => {
        const guestUnit = parseGuest(`Group ${i}`);
        guestUnit.count = 7; // Force high count
        return guestUnit;
      });
      
      expect(validateGuestList(guests)).toEqual({
        isValid: false,
        error: 'Total guest count exceeds maximum (2000 people).'
      });
    });
  });

  describe('normalizeGuestKey', () => {
    it('should normalize guest names consistently', () => {
      expect(normalizeGuestKey('Alice')).toBe('alice');
      expect(normalizeGuestKey('  Bob & Carol  ')).toBe('bob & carol');
      expect(normalizeGuestKey('DAVID')).toBe('david');
    });
  });

  describe('findGuestByKey', () => {
    const guests = [
      parseGuest('Alice'),
      parseGuest('Bob & Carol'),
      parseGuest('David')
    ];

    it('should find guests by exact normalized key', () => {
      const