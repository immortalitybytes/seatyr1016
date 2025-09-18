// src/pages/ConstraintManager.tsx
// Fully functional grid UI that reads raw app state for compatibility
// but FEEDS the solver a clean, ID-keyed, duplicate-safe view via a boundary shim.

import React, { useState, useMemo, useRef, useEffect } from 'react';

// Disable large guest list warnings site-wide
const SHOW_LARGE_LIST_WARNING = false;
import { ClipboardList, Info, AlertCircle, ChevronLeft, ChevronRight, Crown, ArrowDownAZ, X, AlertTriangle } from 'lucide-react';
import Card from '../components/Card';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting } from '../utils/formatters';
import { squash } from '../utils/stateSanitizer';
import { detectConstraintConflictsSafe } from '../utils/conflictsSafe';
import FormatGuestName from '../components/FormatGuestName';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';

// ——————————————————————————————————————————————
// Normalization helpers moved to shared util (squash)

// ——————————————————————————————————————————————
// Local debounce
function useDebouncedCallback<T extends (...args: any[]) => any>(callback: T, delay: number) {
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  useEffect(() => () => { if (timeoutRef.current) clearTimeout(timeoutRef.current); }, []);
  return React.useCallback((...args: Parameters<T>) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => callback(...args), delay);
  }, [callback, delay]);
}

// ——————————————————————————————————————————————
// Types (loose to match existing app state)
interface ConflictItem { id?: string; type: string; description?: string; message?: string; affectedGuests: string[]; [k: string]: any }
interface Guest { id: string; name: string; count?: number }

type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GUEST_THRESHOLD = 120; // pagination threshold
const GUESTS_PER_PAGE = 10;

const ConstraintManager: React.FC = () => {
  const { state, dispatch } = useApp();

  // — UI state
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [highlightedPair, setHighlightedPair] = useState<{guest1: string, guest2: string} | null>(null);
  const [highlightTimeout, setHighlightTimeout] = useState<NodeJS.Timeout | null>(null);
  const [conflicts, setConflicts] = useState<ConflictItem[]>([]);
  const [showConflicts, setShowConflicts] = useState(true);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [isWarningExpanded, setIsWarningExpanded] = useState(false);
  const [initialWarningShown, setInitialWarningShown] = useState(false);
  const [userHasInteractedWithWarning, setUserHasInteractedWithWarning] = useState(false);
  const [adjacentAccordionOpen, setAdjacentAccordionOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  
  const isPremium = isPremiumSubscription?.(state.subscription);
  
  // Touch detection
  useEffect(() => {
    const checkTouch = () => setIsTouchDevice('ontouchstart' in window || (navigator as any).maxTouchPoints > 0);
    checkTouch();
    window.addEventListener('resize', checkTouch);
    return () => window.removeEventListener('resize', checkTouch);
  }, []);
  
  // ——————————————————————————————————————————————
  // BOUNDARY NORMALIZATION SHIM (duplicate-safe)
  const idsByName = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const g of state.guests as Guest[]) {
      const k = squash(g.name);
      const a = m.get(k);
      a ? a.push(g.id) : m.set(k, [g.id]);
    }
    return m;
  }, [state.guests]);

  const validIds = useMemo(() => new Set((state.guests as Guest[]).map(g => g.id)), [state.guests]);

  const toId = (k: string): string | null => {
    if (validIds.has(k)) return k; // already an id
    const arr = idsByName.get(squash(k));
    return arr && arr.length === 1 ? arr[0] : null; // only map unambiguous names
  };

  const normConstraints = useMemo(() => {
    const out: Record<string, Record<string, 'must' | 'cannot'>> = {};
    for (const [k1, row] of Object.entries(state.constraints || {})) {
      const i1 = toId(String(k1)); if (!i1) continue;
      for (const [k2, v] of Object.entries(row || {})) {
        if (v !== 'must' && v !== 'cannot') continue;
        const i2 = toId(String(k2)); if (!i2 || i1 === i2) continue;
        (out[i1] ||= {})[i2] = v; (out[i2] ||= {})[i1] = v; // enforce symmetry at the boundary only
      }
    }
    return out;
  }, [state.constraints, idsByName, validIds]);

  const normAdjacents = useMemo(() => {
    const acc: Record<string, Set<string>> = {};
    for (const [ka, vv] of Object.entries(state.adjacents || {})) {
      const ia = toId(String(ka)); if (!ia) continue;
      const partners = Array.isArray(vv) ? vv : Object.keys(vv || {});
      for (const kb of partners) {
        const ib = toId(String(kb)); if (!ib || ia === ib) continue;
        (acc[ia] ||= new Set()).add(ib);
        (acc[ib] ||= new Set()).add(ia);
      }
    }
    return Object.fromEntries(Object.entries(acc).map(([k, set]) => [k, Array.from(set).slice(0, 2)])) as Record<string, string[]>;
  }, [state.adjacents, idsByName, validIds]);

  // ——————————————————————————————————————————————
  // Conflict detection (debounced) using SAFE wrapper
  const updateConflicts = useDebouncedCallback(() => {
    if ((state.guests as Guest[]).length < 2) { setConflicts([]); return; }
    const result = detectConstraintConflictsSafe(state.guests, normConstraints, state.tables, true, normAdjacents);
    setConflicts(result);
  }, 300);

  useEffect(() => { updateConflicts(); }, [state.guests, state.tables, normConstraints, normAdjacents, updateConflicts]);

  const safeConflicts = useMemo(
    () => conflicts.filter(c => Array.isArray(c.affectedGuests) && new Set(c.affectedGuests).size >= 2),
    [conflicts]
  );

  // ——————————————————————————————————————————————
  // Smart Suggestions removed - conflict detection preserved

  // ——————————————————————————————————————————————
  // Pagination UX
  useEffect(() => {
    setCurrentPage(0);
    if (isPremium && (state.guests as Guest[]).length > GUEST_THRESHOLD) {
      setTotalPages(Math.ceil((state.guests as Guest[]).length / GUESTS_PER_PAGE));
    } else {
      setTotalPages(1);
    }
  }, [state.guests, isPremium]);

  // Reset pagination when sort option changes to avoid empty pages
  useEffect(() => {
    setCurrentPage(0);
  }, [sortOption]);

  useEffect(() => {
    setIsWarningExpanded(false);
    if (isPremium && (state.guests as Guest[]).length > GUEST_THRESHOLD && !initialWarningShown) {
      setInitialWarningShown(true);
    }
    setUserHasInteractedWithWarning(false);
  }, []);

  useEffect(() => {
    const needsPagination = isPremium && (state.guests as Guest[]).length > GUEST_THRESHOLD;
    if (needsPagination) {
      if (!userHasInteractedWithWarning && !initialWarningShown) {
        setIsWarningExpanded(true);
        setInitialWarningShown(true);
        const timer = setTimeout(() => { if (!userHasInteractedWithWarning) setIsWarningExpanded(false); }, 10000);
        return () => clearTimeout(timer);
      }
    } else {
      setInitialWarningShown(false);
    }
  }, [state.guests, isPremium, userHasInteractedWithWarning, initialWarningShown]);

  // ——————————————————————————————————————————————
  // Sorting helpers
  const getGuestTableAssignment = (guestName: string) => {
    if (!isPremium) return null;
    
    // Find the guest object to get the guest ID
    const guest = state.guests.find(g => g.name === guestName);
    if (!guest) return { text: 'unassigned', type: 'none' as const };
    
    // Check for user-assigned table numbers first (by guest ID - primary method)
    if ((state as any).assignments && (state as any).assignments[guest.id]) {
      const assignedTableIds = (state as any).assignments[guest.id].split(',').map((t: string) => t.trim());
      const tablenames = assignedTableIds.map((id: string) => {
        const numId = parseInt(id);
        if (!isNaN(numId)) {
          const table = state.tables.find((t: any) => t.id === numId);
          return table?.name ? `${table.name} (${numId})` : `${numId}`;
        }
        return id;
      });
      return { text: tablenames.join(', '), type: 'assigned' as const };
    }
    
    // Fallback: Check by guest name for backwards compatibility with old assignments
    if ((state as any).assignments && (state as any).assignments[guestName]) {
      const assignedTableIds = (state as any).assignments[guestName].split(',').map((t: string) => t.trim());
      const tablenames = assignedTableIds.map((id: string) => {
        const numId = parseInt(id);
        if (!isNaN(numId)) {
          const table = state.tables.find((t: any) => t.id === numId);
          return table?.name ? `${table.name} (${numId})` : `${numId}`;
        }
        return id;
      });
      return { text: tablenames.join(', '), type: 'assigned' as const };
    }
    if ((state as any).seatingPlans && state.seatingPlans.length > 0) {
      const plan = state.seatingPlans[state.currentPlanIndex];
      for (const table of plan.tables) {
        const found = table.seats.find((s: any) => s.name === guestName);
        if (found) {
          const tableObj = state.tables.find((t: any) => t.id === table.id);
          const tableName = tableObj?.name ? `${tableObj.name} (${table.id})` : `${table.id}`;
          return { text: tableName, type: 'plan' as const };
        }
      }
    }
    return { text: 'unassigned', type: 'none' as const };
  };

  const getAdjacentCount = (guestName: string) => (state.adjacents?.[guestName]?.length || 0);

  const getSortedGuests = (): Guest[] => {
    const guests = [...(state.guests as Guest[])];
    if (sortOption === 'as-entered') return guests;

    if (sortOption === 'first-name') {
      return guests.sort((a, b) => {
        const fa = squash(a.name.split(' ')[0] || '');
        const fb = squash(b.name.split(' ')[0] || '');
        return fa.localeCompare(fb);
      });
    }
    if (sortOption === 'last-name') {
      const getLast = (full: string) => getLastNameForSorting?.(full.split('&')[0].trim()) ?? full;
      return guests.sort((a, b) => {
        const la = squash(getLast(a.name));
        const lb = squash(getLast(b.name));
        return la.localeCompare(lb);
      });
    }
    if (sortOption === 'current-table') {
      // Current table sorting is premium-only
      if (!isPremium || !state.seatingPlans || state.seatingPlans.length === 0) return guests;
      const plan = state.seatingPlans[state.currentPlanIndex];
      const tableIndex: Record<string, number> = {};
      for (const table of plan.tables) {
        for (const seat of table.seats) {
          const seatKey = squash(seat.name);
          tableIndex[seatKey] = table.id;
        }
      }
      return guests.sort((a, b) => {
        const ta = tableIndex[squash(a.name)] ?? Number.MAX_SAFE_INTEGER;
        const tb = tableIndex[squash(b.name)] ?? Number.MAX_SAFE_INTEGER;
        if (ta === Number.MAX_SAFE_INTEGER && tb !== Number.MAX_SAFE_INTEGER) return 1;
        if (tb === Number.MAX_SAFE_INTEGER && ta !== Number.MAX_SAFE_INTEGER) return -1;
        if (ta !== tb) return ta - tb;
        // Stable tie-breaker by normalized name
        const na = squash(a.name);
        const nb = squash(b.name);
        return na.localeCompare(nb);
      });
    }
    return guests;
  };

  // ——————————————————————————————————————————————
  // Grid construction
  const shouldShowPagination = (state.guests as Guest[]).length >= GUEST_THRESHOLD;

  const handleNavigatePage = (delta: number) => setCurrentPage(p => Math.max(0, Math.min(totalPages - 1, p + delta)));

  let longPressTimer: NodeJS.Timeout;
  const handleLongPress = (e: React.TouchEvent, guestName: string) => { e.preventDefault(); longPressTimer = setTimeout(() => handleGuestSelect(guestName), 500); };
  const clearLongPressTimer = () => { if (longPressTimer) clearTimeout(longPressTimer); };

  const purgeSeatingPlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] } as any);
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 } as any);
    try { localStorage.setItem('seatyr_current_setting_name', 'Unsaved'); } catch {}
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false } as any);
  };

  const handleToggleConstraint = (guest1: string, guest2: string) => {
    setSelectedGuest(null); setHighlightedPair(null);
    if (highlightTimeout) { clearTimeout(highlightTimeout); setHighlightTimeout(null); }

    const currentValue = (state.constraints?.[guest1]?.[guest2] ?? '') as '' | 'must' | 'cannot';
    let nextValue: '' | 'must' | 'cannot';
    if (currentValue === '') nextValue = 'must';
    else if (currentValue === 'must') { if (state.adjacents?.[guest1]?.includes(guest2)) dispatch({ type: 'REMOVE_ADJACENT', payload: { guest1, guest2 } } as any); nextValue = 'cannot'; }
    else nextValue = '';

    dispatch({ type: 'SET_CONSTRAINT', payload: { guest1, guest2, value: nextValue } } as any);
    purgeSeatingPlans();
  };

  const handleGuestSelect = (guestName: string) => {
    if (selectedGuest === null) { setSelectedGuest(guestName); return; }
    if (selectedGuest !== guestName) {
      const k1 = selectedGuest; const k2 = guestName;
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: k1, guest2: k2, value: 'must' } } as any);
      dispatch({ type: 'SET_ADJACENT', payload: { guest1: k1, guest2: k2 } } as any);
      setHighlightedPair({ guest1: k1, guest2: k2 }); setSelectedGuest(null);
      const timeout = setTimeout(() => setHighlightedPair(null), 3000);
      if (highlightTimeout) clearTimeout(highlightTimeout);
      setHighlightTimeout(timeout);
    purgeSeatingPlans();
    } else { setSelectedGuest(null); }
  };

  const constraintGrid = useMemo(() => {
    const guests = getSortedGuests();
    if (guests.length === 0) return (
      <div className="text-center py-8 text-gray-500">No guests added yet. Add guests to create constraints.</div>
    );

    const needsPagination = isPremium && guests.length > GUEST_THRESHOLD;
    const displayGuests = needsPagination
      ? guests.slice(currentPage * GUESTS_PER_PAGE, Math.min((currentPage + 1) * GUESTS_PER_PAGE, guests.length))
      : guests;

    const headerRow: JSX.Element[] = [
      <th key="corner" className="bg-indigo-50 font-medium p-2 border border-gray-500 sticky top-0 left-0 z-30">Guest Names</th>
    ];

    displayGuests.forEach((guest, index) => {
      const adjacentCount = getAdjacentCount(guest.name);
      const isSelected = selectedGuest === guest.name;
      const isHighlighted = highlightedPair && (highlightedPair.guest1 === guest.name || highlightedPair.guest2 === guest.name);
      headerRow.push(
        <th key={`col-${index}`} className={`p-2 font-medium sticky top-0 z-20 min-w-[100px] cursor-pointer border border-gray-500 ${isHighlighted ? 'bg-yellow-300' : isSelected ? 'bg-gray-700 text-white' : 'bg-indigo-50 text-gray-700 hover:bg-indigo-100'}`}
            onDoubleClick={() => handleGuestSelect(guest.name)} onTouchStart={(e) => handleLongPress(e, guest.name)} onTouchEnd={() => clearLongPressTimer()} data-name={guest.name}>
          <div className="whitespace-normal break-words"><FormatGuestName name={guest.name} />{adjacentCount > 0 && <span className="text-yellow-600 font-bold ml-1" title={`Adjacent to: ${(state.adjacents?.[guest.name] || []).join(', ')}`}>{adjacentCount === 1 ? '*' : '**'}</span>}</div>
        </th>
      );
    });
    
    const grid: JSX.Element[] = [<tr key="header">{headerRow}</tr>];

    guests.forEach((guest1, rowIndex) => {
      const isHighlighted = highlightedPair && (highlightedPair.guest1 === guest1.name || highlightedPair.guest2 === guest1.name);
      const isSelected = selectedGuest === guest1.name;
      const adjacentCount = getAdjacentCount(guest1.name);

      const row: JSX.Element[] = [
        <td key={`row-${rowIndex}`} className={`p-2 font-medium sticky left-0 z-10 min-w-[140px] cursor-pointer border border-gray-500 ${isHighlighted ? 'bg-yellow-300' : isSelected ? 'bg-gray-700 text-white' : 'bg-indigo-50 text-gray-700 hover:bg-indigo-100'}`}
            onDoubleClick={() => handleGuestSelect(guest1.name)} onTouchStart={(e) => handleLongPress(e, guest1.name)} onTouchEnd={() => clearLongPressTimer()} data-name={guest1.name}>
          <div>
            <div className="whitespace-normal break-words"><FormatGuestName name={guest1.name} />{adjacentCount > 0 && <span className="text-yellow-600 font-bold ml-1" title={`Adjacent to: ${(state.adjacents?.[guest1.name] || []).join(', ')}`}>{adjacentCount === 1 ? '*' : '**'}</span>}</div>
            {guest1.count && guest1.count > 1 && (<div className="text-xs text-gray-700 font-medium">Party size: {guest1.count} {guest1.count === 1 ? 'person' : 'people'}</div>)}
            {(() => { 
              const a = getGuestTableAssignment(guest1.name); 
              if (!a) return <div className="text-xs text-gray-700 opacity-40">Table: Unassigned</div>; 
              
              const getFontWeight = () => {
                if (a.type === 'assigned') return 'text-gray-700 font-normal'; // Standard dark font for user assignments
                if (a.type === 'plan') return 'text-gray-700 font-normal opacity-65'; // 35% lighter for Seatyr allocations
                return 'text-gray-700 font-normal opacity-40'; // 60% lighter for unassigned
              };
              
              const tableText = a.type === 'none' ? 'Unassigned' : a.text;
              return <div className={`text-xs ${getFontWeight()} whitespace-normal break-words`} title={tableText}>Table: {tableText}</div>; 
            })()}
          </div>
        </td>
      ];

      displayGuests.forEach((guest2, colIndexOnPage) => {
        if (guest1.name === guest2.name) {
          row.push(<td key={`cell-${rowIndex}-${colIndexOnPage}`} className="p-2 border border-gray-500 bg-gray-800" />);
        } else {
          const constraintValue = (state.constraints?.[guest1.name]?.[guest2.name] || '') as '' | 'must' | 'cannot';
          const isAdjacent = !!state.adjacents?.[guest1.name]?.includes(guest2.name) || !!state.adjacents?.[guest2.name]?.includes(guest1.name);

          let cellContent: React.ReactNode = null; let bgColor = '';
          if (constraintValue === 'must') { bgColor = 'bg-[#22cf04]'; cellContent = isAdjacent ? (<div className="flex items-center justify-center space-x-1"><span className="font-bold">*</span><span className="font-bold">&</span><span className="font-bold">*</span></div>) : (<span className="font-bold">&</span>); }
          else if (constraintValue === 'cannot') { bgColor = 'bg-[#e6130b]'; cellContent = <span className="font-bold">X</span>; }

          const isCellHighlighted = highlightedPair && ((highlightedPair.guest1 === guest1.name && highlightedPair.guest2 === guest2.name) || (highlightedPair.guest1 === guest2.name && highlightedPair.guest2 === guest1.name));
          if (isCellHighlighted) bgColor = 'bg-yellow-300';
          
          row.push(
            <td key={`cell-${rowIndex}-${colIndexOnPage}`} className={`p-2 border border-gray-500 cursor-pointer text-center ${bgColor}`} onClick={() => handleToggleConstraint(guest1.name, guest2.name)} data-guest1={guest1.name} data-guest2={guest2.name}>
              {cellContent}
            </td>
          );
        }
      });

      grid.push(<tr key={`row-${rowIndex}`}>{row}</tr>);
    });

    const renderPageNumbers = () => {
      if (totalPages <= 5) {
        return Array.from({ length: totalPages }, (_, i) => (
          <button key={i} onClick={() => setCurrentPage(i)} className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-1 text-lg' : 'danstyle1c-btn mx-1 w-1 text-lg'}>
            {i + 1}
          </button>
        ));
      }
      
      const buttons: JSX.Element[] = [];
      const current = currentPage;
      const last = totalPages - 1;
      
      // Always show first page
      buttons.push(
        <button key={0} onClick={() => setCurrentPage(0)} className={current === 0 ? 'danstyle1c-btn selected mx-1 w-1 text-lg' : 'danstyle1c-btn mx-1 w-1 text-lg'}>
          1
        </button>
      );
      
      // Show ellipsis if needed
      if (current > 2) {
        buttons.push(<span key="ellipsis1" className="mx-1">...</span>);
      }
      
      // Show center bundle of up to 5 buttons: (X-2), (X-1), X, (X+1), (X+2)
      const start = Math.max(1, current - 2);
      const end = Math.min(last - 1, current + 2);
      
      for (let i = start; i <= end; i++) {
        if (i !== 0 && i !== last) { // Don't duplicate first and last
          buttons.push(
            <button key={i} onClick={() => setCurrentPage(i)} className={current === i ? 'danstyle1c-btn selected mx-1 w-1 text-lg' : 'danstyle1c-btn mx-1 w-1 text-lg'}>
              {i + 1}
            </button>
          );
        }
      }
      
      // Show ellipsis if needed
      if (current < last - 2) {
        buttons.push(<span key="ellipsis2" className="mx-1">...</span>);
      }
      
      // Always show last page
      if (last > 0) {
        buttons.push(
          <button key={last} onClick={() => setCurrentPage(last)} className={current === last ? 'danstyle1c-btn selected mx-1 w-1 text-lg' : 'danstyle1c-btn mx-1 w-1 text-lg'}>
            {last + 1}
          </button>
        );
      }
      
      return buttons;
    };

    const paginationControls = needsPagination && (
      <div className="flex flex-col md:flex-row items-center justify-between py-4 border-t mt-4">
        <div className="flex items-center w-full justify-between">
          <div className="pl-[140px]">
            <button onClick={() => handleNavigatePage(-1)} disabled={currentPage === 0} className="danstyle1c-btn w-24 mx-1">
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </button>
          </div>
            <div className="flex flex-wrap justify-center">{renderPageNumbers()}</div>
            <div className="pr-[10px]">
            <button onClick={() => handleNavigatePage(1)} disabled={currentPage >= totalPages - 1} className="danstyle1c-btn w-24 mx-1">
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        </div>
      </div>
    );
    
    const showPerformanceWarning = !isPremium && guests.length > 100 && guests.length <= GUEST_THRESHOLD;
    
    return (
      <div className="flex flex-col space-y-4">
        {showPerformanceWarning && SHOW_LARGE_LIST_WARNING && (
          <div className="bg-amber-50 border rounded-md p-4 flex items-start">
            <AlertCircle className="text-amber-500 mr-2 flex-shrink-0 mt-1" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Performance Notice</p>
              <p>You have {guests.length} guests; rendering may be slow.</p>
            </div>
          </div>
        )}
        
        {needsPagination && SHOW_LARGE_LIST_WARNING && (
          <div className={`border rounded-md transition-all ${isWarningExpanded ? 'bg-amber-50 p-4' : 'bg-amber-50/50 px-4 py-2'}`}>
            <div className="flex justify-between items-center">
              <div className="flex items-center">
                {isWarningExpanded && <AlertCircle className="text-amber-500 mr-2 flex-shrink-0" />}
                <p className={`text-sm ${isWarningExpanded ? 'text-amber-800' : 'text-amber-600'}`}>
                  {isWarningExpanded ? 'Large Guest List Detected' : 'Large Guest List Pagination'}
                </p>
              </div>
              <div className="flex items-center">
                <button onClick={() => { setIsWarningExpanded(p => !p); setUserHasInteractedWithWarning(true); }} className="text-amber-600 hover:text-amber-800" aria-label="Toggle warning">
                  {isWarningExpanded ? <X className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {isWarningExpanded && (
              <div className="mt-2 text-sm text-amber-800">
                <p>For performance, the grid shows 10 columns at a time. Scroll vertically and use the buttons below to see all guests.</p>
              </div>
            )}
          </div>
        )}

        <div className="overflow-auto max-h-[60vh] border rounded-md relative">
          <table className="w-full border-collapse bg-white"><tbody>{grid}</tbody></table>
        </div>
        
        {needsPagination && paginationControls}
      </div>
    );
  }, [state.guests, state.constraints, state.adjacents, selectedGuest, highlightedPair, currentPage, totalPages, sortOption, isPremium, state.seatingPlans, state.assignments, state.tables, state.currentPlanIndex, isWarningExpanded, initialWarningShown]);

  // ——————————————————————————————————————————————
  // Render
  return (
    <div className="space-y-6">

      
      <Card>
        <div className="space-y-4">
          {showConflicts && safeConflicts.length > 0 && (
            <div className="bg-red-50 border rounded-lg p-4">
              <h3 className="flex items-center text-red-800 font-medium mb-2"><AlertTriangle className="w-4 h-4 mr-1" /> Detected Conflicts ({safeConflicts.length})</h3>
              <div className="space-y-2 max-h-32 overflow-y-auto">
                {safeConflicts.map((c, i) => (
                  <div key={i} className="text-sm">
                    <p className="text-red-700">{c.description || c.message || c.type}</p>
                  </div>
                ))}
              </div>
            </div>
          )}



          <div className="flex items-start space-x-4 my-4">
            <Info className="text-gray-700 mt-1 flex-shrink-0" />
            <div className="ml-20">
              <h3 className="font-bold text-[#586D78] text-[18.75px]">How To Use Constraints</h3>
              <div className="text-gray-600 text-[18.75px] mt-2 leading-relaxed">
                <div>Click a cell to cycle between constraints:</div>
                <div className="mt-1 flex flex-wrap gap-12">
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
                {state.user && (
                  <div className="mt-4">
                    <div className="bg-blue-50 border border-blue-200 rounded-md">
                      <button
                        className="w-full px-4 py-2 text-left text-blue-800 font-medium hover:bg-blue-100 transition-colors"
                        onClick={() => setAdjacentAccordionOpen(!adjacentAccordionOpen)}
                      >
                        <span className="mr-2">{adjacentAccordionOpen ? '▼' : '▶'}</span>
                        To Set Adjacent-Seating:
                      </button>
                      {adjacentAccordionOpen && (
                        <div className="px-4 pb-4 text-blue-700">
                          <div className="mt-2">
                            <div>1) Double-click a guest name to select it.</div>
                            <div>2) Double-click another guest and the adjacency will be set automatically.</div>
                            <div className="mt-2">Guests with adjacent constraints are marked with *</div>
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
        <div className="flex flex-col lg:flex-row justify-between items-center mb-4 space-y-2 lg:space-y-0">
          <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center space-x-2">
              <span className="text-gray-700 font-medium flex items-center"><ArrowDownAZ className="w-5 h-5 mr-2" /> Sort by:</span>
            <div className="flex space-x-2">
                {state.user && (
                  <button className={sortOption === 'as-entered' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'} onClick={() => setSortOption('as-entered')}>As Entered</button>
                )}
                <button className={sortOption === 'first-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'} onClick={() => setSortOption('first-name')}>First Name</button>
                <button className={sortOption === 'last-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'} onClick={() => setSortOption('last-name')}>Last Name</button>
                <button className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''} ${(state.seatingPlans?.length || 0) === 0 ? 'opacity-50' : ''}`} onClick={() => setSortOption('current-table')} disabled={(state.seatingPlans?.length || 0) === 0}>Current Table</button>
              </div>
            </div>
          </div>
          
          {shouldShowPagination && (state.guests as Guest[]).length > 0 && (
            <div className="flex space-x-2">
              <button className="danstyle1c-btn w-24 mx-1" onClick={() => handleNavigatePage(-1)} disabled={currentPage === 0}><ChevronLeft className="w-4 h-4 mr-1" /> Previous</button>
              <button className="danstyle1c-btn w-24 mx-1" onClick={() => handleNavigatePage(1)} disabled={currentPage >= totalPages - 1}>Next <ChevronRight className="w-4 h-4 ml-1" /></button>
            </div>
          )}
        </div>
        
        <div ref={gridRef}>{(state.guests as Guest[]).length === 0 ? (<p className="text-gray-500 text-center py-4">No guests added yet. Add guests to create constraints.</p>) : (constraintGrid)}</div>
      </Card>
      
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default ConstraintManager;
