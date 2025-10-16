/**
 * Comprehensive test suite for guest parsing logic
 * Tests the tokenizer-based parser for comprehensive coverage
 */

import { countHeads } from './guestCount';

describe('countHeads - Comprehensive Parsing Tests', () => {
  describe('Basic connector parsing', () => {
    test('Single guest returns 1', () => {
      expect(countHeads('John Smith')).toBe(1);
      expect(countHeads('Alice')).toBe(1);
      expect(countHeads('')).toBe(1); // Empty string defaults to 1
    });

    test('Ampersand connectors', () => {
      expect(countHeads('John & Jane')).toBe(2);
      expect(countHeads('A & B & C')).toBe(3);
      expect(countHeads('Family & Friends')).toBe(2);
    });

    test('Plus connectors', () => {
      expect(countHeads('John + Jane')).toBe(2);
      expect(countHeads('A + B + C')).toBe(3);
      expect(countHeads('Host + Guest')).toBe(2);
    });

    test('"and" connectors', () => {
      expect(countHeads('John and Jane')).toBe(2);
      expect(countHeads('A and B and C')).toBe(3);
      expect(countHeads('Host and Guest')).toBe(2);
    });

    test('"plus" word connectors', () => {
      expect(countHeads('John plus Jane')).toBe(2);
      expect(countHeads('A plus B plus C')).toBe(3);
      expect(countHeads('Host plus Guest')).toBe(2);
    });

    test('"also" connectors', () => {
      expect(countHeads('John also Jane')).toBe(2);
      expect(countHeads('A also B also C')).toBe(3);
      expect(countHeads('Host also Guest')).toBe(2);
    });
  });

  describe('Numeric variants and "plus" handling', () => {
    test('"plus one" returns 2', () => {
      expect(countHeads('John plus one')).toBe(2);
      expect(countHeads('Host plus one')).toBe(2);
      expect(countHeads('A plus one')).toBe(2);
    });

    test('"plus [number]" returns base + number', () => {
      expect(countHeads('John plus 2')).toBe(3);
      expect(countHeads('Host plus 3')).toBe(4);
      expect(countHeads('A plus 5')).toBe(6);
    });

    test('"plus [number]" without "one"', () => {
      expect(countHeads('John plus 1')).toBe(2);
      expect(countHeads('Host plus 1')).toBe(2);
    });
  });

  describe('Spelled-out numerals', () => {
    test('"X guests" format', () => {
      expect(countHeads('two guests')).toBe(2);
      expect(countHeads('five people')).toBe(5);
      expect(countHeads('ten persons')).toBe(10);
      expect(countHeads('three guests')).toBe(3);
      expect(countHeads('seven people')).toBe(7);
    });

    test('"family of X" format', () => {
      expect(countHeads('family of five')).toBe(5);
      expect(countHeads('family of three')).toBe(3);
      expect(countHeads('family of ten')).toBe(10);
      expect(countHeads('family of two')).toBe(2);
    });

    test('Spelled numbers one to twenty', () => {
      const numbers = [
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten',
        'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'
      ];
      
      numbers.forEach((word, index) => {
        const expected = index + 1;
        expect(countHeads(`${word} guests`)).toBe(expected);
        expect(countHeads(`family of ${word}`)).toBe(expected);
      });
    });
  });

  describe('Explicit count formats', () => {
    test('Parentheses format (highest precedence)', () => {
      expect(countHeads('John (2)')).toBe(2);
      expect(countHeads('Family (5)')).toBe(5);
      expect(countHeads('Group (10)')).toBe(10);
      expect(countHeads('Party (3 people)')).toBe(3);
    });

    test('Bare number format', () => {
      expect(countHeads('4 guests')).toBe(4);
      expect(countHeads('10 people')).toBe(10);
      expect(countHeads('2 persons')).toBe(2);
      expect(countHeads('7 pax')).toBe(7);
    });
  });

  describe('Complex combinations', () => {
    test('Connectors with numbers', () => {
      expect(countHeads('John & 2')).toBe(3); // 1 + 1 + 1
      expect(countHeads('A + 3')).toBe(4); // 1 + 1 + 2
      expect(countHeads('Host and 4')).toBe(5); // 1 + 1 + 3
    });

    test('Multiple connectors', () => {
      expect(countHeads('A & B + C')).toBe(3); // 1 + 1 + 1
      expect(countHeads('Host and Guest + 2')).toBe(4); // 1 + 1 + 1 + 1
    });

    test('Mixed formats', () => {
      expect(countHeads('John & Jane (3)')).toBe(3); // Parentheses take precedence
      expect(countHeads('Family of 4 + 2')).toBe(6); // 4 + 1 + 1
    });
  });

  describe('Edge cases and validation', () => {
    test('Surname false positives', () => {
      expect(countHeads('Anderson')).toBe(1); // Should not count "and" in surname
      expect(countHeads('Johnson')).toBe(1); // Should not count "son" as connector
      expect(countHeads('Williamson')).toBe(1); // Should not count "son" as connector
    });

    test('HTML and control characters', () => {
      expect(countHeads('<script>alert("xss")</script>')).toBe(1);
      expect(countHeads('John\u0000Smith')).toBe(1);
      expect(countHeads('Alice\u007FBob')).toBe(1);
    });

    test('Whitespace normalization', () => {
      expect(countHeads('John   &   Jane')).toBe(2);
      expect(countHeads('A\n+\nB')).toBe(2);
      expect(countHeads('  Host  and  Guest  ')).toBe(2);
    });

    test('Bounds checking', () => {
      expect(countHeads('John (0)')).toBe(1); // Invalid count defaults to 1
      expect(countHeads('John (51)')).toBe(1); // Out of bounds defaults to 1
      expect(countHeads('John (-5)')).toBe(1); // Negative defaults to 1
    });
  });

  describe('Family and household indicators', () => {
    test('Family keyword as minimum threshold', () => {
      expect(countHeads('family')).toBe(4); // Default family size
      expect(countHeads('household')).toBe(4); // Default household size
      expect(countHeads('Family & 2')).toBe(4); // Max of calculated (3) and family minimum (4)
    });

    test('Family with explicit count', () => {
      expect(countHeads('family of five')).toBe(5); // Explicit count overrides minimum
      expect(countHeads('family of ten')).toBe(10); // Explicit count overrides minimum
      expect(countHeads('family (7)')).toBe(7); // Parentheses format overrides minimum
    });
  });

  describe('Guest keyword handling', () => {
    test('"guest" keyword adds 1', () => {
      expect(countHeads('John guest')).toBe(2);
      expect(countHeads('Host guest')).toBe(2);
      expect(countHeads('A guest')).toBe(2);
    });

    test('"guest" with other indicators', () => {
      expect(countHeads('John & guest')).toBe(3); // 1 + 1 + 1
      expect(countHeads('Host + guest')).toBe(3); // 1 + 1 + 1
    });

    test('"guest" not counted in bare number format', () => {
      expect(countHeads('5 guests')).toBe(5); // Should not add extra for "guests"
      expect(countHeads('10 people')).toBe(10); // Should not add extra for "people"
    });
  });

  describe('Performance and large inputs', () => {
    test('Long guest names', () => {
      const longName = 'A'.repeat(1000) + ' & ' + 'B'.repeat(1000);
      expect(countHeads(longName)).toBe(2);
    });

    test('Many connectors', () => {
      const manyConnectors = 'A & B + C and D plus E also F';
      expect(countHeads(manyConnectors)).toBe(6);
    });
  });
});
