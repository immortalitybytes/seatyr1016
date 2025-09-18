import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ClipboardList, Info, ChevronLeft, ChevronRight, ArrowDownAZ, ChevronDown, ChevronUp, X } from 'lucide-react';
import Card from '../components/Card';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting, formatTableAssignment } from '../utils/formatters';
import { detectConstraintConflicts } from '../utils/seatingAlgorithm';
import { detectConflicts } from '../utils/conflicts';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';

type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GUEST_THRESHOLD = 120;
const GUESTS_PER_PAGE = 10;

const ConstraintManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [highlightedPair, setHighlightedPair] = useState<{guest1: string, guest2: string} | null>(null);
  const [highlightTimeout, setHighlightTimeout] = useState<NodeJS.Timeout | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [adjacentInstructionsOpen, setAdjacentInstructionsOpen] = useState(false);
  
  const isPremium = isPremiumSubscription(state.subscription);
  
  useEffect(() => {
    setCurrentPage(0);
    if (isPremium && state.user && state.guests.length > GUEST_THRESHOLD) {
      setTotalPages(Math.ceil(state.guests.length / GUESTS_PER_PAGE));
    } else {
      setTotalPages(1);
    }
  }, [state.guests.length, isPremium, state.user]);

  const purgePlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };
  
  const getAdjacentCount = (guestId: string) => {
    return state.adjacents[guestId]?.length || 0;
  };
  
  const sortedGuests = useMemo(() => {
    const guests = [...state.guests];
    
    if (sortOption === 'as-entered') {
      return guests;
    }
    
    if (sortOption === 'first-name') {
      return guests.sort((a, b) => {
        const firstNameA = a.name.split(' ')[0].toLowerCase();
        const firstNameB = b.name.split(' ')[0].toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      });
    }
    
    if (sortOption === 'last-name') {
      return guests.sort((a, b) => {
        const lastNameA = getLastNameForSorting(a.name);
        const lastNameB = getLastNameForSorting(b.name);
        return lastNameA.localeCompare(lastNameB);
      });
    }
    
    if (sortOption === 'current-table') {
      // Current table sorting requires seating plans
      if (!state.seatingPlans || state.seatingPlans.length === 0) return guests;
      const plan = state.seatingPlans[state.currentPlanIndex];
      const findTableId = (guestId: string) => {
        for (const table of plan.tables) {
          if (table.seats.some(seat => (seat as any).id === guestId)) {
            return table.id;
          }
        }
        return Number.MAX_SAFE_INTEGER;
      };
      return guests.sort((a, b) => {
        const tableA = findTableId(a.id);
        const tableB = findTableId(b.id);
        if (tableA === Number.MAX_SAFE_INTEGER && tableB !== Number.MAX_SAFE_INTEGER) return 1;
        if (tableB === Number.MAX_SAFE_INTEGER && tableA !== Number.MAX_SAFE_INTEGER) return -1;
        if (tableA !== tableB) return tableA - tableB;
        // Stable tie-breaker by name
        return a.name.localeCompare(b.name);
      });
    }
    
    return guests;
  }, [state.guests, sortOption, state.seatingPlans, state.currentPlanIndex]);

  const constraintGrid = useMemo(() => {
    const guests = sortedGuests;
    if (guests.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          No guests added yet. Add guests to create constraints.
        </div>
      );
    }
    
    const needsPagination = isPremium && guests.length > GUEST_THRESHOLD;
    let displayGuests = guests;
    if (needsPagination) {
      const startIndex = currentPage * GUESTS_PER_PAGE;
      const endIndex = Math.min(startIndex + GUESTS_PER_PAGE, guests.length);
      displayGuests = guests.slice(startIndex, endIndex);
    }
    
    const headerRow = [
      <th 
        key="corner" 
        className="bg-indigo-50 font-medium p-2 border border-[#586D78] border-2 sticky top-0 left-0 z-30 min-w-[140px]"
      >
        Guest Names
      </th>
    ];
    
    displayGuests.forEach((guest) => {
      const adjacentCount = getAdjacentCount(guest.id);
      let adjacentIndicator = null;
      if (adjacentCount > 0) {
        adjacentIndicator = (
          <span className="text-yellow-600 font-bold ml-1" title={`Adjacent to: ${state.adjacents[guest.id].map(id => state.guests.find(g => g.id === id)?.name).join(', ')}`}>
            {adjacentCount === 1 ? '⭐' : '⭐⭐'}
          </span>
        );
      }
      
      const isSelected = selectedGuest === guest.id;
      const isHighlighted = highlightedPair && 
        (highlightedPair.guest1 === guest.id || highlightedPair.guest2 === guest.id);
      
      headerRow.push(
        <th 
          key={`col-${guest.id}`}
          className={`
            p-2 font-medium sticky top-0 z-20 min-w-[100px] cursor-pointer transition-colors duration-200
            border border-[#586D78] border-2
            ${isHighlighted ? 'bg-cyan-200' : isSelected ? 'bg-[#586D78] text-white' : 'bg-indigo-50 text-[#586D78] hover:bg-indigo-100'}
          `}
          onDoubleClick={() => handleGuestSelect(guest.id)}
          onTouchStart={(e) => handleLongPress(e, guest.id)}
          onTouchEnd={() => clearLongPressTimer()}
          data-name={guest.name}
        >
          <div className="max-w-[100px] leading-tight" style={{ minHeight: '3rem', wordWrap: 'break-word', whiteSpace: 'normal' }}>
            {guest.name}
            {adjacentIndicator}
          </div>
        </th>
      );
    });
    
    const grid = [<tr key="header">{headerRow}</tr>];
    
    guests.forEach((guest1) => {
      const isSelected = selectedGuest === guest1.id;
      const isHighlighted = highlightedPair && 
        (highlightedPair.guest1 === guest1.id || highlightedPair.guest2 === guest1.id);
      
      const adjacentCount = getAdjacentCount(guest1.id);
      let adjacentIndicator = null;
      if (adjacentCount > 0) {
        adjacentIndicator = (
          <span className="text-yellow-600 font-bold ml-1" title={`Adjacent to: ${state.adjacents[guest1.id].map(id => state.guests.find(g => g.id === id)?.name).join(', ')}`}>
            {adjacentCount === 1 ? '⭐' : '⭐⭐'}
          </span>
        );
      }
      
      const row = [
        <td 
          key={`row-${guest1.id}`}
          className={`
            p-2 font-medium sticky left-0 z-10 min-w-[140px] cursor-pointer transition-colors duration-200
            border border-[#586D78] border-2
            ${isHighlighted ? 'bg-cyan-200' : isSelected ? 'bg-[#586D78] text-white' : 'bg-indigo-50 text-[#586D78] hover:bg-indigo-100'}
          `}
          onDoubleClick={() => handleGuestSelect(guest1.id)}
          onTouchStart={(e) => handleLongPress(e, guest1.id)}
          onTouchEnd={() => clearLongPressTimer()}
          data-name={guest1.name}
        >
          <div>
            <div className="truncate max-w-[140px]">
              {guest1.name}
              {adjacentIndicator}
            </div>
            {guest1.count > 1 && (
              <div className="text-xs text-gray-700 font-medium">
                Party size: {guest1.count}
              </div>
            )}
            {(() => {
              const tableText = formatTableAssignment(state.assignments, state.tables, guest1.id);
              const isUnassigned = tableText.includes('unassigned');
              return (
                <div 
                  className={`text-xs truncate max-w-[140px] ${isUnassigned ? 'text-gray-500' : 'text-gray-700'}`} 
                  title={tableText}
                >
                  {tableText}
                </div>
              );
            })()}
          </div>
        </td>
      ];
      
      displayGuests.forEach((guest2) => {
        if (guest1.id === guest2.id) {
          row.push(
            <td
              key={`cell-${guest1.id}-${guest2.id}`}
              className="p-2 border border-[#586D78] border-2 bg-gray-800"
            />
          );
        } else {
          const constraintValue = state.constraints[guest1.id]?.[guest2.id] || '';
          const isAdjacent = state.adjacents[guest1.id]?.includes(guest2.id) || state.adjacents[guest2.id]?.includes(guest1.id);
          
          let cellContent = null;
          let bgColor = '';
          
          if (constraintValue === 'must') { 
            bgColor = 'bg-[#22cf04]'; 
            cellContent = isAdjacent ? (
              <div className="flex items-center justify-center space-x-1">
                <span className="font-bold text-yellow-600">⭐</span>
                <span className="font-bold">&</span>
                <span className="font-bold text-yellow-600">⭐</span>
              </div>
            ) : (
              <span className="font-bold">&</span>
            ); 
          }
          else if (constraintValue === 'cannot') { 
            bgColor = 'bg-[#e6130b]'; 
            cellContent = <span className="font-bold">X</span>; 
          }
          
          const isCellHighlighted = highlightedPair && 
            ((highlightedPair.guest1 === guest1.id && highlightedPair.guest2 === guest2.id) ||
             (highlightedPair.guest1 === guest2.id && highlightedPair.guest2 === guest1.id));
          
          if (isCellHighlighted) {
            bgColor = 'bg-cyan-200';
          }
          
          row.push(
            <td
              key={`cell-${guest1.id}-${guest2.id}`}
              className={`p-2 border border-[#586D78] border-2 cursor-pointer transition-colors duration-200 text-center ${bgColor}`}
              onClick={() => handleToggleConstraint(guest1.id, guest2.id)}
              data-guest1={guest1.id}
              data-guest2={guest2.id}
            >
              {cellContent}
            </td>
          );
        }
      });
      grid.push(<tr key={`row-${guest1.id}`}>{row}</tr>);
    });

    const renderPageNumbers = () => {
      const pageButtons = [];
      const showEllipsis = totalPages > 9;
      if (!showEllipsis || currentPage < 6) {
        for (let i = 0; i < Math.min(totalPages, 9); i++) {
          pageButtons.push(
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-8' : 'danstyle1c-btn mx-1 w-8'}
            >
              {i + 1}
            </button>
          );
        }
        if (showEllipsis) {
          pageButtons.push(<span key="ellipsis-end" className="mx-1">...</span>);
        }
      } else if (currentPage >= totalPages - 6) {
        pageButtons.push(<span key="ellipsis-start" className="mx-1">...</span>);
        for (let i = totalPages - 9; i < totalPages; i++) {
          pageButtons.push(
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-8' : 'danstyle1c-btn mx-1 w-8'}
            >
              {i + 1}
            </button>
          );
        }
      } else {
        pageButtons.push(<span key="ellipsis-start" className="mx-1">...</span>);
        for (let i = currentPage - 2; i <= currentPage + 2; i++) {
          pageButtons.push(
            <button
              key={i}
              onClick={() => setCurrentPage(i)}
              className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-8' : 'danstyle1c-btn mx-1 w-8'}
            >
              {i + 1}
            </button>
          );
        }
        pageButtons.push(<span key="ellipsis-end" className="mx-1">...</span>);
      }
      return pageButtons;
    };
    
    const paginationControls = (
      <div className="flex flex-col md:flex-row items-center justify-between py-4 border-t mt-4">
        <div className="flex items-center w-full justify-between">
          <div className="pl-[140px]">
            <button
              onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
              disabled={currentPage === 0}
              className="danstyle1c-btn"
            >
              <ChevronLeft className="w-4 h-4 mr-1" />
              Previous
            </button>
          </div>
          
          <div className="flex flex-wrap justify-center">{renderPageNumbers()}</div>
          
          <div className="pr-[10px]">
            <button
              onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
              disabled={currentPage >= totalPages - 1}
              className="danstyle1c-btn"
            >
              Next
              <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>
      </div>
    );
    
    return (
      <div className="flex flex-col space-y-4">
        {state.conflictWarnings.length > 0 && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
            <Info className="text-red-500 mr-2 mt-1 flex-shrink-0" />
            <div>
              <p className="text-red-700 font-medium">Constraint Warnings</p>
              <ul className="list-disc pl-5 text-red-600 text-sm">
                {state.conflictWarnings.map((warn, index) => (
                  <li key={index}>{warn}</li>
                ))}
              </ul>
            </div>
          </div>
        )}
        
        <div className="overflow-auto max-h-[60vh] border border-[#586D78] rounded-md relative">
          <table className="w-full border-collapse bg-white">
            <tbody>{grid}</tbody>
          </table>
        </div>
        
        {needsPagination && paginationControls}
      </div>
    );
  }, [state.guests, state.constraints, state.adjacents, selectedGuest, highlightedPair, currentPage, totalPages, sortOption, isPremium, state.seatingPlans, state.assignments, state.currentPlanIndex, state.conflictWarnings]);
  
  let longPressTimer: NodeJS.Timeout;
  
  const handleLongPress = (e: React.TouchEvent, guestId: string) => {
    e.preventDefault();
    longPressTimer = setTimeout(() => {
      handleGuestSelect(guestId);
    }, 500);
  };

  const handleNavigatePlan = (delta: number) => {
    setCurrentPage(prev => Math.max(0, Math.min(totalPages - 1, prev + delta)));
  };

  const clearLongPressTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  };

  const handleToggleConstraint = (guest1: string, guest2: string) => {
    setSelectedGuest(null);
    setHighlightedPair(null);
    if (highlightTimeout) {
      clearTimeout(highlightTimeout);
      setHighlightTimeout(null);
    }
    const currentValue = state.constraints[guest1]?.[guest2] || '';
    let nextValue: 'must' | 'cannot' | '';
    if (currentValue === '') {
      nextValue = 'must';
    } else if (currentValue === 'must') {
      if (state.adjacents[guest1]?.includes(guest2)) {
        dispatch({
          type: 'REMOVE_ADJACENT',
          payload: { guest1, guest2 }
        });
      }
      nextValue = 'cannot';
    } else {
      nextValue = '';
    }
    dispatch({
      type: 'SET_CONSTRAINT',
      payload: { guest1, guest2, value: nextValue }
    });
    
    purgePlans();
  };

  const handleGuestSelect = (guestId: string) => {
    if (selectedGuest === null) {
      setSelectedGuest(guestId);
    } else if (selectedGuest !== guestId) {
      dispatch({
        type: 'SET_CONSTRAINT',
        payload: { guest1: selectedGuest, guest2: guestId, value: 'must' }
      });
      
      dispatch({
        type: 'SET_ADJACENT',
        payload: { guest1: selectedGuest, guest2: guestId }
      });
      setHighlightedPair({ guest1: selectedGuest, guest2: guestId });
      setSelectedGuest(null);
      const timeout = setTimeout(() => {
        setHighlightedPair(null);
      }, 3000);
      if (highlightTimeout) {
        clearTimeout(highlightTimeout);
      }
      setHighlightTimeout(timeout);
      purgePlans();
    } else {
      setSelectedGuest(null);
    }
  };

  const isAccordionOpen = useMemo(() => {
    // Logic for accordion state if needed
    return true;
  }, []);

  const conflictWarnings = detectConflicts(state.assignments, state.constraints);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <ClipboardList className="mr-2" />
        Constraint Manager
      </h1>
      
      {conflictWarnings.length > 0 && (
        <div className="text-red-50 mt-2">
          {conflictWarnings.map(w => <p key={w}>{w}</p>)}
        </div>
      )}
      
      <Card>
        <div className="space-y-4">
          <div className="flex items-start space-x-4">
            <Info className="text-[#586D78] mt-1 flex-shrink-0" />
            <div>
              <h3 className="font-medium text-[#586D78]">How to use constraints:</h3>
              <div className="text-gray-600 text-sm mt-2">
                <p>Click a cell to cycle between constraints:</p>
                <div className="mt-1 flex flex-wrap gap-4">
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center justify-center"
                          style={{ width: '2.25em', height: '2.25em', background: '#22cf04', border: '2px solid #000', lineHeight: '2.25em', color: 'white', fontSize: '0.9em' }}
                          aria-label="Must">
                      &
                    </span>
                    <span>Must sit at the same table</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center justify-center"
                          style={{ width: '2.25em', height: '2.25em', background: '#e6130b', border: '2px solid #000', lineHeight: '2.25em', color: 'white', fontSize: '0.9em' }}
                          aria-label="Cannot">
                      X
                    </span>
                    <span>Cannot sit at the same table</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <span className="inline-flex items-center justify-center"
                          style={{ width: '2.25em', height: '2.25em', background: '#ffffff', border: '2px solid #000', lineHeight: '2.25em', fontSize: '0.9em' }}
                          aria-label="No constraint">
                    </span>
                    <span>No constraint</span>
                  </div>
                </div>
              </div>
              
              {state.user && (
                <div className="mt-6">
                  <div className="bg-blue-50 border border-blue-200 rounded-md">
                    <button
                      className="w-full px-4 py-3 text-left font-medium text-[#586D78] hover:bg-blue-100 transition-colors"
                      onClick={() => setAdjacentInstructionsOpen(!adjacentInstructionsOpen)}
                    >
                      ▶ To Set Adjacent-Seating:
                    </button>
                    {adjacentInstructionsOpen && (
                      <div className="px-4 pb-4">
                        <div className="text-gray-600 text-sm space-y-2">
                          <p>1) Double-click a guest name to select it.</p>
                          <p>2) Double-click another guest and the adjacency will be set automatically.</p>
                          <p>Guests with adjacent constraints are marked with ⭐</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>
      
      <Card title="Constraint Grid">
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 space-y-2 md:space-y-0">
          <div className="flex items-center space-x-2">
            <span className="text-gray-700 font-medium flex items-center">
              <ArrowDownAZ className="w-5 h-5 mr-2" />
              Sort by:
            </span>
            <div className="flex space-x-2">
              {!state.user ? (
                // Non-logged-in users: only First Name and Last Name
                <>
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
                </>
              ) : (
                // Logged-in users: all 4 buttons
                <>
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
                </>
              )}
            </div>
          </div>
          
          {(isPremium && state.guests.length > GUEST_THRESHOLD) && (
            <div className="flex space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={() => handleNavigatePlan(-1)}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Previous
              </button>
              <button
                className="danstyle1c-btn"
                onClick={() => handleNavigatePlan(1)}
                disabled={currentPage >= totalPages - 1}
              >
                Next
                <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          )}
        </div>
        
        <div ref={gridRef}>
          {state.guests.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No guests added yet. Add guests to create constraints.</p>
          ) : (
            constraintGrid
          )}
        </div>
      </Card>
      
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default ConstraintManager;