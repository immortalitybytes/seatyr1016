import React, { useState, useEffect } from 'react';
import { ClipboardList, Info, AlertCircle, Crown, ArrowDownAZ } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting } from '../utils/formatters';

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const AssignmentManager: React.FC = () => {
  const { state, dispatch } = useApp();
  // Add sorting state
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Check if user has premium subscription
  const isPremium = isPremiumSubscription(state.subscription);

  // Assignment normalization function (Batch 3)
  function normalizeAssignmentToIds(
    raw: string,
    tables: { id: number; name?: string }[]
  ): string {
    if (!raw) return '';
    const out: number[] = [];
    const byName = new Map<string, number>();
    for (const t of tables) if (t.name) byName.set(t.name.toLowerCase(), t.id);
    for (const tok of String(raw).split(',').map(s => s.trim()).filter(Boolean)) {
      const n = Number(tok);
      if (!Number.isNaN(n)) { if (!out.includes(n)) out.push(n); continue; }
      const id = byName.get(tok.toLowerCase());
      if (typeof id === 'number' && !out.includes(id)) out.push(id);
    }
    return out.join(',');
  }

  // Function to purge seating plans when assignments change
  const purgeSeatingPlans = () => {
    // Reset seating plans
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    
    // Reset plan name in localStorage
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    
    // Mark as not from saved setting
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };
  
  const handleUpdateAssignment = (name: string, value: string) => {
    setErrorMessage(null);
    try {
      // For premium users, normalize assignments to CSV of IDs
      if (isPremium) {
        const processedValue = normalizeAssignmentToIds(value, state.tables || []);
        dispatch({
          type: 'UPDATE_ASSIGNMENT',
          payload: { name, tables: processedValue }
        });
      } else {
        // For non-premium users, keep the original behavior
        dispatch({
          type: 'UPDATE_ASSIGNMENT',
          payload: { name, tables: value }
        });
      }

      // Purge seating plans when assignments change
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating assignment:', error);
      setErrorMessage(`Failed to update assignment: ${error.message || 'An unexpected error occurred'}`);
    }
  };
  
  // Handle updating must/cannot constraints from the constraint boxes
  const handleUpdateMustConstraints = (guestName: string, mustNames: string) => {
    setErrorMessage(null);
    try {
      // Get current must constraints
      const currentMusts = Object.entries(state.constraints[guestName] || {})
        .filter(([otherGuest, value]) => value === 'must')
        .map(([otherGuest]) => otherGuest);
      
      // Parse new list of must guests
      const newMusts = mustNames.split(',').map(name => name.trim()).filter(Boolean);
      
      // Remove constraints that are no longer in the list
      currentMusts.forEach(mustGuest => {
        if (!newMusts.includes(mustGuest)) {
          dispatch({
            type: 'SET_CONSTRAINT',
            payload: { guest1: guestName, guest2: mustGuest, value: '' }
          });
        }
      });
      
      // Add new constraints
      newMusts.forEach(mustGuest => {
        // Skip if it's the same guest or if constraint already exists
        if (mustGuest !== guestName && !currentMusts.includes(mustGuest)) {
          // Verify the guest exists in the guest list
          const guestExists = state.guests.some(g => g.name === mustGuest);
          if (guestExists) {
            dispatch({
              type: 'SET_CONSTRAINT',
              payload: { guest1: guestName, guest2: mustGuest, value: 'must' }
            });
          }
        }
      });
      
      // Purge seating plans when constraints change
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating must constraints:', error);
      setErrorMessage(`Failed to update must constraints: ${error.message || 'An unexpected error occurred'}`);
    }
  };
  
  const handleUpdateCannotConstraints = (guestName: string, cannotNames: string) => {
    setErrorMessage(null);
    try {
      // Get current cannot constraints
      const currentCannots = Object.entries(state.constraints[guestName] || {})
        .filter(([otherGuest, value]) => value === 'cannot')
        .map(([otherGuest]) => otherGuest);
      
      // Parse new list of cannot guests
      const newCannots = cannotNames.split(',').map(name => name.trim()).filter(Boolean);
      
      // Remove constraints that are no longer in the list
      currentCannots.forEach(cannotGuest => {
        if (!newCannots.includes(cannotGuest)) {
          dispatch({
            type: 'SET_CONSTRAINT',
            payload: { guest1: guestName, guest2: cannotGuest, value: '' }
          });
        }
      });
      
      // Add new constraints
      newCannots.forEach(cannotGuest => {
        // Skip if it's the same guest or if constraint already exists
        if (cannotGuest !== guestName && !currentCannots.includes(cannotGuest)) {
          // Verify the guest exists in the guest list
          const guestExists = state.guests.some(g => g.name === cannotGuest);
          if (guestExists) {
            dispatch({
              type: 'SET_CONSTRAINT',
              payload: { guest1: guestName, guest2: cannotGuest, value: 'cannot' }
            });
          }
        }
      });
      
      // Purge seating plans when constraints change
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating cannot constraints:', error);
      setErrorMessage(`Failed to update cannot constraints: ${error.message || 'An unexpected error occurred'}`);
    }
  };
  
  // Helper function to get all "must" constraints for a guest
  const getMustConstraints = (guestName: string) => {
    if (!state.constraints[guestName]) return [];
    
    return Object.entries(state.constraints[guestName])
      .filter(([_, value]) => value === 'must')
      .map(([otherGuest]) => otherGuest);
  };
  
  // Helper function to get all "cannot" constraints for a guest
  const getCannotConstraints = (guestName: string) => {
    if (!state.constraints[guestName]) return [];
    
    return Object.entries(state.constraints[guestName])
      .filter(([_, value]) => value === 'cannot')
      .map(([otherGuest]) => otherGuest);
  };
  
  const getTableList = () => {
    if (!isPremium || !state.tables.some(t => t.name)) {
      return state.tables.map(t => t.id).join(', ');
    }
    
    // For premium users with renamed tables, show both IDs and names
    return state.tables.map(t => {
      if (t.name) {
        return `${t.id} (${t.name})`;
      }
      return t.id;
    }).join(', ');
  };

  // Get adjacent pairings for a guest
  const getAdjacentGuests = (guestName: string) => {
    if (!state.adjacents[guestName] || state.adjacents[guestName].length === 0) return null;
    
    return state.adjacents[guestName];
  };
  
  // Function to get sorted guests
  const getSortedGuests = () => {
    if (sortOption === 'as-entered') {
      return [...state.guests];
    }
    
    return [...state.guests].sort((a, b) => {
      if (sortOption === 'first-name') {
        // Sort by the first name (everything before the first space)
        const firstNameA = a.name.split(' ')[0].toLowerCase();
        const firstNameB = b.name.split(' ')[0].toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      } 
      else if (sortOption === 'last-name') {
        // For guests with ampersands, only use the part before the ampersand for sorting
        const getLastName = (fullName: string) => {
          // Extract the first person's name (before any ampersand)
          const firstPersonName = fullName.split('&')[0].trim();
          return getLastNameForSorting(firstPersonName).toLowerCase();
        };
        
        const lastNameA = getLastName(a.name);
        const lastNameB = getLastName(b.name);
        
        return lastNameA.localeCompare(lastNameB);
      }
      else if (sortOption === 'current-table') {
        // Sort by current table assignment in the currently active plan
        if (state.seatingPlans.length === 0) {
          return 0; // No sorting if no plans
        }
        
        // Use the currently viewed plan
        const plan = state.seatingPlans[state.currentPlanIndex];
        let tableA = Number.MAX_SAFE_INTEGER;  // Default to high value for unassigned
        let tableB = Number.MAX_SAFE_INTEGER;
        let foundA = false;
        let foundB = false;
        
        // Find which table each guest is assigned to
        for (const table of plan.tables) {
          for (const seat of table.seats) {
            if (seat.name === a.name) {
              tableA = table.id;
              foundA = true;
            }
            if (seat.name === b.name) {
              tableB = table.id;
              foundB = true;
            }
            // Exit early if both found
            if (foundA && foundB) break;
          }
          if (foundA && foundB) break;
        }
        
        // Sort unassigned guests last
        if (!foundA && foundB) return 1;
        if (foundA && !foundB) return -1;
        
        return tableA - tableB;
      }
      return 0;
    });
  };
  
  const sortedGuests = getSortedGuests();
  
  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <ClipboardList className="mr-2" />
        Assignment Manager

      </h1>
      
      <Card>
        <div className="space-y-4">
          <p className="text-[#586D78]">
            Specify which tables each guest can be assigned to. Enter table numbers separated by commas, or leave blank for automatic assignment.
          </p>
          

          
          <p className="text-sm text-[#586D78] bg-indigo-50 p-3 rounded-md">
            <strong>Tip:</strong> You can assign a guest to multiple tables by entering comma-separated numbers (e.g., "1,3,5").
            This means the seating algorithm will place them at one of these tables.
          </p>
        </div>
      </Card>
      
      {errorMessage && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
          <AlertCircle className="text-red-500 mr-2 mt-1 flex-shrink-0" />
          <div>
            <p className="text-red-700 font-medium">Error</p>
            <p className="text-red-600 text-sm">{errorMessage}</p>
          </div>
        </div>
      )}
      
      <Card 
        title={
          <div className="w-full flex items-center justify-between">
            <span>Guest Assignments</span>
            <div className="flex space-x-2">
              <span className="text-gray-700 font-medium flex items-center">
                <ArrowDownAZ className="w-4 h-4 mr-1" />
                Sort:
              </span>
              <button
                className={sortOption === 'as-entered' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                onClick={() => setSortOption('as-entered')}
              >
                As Entered
              </button>
              <button
                className={sortOption === 'first-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                onClick={() => setSortOption('first-name')}
              >
                First Name
              </button>
              <button
                className={sortOption === 'last-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                onClick={() => setSortOption('last-name')}
              >
                Last Name
              </button>
              <button
                className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''} ${state.seatingPlans.length === 0 ? 'opacity-50' : ''}`}
                onClick={() => setSortOption('current-table')}
                disabled={state.seatingPlans.length === 0}
              >
                Current Table
              </button>
            </div>
          </div>
        }
      >
        {state.guests.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No guests added yet. Add guests to create assignments.</p>
        ) : (
          <div className="space-y-6">
            {sortedGuests.map((guest, index) => {
              // Get adjacent guest names if any
              const adjacentGuests = getAdjacentGuests(guest.name);
              
              // Get must/cannot constraints
              const mustConstraints = getMustConstraints(guest.name);
              const cannotConstraints = getCannotConstraints(guest.name);
              
              return (
                <div key={`${guest.name}-${index}`} className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex flex-col gap-4">
                    <div className="min-w-[150px] font-medium text-[#586D78]">
                      <div>
                        {guest.name.includes('%') ? (
                          <>
                            {guest.name.split('%')[0]}
                            <span style={{ color: '#959595' }}>%</span>
                            {guest.name.split('%')[1]}
                          </>
                        ) : guest.name}
                        {guest.count > 1 && (
                          <span className="ml-2 text-sm text-gray-700 font-medium block mt-1">
                            Party size: {guest.count} {guest.count === 2 ? 'people' : 'people'}
                          </span>
                        )}
                      </div>
                      
                      {/* Display adjacent pairing information */}
                      {adjacentGuests && adjacentGuests.length > 0 && (
                        <div className="text-xs text-amber-600 mt-1">
                          Adjacent to: {adjacentGuests.join(', ')}
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      {/* Table Assignment */}
                      <div>
                        <label 
                          htmlFor={`assignment-${guest.name}`} 
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          Table Assignment
                        </label>
                        <div className="relative">
                          <input
                            id={`assignment-${guest.name}`}
                            type="text"
                            value={state.assignments[guest.name] || ''}
                            onChange={(e) => handleUpdateAssignment(guest.name, e.target.value)}
                            placeholder={isPremium && state.user ? "Enter table numbers or table names..." : "Enter table numbers..."}
                            className="w-full px-3 py-2 border border-[#586D78] rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                          />
                        </div>
                        
                        {/* Available tables reminder */}
                        {state.tables.length > 0 && (
                          <div className="mt-1 text-xs text-[#586D78]">
                            Available tables: {getTableList()}
                          </div>
                        )}
                      </div>
                      
                      {/* Must Constraints Box */}
                      <div>
                        <label 
                          htmlFor={`must-${guest.name}`} 
                          className="block text-sm font-medium text-green-600 mb-1"
                        >
                          Must Sit With
                        </label>
                        <input
                          id={`must-${guest.name}`}
                          type="text"
                          value={mustConstraints.join(', ')}
                          onChange={(e) => handleUpdateMustConstraints(guest.name, e.target.value)}
                          placeholder="Enter guest names separated by commas"
                          className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 text-green-600"
                        />
                        <div className="mt-1 text-xs text-green-600">
                          These guests will be seated at the same table
                        </div>
                      </div>
                      
                      {/* Cannot Constraints Box */}
                      <div>
                        <label 
                          htmlFor={`cannot-${guest.name}`} 
                          className="block text-sm font-medium text-red-600 mb-1"
                        >
                          Cannot Sit With
                        </label>
                        <input
                          id={`cannot-${guest.name}`}
                          type="text"
                          value={cannotConstraints.join(', ')}
                          onChange={(e) => handleUpdateCannotConstraints(guest.name, e.target.value)}
                          placeholder="Enter guest names separated by commas"
                          className="w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-red-600"
                        />
                        <div className="mt-1 text-xs text-red-600">
                          These guests will not be seated at the same table
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};

export default AssignmentManager;