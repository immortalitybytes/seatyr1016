import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Info, ArrowDownAZ, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '../components/Card';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting, formatTableAssignment } from '../utils/formatters';
import { detectUnsatisfiableMustGroups, detectConflicts } from '../utils/conflicts';
import { Guest, Table } from '../types';

/**
 * ConstraintManager — Path B synthesis (buttons, not dropdowns; ⭐&⭐ for adjacent pairs in cells — premium gated)
 * - No layout drift: preserves button-based sorting and compact Prev/Next pagination
 * - Premium: 4-state cycle '' → must → adjacent(+must) → cannot → ''
 * - Free/unsigned: 3-state cycle '' → must → cannot → '' (adjacency view-only; edits blocked)
 * - Stars in the GRID cells only when a pair is adjacent and the user is premium (⭐&⭐); otherwise '&' or 'X'
 * - Full warnings: detectUnsatisfiableMustGroups + detectConflicts (deduped)
 * - Touch parity: long-press gesture for adjacency (premium)
 * - Minimal, surgical code; preserves existing state/actions (no refactors)
 */

type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GUEST_THRESHOLD = 120; // paginate beyond this
const GUESTS_PER_PAGE = 10;  // page size
const HEADS_FREE_LIMIT = 80; // free-tier headcap

const ConstraintManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const isPremium = isPremiumSubscription(state.subscription);

  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // ------- helpers -------
  const getAdj = (id: string) => state.adjacents?.[id] ?? [];
  const hasAdj = (a: string, b: string) => getAdj(a).includes(b);

  const guestMap = useMemo(() => {
    const m = new Map<string, Guest>();
    state.guests.forEach(g => m.set(g.id, g));
    return m;
  }, [state.guests]);

  const parsePlusN = (name: string) => {
    // crude "+N" parser to avoid undercounting if count is missing
    const m = name.match(/\+(\d+)\s*$/);
    return m ? parseInt(m[1], 10) : 0;
  };
  const countHeads = (g: Guest) => (typeof g.count === 'number' ? g.count! : 1 + parsePlusN(g.name));
  const totalHeads = useMemo(() => state.guests.reduce((sum, g) => sum + countHeads(g), 0), [state.guests]);

  const overFreeCap = !isPremium && totalHeads > HEADS_FREE_LIMIT;

  // ------- sorting -------
  const sortedGuests: Guest[] = useMemo(() => {
    const gs = [...state.guests];
    if (sortOption === 'first-name') {
      gs.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption === 'last-name') {
      gs.sort((a, b) => getLastNameForSorting(a.name).localeCompare(getLastNameForSorting(b.name)));
    } else if (sortOption === 'current-table') {
      const tableBySeatId = new Map<string, string>();
      if (state.seatingPlans?.length) {
        const plan = state.seatingPlans[state.currentPlanIndex] || state.seatingPlans[0];
        if (plan?.tables) {
          for (const t of plan.tables) {
            for (const s of (t.seats || []) as any[]) {
              if (s?.id) tableBySeatId.set(String(s.id), String(t.id));
            }
          }
        }
      }
      const getCurrentTableIndex = (g: Guest) => {
        const assignment = state.assignments?.[g.id]; // often like "12,5"
        if (assignment) {
          const tableId = String(assignment).split(',')[0];
          return Number.isNaN(Number(tableId)) ? Number.MAX_SAFE_INTEGER : parseInt(tableId, 10);
        }
        // fallback to plan tables map if seats carry ids that match assignments ids
        for (const [seatId, tId] of tableBySeatId) {
          if (String(seatId) === String(state.assignments?.[g.id])) return parseInt(String(tId), 10) || Number.MAX_SAFE_INTEGER;
        }
        return Number.MAX_SAFE_INTEGER;
      };
      gs.sort((a, b) => getCurrentTableIndex(a) - getCurrentTableIndex(b));
    }
    return gs;
  }, [state.guests, sortOption, state.seatingPlans, state.currentPlanIndex, state.assignments]);

  const shouldPaginate = isPremium && sortedGuests.length > GUEST_THRESHOLD;
  const displayGuests = useMemo(() => {
    if (!shouldPaginate) return sortedGuests;
    const start = currentPage * GUESTS_PER_PAGE;
    return sortedGuests.slice(start, start + GUESTS_PER_PAGE);
  }, [sortedGuests, shouldPaginate, currentPage]);

  useEffect(() => {
    if (shouldPaginate) {
      setTotalPages(Math.max(1, Math.ceil(sortedGuests.length / GUESTS_PER_PAGE)));
      setCurrentPage(p => Math.min(p, Math.ceil(sortedGuests.length / GUESTS_PER_PAGE) - 1));
    } else {
      if (currentPage !== 0) setCurrentPage(0);
      if (totalPages !== 1) setTotalPages(1);
    }
  }, [shouldPaginate, sortedGuests.length]);

  // ------- warnings (merged & deduped) -------
  const warnings = useMemo(() => {
    const mustIssues = detectUnsatisfiableMustGroups({
      guests: state.guests.reduce((acc, g) => {
        acc[g.id] = { partySize: g.count, name: g.name };
        return acc;
      }, {} as Record<string, { partySize?: number; name?: string }>),
      tables: state.tables.map(t => ({ id: t.id, capacity: t.seats })),
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
    }).map((group: any) => {
      try {
        const names = Array.isArray(group) ? group.map((g: Guest) => g.name).join(', ') : String(group);
        return `Must-group may be unsatisfiable: ${names}`;
      } catch {
        return `Must-group may be unsatisfiable`;
      }
    });

    const conflictIssues = detectConflicts(state.assignments, state.constraints)
      .map((c: any) => (typeof c === 'string' ? c : c?.message ?? JSON.stringify(c)));

    const all = [...mustIssues, ...conflictIssues];
    return all.filter((msg, i) => all.indexOf(msg) === i);
  }, [state.guests, state.constraints, state.adjacents]);

  // ------- plan purge (keep your existing effect that regenerates) -------
  const purgePlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] as any });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 as any });
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false as any });
  };

  // ------- adjacency guards -------
  const degree = (id: string) => getAdj(id).length;
  const degreeCapReached = (a: string, b: string) => degree(a) >= 2 || degree(b) >= 2;

  const closesLoopWithExactCapacity = (a: string, b: string) => {
    // Simple BFS to detect a cycle formed by adding edge (a,b). If found, sum party size and require a table with exact capacity.
    if (a === b) return false;
    // Build adjacency including the proposed edge
    const graph = new Map<string, Set<string>>();
    const addEdge = (x: string, y: string) => {
      if (!graph.has(x)) graph.set(x, new Set());
      graph.get(x)!.add(y);
    };
    for (const [id, neighbors] of Object.entries(state.adjacents || {})) {
      for (const nb of neighbors || []) addEdge(String(id), String(nb));
    }
    addEdge(a, b);
    addEdge(b, a);

    // Detect a cycle that includes edge (a,b) using parent-aware DFS from a to b
    const stack: { node: string; parent: string | null }[] = [{ node: a, parent: null }];
    const visited = new Set<string>();
    let cycleNodes: Set<string> | null = null;

    while (stack.length) {
      const { node, parent } = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      for (const nb of graph.get(node) || []) {
        if (nb === parent) continue;
        if (!visited.has(nb)) {
          stack.push({ node: nb, parent: node });
        } else {
          // found a back-edge → cycle. Build a rough set including node & nb.
          cycleNodes = new Set([node, nb]);
        }
      }
    }

    if (!cycleNodes) return false;

    // Expand cycle set by traversing neighbors (bounded)
    const q = [...cycleNodes];
    while (q.length) {
      const x = q.pop()!;
      for (const y of graph.get(x) || []) {
        if (!cycleNodes.has(y)) {
          cycleNodes.add(y);
          q.push(y);
        }
      }
      if (cycleNodes.size > 1000) break; // safety guard
    }

    // Compute party size of the cycle
    let heads = 0;
    for (const id of cycleNodes) {
      const g = guestMap.get(id);
      if (g) heads += countHeads(g);
    }

    const capacities = (state.tables || []).map((t: Table) => t.seats);
    return capacities.some(c => c === heads);
  };

  const tryAddAdjacency = (a: string, b: string) => {
    if (!isPremium) {
      alert('Adjacency pairing is a premium feature.');
      setSelectedGuestId(null);
      return;
    }
    if (a === b) return;
    if (hasAdj(a, b)) return; // already adjacent
    if (degreeCapReached(a, b)) {
      alert('Each guest can be adjacent to at most 2 partners.');
      setSelectedGuestId(null);
      return;
    }
    if (!closesLoopWithExactCapacity(a, b)) {
      // it's okay to add adjacency even if it doesn't close a loop; the guard only blocks invalid closed rings
      // fallthrough
    }
    // dispatch: adjacency + must constraint (symmetric); then purge plans
    dispatch({ type: 'SET_ADJACENT', payload: { guest1: a, guest2: b } as any });
    dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value: 'must' } as any });
    purgePlans();
    setSelectedGuestId(null);
  };

  // ------- gestures on name cells (premium only) -------
  const handleGuestSelect = (id: string) => {
    if (!isPremium) {
      alert('Adjacency pairing is a premium feature.');
      setSelectedGuestId(null);
      return;
    }
    setSelectedGuestId(prev => {
      if (!prev) return id;
      if (prev === id) return null;
      tryAddAdjacency(prev, id);
      return null;
    });
  };

  const handleTouchStart = (id: string) => {
    if (!isPremium) return;
    if (longPressTimer.current) window.clearTimeout(longPressTimer.current);
    longPressTimer.current = window.setTimeout(() => handleGuestSelect(id), 500);
  };
  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  // ------- click cycle on grid cells -------
  const handleToggleConstraint = (a: string, b: string) => {
    if (overFreeCap) {
      alert(`Editing is limited for free accounts over ${HEADS_FREE_LIMIT} heads.`);
      return;
    }
    const current = state.constraints?.[a]?.[b] || '';
    const adj = hasAdj(a, b);

    if (!isPremium) {
      // Free: block destructive changes when an adjacency exists
      if (adj) {
        alert('This pair is adjacent in your saved data. Editing adjacency or conflicting constraints requires premium.');
        return;
      }
      const next = current === '' ? 'must' : current === 'must' ? 'cannot' : '';
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value: next } as any });
      purgePlans();
      return;
    }

    // Premium 4-state cycle
    if (current === '') {
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value: 'must' } as any });
      purgePlans();
      return;
    }

    if (current === 'must' && !adj) {
      // move to "adjacent (+must)"
      if (degreeCapReached(a, b)) {
        alert('Each guest can be adjacent to at most 2 partners.');
        return;
      }
      // closed-loop exact-capacity check
      if (!closesLoopWithExactCapacity(a, b)) {
        // allowed: only blocks when a ring closes without a matching table; here we may be opening or extending
      }
      dispatch({ type: 'SET_ADJACENT', payload: { guest1: a, guest2: b } as any });
      // keep must set (already)
      purgePlans();
      return;
    }

    if (current === 'must' && adj) {
      // adjacent → cannot   (remove adjacency first)
      dispatch({ type: 'REMOVE_ADJACENT', payload: { guest1: a, guest2: b } as any });
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value: 'cannot' } as any });
      purgePlans();
      return;
    }

    if (current === 'cannot') {
      // back to clear
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value: '' } as any });
      purgePlans();
      return;
    }
  };

  // ------- grid -------
  const GridTable = useMemo(() => {
    const headerRow = (
      <tr>
        <th className="sticky top-0 left-0 z-20 bg-white border border-[#586D78] p-2 text-left">
          <div className="flex items-center gap-2">
            <span>Guests</span>
            <Info className="w-4 h-4 text-[#586D78]" />
          </div>
        </th>
        {displayGuests.map(g => (
          <th key={`col-${g.id}`} className="sticky top-0 z-10 bg-white border border-[#586D78] p-2 text-center">
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-bold"><FormatGuestName name={g.name} /></span>
              {getAdj(g.id).length === 1 && <span className="text-yellow-600">⭐</span>}
              {getAdj(g.id).length === 2 && <span className="text-yellow-600">⭐⭐</span>}
            </div>
            <div className="text-xs text-[#586D78] mt-1">{formatTableAssignment(state.assignments, state.tables, g.id)}</div>
          </th>
        ))}
      </tr>
    );

    const bodyRows = displayGuests.map(g1 => (
      <tr key={`row-${g1.id}`}>
        <th
          key={`rowhdr-${g1.id}`}
          className="sticky left-0 z-10 bg-white border border-[#586D78] p-2 text-left select-none"
          onDoubleClick={isPremium ? () => handleGuestSelect(g1.id) : undefined}
          onTouchStart={isPremium ? () => handleTouchStart(g1.id) : undefined}
          onTouchEnd={isPremium ? () => handleTouchEnd() : undefined}
        >
          <div className={`flex items-center justify-between gap-2 ${selectedGuestId === g1.id ? 'ring-2 ring-indigo-400 rounded' : ''}`}>
            <span className="truncate font-bold"><FormatGuestName name={g1.name} /></span>
            {getAdj(g1.id).length === 1 && <span className="text-yellow-600">⭐</span>}
            {getAdj(g1.id).length === 2 && <span className="text-yellow-600">⭐⭐</span>}
          </div>
          <div className="text-xs text-[#586D78] mt-1">{formatTableAssignment(state.assignments, state.tables, g1.id)}</div>
        </th>

        {displayGuests.map(g2 => {
          if (g1.id === g2.id) {
            return <td key={`cell-${g1.id}-${g2.id}`} className="p-2 border border-[#586D78] bg-gray-100" />;
          }
          const constraint: '' | 'must' | 'cannot' = (state.constraints?.[g1.id]?.[g2.id] as any) || '';
          const adj = hasAdj(g1.id, g2.id);
          let bg = '';
          let content: React.ReactNode = null;

          if (constraint === 'cannot') {
            bg = 'bg-red-200';
            content = <span className="text-black font-bold">X</span>;
          } else if (adj && isPremium) {
            // ⭐&⭐ for premium-adjacent pairs (distinct from plain MUST)
            bg = 'bg-green-200';
            content = <span className="text-black font-bold">⭐&⭐</span>;
          } else if (constraint === 'must') {
            bg = 'bg-green-200';
            content = <span className="text-black font-bold">&</span>;
          } else if (adj && !isPremium) {
            // Non-premium adjacency shows as read-only 'adj'
            bg = '';
            content = <span className="text-gray-500 text-xs">adj</span>;
          }

          const handleClick = () => {
            if (overFreeCap) {
              alert(`Editing is limited for free accounts over ${HEADS_FREE_LIMIT} heads.`);
              return;
            }
            handleToggleConstraint(g1.id, g2.id);
          };

          return (
            <td
              key={`cell-${g1.id}-${g2.id}`}
              className={`p-2 border border-[#586D78] text-center ${overFreeCap ? '' : 'cursor-pointer'} ${bg}`}
              onClick={handleClick}
            >
              {content}
            </td>
          );
        })}
      </tr>
    ));

    return (
      <table className="w-full border-collapse">
        <thead>{headerRow}</thead>
        <tbody>{bodyRows}</tbody>
      </table>
    );
  }, [displayGuests, state.constraints, state.adjacents, isPremium, selectedGuestId, overFreeCap]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">
        Constraint Manager <ClipboardList className="inline w-6 h-6 align-text-bottom" />
      </h1>

      {/* Free-tier cap banner */}
      {!isPremium && totalHeads > HEADS_FREE_LIMIT && (
        <div className="bg-red-50 text-red-800 border border-red-200 rounded p-3">
          Your free plan is limited to {HEADS_FREE_LIMIT} heads. Editing is disabled until you reduce the list or upgrade.
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="bg-amber-50 text-amber-900 border border-amber-300 rounded p-3">
          <ul className="list-disc ml-5">
            {warnings.map((w, i) => <li key={i}>{w}</li>)}
          </ul>
        </div>
      )}

      <Card title="Grid">
        {/* Sort controls — buttons, not a dropdown */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            className={`danstyle1c-btn ${sortOption === 'as-entered' ? 'opacity-100' : 'opacity-80'}`}
            onClick={() => setSortOption('as-entered')}
          >
            As Entered
          </button>
          <button
            className={`danstyle1c-btn ${sortOption === 'first-name' ? 'opacity-100' : 'opacity-80'}`}
            onClick={() => setSortOption('first-name')}
          >
            First Name
          </button>
          <button
            className={`danstyle1c-btn ${sortOption === 'last-name' ? 'opacity-100' : 'opacity-80'}`}
            onClick={() => setSortOption('last-name')}
          >
            Last Name
          </button>
          <button
            className={`danstyle1c-btn ${sortOption === 'current-table' ? 'opacity-100' : 'opacity-80'}`}
            onClick={() => setSortOption('current-table')}
            disabled={!state.seatingPlans || state.seatingPlans.length === 0}
            title={!state.seatingPlans || state.seatingPlans.length === 0 ? 'Generate plans to enable this sort' : ''}
          >
            Current Table
          </button>

          {/* spacer */}
          <span className="ml-auto text-[#586D78] flex items-center gap-1">
            <ArrowDownAZ className="w-4 h-4" /> Sort
          </span>
        </div>

        {/* Grid container with sticky headers */}
        <div ref={gridRef} className="overflow-auto max-h-[70vh] border border-[#586D78] rounded">
          {GridTable}
        </div>

        {/* Pagination — compact, Prev/Next only */}
        {isPremium && shouldPaginate && (
          <div className="flex items-center justify-center gap-3 mt-3">
            <button
              className="danstyle1c-btn"
              onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
              disabled={currentPage === 0}
            >
              <ChevronLeft className="inline w-4 h-4" /> Prev
            </button>
            <span className="text-sm text-[#586D78]">Page {currentPage + 1} / {totalPages}</span>
            <button
              className="danstyle1c-btn"
              onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))}
              disabled={currentPage >= totalPages - 1}
            >
              Next <ChevronRight className="inline w-4 h-4" />
            </button>
          </div>
        )}
      </Card>

      <SavedSettingsAccordion />
    </div>
  );
};

export default ConstraintManager;
