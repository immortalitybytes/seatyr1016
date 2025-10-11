import React, { useState, useMemo, useEffect } from 'react';
import { ClipboardList, Info, AlertCircle, ArrowDownAZ } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting } from '../utils/formatters';
import { normalizeAssignmentInputToIdsWithWarnings } from '../utils/assignments';
import FormatGuestName from '../components/FormatGuestName';

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const AssignmentManager: React.FC = () => {
  const { state, dispatch, mode } = useApp();
  const [sortOption, setSortOption] = useState<SortOption>('last-name');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  const isPremium = isPremiumSubscription(state.subscription);
  
  // Mode-aware sorting options (SSoT)
  const allowedSortOptions: SortOption[] = mode === 'unsigned'
    ? ['first-name', 'last-name']
    : ['first-name', 'last-name', 'as-entered', 'current-table'];

  // If current sort became disallowed (e.g., downgrade), coerce safely
  useEffect(() => {
    if (!allowedSortOptions.includes(sortOption)) setSortOption('last-name');
  }, [isPremium]); // eslint-disable-line react-hooks/exhaustive-deps
  // Use a debounced query for smoother interaction if a future implementation uses a search box
  const [query, setQuery] = useState('');
  const debouncedQuery = useDebounce(query, 300);

  // Function to purge seating plans when assignments change
  const purgeSeatingPlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };
  
  const handleUpdateAssignment = (guestId: string, value: string) => {
    setErrorMessage(null);
    try {
      // SSoT: Check for name-based assignments (non-premium blocked)
      const tokens = value.split(',').map(s => s.trim()).filter(Boolean);
      const hasNames = tokens.some(t => isNaN(Number(t)));
      
      if (mode !== 'premium' && hasNames) {
        dispatch({ type: 'SHOW_MODAL', payload: { 
          title: 'Use Table IDs', 
          body: 'Assigning tables by name is a Premium feature. Please use numeric IDs only (e.g., "1, 3, 5").' 
        }});
        return;
      }
      
      // SSoT: Normalize all assignments to ID-CSV format on input
      const { idCsv, warnings } = normalizeAssignmentInputToIdsWithWarnings(value, state.tables);
      
      if (warnings.length > 0) {
        dispatch({
          type: 'SET_WARNING',
          payload: warnings.map(w => `Guest ${guestId}: ${w}`)
        });
      }
      
      // Dispatch the normalized ID-based payload
      dispatch({
        type: 'UPDATE_ASSIGNMENT',
        payload: { guestId, raw: idCsv }
      });
      
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating assignment:', error);
      setErrorMessage(`Failed to update assignment: ${error.message || 'An unexpected error occurred'}`);
    }
  };
  
  const handleUpdateMustConstraints = (guestId: string, mustNames: string) => {
    setErrorMessage(null);
    try {
      // Get current must constraints for this guest
      const currentMusts = Object.entries(state.constraints[guestId] ?? {})
        .filter(([otherGuestId, value]) => value === 'must')
        .map(([otherGuestId]) => state.guests.find(g => g.id === otherGuestId)?.name ?? '')
        .filter(Boolean);
      
      // Parse new list of must guests
      const newMusts = mustNames.split(',').map(name => name.trim()).filter(Boolean);
      
      // Remove constraints that are no longer in the list
      currentMusts.forEach(mustGuestName => {
        if (!newMusts.includes(mustGuestName)) {
          const byName = new Map(state.guests.map(g => [g.name.toLowerCase(), g]));
          const otherGuest = byName.get(mustGuestName.toLowerCase());
          if (otherGuest) {
            dispatch({
              type: 'SET_CONSTRAINT',
              payload: { guest1: guestId, guest2: otherGuest.id, value: '' }
            });
          }
        }
      });
      
      // Add new constraints
      newMusts.forEach(name => {
        const byName = new Map(state.guests.map(g => [g.name.toLowerCase(), g]));
        const otherGuest = byName.get(name.trim().toLowerCase());
        if (otherGuest) {
          dispatch({
            type: 'SET_CONSTRAINT',
            payload: { guest1: guestId, guest2: otherGuest.id, value: 'must' }
          });
        }
      });
      
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating must constraints:', error);
      setErrorMessage(`Failed to update must constraints: ${error.message || 'An unexpected error occurred'}`);
    }
  };
  
  const handleUpdateCannotConstraints = (guestId: string, cannotNames: string) => {
    setErrorMessage(null);
    try {
      // Get current cannot constraints for this guest
      const currentCannots = Object.entries(state.constraints[guestId] ?? {})
        .filter(([otherGuestId, value]) => value === 'cannot')
        .map(([otherGuestId]) => state.guests.find(g => g.id === otherGuestId)?.name ?? '')
        .filter(Boolean);
      
      // Parse new list of cannot guests
      const newCannots = cannotNames.split(',').map(name => name.trim()).filter(Boolean);
      
      // Remove constraints that are no longer in the list
      currentCannots.forEach(cannotGuestName => {
        if (!newCannots.includes(cannotGuestName)) {
          const byName = new Map(state.guests.map(g => [g.name.toLowerCase(), g]));
          const otherGuest = byName.get(cannotGuestName.toLowerCase());
          if (otherGuest) {
            dispatch({
              type: 'SET_CONSTRAINT',
              payload: { guest1: guestId, guest2: otherGuest.id, value: '' }
            });
          }
        }
      });
      
      // Add new constraints
      newCannots.forEach(name => {
        const byName = new Map(state.guests.map(g => [g.name.toLowerCase(), g]));
        const otherGuest = byName.get(name.trim().toLowerCase());
        if (otherGuest) {
          dispatch({
            type: 'SET_CONSTRAINT',
            payload: { guest1: guestId, guest2: otherGuest.id, value: 'cannot' }
          });
        }
      });
      
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating cannot constraints:', error);
      setErrorMessage(`Failed to update cannot constraints: ${error.message || 'An unexpected error occurred'}`);
    }
  };

  const getTableList = useMemo(() => {
    return state.tables.map(t => {
      if (t.name) {
        return `${t.id} (${t.name})`;
      }
      return t.id;
    }).join(', ');
  }, [state.tables]);

  const getGuestConstraints = (guestId: string) => {
    const must = Object.entries(state.constraints[guestId] ?? {}).filter(([,v]) => v === 'must').map(([id]) => state.guests.find(g => g.id === id)?.name ?? '');
    const cannot = Object.entries(state.constraints[guestId] ?? {}).filter(([,v]) => v === 'cannot').map(([id]) => state.guests.find(g => g.id === id)?.name ?? '');
    const adjacent = state.adjacents[guestId] ?? [];
    return { must, cannot, adjacent };
  };

  const currentTableKey = (guestId: string, plan: any) => {
    if (plan?.tables) {
      if (plan.tables.some((t: any) => t.seats.some((s: any) => s.id === guestId))) {
        return plan.tables.find((t: any) => t.seats.some((s: any) => s.id === guestId))!.id;
      }
    }
    const raw = state.assignments[guestId];
    if (raw) {
      const ids = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
      if (ids.length) return ids[0];
    }
    return Number.POSITIVE_INFINITY;
  };

  const sortedGuests = useMemo(() => {
    const guests = [...state.guests];
    const plan = state.seatingPlans[state.currentPlanIndex] ?? null;
    switch (sortOption) {
      case 'first-name': return guests.sort((a, b) => a.name.localeCompare(b.name));
      case 'last-name': return guests.sort((a, b) => (getLastNameForSorting(a.name)).localeCompare(getLastNameForSorting(b.name)));
      case 'current-table': 
        if (state.seatingPlans.length === 0) return guests; // no-op when no plans
        return guests.sort((a, b) => currentTableKey(a.id, plan) - currentTableKey(b.id, plan));
      default: return guests;
    }
  }, [state.guests, sortOption, state.seatingPlans, state.currentPlanIndex, state.assignments]);

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
      
      {state.conflictWarnings.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
          <AlertCircle className="text-red-500 mr-2 mt-1 flex-shrink-0" />
          <div>
            <p className="text-red-700 font-medium">Assignment Warnings</p>
            <ul className="list-disc pl-5 text-red-600 text-sm">
              {state.conflictWarnings.map((warn, index) => (
                <li key={index}>{warn}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      
      {state.warnings && state.warnings.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
          <AlertCircle className="text-red-500 mr-2 mt-1 flex-shrink-0" />
          <div>
            <p className="text-red-700 font-medium">Assignment Warnings</p>
            <ul className="list-disc pl-5 text-red-600 text-sm">
              {state.warnings.map((warn, index) => (
                <li key={index}>{warn}</li>
              ))}
            </ul>
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
              {allowedSortOptions.includes('as-entered') && (
                <button
                  className={sortOption === 'as-entered' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                  onClick={() => setSortOption('as-entered')}
                >
                  As Entered
                </button>
              )}
              {allowedSortOptions.includes('first-name') && (
                <button
                  className={sortOption === 'first-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                  onClick={() => setSortOption('first-name')}
                >
                  First Name
                </button>
              )}
              {allowedSortOptions.includes('last-name') && (
                <button
                  className={sortOption === 'last-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                  onClick={() => setSortOption('last-name')}
                >
                  Last Name
                </button>
              )}
              {allowedSortOptions.includes('current-table') && (
                <button
                  className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''} ${state.seatingPlans.length === 0 ? 'opacity-50' : ''}`}
                  onClick={() => setSortOption('current-table')}
                  disabled={state.seatingPlans.length === 0}
                >
                  Current Table
                </button>
              )}
            </div>
          </div>
        }
      >
        {state.guests.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No guests added yet. Add guests to create assignments.</p>
        ) : (
          <div className="space-y-6">
            {sortedGuests.map((guest, index) => {
              const { must, cannot, adjacent } = getGuestConstraints(guest.id);
              return (
                <div key={guest.id} className="p-4 border border-gray-200 rounded-lg">
                  <div className="flex flex-col gap-4">
                    <div className="min-w-[150px] font-medium text-[#586D78]">
                      <div>
                        <FormatGuestName name={guest.name} />
                        {guest.count > 1 && (
                          <span className="ml-2 text-sm text-gray-700 font-medium block mt-1">
                            Party size: {guest.count}
                          </span>
                        )}
                      </div>
                      
                      {adjacent.length > 0 && (
                        <div className="text-xs text-amber-600 mt-1">
                          Adjacent to: {adjacent.map(id => state.guests.find(g => g.id === id)?.name ?? id).join(', ')}
                        </div>
                      )}
                    </div>
                    
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                      <div>
                        <label 
                          htmlFor={`assignment-${guest.id}`} 
                          className="block text-sm font-medium text-gray-700 mb-1"
                        >
                          Table Assignment
                        </label>
                        <div className="relative">
                          <input
                            id={`assignment-${guest.id}`}
                            type="text"
                            value={state.assignments[guest.id] || ''}
                            onChange={(e) => handleUpdateAssignment(guest.id, e.target.value)}
                            placeholder="e.g., 1, 3, 5"
                            className="w-full px-3 py-2 border border-[#586D78] rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                          />
                        </div>
                        
                        {state.tables.length > 0 && (
                          <div className="mt-1 text-xs text-[#586D78]">
                            Available tables: {getTableList}
                          </div>
                        )}
                      </div>
                      
                      <div>
                        <label 
                          htmlFor={`must-${guest.id}`} 
                          className="block text-sm font-medium text-green-600 mb-1"
                        >
                          Must Sit With
                        </label>
                        <input
                          id={`must-${guest.id}`}
                          type="text"
                          value={must.join(', ')}
                          onChange={(e) => handleUpdateMustConstraints(guest.id, e.target.value)}
                          placeholder="Enter guest names separated by commas"
                          className="w-full px-3 py-2 border border-green-300 rounded-md focus:outline-none focus:ring-2 focus:ring-green-500 text-green-600"
                        />
                      </div>
                      
                      <div>
                        <label 
                          htmlFor={`cannot-${guest.id}`} 
                          className="block text-sm font-medium text-red-600 mb-1"
                        >
                          Cannot Sit With
                        </label>
                        <input
                          id={`cannot-${guest.id}`}
                          type="text"
                          value={cannot.join(', ')}
                          onChange={(e) => handleUpdateCannotConstraints(guest.id, e.target.value)}
                          placeholder="Enter guest names separated by commas"
                          className="w-full px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-red-600"
                        />
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

const useDebounce = (value: string, delay: number): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

export default AssignmentManager;