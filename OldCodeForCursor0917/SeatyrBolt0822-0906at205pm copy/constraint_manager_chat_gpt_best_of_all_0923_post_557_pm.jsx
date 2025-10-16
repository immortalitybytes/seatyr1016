import React, { useMemo, useRef, useState, useEffect } from 'react';
import { ClipboardList, Info, ArrowDownAZ, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '../components/Card';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting, formatTableAssignment } from '../utils/formatters';
import { detectUnsatisfiableMustGroups } from '../utils/conflicts';

// ---------- Local Types (surgical; avoid wider coupling) ----------
type Guest = { id: string; name: string; count?: number };
type Table = { id: string; name?: string; seats?: number; capacity?: number };
type ConstraintValue = 'must' | 'cannot' | '';

type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

// ---------- Constants (historic behavior preserved) ----------
const GUEST_THRESHOLD = 120; // pagination starts beyond this
const GUESTS_PER_PAGE = 10;  // classic per-page size

// Premium rule
const MAX_ADJACENTS_PER_GUEST = 2;
// Non-premium hard cap of total seats
const NON_PREMIUM_SEAT_CAP = 80;

const ConstraintManager: React.FC = () => {
  const { state, dispatch } = useApp();

  const isPremium = isPremiumSubscription(state.subscription);

  // ---------- Sorting & Pagination ----------
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  const gridRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (state.guests.length > GUEST_THRESHOLD) {
      const pages = Math.ceil(state.guests.length / GUESTS_PER_PAGE);
      setTotalPages(pages);
      if (currentPage >= pages) setCurrentPage(0);
    } else {
      setTotalPages(1);
      if (currentPage !== 0) setCurrentPage(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.guests.length]);

  const guestsSorted: Guest[] = useMemo(() => {
    const guests = [...(state.guests as Guest[])];

    switch (sortOption) {
      case 'first-name':
        guests.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'last-name':
        guests.sort((a, b) => getLastNameForSorting(a.name).localeCompare(getLastNameForSorting(b.name)));
        break;
      case 'current-table': {
        // Sort using the live assignments mapping (backwards compatible)
        const assignments = state.assignments || {};
        const tableIndex = (g: Guest) => {
          const tableId = assignments[g.id];
          if (!tableId) return Number.MAX_SAFE_INTEGER;
          const idx = state.tables.findIndex((t: Table) => t.id === tableId);
          return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
        };
        guests.sort((a, b) => tableIndex(a) - tableIndex(b));
        break;
      }
      case 'as-entered':
      default:
        break; // preserve original order
    }
    return guests;
  }, [state.guests, state.assignments, state.tables, sortOption]);

  const needsPagination = state.guests.length > GUEST_THRESHOLD;
  const displayGuests = useMemo(() => {
    if (!needsPagination) return guestsSorted;
    const start = currentPage * GUESTS_PER_PAGE;
    const end = Math.min(start + GUESTS_PER_PAGE, guestsSorted.length);
    return guestsSorted.slice(start, end);
  }, [guestsSorted, currentPage, needsPagination]);

  // ---------- Derived maps ----------
  const partySize = useMemo(() => {
    const map: Record<string, number> = {};
    for (const g of state.guests as Guest[]) {
      map[g.id] = Math.max(1, g.count ?? 1);
    }
    return map;
  }, [state.guests]);

  const totalSeats = useMemo(() => Object.values(partySize).reduce((a, b) => a + b, 0), [partySize]);
  const overNonPremiumSeatCap = useMemo(() => (!isPremium) && totalSeats > NON_PREMIUM_SEAT_CAP, [isPremium, totalSeats]);

  const tableCapacities: number[] = useMemo(
    () => (state.tables as Table[]).map(t => (t.capacity ?? t.seats ?? 0)),
    [state.tables]
  );

  const getAdjacentCount = (guestId: string) => (state.adjacents[guestId]?.length || 0);
  const isAdjacentPair = (a: string, b: string) =>
    (state.adjacents[a] || []).includes(b) || (state.adjacents[b] || []).includes(a);

  // ---------- Closed-loop feasibility guard ----------
  const buildAdjGraph = () => {
    const graph: Record<string, Set<string>> = {};
    const ensure = (id: string) => (graph[id] ??= new Set<string>());
    for (const [a, neighbors] of Object.entries(state.adjacents || {})) {
      ensure(a);
      for (const b of neighbors || []) {
        ensure(b);
        graph[a].add(b);
        graph[b].add(a);
      }
    }
    return graph;
  };

  const findPath = (graph: Record<string, Set<string>>, u: string, v: string): string[] | null => {
    if (!graph[u] || !graph[v]) return null;
    const q: string[] = [u];
    const prev: Record<string, string | null> = { [u]: null };
    while (q.length) {
      const x = q.shift()!;
      if (x === v) break;
      for (const y of graph[x]) {
        if (!(y in prev)) {
          prev[y] = x;
          q.push(y);
        }
      }
    }
    if (!(v in prev)) return null;
    const path: string[] = [];
    let cur: string | null = v;
    while (cur) {
      path.push(cur);
      cur = prev[cur]!;
    }
    path.reverse();
    return path;
  };

  const cycleSizeIfEdgeClosesLoop = (u: string, v: string): number | null => {
    const graph = buildAdjGraph();
    const path = findPath(graph, u, v);
    if (!path) return null; // adding (u,v) would NOT create a loop
    const ids = new Set<string>(path);
    let total = 0;
    for (const id of ids) total += partySize[id] ?? 1;
    return total;
  };

  const hasExactCapacity = (size: number) => tableCapacities.some(c => c === size);

  // ---------- Dispatch helpers ----------
  const purgePlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    // keep prior UX: mark current setting as Unsaved & clear loaded flag
    try {
      localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    } catch {}
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };

  const setConstraint = (a: string, b: string, value: ConstraintValue) => {
    dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value } });
  };
  const addAdjacent = (a: string, b: string) => {
    dispatch({ type: 'SET_ADJACENT', payload: { guest1: a, guest2: b } });
  };
  const removeAdjacent = (a: string, b: string) => {
    dispatch({ type: 'REMOVE_ADJACENT', payload: { guest1: a, guest2: b } });
  };

  // ---------- Seat cap guard (non-premium) ----------
  const guardNonPremiumSeatCap = () => {
    if (overNonPremiumSeatCap) {
      alert(`Free/unsigned plan supports up to ${NON_PREMIUM_SEAT_CAP} total seats. Sign in with Premium to exceed this limit.`);
      return true;
    }
    return false;
  };

  // ---------- Click-cycle ----------
  // Free/Unsigned: CLEAR → MUST → CANNOT → CLEAR
  // Premium:       CLEAR → MUST → ADJACENT → CANNOT → CLEAR
  const handleToggleConstraint = (guest1: string, guest2: string) => {
    if (guest1 === guest2) return;

    if (guardNonPremiumSeatCap()) return; // cap guard for non-premium (UI-level)

    const current: ConstraintValue = (state.constraints[guest1]?.[guest2] as ConstraintValue) || '';
    const adjacentNow = isAdjacentPair(guest1, guest2);

    // Non-premium cannot edit adjacency (read-only if loaded)
    if (!isPremium && adjacentNow) {
      alert('Adjacent-pairing is a Premium feature. Sign in with Premium to edit adjacent seating.');
      return;
    }

    if (!isPremium) {
      // 3-state cycle
      if (current === '' && !adjacentNow) setConstraint(guest1, guest2, 'must');
      else if (current === 'must') setConstraint(guest1, guest2, 'cannot');
      else setConstraint(guest1, guest2, '');
      purgePlans();
      return;
    }

    // Premium 4-state cycle
    if (!adjacentNow) {
      if (current === '') {
        setConstraint(guest1, guest2, 'must');
        purgePlans();
        return;
      }
      if (current === 'must') {
        // Enforce cap for both endpoints
        if (getAdjacentCount(guest1) >= MAX_ADJACENTS_PER_GUEST || getAdjacentCount(guest2) >= MAX_ADJACENTS_PER_GUEST) {
          alert(`Each guest can have at most ${MAX_ADJACENTS_PER_GUEST} adjacent-pairings.`);
          return;
        }
        // Closed-loop guard
        const cycleSize = cycleSizeIfEdgeClosesLoop(guest1, guest2);
        if (cycleSize !== null && !hasExactCapacity(cycleSize)) {
          alert(`That adjacent pairing would close a loop of size ${cycleSize}, and no table matches that exact capacity.`);
          return;
        }
        // Upgrade to adjacency: MUST + addAdjacency
        setConstraint(guest1, guest2, 'must');
        addAdjacent(guest1, guest2);
        purgePlans();
        return;
      }
      if (current === 'cannot') {
        setConstraint(guest1, guest2, '');
        purgePlans();
        return;
      }
      // fallback → clear
      setConstraint(guest1, guest2, '');
      purgePlans();
      return;
    }

    // If currently adjacent → move to cannot (remove adjacency first)
    removeAdjacent(guest1, guest2);
    setConstraint(guest1, guest2, 'cannot');
    purgePlans();
  };

  // ---------- Premium name gesture: double‑click / long‑press ----------
  const [selectedGuest, setSelectedGuest] = useState<string | null>(null);
  const longPressTimerRef = useRef<number | null>(null);

  const tryAddAdjacency = (a: string, b: string) => {
    if (!isPremium) {
      alert('Adjacent-pairing is a Premium feature. Sign in with Premium to use adjacent seating.');
      return;
    }
    if (guardNonPremiumSeatCap()) return; // seat cap guard

    // degree cap
    if (getAdjacentCount(a) >= MAX_ADJACENTS_PER_GUEST || getAdjacentCount(b) >= MAX_ADJACENTS_PER_GUEST) {
      alert(`Each guest can have at most ${MAX_ADJACENTS_PER_GUEST} adjacent-pairings.`);
      return;
    }
    // loop guard
    const cycleSize = cycleSizeIfEdgeClosesLoop(a, b);
    if (cycleSize !== null && !hasExactCapacity(cycleSize)) {
      alert(`That adjacent pairing would close a loop of size ${cycleSize}, and no table matches that exact capacity.`);
      return;
    }
    // adjacency implies MUST
    setConstraint(a, b, 'must');
    addAdjacent(a, b);
    purgePlans();
  };

  const pickOrPair = (guestId: string) => {
    if (!isPremium) {
      alert('Adjacent-pairing is a Premium feature. Sign in with Premium to use adjacent seating.');
      return;
    }
    if (!selectedGuest) {
      setSelectedGuest(guestId);
      return;
    }
    if (selectedGuest === guestId) {
      setSelectedGuest(null);
      return;
    }
    tryAddAdjacency(selectedGuest, guestId);
    setSelectedGuest(null);
  };

  const handleNameDoubleClick = (guestId: string) => {
    pickOrPair(guestId);
  };

  const handleNameTouchStart = (guestId: string) => {
    if (longPressTimerRef.current) window.clearTimeout(longPressTimerRef.current);
    longPressTimerRef.current = window.setTimeout(() => pickOrPair(guestId), 500);
  };
  const handleNameTouchEnd = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  // ---------- Group conflict warnings (DSU-based) ----------
  const conflictWarnings = useMemo(() => {
    return detectUnsatisfiableMustGroups({
      guests: (state.guests as Guest[]).reduce((acc, g) => {
        acc[g.id] = { partySize: Math.max(1, g.count ?? 1), name: g.name };
        return acc;
      }, {} as Record<string, { partySize?: number; name?: string }>),
      tables: (state.tables as Table[]).map(t => ({ id: t.id, capacity: (t as any).capacity ?? t.seats })),
      assignments: state.assignments,
      constraints: {
        mustPairs: function* () {
          for (const a of Object.keys(state.constraints || {})) {
            const row = state.constraints[a] || {};
            for (const b of Object.keys(row)) {
              if (row[b] === 'must' && a !== b) yield [a, b] as [string, string];
            }
          }
        }
      }
    });
  }, [state.guests, state.tables, state.assignments, state.constraints]);

  // ---------- Render helpers ----------
  const renderSortControls = () => (
    <div className="flex items-center gap-3">
      <ArrowDownAZ className="text-[#586D78]" />
      <select
        className="border border-[#586D78] rounded-md p-1 text-[#586D78]"
        value={sortOption}
        onChange={e => setSortOption(e.target.value as SortOption)}
      >
        <option value="as-entered">As entered</option>
        <option value="first-name">First name</option>
        <option value="last-name">Last name</option>
        <option value="current-table">Current table</option>
      </select>
      {needsPagination && (
        <div className="ml-4 flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
            className="p-1 rounded border border-[#586D78] hover:bg-indigo-50"
            aria-label="Previous page"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-sm text-[#586D78]">
            Page {currentPage + 1} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
            className="p-1 rounded border border-[#586D78] hover:bg-indigo-50"
            aria-label="Next page"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  const renderInstructions = () => {
    // Non‑premium: double-width demo boxes with black glyphs; Premium: your bracketed text block.
    const Box = ({ label }: { label: 'must' | 'adjacent' | 'cannot' | 'none' }) => (
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className="inline-flex items-center justify-center"
          style={{
            width: '6em', // doubled
            height: '2.25em',
            border: '2px solid #000',
            lineHeight: '2.25em',
            fontSize: '0.9em',
            background: label === 'must' || label === 'adjacent' ? '#22cf04' : label === 'cannot' ? '#e6130b' : 'transparent',
            color: label === 'none' ? 'transparent' : '#000'
          }}
          aria-label={label}
        >
          {label === 'must' && <span className="font-bold">&</span>}
          {label === 'adjacent' && (
            <span className="font-bold">⭐&⭐</span>
          )}
          {label === 'cannot' && <span className="font-bold">X</span>}
        </span>
        <span className="text-[#586D78]">
          {label === 'must' && 'Must sit at the same table'}
          {label === 'adjacent' && 'Must sit beside at the same table'}
          {label === 'cannot' && 'Cannot sit at the same table'}
          {label === 'none' && 'No constraint'}
        </span>
      </div>
    );

    return (
      <Card>
        <div className="flex items-center gap-2 mb-2">
          <Info className="text-[#586D78]" />
          <h2 className="text-lg font-semibold text-[#586D78]">How to use constraints</h2>
        </div>

        {!isPremium ? (
          <div className="text-gray-600 text-sm space-y-3">
            <p className="text-[#586D78]">Click a cell to cycle between constraints:</p>
            <div className="flex flex-wrap gap-4">
              <Box label="must" />
              <Box label="cannot" />
              <Box label="none" />
            </div>
          </div>
        ) : (
          <div className="text-gray-700 text-sm">
            <div className="rounded-md border border-black p-3 bg-white">
              <p className="font-medium">How to use constraints:</p>
              <p className="mt-2 whitespace-pre-wrap">
                {`Click a cell to cycle between constraints:\n[&] Must sit at the same table\t[⭐] Must sit beside at the same table\t[X] Cannot sit at the same table\t[  ] No constraint`}
              </p>
              <p className="mt-2">Each guest may have at most {MAX_ADJACENTS_PER_GUEST} adjacent-pairings.</p>
              {/* (Optional UX copy line if desired later: Premium can also double-click (desktop) or long-press (touch) guest names to create an adjacent pair.) */}
            </div>
          </div>
        )}
      </Card>
    );
  };

  const constraintGrid = useMemo(() => {
    const headerRow = [
      <th
        key="corner"
        className="bg-indigo-50 font-medium p-2 border border-[#586D78] border-2 sticky top-0 left-0 z-30 min-w-[140px]"
      >
        Guest Names
      </th>
    ];

    for (const g of displayGuests) {
      const count = getAdjacentCount(g.id);
      headerRow.push(
        <th
          key={`col-${g.id}`}
          className={`bg-indigo-50 font-medium p-2 border border-[#586D78] border-2 sticky top-0 z-20 ${isPremium ? 'cursor-pointer' : ''}`}
          onDoubleClick={() => handleNameDoubleClick(g.id)}
          onTouchStart={() => handleNameTouchStart(g.id)}
          onTouchEnd={handleNameTouchEnd}
          title={
            count > 0
              ? `Adjacent to: ${(state.adjacents[g.id] || [])
                  .map((id: string) => (state.guests as Guest[]).find(gg => gg.id === id)?.name || id)
                  .join(', ')}`
              : undefined
          }
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate ${selectedGuest === g.id ? 'ring-2 ring-indigo-400 rounded-sm px-1' : ''}`}><FormatGuestName name={g.name} /></span>
            {count > 0 && <span aria-label="Adjacent partners">{count === 1 ? '⭐' : '⭐⭐'}</span>}
          </div>
        </th>
      );
    }

    const rows = [<tr key="header">{headerRow}</tr>];

    for (const g1 of displayGuests) {
      const left = (
        <td
          key={`row-${g1.id}`}
          className={`p-2 font-medium sticky left-0 z-10 min-w-[140px] border border-[#586D78] border-2 bg-indigo-50 text-[#586D78] ${isPremium ? 'cursor-pointer' : ''}`}
          data-name={g1.name}
          onDoubleClick={() => handleNameDoubleClick(g1.id)}
          onTouchStart={() => handleNameTouchStart(g1.id)}
          onTouchEnd={handleNameTouchEnd}
        >
          <div className="flex items-center justify-between gap-2">
            <span className={`truncate ${selectedGuest === g1.id ? 'ring-2 ring-indigo-400 rounded-sm px-1' : ''}`}><FormatGuestName name={g1.name} /></span>
            {getAdjacentCount(g1.id) > 0 && (
              <span title={`Adjacent to: ${(state.adjacents[g1.id] || [])
                .map((id: string) => (state.guests as Guest[]).find(gg => gg.id === id)?.name || id)
                .join(', ')}`}
              >{getAdjacentCount(g1.id) === 1 ? '⭐' : '⭐⭐'}</span>
            )}
          </div>
          <div className="text-xs text-[#586D78] mt-1">{formatTableAssignment(state.assignments, state.tables, g1.id)}</div>
        </td>
      );

      const cells: React.ReactNode[] = [left];

      for (const g2 of displayGuests) {
        if (g1.id === g2.id) {
          cells.push(<td key={`cell-${g1.id}-${g2.id}`} className="p-2 border border-[#586D78] border-2 bg-gray-100" />);
          continue;
        }
        const constraint: ConstraintValue = (state.constraints[g1.id]?.[g2.id] as ConstraintValue) || '';
        const adj = isAdjacentPair(g1.id, g2.id);

        let bg = 'bg-white';
        let content: React.ReactNode = null;
        if (adj) {
          bg = 'bg-[#22cf04]';
          content = (
            <div className="flex items-center justify-center min-w-[44px]">
              <span className="text-black font-bold">[</span>
              <span className="text-black font-bold">⭐</span>
              <span className="text-black font-bold">&</span>
              <span className="text-black font-bold">⭐</span>
              <span className="text-black font-bold">]</span>
            </div>
          );
        } else if (constraint === 'must') {
          bg = 'bg-[#22cf04]';
          content = <span className="text-black font-bold">[&]</span>;
        } else if (constraint === 'cannot') {
          bg = 'bg-[#e6130b]';
          content = <span className="text-black font-bold">[X]</span>;
        }

        cells.push(
          <td
            key={`cell-${g1.id}-${g2.id}`}
            className={`p-2 border border-[#586D78] border-2 ${overNonPremiumSeatCap ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'} transition-colors duration-150 ${bg}`}
            onClick={() => {
              if (overNonPremiumSeatCap) {
                alert(`Free/unsigned plan supports up to ${NON_PREMIUM_SEAT_CAP} total seats. Sign in with Premium to exceed this limit.`);
                return;
              }
              handleToggleConstraint(g1.id, g2.id);
            }}
            title={!isPremium && adj ? 'Adjacent-pairing is a Premium feature. Sign in with Premium to edit adjacent seating.' : undefined}
          >
            <div className="flex items-center justify-center">{content}</div>
          </td>
        );
      }

      rows.push(<tr key={`row-${g1.id}`}>{cells}</tr>);
    }

    return (
      <table className="w-full border-collapse text-sm">
        <tbody>{rows}</tbody>
      </table>
    );
  }, [displayGuests, state.constraints, state.adjacents, isPremium, selectedGuest, overNonPremiumSeatCap, state.assignments, state.tables]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <ClipboardList className="mr-2" />
        Constraints
      </h1>

      {overNonPremiumSeatCap && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-red-700 font-medium">Seat limit reached</p>
          <p className="text-red-600 text-sm">Free/unsigned plan supports up to {NON_PREMIUM_SEAT_CAP} total seats across all guests. Sign in with Premium to exceed this limit.</p>
        </div>
      )}

      {/* DSU group infeasibility warnings */}
      {(() => {
        const warnings = conflictWarnings as unknown as string[];
        return warnings && warnings.length > 0 ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
            <Info className="text-red-500 mr-2 mt-1 flex-shrink-0" />
            <div>
              <p className="text-red-700 font-medium">Constraint Warnings</p>
              <ul className="list-disc pl-5 text-red-600 text-sm">
                {warnings.map((w: string, i: number) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          </div>
        ) : null;
      })()}

      {renderInstructions()}

      <Card>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[#586D78]">Constraint Grid</h2>
          {renderSortControls()}
        </div>
        <div className="mt-3" ref={gridRef}>
          {state.guests.length === 0 ? (
            <p className="text-gray-500 text-center py-4">No guests added yet. Add guests to create constraints.</p>
          ) : (
            <div className="overflow-auto max-h-[60vh] border border-[#586D78] rounded-md relative">
              {constraintGrid}
            </div>
          )}
        </div>
      </Card>

      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default ConstraintManager;
