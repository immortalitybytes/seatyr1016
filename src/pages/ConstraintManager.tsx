import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, ArrowDownAZ, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '../components/Card';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { getLastNameForSorting, formatTableAssignment } from '../utils/formatters';
import { detectUnsatisfiableMustGroups, detectConflicts } from '../utils/conflicts';

type Guest = { id: string; name: string; count?: number };
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GUEST_THRESHOLD = 120;
const GUESTS_PER_PAGE = 10;
const HEADS_FREE_LIMIT = 80;

const ConstraintManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const isPremium = !!state.user && isPremiumSubscription(state.subscription);

  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedGuestId, setSelectedGuestId] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const longPressTimer = useRef<number | null>(null);

  // Helpers
  const getAdj = (id: string) => state.adjacents?.[id] ?? [];
  const hasAdj = (a: string, b: string) => getAdj(a).includes(b) || getAdj(b).includes(a);
  const guestMap = useMemo(() => {
    const m = new Map<string, Guest>();
    state.guests.forEach(g => m.set(g.id, g));
    return m;
  }, [state.guests]);
  const countHeads = (g: Guest) => {
    if (typeof g.count === 'number') return g.count;
    const match = g.name.match(/\+(\d+)\s*$/);
    return 1 + (match ? parseInt(match[1], 10) : 0);
  };
  const totalHeads = useMemo(() => state.guests.reduce((sum, g) => sum + countHeads(g), 0), [state.guests]);
  const overFreeCap = !isPremium && totalHeads > HEADS_FREE_LIMIT;

  // Sorting
  const sortedGuests: Guest[] = useMemo(() => {
    const gs = [...state.guests];
    if (sortOption === 'first-name') {
      gs.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption === 'last-name') {
      gs.sort((a, b) => getLastNameForSorting(a.name).localeCompare(getLastNameForSorting(b.name)));
    } else if (sortOption === 'current-table') {
      const getCurrentTableIndex = (g: Guest) => {
        const assignment = state.assignments?.[g.id];
        if (assignment) {
          const tableId = String(assignment).split(',')[0];
          return Number.isNaN(Number(tableId)) ? Number.MAX_SAFE_INTEGER : parseInt(tableId, 10);
        }
        return Number.MAX_SAFE_INTEGER;
      };
      gs.sort((a, b) => getCurrentTableIndex(a) - getCurrentTableIndex(b));
    }
    return gs;
  }, [state.guests, sortOption, state.assignments]);

  const shouldPaginate = isPremium && sortedGuests.length > GUEST_THRESHOLD;
  const displayGuests = useMemo(() => {
    if (!shouldPaginate) return sortedGuests;
    const start = currentPage * GUESTS_PER_PAGE;
    return sortedGuests.slice(start, start + GUESTS_PER_PAGE);
  }, [sortedGuests, shouldPaginate, currentPage]);

  useEffect(() => {
    if (shouldPaginate) {
      const pages = Math.max(1, Math.ceil(sortedGuests.length / GUESTS_PER_PAGE));
      setTotalPages(pages);
      setCurrentPage(p => Math.min(p, pages - 1));
    } else {
      setCurrentPage(0);
      setTotalPages(1);
    }
  }, [shouldPaginate, sortedGuests.length]);

  // Warnings - merged and deduped with case-insensitive comparison
  const warnings = useMemo(() => {
    const mustIssues = Array.from(detectUnsatisfiableMustGroups({
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
    }) || []).map((group: any) => {
      try {
        const names = Array.isArray(group) ? group.map((g: Guest) => g.name).join(', ') : String(group);
        return `Must-group may be unsatisfiable: ${names}`;
      } catch {
        return `Must-group may be unsatisfiable`;
      }
    }).map(m => m.toLowerCase());

    const conflictIssues = (detectConflicts(state.assignments, state.constraints) || [])
      .map((c: any) => (typeof c === 'string' ? c : c?.message ?? JSON.stringify(c))).map(msg => msg.toLowerCase());

    const all = [...mustIssues, ...conflictIssues];
    return all.filter((msg, i) => all.indexOf(msg) === i);
  }, [state.guests, state.constraints, state.adjacents]);

  // Plan purge (non-destructive)
  const purgePlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] as any });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 as any });
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false as any });
  };

  // Adjacency guards
  const degree = (id: string) => getAdj(id).length;
  const degreeCapReached = (a: string, b: string) => degree(a) >= 2 || degree(b) >= 2;

  // BFS to detect if adding edge closes a ring and compute its size
  const wouldCloseRing = (a: string, b: string): { closes: boolean; ringSize: number; ringMembers: string[] } => {
    if (hasAdj(a, b)) return { closes: false, ringSize: 0, ringMembers: [] }; // already adjacent

    const graph = Object.entries(state.adjacents ?? {}).reduce((g, [k, vs]) => {
      g[k] = vs;
      vs.forEach(v => {
        if (!g[v]) g[v] = [];
        if (!g[v].includes(k)) g[v].push(k); // force symmetric
      });
      return g;
    }, {} as Record<string, string[]>);

    // BFS from a to find path to b without direct edge
    const queue: { node: string; path: string[] }[] = [{ node: a, path: [a] }];
    const visited = new Set<string>([a]);
    while (queue.length) {
      const { node, path } = queue.shift()!;
      for (const neighbor of graph[node] ?? []) {
        if (neighbor === b && path.length > 1) { // found path >1 (closes ring)
          return { closes: true, ringSize: path.length + 1, ringMembers: [...path, b] }; // +1 for closing
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ node: neighbor, path: [...path, neighbor] });
        }
      }
    }
    return { closes: false, ringSize: 0, ringMembers: [] };
  };

  // Compute total party size of a component (ring or chain)
  const componentPartySize = (members: string[]) => {
    return members.reduce((sum, id) => sum + countHeads(guestMap.get(id)!), 0);
  };

  // Check if component size matches a table capacity (lock-aware)
  const matchesTableCapacity = (size: number, members: string[]) => {
    const capacities = new Set(state.tables.map(t => t.seats));
    const lockedTable = members.find(m => {
      const assign = state.assignments?.[m];
      return assign && !isNaN(parseInt(assign.split(',')[0]));
    });
    if (lockedTable) {
      const tableId = parseInt(state.assignments![lockedTable].split(',')[0]);
      const table = state.tables.find(t => t.id === tableId);
      return table ? size === table.seats : false;
    }
    return capacities.has(size);
  };

  // Gesture handlers (premium)
  const handleTouchStart = (id: string) => {
    if (!isPremium) return;
    longPressTimer.current = window.setTimeout(() => {
      handleGuestSelect(id);
    }, 500);
  };

  const handleTouchEnd = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handleGuestSelect = (id: string) => {
    if (selectedGuestId === null) {
      setSelectedGuestId(id);
      return;
    }
    if (selectedGuestId === id) {
      setSelectedGuestId(null);
      return;
    }
    // Attempt to add adjacency
    const a = selectedGuestId;
    const b = id;
    if (degreeCapReached(a, b)) {
      alert("A guest can have at most 2 adjacencies.");
      setSelectedGuestId(null);
      return;
    }
    const { closes, ringMembers } = wouldCloseRing(a, b);
    if (closes) {
      const partySize = componentPartySize(ringMembers);
      if (!matchesTableCapacity(partySize, ringMembers)) {
        alert(`Adjacency would create a ring of ${partySize} heads, which doesn't match any table capacity (considering locks).`);
        setSelectedGuestId(null);
        return;
      }
    }
    // Ensure 'must' is set
    const currentConstraint = (state.constraints?.[a]?.[b] as any) || '';
    if (currentConstraint !== 'must') {
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: a, guest2: b, value: 'must' as any } });
    }
    dispatch({ type: 'SET_ADJACENT', payload: { guest1: a, guest2: b } });
    setSelectedGuestId(null);
    purgePlans(); // non-destructive reset
  };

  // Cell toggle (with guards)
  const handleToggleConstraint = (g1: string, g2: string) => {
    if (overFreeCap) {
      alert(`Editing is limited for free accounts over ${HEADS_FREE_LIMIT} heads.`);
      return;
    }
    if (g1 > g2) [g1, g2] = [g2, g1]; // normalize order
    const constraint: '' | 'must' | 'cannot' = (state.constraints?.[g1]?.[g2] as any) || '';
    const adj = hasAdj(g1, g2);
    let next: '' | 'must' | 'cannot' = constraint;

    if (!isPremium) {
      // Non-premium: block all edits if adj (strict view-only)
      if (adj) {
        alert("Cannot edit constraint for adjacent pair; upgrade to premium.");
        return;
      }
      next = constraint === '' ? 'must' : constraint === 'must' ? 'cannot' : '';
    } else {
      // Premium
      if (constraint === '') {
        next = 'must';
      } else if (constraint === 'must') {
        if (adj) {
          // Cycle to 'cannot' and remove adj
          dispatch({ type: 'REMOVE_ADJACENT', payload: { guest1: g1, guest2: g2 } });
          next = 'cannot';
        } else {
          // Attempt to add adj (stay 'must')
          if (degreeCapReached(g1, g2)) {
            alert("A guest can have at most 2 adjacencies.");
            return;
          }
          const { closes, ringMembers } = wouldCloseRing(g1, g2);
          if (closes) {
            const partySize = componentPartySize(ringMembers);
            if (!matchesTableCapacity(partySize, ringMembers)) {
              alert(`Adjacency would create a ring of ${partySize} heads, which doesn't match any table capacity (considering locks).`);
              return;
            }
          }
          dispatch({ type: 'SET_ADJACENT', payload: { guest1: g1, guest2: g2 } });
          next = 'must'; // stay
        }
      } else if (constraint === 'cannot') {
        if (adj) dispatch({ type: 'REMOVE_ADJACENT', payload: { guest1: g1, guest2: g2 } });
        next = '';
      }
    }

    if (next !== constraint) {
      dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: g1, guest2: g2, value: next as any } });
    }
    purgePlans(); // non-destructive
  };

  // Grid table (memoized)
  const GridTable = useMemo(() => {
    const headerRow = (
      <tr>
        <th className="sticky top-0 left-0 z-20 bg-white border border-[#586D78] p-2 text-left" />
        {displayGuests.map(g => (
          <th
            key={`colhdr-${g.id}`}
            className="sticky top-0 z-10 bg-white border border-[#586D78] p-2 text-center"
            onDoubleClick={isPremium ? () => handleGuestSelect(g.id) : undefined}
            onTouchStart={isPremium ? () => handleTouchStart(g.id) : undefined}
            onTouchEnd={isPremium ? () => handleTouchEnd() : undefined}
          >
            <div className={`flex items-center justify-between gap-2 ${selectedGuestId === g.id ? 'ring-2 ring-indigo-400 rounded' : ''}`}>
              <span className="truncate font-normal"><FormatGuestName name={g.name} /></span>
              {getAdj(g.id).length === 1 && <span className="text-yellow-600">⭐</span>}
              {getAdj(g.id).length === 2 && <span className="text-yellow-600">⭐⭐</span>}
            </div>
            <div className="text-xs text-[#586D78] mt-1 font-normal">{formatTableAssignment(state.assignments, state.tables, g.id)}</div>
          </th>
        ))}
      </tr>
    );

    const bodyRows = sortedGuests.map(g1 => (
      <tr key={`row-${g1.id}`}>
        <th
          key={`rowhdr-${g1.id}`}
          className="sticky left-0 z-10 bg-white border border-[#586D78] p-2 text-left select-none"
          onDoubleClick={isPremium ? () => handleGuestSelect(g1.id) : undefined}
          onTouchStart={isPremium ? () => handleTouchStart(g1.id) : undefined}
          onTouchEnd={isPremium ? () => handleTouchEnd() : undefined}
        >
          <div className={`flex items-center justify-between gap-2 ${selectedGuestId === g1.id ? 'ring-2 ring-indigo-400 rounded' : ''}`}>
            <span className="truncate font-normal"><FormatGuestName name={g1.name} /></span>
            {getAdj(g1.id).length === 1 && <span className="text-yellow-600">⭐</span>}
            {getAdj(g1.id).length === 2 && <span className="text-yellow-600">⭐⭐</span>}
          </div>
          <div className="text-xs text-[#586D78] mt-1 font-normal">{formatTableAssignment(state.assignments, state.tables, g1.id)}</div>
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
            bg = 'bg-green-200';
            content = <span className="text-black font-bold">&</span>;
          } else if (constraint === 'must') {
            bg = 'bg-green-200';
            content = <span className="text-black font-bold">&</span>;
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
  }, [sortedGuests, displayGuests, state.constraints, state.adjacents, isPremium, selectedGuestId, overFreeCap]);

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
        {/* Sort controls - buttons */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-[#586D78] flex items-center gap-1">
            <ArrowDownAZ className="w-4 h-4" /> Sort
          </span>
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
        </div>

        {/* Grid container with sticky headers */}
        <div ref={gridRef} className="overflow-auto max-h-[70vh] border border-[#586D78] rounded">
          {GridTable}
        </div>

        {/* Pagination - compact, Prev/Next only */}
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