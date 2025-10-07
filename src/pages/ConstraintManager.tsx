import React, { useState, useMemo, useRef, useEffect, useCallback } from 'react';
import { ClipboardList, Info, AlertCircle, ChevronLeft, ChevronRight, Download, AlertTriangle } from 'lucide-react';

// Disable large guest list warnings site-wide
const SHOW_LARGE_LIST_WARNING = false;
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { getLastNameForSorting, formatTableAssignment } from '../utils/formatters';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { ValidationError } from '../types'; 

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table' | 'party-size';

const GUEST_THRESHOLD = 120; // Threshold for pagination
const GUESTS_PER_PAGE = 10; // Show 10 guests per page when paginating

// Custom debounce utility
function useDebouncedCallback<T extends (...args: any[]) => any>(callback: T, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
  }, []);
  return useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);
}

const ConstraintManager: React.FC = () => {
  // SSoT #2 Fix: Get derived isPremium from context
  const { state, dispatch, isPremium } = useApp();
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [highlightedPair, setHighlightedPair] = useState<{guest1: string, guest2: string} | null>(null);
  const [highlightTimeout, setHighlightTimeout] = useState<NodeJS.Timeout | null>(null);
  const [sortOption, setSortOption] = useState<SortOption>('last-name');
  const [currentPage, setCurrentPage] = useState(0);
  const [showConflicts, setShowConflicts] = useState(false); // Toggle for error display

  const gridRef = useRef<HTMLDivElement>(null);
  
  const nameToId = useMemo(() => new Map(state.guests.map(g => [g.name, g.id])), [state.guests]);

  // BEST OF ALL v1.7 Fix: Memoize and include party-size for sort robustness
  const sortedGuests = useMemo(() => {
    let guests = [...state.guests];
    switch (sortOption) {
      case 'first-name':
        return guests.sort((a, b) => a.name.localeCompare(b.name));
      case 'last-name':
        return guests.sort((a, b) => getLastNameForSorting(a.name).localeCompare(getLastNameForSorting(b.name)));
      case 'current-table': {
        return guests.sort((a, b) => {
          const tableA = formatTableAssignment(state.assignments, state.tables, a.id);
          const tableB = formatTableAssignment(state.assignments, state.tables, b.id);
          return tableA.localeCompare(tableB);
        });
      }
      // BEST OF ALL v1.7 Feature: Party-size sort
      case 'party-size':
        return guests.sort((a, b) => (b.count || 1) - (a.count || 1));
      case 'as-entered':
      default:
        return guests;
    }
  }, [state.guests, sortOption, state.seatingPlans, state.currentPlanIndex, state.assignments, state.tables]);
  
  const allowedSortOptions: SortOption[] = isPremium
    ? ['as-entered', 'first-name', 'last-name', 'current-table', 'party-size']
    : ['first-name', 'last-name', 'party-size'];

  useEffect(() => {
    if (!allowedSortOptions.includes(sortOption)) setSortOption('last-name');
  }, [isPremium, sortOption, allowedSortOptions]);

  const GUEST_LIST = sortedGuests;
  const totalPages = Math.ceil(GUEST_LIST.length / GUESTS_PER_PAGE);
  
  // BEST OF ALL v1.7 Fix: Memoize paginated guests
  const paginatedGuests = useMemo(() => {
    if (state.guests.length <= GUEST_THRESHOLD || !isPremium) return sortedGuests;
    const start = currentPage * GUESTS_PER_PAGE;
    return sortedGuests.slice(start, start + GUESTS_PER_PAGE);
  }, [sortedGuests, currentPage, state.guests.length, isPremium]);

  useEffect(() => {
    if (currentPage >= totalPages && totalPages > 0) {
      setCurrentPage(totalPages - 1);
    }
  }, [totalPages]);

  // BEST OF ALL v1.7 Fix: Correct Constraint Cycling Logic (MUST -> ADJACENT -> CANNOT)
  const handleCellClick = useDebouncedCallback((g1: string, g2: string) => {
    const id1 = nameToId.get(g1) || g1;
    const id2 = nameToId.get(g2) || g2;
    if (id1 === id2) return;

    if (highlightTimeout) clearTimeout(highlightTimeout);
    setHighlightedPair({ guest1: id1, guest2: id2 });

    const newTimeout = setTimeout(() => {
      setHighlightedPair(null);
    }, 1000);
    setHighlightTimeout(newTimeout);

    // Check current state
    const isCannot = state.constraints.cannot?.[id1]?.includes(id2) || state.constraints.cannot?.[id2]?.includes(id1);
    const isMust = state.constraints.must?.[id1]?.includes(id2) || state.constraints.must?.[id2]?.includes(id1);
    const isAdjacent = state.adjacents[id1]?.includes(id2) || state.adjacents[id2]?.includes(id1);

    // Proper cycling: CLEAR → MUST → ADJACENT (Implicitly done by SET_ADJACENT in reducer) → CANNOT → CLEAR
    if (isAdjacent) {
      // ADJACENT (Implicitly MUST/ADJACENT) → CANNOT
      // Remove ADJACENT, Remove MUST (if present), Add CANNOT
      dispatch({ type: 'SET_ADJACENT', payload: { a: id1, b: id2 } }); // Removes ADJACENT
      setTimeout(() => { // Small delay to prevent race condition
          dispatch({ type: 'SET_CONSTRAINT', payload: { a: id1, b: id2, type: 'cannot', removeType: 'must' } }); // Add CANNOT
      }, 50); 
    } else if (isMust) {
      // MUST → ADJACENT (Implicitly done by SET_ADJACENT in reducer)
      // Remove MUST, Add ADJACENT
      dispatch({ type: 'SET_CONSTRAINT', payload: { a: id1, b: id2, type: 'must', removeType: 'must' } }); // Remove MUST
      setTimeout(() => { // Small delay to prevent race condition
          dispatch({ type: 'SET_ADJACENT', payload: { a: id1, b: id2 } }); // Add ADJACENT
      }, 50); 
    } else if (isCannot) {
      // CANNOT → CLEAR
      dispatch({ type: 'SET_CONSTRAINT', payload: { a: id1, b: id2, type: 'must', removeType: 'cannot' } }); // NOTE: Must pass a valid 'type' to reducer, using 'must' temporarily to trigger 'removeType' 'cannot'
        } else {
      // CLEAR → MUST
      dispatch({ type: 'SET_CONSTRAINT', payload: { a: id1, b: id2, type: 'must', removeType: 'cannot' } });
    }
  }, 300);

  // BEST OF ALL v1.7 Feature: ⭐ & ⭐ UI implementation
  const getCellContent = (g1: string, g2: string) => {
    const id1 = nameToId.get(g1) || g1;
    const id2 = nameToId.get(g2) || g2;
    if (state.adjacents[id1]?.includes(id2) || state.adjacents[id2]?.includes(id1)) {
      return '⭐ & ⭐';
    }
    if (state.constraints.must?.[id1]?.includes(id2) || state.constraints.must?.[id2]?.includes(id1)) {
      return '&';
    }
    if (state.constraints.cannot?.[id1]?.includes(id2) || state.constraints.cannot?.[id2]?.includes(id1)) {
      return 'X';
    }
    return '';
  };


  const renderConstraintCell = (gRow: string, gCol: string) => {
    const content = getCellContent(gRow, gCol);
    const id1 = nameToId.get(gRow) || gRow;
    const id2 = nameToId.get(gCol) || gCol;
    const isHighlighted = highlightedPair && 
      ((highlightedPair.guest1 === id1 && highlightedPair.guest2 === id2) || (highlightedPair.guest1 === id2 && highlightedPair.guest2 === id1));

    let className = "w-full h-full text-center text-sm font-semibold flex items-center justify-center cursor-pointer transition-all duration-100";
    
    if (isHighlighted) {
      className += ' scale-110 ring-2 ring-offset-1';
    }

    switch (content) {
      case '⭐ & ⭐':
        className += isHighlighted ? ' bg-yellow-400 text-white' : ' bg-yellow-100 text-yellow-600 hover:bg-yellow-200';
        break;
      case '&':
        className += isHighlighted ? ' bg-green-400 text-white' : ' bg-green-100 text-green-600 hover:bg-green-200';
        break;
      case 'X':
        className += isHighlighted ? ' bg-red-400 text-white' : ' bg-red-100 text-red-600 hover:bg-red-200';
        break;
      default:
        className += ' bg-gray-50 text-gray-400 hover:bg-gray-100';
    }

    return (
      <div 
        className={className}
        onClick={() => handleCellClick(gRow, gCol)}
        aria-label={`Constraint between ${gRow} and ${gCol}: ${content || 'NONE'}`}
      >
        {content || <span className="text-xs">NONE</span>}
      </div>
    );
  };
  
  const constraintGrid = useMemo(() => {
    if (GUEST_LIST.length === 0) return null;

    return (
      <div className="flex flex-col">
        {/* Header Row */}
        <div className="flex sticky top-0 bg-[#dde1e3] z-20 shadow-md">
          <div className="flex flex-col items-center justify-center p-2 min-w-[140px] sticky left-0 z-10 bg-[#dde1e3] border-r border-b border-[#586D78]">
            <div className="text-xs font-semibold text-[#586D78]">Your Guests</div>
            <Info className="w-4 h-4 text-[#586D78] mt-1" />
          </div>
          {paginatedGuests.map(g => (
            <div key={g.id} className="w-16 h-16 flex items-end justify-center text-xs font-medium text-gray-700 p-1 border-r border-b border-[#586D78] transform rotate-[-45deg] origin-[0_100%]">
              <span className="truncate max-w-full text-right"><FormatGuestName name={g.name} /></span>
            </div>
          ))}
        </div>
        
        {/* Guest Rows */}
        {paginatedGuests.map((gRow, rowIndex) => (
          <div key={gRow.id} className="flex">
            {/* Row Label (Guest Name) */}
            <div 
              className={`w-[140px] h-16 flex items-center justify-start p-2 border-r border-b border-[#586D78] sticky left-0 z-10 ${rowIndex % 2 === 0 ? 'bg-gray-50' : 'bg-white'}`}
              onClick={() => setSelectedGuest(selectedGuest === gRow.name ? null : gRow.name)}
            >
              <ClipboardList className={`w-4 h-4 mr-2 ${selectedGuest === gRow.name ? 'text-[#586D78]' : 'text-gray-400'}`} />
              <span className="font-medium text-sm text-gray-700 truncate"><FormatGuestName name={gRow.name} /></span>
          </div>
            
            {/* Constraint Cells */}
            {paginatedGuests.map((gCol, colIndex) => {
              const isDiagonal = gRow.id === gCol.id;
              const isAboveDiagonal = rowIndex < colIndex;

              if (isDiagonal || isAboveDiagonal) {
                // Diagonal: Guest info or empty space
                const content = isDiagonal ? (
                  <div className="w-full h-full bg-gray-200 flex flex-col items-center justify-center text-xs text-gray-600">
                    <span className="font-bold">{gRow.count} Seats</span>
                    <span className="truncate max-w-full">{formatTableAssignment(state.assignments, state.tables, gRow.id)}</span>
                  </div>
                ) : (
                  // Above Diagonal: Mirrored cell (empty)
                  <div className="w-full h-full bg-gray-100 border-r border-b border-[#586D78] flex items-center justify-center">
                    <span className="text-gray-300">|</span>
                  </div>
                );
                
                return <div key={gCol.id} className="w-16 h-16 border-r border-b border-[#586D78]">{content}</div>;
              }

              // Below Diagonal: Constraint cell
          return (
                <div key={gCol.id} className="w-16 h-16 border-r border-b border-[#586D78]">
                  {renderConstraintCell(gRow.name, gCol.name)}
                </div>
          );
        })}
          </div>
        ))}
      </div>
    );
  }, [paginatedGuests, GUEST_LIST.length, selectedGuest, state.constraints, state.adjacents, state.assignments, state.tables, nameToId, renderConstraintCell]);
  
  const exportJSON = useCallback(() => {
    const data = {
      guests: state.guests,
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'constraints.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [state.guests, state.constraints, state.adjacents, state.assignments]);

  return (
    <div className="space-y-6">
      <Card title="Your Rules (Constraints)">
        <div className="mb-4 space-y-3">
          
          <div className="flex justify-between items-center flex-wrap gap-2">
            <div className="flex items-center space-x-2">
              <span className="text-sm font-medium text-gray-700">Sort by:</span>
              <div className="flex space-x-1">
                {allowedSortOptions.map(option => (
                  <button
                    key={option}
                    className={sortOption === option ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                    onClick={() => setSortOption(option)}
                  >
                    {option.split('-').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join(' ')}
                  </button>
                ))}
              </div>
            </div>
            
            <div className="flex space-x-2">
                <Button onClick={exportJSON} variant="secondary" icon={<Download className="w-4 h-4" />}>
                  Export
                </Button>
                <Button onClick={() => setShowConflicts(v => !v)} variant="secondary">
                  {showConflicts ? 'Hide Errors' : 'Show Errors'}
                </Button>
            </div>
        </div>
          
          {/* SSoT-COMPLIANT Conflict/Error Display (Reads from state.warnings) */}
          {showConflicts && state.warnings.length > 0 && (
            <div className="mt-4 mb-4 bg-red-50 border border-red-200 rounded-md p-3">
              <h3 className="text-sm font-semibold text-red-700 mb-2">Errors Detected</h3>
              <ul className="space-y-2">
                {state.warnings.map((warning: string, index: number) => (
                  <li key={index} className="flex items-start text-sm text-red-700">
                    <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                    <span>{warning}</span>
                  </li>
                ))}
          </ul>
        </div>
      )}

          {SHOW_LARGE_LIST_WARNING && state.guests.length > GUEST_THRESHOLD && (
            <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3 flex items-start">
              <AlertCircle className="w-5 h-5 mr-3 text-yellow-600 flex-shrink-0" />
              <p className="text-sm text-yellow-700">
                You have over {GUEST_THRESHOLD} guests. The constraint grid is paginated for performance. Only {GUESTS_PER_PAGE} guests are shown per page.
              </p>
            </div>
          )}
        </div>

        <div ref={gridRef} className="overflow-auto max-h-[60vh] border border-[#586D78] rounded-md relative">
          {constraintGrid}
        </div>

        {isPremium && (state.guests.length > GUEST_THRESHOLD) && (
          <div className="flex items-center justify-center gap-3 mt-3">
            <button
              className="danstyle1c-btn"
              onClick={() => setCurrentPage(prev => Math.max(0, prev - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-[#586D78]">Page {currentPage + 1} / {totalPages}</span>
            <button
              className="danstyle1c-btn"
              onClick={() => setCurrentPage(prev => Math.min(totalPages - 1, prev + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        )}
      </Card>

      <SavedSettingsAccordion />
    </div>
  );
};

export default ConstraintManager;