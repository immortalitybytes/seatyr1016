import React, { useState, useMemo, useRef, useEffect } from 'react';
import { ClipboardList, Info, AlertCircle, ChevronLeft, ChevronRight, ArrowDownAZ, ChevronDown, X } from 'lucide-react';

// Disable large guest list warnings site-wide
const SHOW_LARGE_LIST_WARNING = false;
import Card from '../components/Card';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting, formatTableAssignment } from '../utils/formatters';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table' | 'party-size';

const GUEST_THRESHOLD = 120; // Threshold for pagination
const GUESTS_PER_PAGE = 10; // Show 10 guests per page when paginating

const ConstraintManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [highlightedPair, setHighlightedPair] = useState<{guest1: string, guest2: string} | null>(null);
  const [highlightTimeout, setHighlightTimeout] = useState<NodeJS.Timeout | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  
  // ID ↔ Name mapping for display only (UI still shows names)
  const idToName = useMemo(() => new Map(state.guests.map(g => [g.id, g.name])), [state.guests]);
  const nameToId = useMemo(() => new Map(state.guests.map(g => [g.name, g.id])), [state.guests]);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  
  // Sorting state (for premium users)
  const [sortOption, setSortOption] = useState<SortOption>('last-name');
  
  // Warning message state
  const [isWarningExpanded, setIsWarningExpanded] = useState(false);
  const [initialWarningShown, setInitialWarningShown] = useState(false);
  const [userHasInteractedWithWarning, setUserHasInteractedWithWarning] = useState(false);
  
  // Check if user has premium subscription
  const isPremium = isPremiumSubscription(state.subscription);

  // Premium gating for sorting options
  const allowedSortOptions: SortOption[] = isPremium
    ? ['first-name', 'last-name', 'as-entered', 'current-table', 'party-size']
    : ['first-name', 'last-name', 'party-size'];

  // If current sort became disallowed (e.g., downgrade), coerce safely
  useEffect(() => {
    if (!allowedSortOptions.includes(sortOption)) setSortOption('last-name');
  }, [isPremium]); // eslint-disable-line react-hooks/exhaustive-deps
  
  // Load pagination warning expanded state from localStorage
  useEffect(() => {
    // Always start collapsed in a new session
    setIsWarningExpanded(false);
    
    // Mark that we've shown the initial warning in its collapsed state
    if (isPremium && state.guests.length > GUEST_THRESHOLD && !initialWarningShown) {
      setInitialWarningShown(true);
    }
    
    // Reset user interaction flag on component mount
    setUserHasInteractedWithWarning(false);
  }, []);

  // Handle guest threshold crossing
  useEffect(() => {
    const needsPagination = isPremium && state.guests.length > GUEST_THRESHOLD;
    
    if (needsPagination) {
      // Only auto-expand the warning if:
      // 1. User hasn't manually interacted with it this session, AND
      // 2. Guest count just crossed the threshold from below
      if (!userHasInteractedWithWarning && !initialWarningShown) {
        setIsWarningExpanded(true);
        setInitialWarningShown(true);
        // Auto-collapse after 10 seconds if user doesn't interact
        const timer = setTimeout(() => {
          if (!userHasInteractedWithWarning) {
            setIsWarningExpanded(false);
          }
        }, 10000);
        return () => clearTimeout(timer);
      }
    } else {
      // Reset the initialWarningShown flag when guest count drops below threshold
      // This allows for re-showing expanded warning if count goes above threshold again
      setInitialWarningShown(false);
    }
  }, [state.guests.length, isPremium, userHasInteractedWithWarning, initialWarningShown]);
  
  // Reset pagination when guest list changes
  useEffect(() => {
    setCurrentPage(0);
    
    // Calculate total pages
    if (isPremium && state.guests.length > GUEST_THRESHOLD) {
      setTotalPages(Math.ceil(state.guests.length / GUESTS_PER_PAGE));
    } else {
      setTotalPages(1);
    }
  }, [state.guests.length, isPremium]);
  
  // Function to handle user expanding/collapsing the warning
  const handleToggleWarning = () => {
    setIsWarningExpanded(prev => !prev);
    setUserHasInteractedWithWarning(true);
  };

  // Function to purge seating plans when constraints change
  const purgeSeatingPlans = () => {
    // Clear plans only - AppContext handles generation
    dispatch({ type: 'CLEAR_PLANS' });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    
    // Reset plan name in localStorage
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    
    // Mark as not from saved setting
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };
  
  // Get adjacent count for a guest
  const getAdjacentCount = (guestId: string) => {
    return state.adjacents[guestId]?.length || 0;
  }
  
  // Function to get sorted guests
  const getSortedGuests = () => {
    if (!isPremium && (sortOption === 'as-entered' || sortOption === 'current-table')) {
      // Free/unsigned: only First/Last are allowed. Fall back to 'last-name'.
      return [...state.guests].sort((a, b) => {
        const lnA = getLastNameForSorting(a.name.split('&')[0].trim()).toLowerCase();
        const lnB = getLastNameForSorting(b.name.split('&')[0].trim()).toLowerCase();
        return lnA.localeCompare(lnB);
      });
    }
    
    if (sortOption === 'as-entered') {
      return [...state.guests];
    }
    
    const sortedGuests = [...state.guests].sort((a, b) => {
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
      else if (sortOption === 'party-size') {
        return b.count - a.count; // descending
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
        
        // Build ID mapping for robust matching
        const idByName = new Map(state.guests.map(g => [g.name, g.id]));
        const aId = idByName.get(a.name);
        const bId = idByName.get(b.name);
        
        // Find which table each guest is assigned to
        for (const table of plan.tables) {
          for (const seat of table.seats) {
            const seatId = (seat as any).id ?? idByName.get(seat.name);
            if (aId && seatId === aId) {
              tableA = table.id;
              foundA = true;
            }
            if (bId && seatId === bId) {
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
    
    return sortedGuests;
  };
  
  const constraintGrid = useMemo(() => {
    // Use sorted guests if premium and sorting is active
    const guests = getSortedGuests();
    
    const { constraints, adjacents } = state;
    
    if (guests.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          No guests added yet. Add guests to create constraints.
        </div>
      );
    }
    
    // Handle pagination for large guest lists (only for premium users)
    const needsPagination = isPremium && guests.length > GUEST_THRESHOLD;
    const totalPages = needsPagination ? Math.ceil(guests.length / GUESTS_PER_PAGE) : 1;
    
    // Get the guests for the current page
    let displayGuests = guests;
    if (needsPagination) {
      const startIndex = currentPage * GUESTS_PER_PAGE;
      const endIndex = Math.min(startIndex + GUESTS_PER_PAGE, guests.length);
      displayGuests = guests.slice(startIndex, endIndex);
    }
    
    // Create the header row with the corner cell and column headers
    const headerRow = [
      <th 
        key="corner" 
        className="bg-indigo-50 font-medium p-2 border border-[#586D78] border-2 sticky top-0 left-0 z-30"
      >
        Guest Names
      </th>
    ];
    
    // Add column headers (only for the current page when paginated)
    displayGuests.forEach((guest, index) => {
      // Get the number of adjacent pairings for visual indicator
      const adjacentCount = getAdjacentCount(guest.id);
      
      // Create adjacent indicator based on count
      let adjacentIndicator = null;
      if (adjacentCount > 0) {
        adjacentIndicator = (
          <span className="text-[#b3b508] font-bold ml-1" title={`Adjacent to: ${(adjacents[guest.id] || []).map(id => idToName.get(id)).filter(Boolean).join(', ')}`}>
            {adjacentCount === 1 ? '⭐' : '⭐⭐'}
          </span>
        );
      }
      
      // Check if this header is selected or highlighted
      const isSelected = selectedGuest === guest.name;
      const isHighlighted = !!highlightedPair &&
        (highlightedPair.guest1 === guest.id || highlightedPair.guest2 === guest.id);
      
      headerRow.push(
        <th 
          key={`col-${index}`}
          className={`
            p-2 font-medium sticky top-0 z-20 min-w-[100px] cursor-pointer transition-colors duration-200
            border border-[#586D78] border-2
            ${isHighlighted ? 'bg-[#88abc6]' : isSelected ? 'bg-[#586D78] text-white' : 'bg-indigo-50 text-[#586D78] hover:bg-indigo-100'}
          `}
          onDoubleClick={() => handleGuestSelect(guest.name)}
          onTouchStart={(e) => handleLongPress(e, guest.name)}
          onTouchEnd={() => clearLongPressTimer()}
          data-name={guest.name}
        >
          <div className="max-w-[100px] leading-tight" style={{ minHeight: '3rem', wordWrap: 'break-word', whiteSpace: 'normal' }}>
            <FormatGuestName name={guest.name} />
            {adjacentIndicator}
          </div>
        </th>
      );
    });
    
    const grid = [<tr key="header">{headerRow}</tr>];
    
    // Now add the rows
    guests.forEach((guest1, rowIndex) => {
      
      // Get table assignment info if premium
      let assignmentInfo = null;
      if (isPremium) {
        const tableAssignment = formatTableAssignment(state.assignments, state.tables, guest1.id);
        if (tableAssignment) {
          const color = 'text-gray-600'; // Default color for assignment info
          
          assignmentInfo = (
            <div className={`text-xs ${color} truncate max-w-[280px]`} title={tableAssignment}>
              {tableAssignment}
            </div>
          );
        }
      }
      
      // Check if this row should be highlighted
      const isHighlighted = !!highlightedPair &&
        (highlightedPair.guest1 === guest1.id || highlightedPair.guest2 === guest1.id);
      
      // Check if this row is selected
      const isSelected = selectedGuest === guest1.name;
      
      // Get adjacent count indicator
      const adjacentCount = getAdjacentCount(guest1.id);
      let adjacentIndicator = null;
      if (adjacentCount > 0) {
        adjacentIndicator = (
          <span className="text-[#b3b508] font-bold ml-1" title={`Adjacent to: ${(adjacents[guest1.id] || []).map(id => idToName.get(id)).filter(Boolean).join(', ')}`}>
            {adjacentCount === 1 ? '⭐' : '⭐⭐'}
          </span>
        );
      }
      
      const row = [
        <td 
          key={`row-${rowIndex}`}
          className={`
            p-2 font-medium sticky left-0 z-10 min-w-[140px] cursor-pointer transition-colors duration-200
            border border-[#586D78] border-2
            ${isHighlighted ? 'bg-[#88abc6]' : isSelected ? 'bg-[#586D78] text-white' : 'bg-indigo-50 text-[#586D78] hover:bg-indigo-100'}
          `}
          onDoubleClick={() => handleGuestSelect(guest1.name)}
          onTouchStart={(e) => handleLongPress(e, guest1.name)}
          onTouchEnd={() => clearLongPressTimer()}
          data-name={guest1.name}
        >
          <div>
            <div className="truncate max-w-[140px]">
              {guest1.name.includes('%') ? (
                <>
                  {guest1.name.split('%')[0]}
                  <span style={{ color: '#959595' }}>%{guest1.name.split('%')[1]}</span>
                </>
              ) : guest1.name}
              {adjacentIndicator}
            </div>
            {guest1.count > 1 && (
              <div className="text-xs text-gray-700 font-medium">
                Party size: {guest1.count} {guest1.count === 2 ? 'people' : 'people'}
              </div>
            )}
            {isPremium && assignmentInfo}
          </div>
        </td>
      ];
      
      // Add cells only for the current page of columns
      displayGuests.forEach((guest2, colIndexOnPage) => {
        // For the same guest (diagonal cells), show a black background
        if (guest1.name === guest2.name) {
          row.push(
            <td
              key={`cell-${rowIndex}-${colIndexOnPage}`}
              className="p-2 border border-[#586D78] border-2 bg-black"
            />
          );
        } else {
          // Determine the current constraint value (if any)
          const constraintValue =
            constraints[guest1.id]?.[guest2.id] ??
            // legacy name-keyed compatibility:
            (constraints as any)[guest1.name]?.[guest2.name] ??
            '';
          
          // Check if there's an adjacent relationship
          const isAdjacent =
            !!adjacents[guest1.id]?.includes(guest2.id) ||
            !!(adjacents as any)[guest1.name]?.includes?.(guest2.name);
          const isAdjacentReverse =
            !!adjacents[guest2.id]?.includes(guest1.id) ||
            !!(adjacents as any)[guest2.name]?.includes?.(guest1.name);
          
          // Prepare the cell content and background color
          // Precedence: cannot > adjacency > must > empty
          const hasAdj = isAdjacent || isAdjacentReverse;
          
          let cellContent = null;
          let bgColor = '';
          
          if (constraintValue === 'cannot') {
            // Hard prohibition always wins
            bgColor = 'bg-[#e6130b]';
            cellContent = <span className="text-black font-bold">X</span>;
          } else if (hasAdj && isPremium) {
            // Premium-adjacent pairs: ⭐&⭐
            bgColor = 'bg-[#22cf04]';
            cellContent = <span className="text-black font-bold">⭐&⭐</span>;
          } else if (constraintValue === 'must') {
            // Must without adjacency remains green with '&'
            bgColor = 'bg-[#22cf04]';
            cellContent = <span className="text-black font-bold">&</span>;
          } else if (hasAdj && !isPremium) {
            // Non-premium adjacency shows as read-only 'adj'
            bgColor = '';
            cellContent = <span className="text-gray-500 text-xs">adj</span>;
          }
          
          // Check if this cell should be highlighted
          const isCellHighlighted = highlightedPair && 
            ((highlightedPair.guest1 === guest1.id && highlightedPair.guest2 === guest2.id) ||
             (highlightedPair.guest1 === guest2.id && highlightedPair.guest2 === guest1.id));
          
          if (isCellHighlighted) {
            bgColor = 'bg-[#88abc6]';
          }
          
          row.push(
            <td
              key={`cell-${rowIndex}-${colIndexOnPage}`}
              className={`p-2 border border-[#586D78] border-2 cursor-pointer transition-colors duration-200 text-center ${bgColor}`}
              onClick={() => handleToggleConstraint(guest1.id, guest2.id)}
              data-guest1={guest1.name}
              data-guest2={guest2.name}
            >
              {cellContent}
            </td>
          );
        }
      });

      grid.push(<tr key={`row-${rowIndex}`}>{row}</tr>);
    });

    
    // Bottom controls
    const paginationControls = needsPagination && (
      <div className="mt-3">
        {/* Row of 10 static buttons; wraps on narrow screens */}
        <div className="grid grid-cols-10 gap-2 [@media(max-width:480px)]:grid-cols-3 [@media(max-width:480px)]:grid-rows-4">
          {(() => {
            const TOTAL_PAGES = Math.max(1, totalPages);
            const pageWindow = 10;
            const first = Math.floor(currentPage / pageWindow) * pageWindow; // 0-based window
            const pageIndices = Array.from({ length: Math.min(pageWindow, TOTAL_PAGES - first) },
                                           (_, i) => first + i);
            return pageIndices.map((i) => (
              <button
                key={i}
                onClick={() => setCurrentPage(i)}
                className={`px-2 py-1 border text-sm ${i===currentPage ? 'bg-[#586D78] text-white' : 'bg-white text-[#586D78]'}`}
              >
                {i+1}
              </button>
            ));
          })()}
        </div>
        {/* Row 2: centered arrows */}
        <div className="flex items-center justify-center gap-4 mt-2">
          <button onClick={() => setCurrentPage(Math.max(0, currentPage-1))} aria-label="Previous Page">◀</button>
          <button onClick={() => setCurrentPage(Math.min(totalPages-1, currentPage+1))} aria-label="Next Page">▶</button>
        </div>
      </div>
    );
    
    // Performance warning for large but not pagination-level guest lists
    const showPerformanceWarning = !isPremium && state.guests.length > 100 && state.guests.length <= GUEST_THRESHOLD;
    
    return (
      <div className="flex flex-col space-y-4">
        {showPerformanceWarning && SHOW_LARGE_LIST_WARNING && (
                  <div className="bg-[#88abc6] border border-[#586D78] rounded-md p-4 flex items-start">
          <AlertCircle className="text-white mr-2 flex-shrink-0 mt-1" />
          <div className="text-sm text-white">
              <p className="font-medium">Performance Notice</p>
              <p>You have {state.guests.length} guests, which may cause the constraint grid to be slow to render and interact with.</p>
              <p className="mt-1">For better performance, consider working with smaller groups of guests.</p>
            </div>
          </div>
        )}
        
        {needsPagination && SHOW_LARGE_LIST_WARNING && (
                  <div className={`border border-[#586D78] rounded-md transition-all ${isWarningExpanded ? 'bg-[#88abc6] p-4' : 'bg-[#88abc6]/50 px-4 py-2'}`}>
          <div className="flex justify-between items-center">
            <div className="flex items-center">
              {isWarningExpanded ? (
                <AlertCircle className="text-white mr-2 flex-shrink-0" />
              ) : null}
              <p className={`text-sm ${isWarningExpanded ? 'text-white' : 'text-white'}`}>
                  {isWarningExpanded ? 'Large Guest List Detected' : 'Large Guest List Pagination'}
                </p>
              </div>
              
              <div className="flex items-center">
                {isWarningExpanded ? (
                  <button
                    onClick={handleToggleWarning}
                    className="text-white hover:text-white"
                    aria-label="Collapse warning"
                  >
                    <X className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    onClick={handleToggleWarning}
                    className="text-white hover:text-white"
                    aria-label="Expand warning"
                  >
                    <ChevronDown className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
            
            {isWarningExpanded && (
              <div className="mt-2 text-sm text-white">
                <p>To improve performance, the constraint grid shows 10 columns at a time.</p>
                <p>Scroll vertically and use the navigation buttons below to see all guests.</p>
              </div>
            )}
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
  }, [state.guests, state.constraints, state.adjacents, selectedGuest, highlightedPair, currentPage, totalPages, sortOption, isPremium, state.seatingPlans, state.assignments, state.tables, state.currentPlanIndex, isWarningExpanded, initialWarningShown]);
  
  let longPressTimer: NodeJS.Timeout;
  
  const handleLongPress = (e: React.TouchEvent, guestName: string) => {
    e.preventDefault();
    longPressTimer = setTimeout(() => {
      handleGuestSelect(guestName);
    }, 500);
  };


  const clearLongPressTimer = () => {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
    }
  };

  const handleToggleConstraint = (guest1Id: string, guest2Id: string) => {
    // Free-tier grid edit guard at >80 heads (no UI change)
    const totalHeads = state.guests.reduce((s,g) => s + (g.count ?? 1), 0);
    if (!isPremium && totalHeads > 80) { 
      alert('Free plan limit: editing constraints above 80 total guests is blocked.'); 
      return; 
    }

    setSelectedGuest(null);
    setHighlightedPair(null);
    if (highlightTimeout) {
      clearTimeout(highlightTimeout);
      setHighlightTimeout(null);
    }

    if (guest1Id === guest2Id) return;

    const current = (state.constraints[guest1Id]?.[guest2Id] ?? '') as ''|'must'|'cannot';
    const adj = !!state.adjacents[guest1Id]?.includes(guest2Id);

    let next: ''|'must'|'cannot' = '';
    if (!isPremium) {
      next = current === '' ? 'must' : current === 'must' ? 'cannot' : '';
    } else {
      if (current === '') {
        next = 'must';
      } else if (current === 'must' && !adj) {
        dispatch({ type: 'SET_ADJACENT', payload: { guest1: guest1Id, guest2: guest2Id } });
        next = 'must';
      } else if (current === 'must' && adj) {
        dispatch({ type: 'REMOVE_ADJACENT', payload: { guest1: guest1Id, guest2: guest2Id } });
        next = 'cannot';
      } else if (current === 'cannot') {
        next = '';
      }
    }
    dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: guest1Id, guest2: guest2Id, value: next } });
    // AppContext handles plan clearing on constraint changes
  };

  const handleGuestSelect = (guestName: string) => {
    // Free-tier grid edit guard at >80 heads (no UI change)
    const totalHeads = state.guests.reduce((s,g) => s + (g.count ?? 1), 0);
    if (!isPremium && totalHeads > 80) { 
      alert('Free plan limit: editing constraints above 80 total guests is blocked.'); 
      return; 
    }

    if (!isPremium) { alert('Adjacency pairing is a premium feature.'); return; }
    const guestId = nameToId.get(guestName);
    if (!guestId) return;
    
    if (selectedGuest === null) {
      setSelectedGuest(guestName); // Keep name for UI display
    } else if (selectedGuest !== guestName) {
      const selectedGuestId = nameToId.get(selectedGuest);
      if (!selectedGuestId) return;
      
      // Set constraint to 'must' when setting adjacency
      dispatch({
        type: 'SET_CONSTRAINT',
        payload: { guest1: selectedGuestId, guest2: guestId, value: 'must' }
      });
      
      // Then set the adjacency
      dispatch({
        type: 'SET_ADJACENT',
        payload: { guest1: selectedGuestId, guest2: guestId }
      });

      // Highlight the pair (using IDs for internal state)
      setHighlightedPair({ guest1: selectedGuestId, guest2: guestId });
      setSelectedGuest(null);

      // Clear highlight after 3 seconds
      const timeout = setTimeout(() => {
        setHighlightedPair(null);
      }, 3000);

      if (highlightTimeout) {
        clearTimeout(highlightTimeout);
      }
      setHighlightTimeout(timeout);

      // Purge seating plans when adjacency changes
      purgeSeatingPlans();
    } else {
      setSelectedGuest(null);
    }
  };


  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <ClipboardList className="mr-2" />
        Constraint Manager

      </h1>
      
      {isPremium && (
        <Card>
          <div className="space-y-4">
            <div className="flex items-start space-x-4">
              <Info className="text-[#586D78] mt-1 flex-shrink-0" />
              <div>
                <h3 className="font-medium text-[#586D78]">How to use constraints:</h3>
                <div className="text-gray-600 text-[17px] mt-2">
                  <div>Click a cell to cycle between constraints:</div>
                  <div className="mt-1 flex flex-wrap gap-4">
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="inline-flex items-center justify-center"
                            style={{ width: '1.5em', height: '1.5em', background: '#34d399', border: '2px solid #000', lineHeight: '1.5em' }}
                            aria-label="Must">
                        &
                      </span>
                      <span>Must sit at the same table</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="inline-flex items-center justify-center"
                            style={{ width: '1.5em', height: '1.5em', background: '#ef4444', border: '2px solid #000', lineHeight: '1.5em' }}
                            aria-label="Cannot">
                        X
                      </span>
                      <span>Cannot sit at the same table</span>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="inline-flex items-center justify-center"
                            style={{ width: '1.5em', height: '1.5em', background: '#ffffff', border: '2px solid #000', lineHeight: '1.5em' }}
                            aria-label="No constraint">
                      </span>
                      <span>No constraint</span>
                    </div>
                  </div>
                </div>
                <ul className="list-disc pl-5 mt-2">
                  <li>To set "Adjacent Seating" (guests sit right next to each other):
                    <ol className="list-decimal pl-5 mt-1">
                      <li>Long-press (mobile) or double-click (desktop) a guest name to select it</li>
                      <li>And then Long-press or double-click another guest name to create the adjacent pairing</li>
                    </ol>
                  </li>
                  <li>Guests with adjacent constraints are marked with <span className="text-[#b3b508] font-bold">⭐</span></li>
                </ul>
              </div>
            </div>
          </div>
        </Card>
      )}
    
      <Card title="Constraint Grid">
        <div className="flex flex-col md:flex-row justify-between items-center mb-4 space-y-2 md:space-y-0">
          <div className="flex items-center space-x-2">
            <span className="text-gray-700 font-medium flex items-center">
              <ArrowDownAZ className="w-5 h-5 mr-2" />
              Sort by:
            </span>
            <div className="flex space-x-2">
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
              {allowedSortOptions.includes('as-entered') && (
                <button
                  className={sortOption === 'as-entered' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                  onClick={() => setSortOption('as-entered')}
                >
                  As Entered
                </button>
              )}
              {allowedSortOptions.includes('current-table') && (
                <button
                  className={`
                    ${sortOption === 'current-table' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                  `}
                  onClick={() => setSortOption('current-table')}
                  disabled={!state.seatingPlans || state.seatingPlans.length === 0}
                  title={!state.seatingPlans || state.seatingPlans.length === 0 ? 'Generate plans to enable this sort' : ''}
                >
                  Current Table
                </button>
              )}
              {allowedSortOptions.includes('party-size') && (
                <button
                  className={sortOption === 'party-size' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                  onClick={() => setSortOption('party-size')}
                >
                  Party Size
                </button>
              )}
            </div>
          </div>
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