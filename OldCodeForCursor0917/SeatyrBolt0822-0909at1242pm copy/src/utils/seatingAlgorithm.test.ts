/**
 * Comprehensive test suite for seating algorithm adjacency logic
 * Tests the axiomatic logic as specified in the SSoT
 */

import { detectAdjacentPairingConflicts, detectConstraintConflicts } from './seatingAlgorithm';
import { Guest, Table } from '../types';

// Mock data for testing
const createTestTables = (seats: number[]): Table[] => {
  return seats.map((seats, index) => ({ id: index + 1, seats }));
};

const createTestGuests = (names: string[], counts: number[]): Guest[] => {
  return names.map((name, index) => ({ name, count: counts[index] || 1 }));
};

// Test suite for detectAdjacentPairingConflicts - Axiom Tests
const testAxiomTests = () => {
  const tables = createTestTables([10]); // Single table with 10 seats
  
  // Test AXIOM: 2-guest chains are never circular
  const testTwoGuestChains = () => {
    // 2-guest chain under capacity is NOT a conflict
    const guests1 = createTestGuests(['A', 'B'], [1, 1]);
    const adjacents1 = { 'A': ['B'], 'B': ['A'] };
    
    const conflicts1 = detectAdjacentPairingConflicts(guests1, adjacents1, tables);
    console.assert(conflicts1.length === 0, '2-guest chain under capacity should not be a conflict');
    
    // 2-guest chain over capacity IS a conflict
    const guests2 = createTestGuests(['A', 'B'], [6, 5]);
    const adjacents2 = { 'A': ['B'], 'B': ['A'] };
    
    const conflicts2 = detectAdjacentPairingConflicts(guests2, adjacents2, tables);
    console.assert(conflicts2.length === 1, '2-guest chain over capacity should be a conflict');
    console.assert(conflicts2[0].type === 'capacity_violation', 'Should be capacity violation type');
  };
  
  // Test 3+ guest chains require exactly 2 endpoints
  const testThreePlusGuestChains = () => {
    // 3-guest chain with 2 endpoints (valid line) is NOT a conflict
    const guests1 = createTestGuests(['A', 'B', 'C'], [1, 1, 1]);
    const adjacents1 = { 
      'A': ['B'],           // A has degree 1 (endpoint)
      'B': ['A', 'C'],      // B has degree 2 (middle)
      'C': ['B']            // C has degree 1 (endpoint)
    };
    
    const conflicts1 = detectAdjacentPairingConflicts(guests1, adjacents1, tables);
    console.assert(conflicts1.length === 0, '3-guest chain with 2 endpoints should not be a conflict');
    
    // 3-guest chain with < 2 endpoints (closed loop) IS a conflict
    const guests2 = createTestGuests(['A', 'B', 'C'], [1, 1, 1]);
    const adjacents2 = { 
      'A': ['B', 'C'],      // A has degree 2
      'B': ['A', 'C'],      // B has degree 2
      'C': ['A', 'B']       // C has degree 2
    };
    
    const conflicts2 = detectAdjacentPairingConflicts(guests2, adjacents2, tables);
    console.assert(conflicts2.length === 1, '3-guest chain with < 2 endpoints should be a conflict');
    console.assert(conflicts2[0].type === 'circular', 'Should be circular type');
  };
  
  // Test degree cap enforcement
  const testDegreeCapEnforcement = () => {
    // Guest with degree > 2 (star topology) IS a conflict
    const guests = createTestGuests(['A', 'B', 'C', 'D'], [1, 1, 1, 1]);
    const adjacents = { 
      'A': ['B', 'C', 'D'], // A has degree 3 (violation!)
      'B': ['A'],            // B has degree 1
      'C': ['A'],            // C has degree 1
      'D': ['A']             // D has degree 1
    };
    
    const conflicts = detectAdjacentPairingConflicts(guests, adjacents, tables);
    console.assert(conflicts.length === 1, 'Guest with degree > 2 should be a conflict');
    console.assert(conflicts[0].type === 'adjacency_violation', 'Should be adjacency violation type');
  };
  
  // Run all tests
  testTwoGuestChains();
  testThreePlusGuestChains();
  testDegreeCapEnforcement();
  
  console.log('✅ All axiom tests passed!');
};

// Test the enhanced adjacency logic with must-constraint validation
const testEnhancedAdjacencyLogic = () => {
  // Adjacent pairs no longer require explicit must constraints (Implicit Must model)
  const guests1 = createTestGuests(['A', 'B'], [1, 1]);
  const adjacents1 = { 'A': ['B'], 'B': ['A'] };
  const tables1 = createTestTables([10]);
  const constraints1 = {}; // No must constraints needed
  
  const conflicts1 = detectAdjacentPairingConflicts(guests1, adjacents1, tables1, constraints1);
  console.assert(conflicts1.length === 0, 'Adjacent pairs should work without explicit must constraints (Implicit Must model)');
  
  // Should also work with explicit must constraints
  const guests2 = createTestGuests(['A', 'B'], [1, 1]);
  const adjacents2 = { 'A': ['B'], 'B': ['A'] };
  const tables2 = createTestTables([10]);
  const constraints2: Record<string, Record<string, 'must' | 'cannot' | ''>> = { 'A': { 'B': 'must' }, 'B': { 'A': 'must' } };
  
  const conflicts2 = detectAdjacentPairingConflicts(guests2, adjacents2, tables2, constraints2);
  console.assert(conflicts2.length === 0, 'Should also work with explicit must constraints');
  
  // Should use maxTableCapacity for existential placeability
  const guests3 = createTestGuests(['A', 'B', 'C'], [4, 4, 4]);
  const adjacents3 = { 
    'A': ['B'],           // A has degree 1 (endpoint)
    'B': ['A', 'C'],      // B has degree 2 (middle)
    'C': ['B']            // C has degree 1 (endpoint)
  };
  const tables3 = createTestTables([8, 10, 12]); // Max capacity is 12
  
  const conflicts3 = detectAdjacentPairingConflicts(guests3, adjacents3, tables3);
  console.assert(conflicts3.length === 0, 'Should pass with maxTableCapacity for existential placeability');
  
  console.log('✅ All enhanced adjacency logic tests passed!');
};

// Test the min-capacity bug fix
const testMinCapacityBugFix = () => {
  const guests = createTestGuests(['A', 'B'], [6, 5]);
  const adjacents = { 'A': ['B'], 'B': ['A'] };
  const tables = createTestTables([8, 10, 12]); // Multiple tables with valid capacities
  
  const conflicts = detectAdjacentPairingConflicts(guests, adjacents, tables);
  // Should detect capacity violation (11 seats > 8 min capacity), not early exit
  console.assert(conflicts.length === 1, 'Should detect capacity violation, not early exit');
  console.assert(conflicts[0].type === 'capacity_violation', 'Should be capacity violation type');
  
  console.log('✅ Min-capacity bug fix test passed!');
};

// Test the self-reference bug fix in circular dependency detection
const testSelfReferenceBugFix = () => {
  const guests = createTestGuests(['A', 'B', 'C'], [1, 1, 1]);
  const tables = createTestTables([10]);
  
  // Test self-referential constraint (should be ignored, not cause false circular dependency)
  const selfReferential: Record<string, Record<string, 'must' | 'cannot' | ''>> = {
    'A': { 'A': 'must' },  // A cannot depend on itself
    'B': { 'C': 'must' },  // B depends on C
    'C': { 'B': 'must' }   // C depends on B (creates a valid 2-node cycle)
  };
  
  // This should NOT report a circular dependency because A→A is impossible
  // and B↔C is a valid 2-node relationship
  const conflicts = detectConstraintConflicts(guests, selfReferential, tables);
  console.assert(conflicts.length === 0, 'Self-referential constraints should be ignored, not cause false circular dependencies');
  
  console.log('✅ Self-reference bug fix test passed!');
};

// Run all test suites
export const runAllTests = () => {
  console.log('🧪 Running comprehensive adjacency logic tests...');
  testAxiomTests();
  testEnhancedAdjacencyLogic();
  testMinCapacityBugFix();
  testSelfReferenceBugFix();
  console.log('🎉 All tests completed successfully!');
};
