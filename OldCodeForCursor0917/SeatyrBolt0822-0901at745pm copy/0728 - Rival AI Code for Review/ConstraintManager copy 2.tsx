import React, { useState, useMemo, useCallback, useEffect, useRef, KeyboardEvent } from 'react';
import { ClipboardList, Info, AlertCircle, ChevronLeft, ChevronRight, Crown, ArrowDownAZ, ChevronDown, ChevronUp, X, Undo, Redo, Download, AlertTriangle, CheckCircle } from 'lucide-react';
import Card from '../components/Card';
import { useAppContext } from '../context/AppContext';
import { useModal } from '../providers/ModalProvider';
import { GuestUnit, Constraint, ConstraintConflict } from '../types';
import { detectConstraintConflicts } from '../utils/seatingAlgorithm';
import { normalizeGuestName, getLastNameForSorting } from '../utils/guestParser';
import { v4 as uuidv4 } from 'uuid';

// Constants
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';
const GUEST_THRESHOLD = 15;
const GUESTS_PER_PAGE = 15;

// Custom debounce hook
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

// Sub-components
const InstructionsCard: React.FC<{ isTouchDevice: boolean }> = ({ isTouchDevice }) => (
  <Card>
    <div className="space-y-4">
      <div className="flex items-start space-x-4">
        <Info className="text-[#586D78] mt-1 flex-shrink-0" />
        <div>
          <h3 className="font-medium text-[#586D78]">How to use constraints:</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-600 text-[17px] mt-2">
            <li>
              Click a cell or press Enter/Space to cycle constraints:
              <div className="mt-1 flex space-x-4">
                <span className="flex items-center"><span className="w-3 h-3 bg-green-200 border border-[#586D78] mr-1"></span>Must sit together</span>
                <span className="flex items-center"><span className="w-3 h-3 bg-red-200 border border-[#586D78] mr-1"></span>Cannot sit together</span>
                <span className="flex items-center"><span className="w-3 h-3 bg-white border border-[#586D78] mr-1"></span>No constraint</span>
              </div>
            </li>
            <li>
              To set adjacent seating:
              <ol className="list-decimal pl-5 mt-1">
                <li>{isTouchDevice ? 'Long-press' : 'Click'} a guest name to select</li>
                <li>Click another guest and choose "Set Adjacent"</li>
              </ol>
            </li>
            <li>Guests with adjacent constraints are marked with <span className="text-[#b3b508] font-bold">*</span></li>
            <li>Use arrow keys or buttons to navigate pages</li>
            <li>View and resolve conflicts with "Show Conflicts"</li>
            <li>Undo changes with the Undo button</li>
          </ul>
        </div>
      </div>
    </div>
  </Card>
);

const PaginationWarning: React.FC<{
  isWarningExpanded: boolean;
  guestCount: number;
  toggleWarning: () => void;
}> = ({ isWarningExpanded, guestCount, toggleWarning }) => (
  <div className={`border border-[#586D78] rounded-md transition-all ${isWarningExpanded ? 'bg-amber-50 p-4' : 'bg-amber-50/50 px-4 py-2'}`}>
    <div className="flex justify-between items-center">
      <div className="flex items-center">
        {isWarningExpanded && <AlertCircle className="text-amber-500 mr-2 flex-shrink-0" />}
        <p className={`text-sm ${isWarningExpanded ? 'text-amber-800' : 'text-amber-600'}`}>
          {isWarningExpanded ? 'Large Guest List Detected' : 'Large Guest List Pagination'}
        </p>
      </div>
      <button
        onClick={toggleWarning}
        className="text-amber-600 hover:text-amber-800"
        aria-label={isWarningExpanded ? 'Collapse warning' : 'Expand warning'}
      >
        {isWarningExpanded ? <X className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </button>
    </div>
    {isWarningExpanded && (
      <div className="mt-2 text-sm text-amber-800">
        <p>Showing {GUESTS_PER_PAGE} guests at a time for performance.</p>
        <p>Use navigation buttons to view all guests.</p>
      </div>
    )}
  </div>
);

const ConflictPanel: React.FC<{
  conflicts: ConstraintConflict[];
  guests: GuestUnit[];
  resolveConflict: (key1: string, key2: string) => void;
}> = ({ conflicts, guests, resolveConflict }) => {
  const getGuestName = (key: string) => guests.find(g => g.normalizedKey === key)?.displayName || key;

  return (
    <Card title="Detected Conflicts" role="alert" aria-live="polite">
      {conflicts.length === 0 ? (
        <p className="text-center text-green-600 flex items-center justify-center py-4">
          <CheckCircle className="w-5 h-5 mr-2" /> No conflicts detected.
        </p>
      ) : (
        <ul className="list-disc list-inside max-h-40 overflow-auto space-y-3">
          {conflicts.map(conflict => {
            const pairs: [string, string][] = [];
            const seen = new Set<string>();
            for (let i = 0; i < conflict.affectedGuests.length; i++) {
              const nextIndex = (i + 1) % conflict.affectedGuests.length;
              const key1 = conflict.affectedGuests[i];
              const key2 = conflict.affectedGuests[nextIndex];
              const pairKey = [key1, key2].sort().join('--');
              if (!seen.has(pairKey) && (conflict.type !== 'circular' || i < conflict.affectedGuests.length)) {
                pairs.push([key1, key2]);
                seen.add(pairKey);
              }
            }
            return (
              <li key={conflict.id}>
                <div className="flex items-center">
                  <AlertTriangle className="w-4 h-4 mr-2 text-red-500 flex-shrink-0" />
                  <span>{conflict.description}</span>
                </div>
                <div className="pl-6 mt-1 flex flex-wrap gap-x-4">
                  {pairs.map(([key1, key2]) => (
                    <button
                      key={`${key1}-${key2}`}
                      onClick={() => resolveConflict(key1, key2)}
                      className="text-indigo-600 hover:underline text-sm font-medium"
                      aria-label={`Resolve conflict between ${getGuestName(key1)} and ${getGuestName(key2)}`}
                    >
                      Resolve ({getGuestName(key1)} & {getGuestName(key2)})
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
};

const SmartSuggestionsPanel: React.FC<{ suggestions: string[] }> = ({ suggestions }) => (
  <Card title="Smart Suggestions">
    <div className="space-y-2">
      {suggestions.map((suggestion, index) => (
        <div key={index} className="flex items-center space-x-2 text-gray-700">
          <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
          <span>{suggestion}</span>
        </div>
      ))}
    </div>
  </Card>
);

const SortControls: React.FC<{
  sortOption: SortOption;
  setSortOption: (option: SortOption) => void;
  hasPlans: boolean;
}> = ({ sortOption, setSortOption, hasPlans }) => (
  <div className="flex items-center space-x-2">
    <span className="text-sm font-medium text-gray-700 flex items-center">
      <ArrowDownAZ className="w-5 h-5 mr-2" />
      Sort by:
    </span>
    <div className="flex space-x-2">
      {(['as-entered', 'first-name', 'last-name'] as const).map(opt => (
        <button
          key={opt}
          className={`px-3 py-1 border rounded-md text-sm font-medium ${sortOption === opt ? 'bg-indigo-100 text-indigo-700' : 'bg-white hover:bg-gray-50'}`}
          onClick={() => setSortOption(opt)}
        >
          {opt.replace('-', ' ')}
        </button>
      ))}
      <button
        className={`px-3 py-1 border rounded-md text-sm font-medium ${sortOption === 'current-table' ? 'bg-indigo-100 text-indigo-700' : 'bg-white hover:bg-gray-50'} ${!hasPlans ? 'opacity-50 cursor-not-allowed' : ''}`}
        onClick={() => setSortOption('current-table')}
        disabled={!hasPlans}
      >
        Current Table
      </button>
    </div>
  </div>
);

const ConstraintManager: React.FC = () => {
  const { state, dispatch, isPremium, canUndo, canRedo } = useAppContext();
  const { openConfirm } = useModal();
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [showConflicts, setShowConflicts] = useState(true);
  const [conflicts, setConflicts] = useState<ConstraintConflict[]>([]);
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isWarningExpanded, setIsWarningExpanded] = useState(false);
  const [initialWarningShown, setInitialWarningShown] = useState(false);
  const [userHasInteractedWithWarning, setUserHasInteractedWithWarning] = useState(false);
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const [highlightedPair, setHighlightedPair] = useState<{ guest1: string; guest2: string } | null>(null);
  const [highlightTimeout, setHighlightTimeout] = useState<NodeJS.Timeout | null>(null);
  const longPressTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Detect touch device
  useEffect(() => {
    const checkTouchDevice = () => setIsTouchDevice('ontouchstart' in window || navigator.maxTouchPoints > 0);
    checkTouchDevice();
    window.addEventListener('resize', checkTouchDevice);
    return () => window.removeEventListener('resize', checkTouchDevice);
  }, []);

  // Pagination warning
  useEffect(() => {
    setIsWarningExpanded(false);
    if (state.guests.length > GUEST_THRESHOLD && !initialWarningShown) {
      setIsWarningExpanded(true);
      setInitialWarningShown(true);
      const timer = setTimeout(() => {
        if (!userHasInteractedWithWarning) setIsWarningExpanded(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [state.guests.length, initialWarningShown, userHasInteractedWithWarning]);

  // Update pagination
  useEffect(() => {
    setCurrentPage(0);
    setTotalPages(Math.ceil(state.guests.length / GUESTS_PER_PAGE));
  }, [state.guests.length]);

  // Conflict detection
  const updateConflicts = useDebouncedCallback(async () => {
    if (state.guests.length < 2 || state.tables.length === 0) {
      setConflicts([]);
      return;
    }
    const result = await detectConstraintConflicts(state.guests, state.constraints, state.tables);
    setConflicts(result);
  }, 300);

  useEffect(() => {
    updateConflicts();
  }, [state.guests, state.constraints, state.tables, updateConflicts]);

  // Conflict set
  const conflictSet = useMemo(() => {
    const set = new Set<string>();
    conflicts.forEach(conflict => {
      for (let i = 0; i < conflict.affectedGuests.length; i++) {
        for (let j = i + 1; j < conflict.affectedGuests.length; j++) {
          const key1 = conflict.affectedGuests[i];
          const key2 = conflict.affectedGuests[j];
          set.add(`${key1}|${key2}`);
          set.add(`${key2}|${key1}`);
        }
      }
    });
    return set;
  }, [conflicts]);

  // Smart suggestions
  const smartSuggestions = useMemo((): string[] => {
    const suggestions: string[] = [];
    if (conflicts.length > 0) suggestions.push(`Resolve ${conflicts.length} constraint conflicts to improve seating generation.`);
    const constraintCount = Object.keys(state.constraints).reduce((count, key) => count + Object.keys(state.constraints[key]).length, 0) / 2;
    if (constraintCount === 0 && state.guests.length > 10) suggestions.push('Consider adding "must sit together" constraints for families or friends.');
    if (constraintCount > state.guests.length * 2) suggestions.push('You have many constraints. Consider if all are necessary for flexibility.');
    return suggestions;
  }, [conflicts, state.constraints, state.guests.length]);

  // Sorted guests
  const getSortedGuests = useCallback(() => {
    if (!isPremium || sortOption === 'as-entered') return [...state.guests];
    return [...state.guests].sort((a, b) => {
      if (sortOption === 'first-name') {
        return a.displayName.split(' ')[0].toLowerCase().localeCompare(b.displayName.split(' ')[0].toLowerCase());
      } else if (sortOption === 'last-name') {
        return getLastNameForSorting(a.displayName).localeCompare(getLastNameForSorting(b.displayName));
      } else if (sortOption === 'current-table') {
        if (state.seatingPlans.length === 0) return 0;
        const plan = state.seatingPlans[state.currentPlanIndex];
        let tableA = Number.MAX_SAFE_INTEGER, tableB = Number.MAX_SAFE_INTEGER;
        let foundA = false, foundB = false;
        for (const table of plan.tables) {
          if (table.seats.some(seat => seat.normalizedKey === a.normalizedKey)) {
            tableA = table.id;
            foundA = true;
          }
          if (table.seats.some(seat => seat.normalizedKey === b.normalizedKey)) {
            tableB = table.id;
            foundB = true;
          }
          if (foundA && foundB) break;
        }
        if (!foundA && foundB) return 1;
        if (foundA && !foundB) return -1;
        return tableA - tableB;
      }
      return 0;
    });
  }, [sortOption, state.guests, state.seatingPlans, state.currentPlanIndex, isPremium]);

  const guests = useMemo(() => getSortedGuests(), [getSortedGuests]);

  // Paginated guests
  const displayGuests = useMemo(() => {
    const startIndex = currentPage * GUESTS_PER_PAGE;
    return guests.slice(startIndex, startIndex + GUESTS_PER_PAGE);
  }, [guests, currentPage]);

  // Table assignments
  const getGuestTableAssignment = useCallback((guestKey: string) => {
    if (state.assignments[guestKey]) {
      const assignedTableIds = state.assignments[guestKey].split(',').map(t => t.trim());
      const tableNames = assignedTableIds.map(id => {
        const numId = parseInt(id);
        const table = state.tables.find(t => t.id === numId);
        return table?.name ? `${table.name} (${numId})` : `${numId}`;
      });
      return { text: tableNames.join(', '), type: 'assigned' };
    }
    if (state.seatingPlans.length > 0) {
      const plan = state.seatingPlans[state.currentPlanIndex];
      for (const table of plan.tables) {
        if (table.seats.some(seat => seat.normalizedKey === guestKey)) {
          const tableObj = state.tables.find(t => t.id === table.id);
          const tableName = tableObj?.name ? `${tableObj.name} (${table.id})` : `${table.id}`;
          return { text: tableName, type: 'plan' };
        }
      }
    }
    return { text: 'unassigned', type: 'none' };
  }, [state.assignments, state.seatingPlans, state.tables, state.currentPlanIndex]);

  // Handlers
  const clearSeatingPlans = useCallback(() => {
    if (state.seatingPlans.length > 0) {
      dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
      try {
        localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
      } catch (error) {
        console.warn('Failed to update localStorage:', error);
      }
    }
  }, [dispatch, state.seatingPlans.length]);

  const toggleConstraint = useCallback((g1: GuestUnit, g2: GuestUnit) => {
    const key1 = g1.normalizedKey, key2 = g2.normalizedKey;
    const current = state.constraints[key1]?.[key2] || '';
    const next: Constraint = current === '' ? 'must' : current === 'must' ? 'cannot' : '';

    const applyChange = () => {
      const newConstraints = { ...state.constraints };
      newConstraints[key1] = { ...(newConstraints[key1] || {}) };
      newConstraints[key2] = { ...(newConstraints[key2] || {}) };
      if (next) {
        newConstraints[key1][key2] = newConstraints[key2][key1] = next;
      } else {
        delete newConstraints[key1][key2];
        delete newConstraints[key2][key1];
      }
      dispatch({ type: 'SET_CONSTRAINTS', payload: newConstraints });
      clearSeatingPlans();
    };

    openConfirm(
      'Confirm Constraint Change',
      `This will ${next ? `set "${next} sit together" for` : 'remove the constraint between'} ${g1.displayName} and ${g2.displayName} and may clear existing seating plans. Continue?`,
      applyChange
    );
  }, [state.constraints, dispatch, openConfirm, clearSeatingPlans]);

  const toggleAdjacent = useCallback((g1: GuestUnit, g2: GuestUnit) => {
    const key1 = g1.normalizedKey, key2 = g2.normalizedKey;
    const isAdjacent = state.adjacents[key1]?.includes(key2);

    const applyChange = () => {
      const newAdjacents = { ...state.adjacents };
      newAdjacents[key1] = (newAdjacents[key1] || []).filter(k => k !== key2);
      newAdjacents[key2] = (newAdjacents[key2] || []).filter(k => k !== key1);
      if (!isAdjacent) {
        newAdjacents[key1] = [...(newAdjacents[key1] || []), key2];
        newAdjacents[key2] = [...(newAdjacents[key2] || []), key1];
        const newConstraints = { ...state.constraints };
        newConstraints[key1] = { ...(newConstraints[key1] || {}), [key2]: 'must' as Constraint };
        newConstraints[key2] = { ...(newConstraints[key2] || {}), [key1]: 'must' as Constraint };
        dispatch({ type: 'SET_CONSTRAINTS', payload: newConstraints });
      }
      dispatch({ type: 'SET_ADJACENTS', payload: newAdjacents });
      setHighlightedPair({ guest1: key1, guest2: key2 });
      const timeout = setTimeout(() => setHighlightedPair(null), 3000);
      if (highlightTimeout) clearTimeout(highlightTimeout);
      setHighlightTimeout(timeout);
      clearSeatingPlans();
    };

    openConfirm(
      isAdjacent ? 'Remove Adjacency' : 'Set Adjacency',
      `${isAdjacent ? 'Remove' : 'Set'} adjacent seating for ${g1.displayName} and ${g2.displayName}? This may clear existing seating plans.`,
      applyChange
    );
  }, [state.constraints, state.adjacents, dispatch, openConfirm, highlightTimeout, clearSeatingPlans]);

  const resolveConflict = useCallback((key1: string, key2: string) => {
    const guest1 = guests.find(g => g.normalizedKey === key1)?.displayName || key1;
    const guest2 = guests.find(g => g.normalizedKey === key2)?.displayName || key2;
    openConfirm(
      'Resolve Conflict',
      `Remove constraint between ${guest1} and ${guest2}? This may clear existing seating plans.`,
      () => {
        const newConstraints = { ...state.constraints };
        if (newConstraints[key1])人们的`delete newConstraints[key1][key2];
        if (newConstraints[key2]) delete newConstraints[key2][key1];
        dispatch({ type: 'SET_CONSTRAINTS', payload: newConstraints });
        clearSeatingPlans();
      }
    );
  }, [state.constraints, dispatch, openConfirm, guests, clearSeatingPlans]);

  const exportJSON = useCallback(() => {
    const data = JSON.stringify(
      { guests: state.guests.length, constraints: state.constraints, adjacents: state.adjacents, exportedAt: new Date().toISOString() },
      null,
      2
    );
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seatyr-constraints-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.guests, state.constraints, state.adjacents]);

  const handleGuestSelect = useCallback((guestName: string) => {
    setSelectedGuest(prev => (prev === guestName ? null : guestName));
  }, []);

  const handleKeyNav = useCallback((e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      setCurrentPage(p => Math.max(0, p - 1));
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      setCurrentPage(p => Math.min(totalPages - 1, p + 1));
    }
  }, [totalPages]);

  const handleLongPress = useCallback((e: React.TouchEvent, guestName: string) => {
    e.preventDefault();
    longPressTimerRef.current = setTimeout(() => handleGuestSelect(guestName), 500);
  }, [handleGuestSelect]);

  const clearLongPressTimer = useCallback(() => {
    if (longPressTimerRef.current) {
      clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }, []);

  const handleToggleWarning = useCallback(() => {
    setIsWarningExpanded(prev => !prev);
    setUserHasInteractedWithWarning(true);
  }, []);

  // Constraint grid
  const constraintGrid = useMemo(() => {
    if (state.guests.length === 0) {
      return <div className="text-center py-8 text-gray-500">No guests added yet. Add guests to create constraints.</div>;
    }

    const headerRow = [
      <th key="corner" className="bg-indigo-50 p-2 border-2 border-[#586D78] sticky top-0 left-0 z-30 min-w-[140px]" scope="col">
        Guest Names
      </th>
    ];

    displayGuests.forEach((guest, index) => {
      const adjacentCount = state.adjacents[guest.normalizedKey]?.length || 0;
      const isSelected = selectedGuest === guest.normalizedKey;
      const isHighlighted = highlightedPair && (highlightedPair.guest1 === guest.normalizedKey || highlightedPair.guest2 === guest.normalizedKey);
      const assignment = getGuestTableAssignment(guest.normalizedKey);
      const color = assignment.type === 'assigned' ? 'text-blue-600' : assignment.type === 'plan' ? 'text-green-600' : 'text-gray-500';

      headerRow.push(
        <th
          key={`col-${index}`}
          className={`p-2 border-2 border-[#586D78] sticky top-0 z-20 min-w-[100px] cursor-pointer transition-colors duration-200 ${isHighlighted ? 'bg-yellow-300' : isSelected ? 'bg-[#586D78] text-white' : 'bg-indigo-50 text-[#586D78] hover:bg-indigo-100'}`}
          onClick={() => handleGuestSelect(guest.normalizedKey)}
          onTouchStart={e => handleLongPress(e, guest.normalizedKey)}
          onTouchEnd={clearLongPressTimer}
          scope="col"
          title={guest.displayName}
        >
          <div className="truncate max-w-[100px]">
            {guest.displayName}
            {adjacentCount > 0 && (
              <span className="text-[#b3b508] font-bold ml-1" title={`Adjacent to: ${state.adjacents[guest.normalizedKey].join(', ')}`}>
                {adjacentCount === 1 ? '*' : '**'}
              </span>
            )}
            {assignment.text !== 'unassigned' && (
              <div className={`text-xs ${color} truncate max-w-[100px]`} title={assignment.text}>
                {assignment.text}
              </div>
            )}
            {isSelected && (
              <button
                className="mt-1 px-2 py-1 bg-indigo-600 text-white text-xs rounded"
                onClick={e => { e.stopPropagation(); setSelectedGuest(null); }}
                aria-label="Cancel selection"
              >
                Cancel
              </button>
            )}
          </div>
        </th>
      );
    });

    const grid = [<tr key="header">{headerRow}</tr>];

    displayGuests.forEach((guest1, rowIndex) => {
      const isSelected = selectedGuest === guest1.normalizedKey;
      const isHighlighted = highlightedPair && (highlightedPair.guest1 === guest1.normalizedKey || highlightedPair.guest2 === guest1.normalizedKey);
      const assignment = getGuestTableAssignment(guest1.normalizedKey);
      const color = assignment.type === 'assigned' ? 'text-blue-600' : assignment.type === 'plan' ? 'text-green-600' : 'text-gray-500';

      const row = [
        <th
          key={`row-${rowIndex}`}
          className={`p-2 border-2 border-[#586D78] sticky left-0 z-10 min-w-[140px] cursor-pointer transition-colors duration-200 ${isHighlighted ? 'bg-yellow-300' : isSelected ? 'bg-[#586D78] text-white' : 'bg-indigo-50 text-[#586D78] hover:bg-indigo-100'}`}
          onClick={() => handleGuestSelect(guest1.normalizedKey)}
          onTouchStart={e => handleLongPress(e, guest1.normalizedKey)}
          onTouchEnd={clearLongPressTimer}
          scope="row"
          title={guest1.displayName}
        >
          <div>
            <div className="truncate max-w-[140px]">{guest1.displayName}</div>
            {guest1.count > 1 && (
              <div className="text-xs text-gray-700 font-medium">Party size: {guest1.count} people</div>
            )}
            {assignment.text !== 'unassigned' && (
              <div className={`text-xs ${color} truncate max-w-[140px]`} title={assignment.text}>
                {assignment.text}
              </div>
            )}
            {isSelected && (
              <button
                className="mt-1 px-2 py-1 bg-indigo-600 text-white text-xs rounded"
                onClick={e => { e.stopPropagation(); setSelectedGuest(null); }}
                aria-label="Cancel selection"
              >
                Cancel
              </button>
            )}
          </div>
        </th>
      ];

      displayGuests.forEach((guest2, colIndex) => {
        if (guest1.normalizedKey === guest2.normalizedKey) {
          row.push(<td key={`cell-${rowIndex}-${colIndex}`} className="p-2 border-2 border-[#586D78] bg-gray-300" role="gridcell" aria-disabled="true" />);
        } else {
          const constraint = state.constraints[guest1.normalizedKey]?.[guest2.normalizedKey] || '';
          const isInConflict = conflictSet.has(`${guest1.normalizedKey}|${guest2.normalizedKey}`);
          const isAdjacent = state.adjacents[guest1.normalizedKey]?.includes(guest2.normalizedKey);
          const bgColor = isInConflict ? 'bg-yellow-200 ring-2 ring-red-500 ring-inset' : constraint === 'must' ? 'bg-green-200 hover:bg-green-300' : constraint === 'cannot' ? 'bg-red-200 hover:bg-red-300' : 'bg-white hover:bg-gray-50';
          const label = constraint === 'must' ? 'Must sit together' : constraint === 'cannot' ? 'Cannot sit together' : 'No constraint';

          let cellContent = null;
          if (constraint === 'must') {
            cellContent = isAdjacent ? (
              <div className="flex items-center justify-center space-x-1">
                <span className="text-[#b3b508] font-bold">*</span>
                <span className="text-black font-bold">&</span>
                <span className="text-[#b3b508] font-bold">*</span>
              </div>
            ) : (
              <span className="text-black font-bold">&</span>
            );
          } else if (constraint === 'cannot') {
            cellContent = <span className="text-black font-bold">X</span>;
          }

          row.push(
            <td
              key={`cell-${rowIndex}-${colIndex}`}
              className={`p-2 border-2 border-[#586D78] cursor-pointer transition-colors text-center ${bgColor}`}
              role="gridcell"
              aria-label={`Constraint between ${guest1.displayName} and ${guest2.displayName}: ${label}`}
              tabIndex={0}
              onClick={() => selectedGuest && selectedGuest !== guest1.normalizedKey ? toggleAdjacent(guest1, guest2) : toggleConstraint(guest1, guest2)}
              onKeyDown={e => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  selectedGuest && selectedGuest !== guest1.normalizedKey ? toggleAdjacent(guest1, guest2) : toggleConstraint(guest1, guest2);
                }
              }}
            >
              {cellContent}
            </td>
          );
        }
      });

      grid.push(<tr key={`row-${rowIndex}`}>{row}</tr>);
    });

    const renderPageNumbers = () => {
      if (totalPages <= 9) {
        return Array.from({ length: totalPages }, (_, i) => (
          <button
            key={i}
            onClick={() => setCurrentPage(i)}
            className={`px-3 py-1 border rounded-md text-sm font-medium ${currentPage === i ? 'bg-indigo-100 text-indigo-700' : 'bg-white hover:bg-gray-50'}`}
          >
            {i + 1}
          </button>
        ));
      }
      const pageButtons = [];
      for (let i = 0; i < 3 && i < totalPages; i++) {
        pageButtons.push(
          <button
            key={i}
            onClick={() => setCurrentPage(i)}
            className={`px-3 py-1 border rounded-md text-sm font-medium ${currentPage === i ? 'bg-indigo-100 text-indigo-700' : 'bg-white hover:bg-gray-50'}`}
          >
            {i + 1}
          </button>
        );
      }
      if (currentPage > 2) {
        pageButtons.push(<span key="ellipsis1" className="mx-1">...</span>);
        if (currentPage < totalPages - 3) {
          pageButtons.push(
            <button
              key={currentPage}
              onClick={() => setCurrentPage(currentPage)}
              className="px-3 py-1 border rounded-md text-sm font-medium bg-indigo-100 text-indigo-700"
            >
              {currentPage + 1}
            </button>
          );
        }
      }
      if (currentPage < totalPages - 3) {
        pageButtons.push(<span key="ellipsis2" className="mx-1">...</span>);
      }
      for (let i = Math.max(3, totalPages - 3); i < totalPages; i++) {
        pageButtons.push(
          <button
            key={i}
            onClick={() => setCurrentPage(i)}
            className={`px-3 py-1 border rounded-md text-sm font-medium ${currentPage === i ? 'bg-indigo-100 text-indigo-700' : 'bg-white hover:bg-gray-50'}`}
          >
            {i + 1}
          </button>
        );
      }
      return pageButtons;
    };

    const paginationControls = state.guests.length > GUEST_THRESHOLD && (
      <div className="flex items-center justify-between py-4 border-t mt-4" aria-live="polite">
        <div className="sr-only">
          Showing rows {currentPage * GUESTS_PER_PAGE + 1} to {Math.min((currentPage + 1) * GUESTS_PER_PAGE, state.guests.length)} of {state.guests.length}
        </div>
        <button
          onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
          disabled={currentPage === 0}
          className="px-3 py-1 border rounded-md text-sm font-medium disabled:opacity-50"
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Previous
        </button>
        <div className="flex flex-wrap justify-center space-x-2">{renderPageNumbers()}</div>
        <button
          onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
          disabled={currentPage >= totalPages - 1}
          className="px-3 py-1 border rounded-md text-sm font-medium disabled:opacity-50"
        >
          Next
          <ChevronRight className="w-4 h-4 ml-1" />
        </button>
      </div>
    );

    const showPerformanceWarning = !isPremium && state.guests.length > 100;

    return (
      <div className="flex flex-col space-y-4">
        {showPerformanceWarning && (
          <div className="bg-amber-50 border border-[#586D78] rounded-md p-4 flex items-start">
            <AlertCircle className="text-amber-500 mr-2 flex-shrink-0 mt-1" />
            <div className="text-sm text-amber-800">
              <p className="font-medium">Performance Notice</p>
              <p>Your {state.guests.length} guests may slow the grid. Consider a premium subscription for pagination.</p>
            </div>
          </div>
        )}
        {paginationControls && <PaginationWarning isWarningExpanded={isWarningExpanded} guestCount={state.guests.length} toggleWarning={handleToggleWarning} />}
        {showConflicts && <ConflictPanel conflicts={conflicts} guests={guests} resolveConflict={resolveConflict} />}
        {smartSuggestions.length > 0 && <SmartSuggestionsPanel suggestions={smartSuggestions} />}
        <div className="overflow-auto max-h-[60vh] border border-[#586D78] rounded-md relative" role="grid" aria-label="Seating Constraint Grid">
          <table className="w-full border-collapse bg-white">
            <tbody>{grid}</tbody>
          </table>
        </div>
        {paginationControls}
      </div>
    );
  }, [state.guests, state.constraints, state.adjacents, state.tables, state.seatingPlans, state.assignments, state.currentPlanIndex, isPremium, selectedGuest, highlightedPair, currentPage, totalPages, isWarningExpanded, showConflicts, conflicts, conflictSet, smartSuggestions, isTouchDevice, getGuestTableAssignment, toggleConstraint, toggleAdjacent, handleGuestSelect]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (longPressTimerRef.current) clearTimeout(longPressTimerRef.current);
      if (highlightTimeout) clearTimeout(highlightTimeout);
    };
  }, [highlightTimeout]);

  return (
    <div className="space-y-6" onKeyDown={handleKeyNav} role="region" aria-label="Constraint Manager">
      <header className="flex flex-col sm:flex-row justify-between items-center gap-4">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <ClipboardList className="mr-2 h-6 w-6 text-indigo-600" />
          Constraint Manager
          {isPremium xr&& (
            <span className="flex items-center px-2 py-1 bg-yellow-100 text-yellow-800 text-sm rounded ml-2">
              <Crown className="w-4 h-4 mr-1" />
              Premium
            </span>
          )}
        </h1>
        <div className="flex space-x-2">
          <button
            onClick={() => dispatch({ type: 'UNDO' })}
            disabled={!canUndo}
            className={`px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50`}
            aria-label="Undo last change"
          >
            <Undo className="w-4 h-4 mr-2" />
            Undo
          </button>
          <button
            onClick={() => dispatch({ type: 'REDO' })}
            disabled={!canRedo}
            className={`px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50 disabled:opacity-50`}
            aria-label="Redo last undone change"
          >
            <Redo className="w-4 h-4 mr-2" />
            Redo
          </button>
          <button
            onClick={exportJSON}
            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
            aria-label="Export constraints as JSON"
          >
            <Download className="w-4 h-4 mr-2" />
            Export
          </button>
          <button
            onClick={() => setShowConflicts(s => !s)}
            className="px-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium hover:bg-gray-50"
            aria-label={showConflicts ? 'Hide conflicts' : 'Show conflicts'}
          >
            {showConflicts ? 'Hide Conflicts' : 'Show Conflicts'}
          </button>
        </div>
      </header>
      <InstructionsCard isTouchDevice={isTouchDevice} />
      <Card title="Constraint Grid">
        <SortControls sortOption={sortOption} setSortOption={setSortOption} hasPlans={state.seatingPlans.length > 0} />
        <div>{constraintGrid}</div>
      </Card>
    </div>
  );
};

export default ConstraintManager;