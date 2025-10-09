import React, { useMemo, useState } from 'react';
import { useApp } from '../context/AppContext';
import { deriveMode, type Mode } from '../utils/premium';

// The only allowed sort options per SSoT
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

function firstNameOf(full: string): string {
  const parts = String(full || '').trim().split(/\s+/);
  return (parts[0] || '').toLowerCase();
}

function lastNameOf(full: string): string {
  const parts = String(full || '').trim().split(/\s+/);
  return (parts.length ? parts[parts.length - 1] : '').toLowerCase();
}

export default function ConstraintManager() {
  const { state, dispatch } = useApp();

  // Trial-aware mode (Unsigned vs Free vs Premium)
  const userId = state.user?.id ?? null;
  const mode: Mode = useMemo(
    () => deriveMode(userId, state.subscription, state.trial),
    [userId, state.subscription, state.trial]
  );

  // Per SSoT: Unsigned gets First/Last only; Free & Premium get all four
  const allowedSortOptions: SortOption[] =
    mode === 'unsigned'
      ? ['first-name', 'last-name']
      : ['as-entered', 'first-name', 'last-name', 'current-table'];

  const [sortBy, setSortBy] = useState<SortOption>(
    allowedSortOptions.includes('as-entered') ? 'as-entered' : 'first-name'
  );

  const guests = state.guests || [];
  const assignments = state.assignments || {};
  const tables = state.tables || [];

  // Helper: resolve the first assigned table id (from CSV) for display/sort
  const firstAssignedTableId = (guestId: string): number | null => {
    const raw = assignments[guestId];
    if (!raw) return null;
    const token = String(raw).split(',').map(s => s.trim()).filter(Boolean)[0];
    if (!token) return null;
    const n = Number(token);
    return Number.isFinite(n) ? n : null;
  };

  const nameOf = (id: string) => guests.find(g => g.id === id)?.name || id;

  // Build the sorted list of guest IDs according to the chosen sort
  const ids: string[] = useMemo(() => {
    const base = [...guests.map(g => g.id)];
    switch (sortBy) {
      case 'first-name':
        return base.sort((a, b) =>
          firstNameOf(nameOf(a)).localeCompare(firstNameOf(nameOf(b)))
        );
      case 'last-name':
        return base.sort((a, b) =>
          lastNameOf(nameOf(a)).localeCompare(lastNameOf(nameOf(b)))
        );
      case 'current-table':
        return base.sort((a, b) => {
          const ta = firstAssignedTableId(a);
          const tb = firstAssignedTableId(b);
          if (ta == null && tb == null) return nameOf(a).localeCompare(nameOf(b));
          if (ta == null) return 1;
          if (tb == null) return -1;
          if (ta !== tb) return ta - tb;
          return nameOf(a).localeCompare(nameOf(b));
        });
      case 'as-entered':
      default:
        return base; // keep original order
    }
  }, [guests, sortBy]);

  // Grid state helpers
  const isAdjacent = (a: string, b: string) => (state.adjacents[a] || []).includes(b);
  const isMust = (a: string, b: string) => (state.constraints.must?.[a] || []).includes(b);
  const isCannot = (a: string, b: string) => (state.constraints.cannot?.[a] || []).includes(b);

  const labelFor = (a: string, b: string) => {
    if (a === b) return '';
    if (isAdjacent(a, b)) return '⭐&⭐';
    if (isMust(a, b)) return '&';
    if (isCannot(a, b)) return 'X';
    return '';
  };

  // Single-dispatch atomic cycle handled by reducer (no multi-dispatch here)
  // SURGICAL TASK 3: Cell click dispatches CYCLE_CONSTRAINT
  const onCellClick = (a: string, b: string) => {
    if (a === b) return;
    dispatch({ type: 'CYCLE_CONSTRAINT', payload: { a, b } });
  };

  // SURGICAL TASK 3: Premium-only double-click accelerator jumps to ADJACENT
  const onCellDoubleClick = (a: string, b: string) => {
    if (a === b) return;
    if (mode === 'premium') {
      dispatch({ type: 'CYCLE_CONSTRAINT', payload: { a, b, force: 'adjacent' } });
    }
  };

  return (
    <div className="constraints-grid">
      {/* Sort control — same footprint; only party-size removed */}
      <div className="mb-2 text-sm flex items-center gap-2">
        <span className="opacity-70">Sort:</span>
        <select
          className="border rounded px-2 py-1"
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as SortOption)}
        >
          {allowedSortOptions.map(opt => (
            <option key={opt} value={opt}>
              {opt === 'as-entered' ? 'As Entered'
                : opt === 'first-name' ? 'First Name'
                : opt === 'last-name' ? 'Last Name'
                : 'By Table'}
            </option>
          ))}
        </select>
      </div>

      <table className="w-full text-sm border-collapse">
        <thead>
          <tr>
            <th className="px-2 py-1 text-left"></th>
            {ids.map(id => (
              <th key={id} className="px-2 py-1 text-left">{nameOf(id)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ids.map(a => (
            <tr key={a}>
              <td className="px-2 py-1 font-semibold">{nameOf(a)}</td>
              {ids.map(b => (
                <td
                  key={`${a}::${b}`}
                  className="px-2 py-1 text-center cursor-pointer select-none"
                  title={
                    a === b
                      ? ''
                      : (labelFor(a, b) || 'Click to cycle CLEAR → & → ⭐&⭐ → X → CLEAR')
                  }
                  onClick={() => onCellClick(a, b)}
                  onDoubleClick={() => onCellDoubleClick(a, b)}
                >
                  {labelFor(a, b)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>

      <div className="mt-2 text-xs opacity-80">
        Click any cell to cycle <strong>CLEAR → & → ⭐&⭐ → X → CLEAR</strong>. Adjacency obeys the degree cap.
      </div>
    </div>
  );
}
