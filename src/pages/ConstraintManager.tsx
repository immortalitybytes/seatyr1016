// File: src/pages/ConstraintManager.tsx
// Purpose: Constraint grid with ⭐&⭐ for ADJACENT; click cycles CLEAR → & → ⭐&⭐ → X → CLEAR
// Safety: No layout or file-structure changes; only removes "party-size" sort and fixes sort gating per SSoT.

import React, { useMemo, useState } from 'react';
import Card from '../components/Card';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';

// The only allowed sort options per SSoT (party-size removed)
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

function firstNameOf(full: string): string {
  const parts = String(full || '').trim().split(/\s+/);
  return (parts[0] || '').toLowerCase();
}

function lastNameOf(full: string): string {
  const parts = String(full || '').trim().split(/\s+/);
  return (parts.length ? parts[parts.length - 1] : '').toLowerCase();
}

const ConstraintManager: React.FC = () => {
  const { state, dispatch, isPremium } = useApp();

  // D4 SURGICAL EDIT: Per SSoT, Unsigned gets First/Last only; Free & Premium get all four
  // Trial-aware mode: if user is signed in (Free or Premium), show all four sorts
  const allowedSortOptions: SortOption[] = !state.user
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
  }, [guests, sortBy, assignments]);

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

  // D4 SURGICAL EDIT: Single-dispatch atomic cycle handled by reducer (no multi-dispatch here)
  const onCellClick = (a: string, b: string) => {
    if (a === b) return;
    dispatch({ type: 'SET_ADJACENT', payload: { a, b } });
  };

  return (
    <div className="space-y-6">
      <Card title="Your Rules (Constraints)">
        <div className="constraints-grid">
          {/* Sort control — same footprint; only party-size removed */}
          <div className="mb-4 text-sm flex items-center gap-2">
            <span className="font-medium text-gray-700">Sort by:</span>
            <select
              className="border rounded px-3 py-2 border-gray-300 focus:outline-none focus:ring-2 focus:ring-[#586D78]"
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

          {guests.length === 0 ? (
            <p className="text-gray-500 text-center py-8">
              No guests added yet. Add guests to create constraints.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse border border-[#586D78]">
                <thead>
                  <tr>
                    <th className="px-2 py-2 text-left border border-[#586D78] bg-[#dde1e3] sticky left-0 z-10"></th>
                    {ids.map(id => (
                      <th key={id} className="px-2 py-2 text-center border border-[#586D78] bg-[#dde1e3] min-w-[80px]">
                        <FormatGuestName name={nameOf(id)} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ids.map(a => (
                    <tr key={a}>
                      <td className="px-2 py-2 font-semibold border border-[#586D78] bg-[#dde1e3] sticky left-0 z-10">
                        <FormatGuestName name={nameOf(a)} />
                      </td>
                      {ids.map(b => {
                        const content = labelFor(a, b);
                        const isDiagonal = a === b;
                        
                        let cellClass = "px-2 py-3 text-center border border-[#586D78] ";
                        
                        if (isDiagonal) {
                          cellClass += "bg-gray-200 cursor-not-allowed";
                        } else {
                          cellClass += "cursor-pointer select-none transition-colors ";
                          if (content === '⭐&⭐') cellClass += "bg-yellow-100 text-yellow-800 hover:bg-yellow-200 font-bold";
                          else if (content === '&') cellClass += "bg-green-100 text-green-800 hover:bg-green-200 font-bold";
                          else if (content === 'X') cellClass += "bg-red-100 text-red-800 hover:bg-red-200 font-bold";
                          else cellClass += "hover:bg-gray-100";
                        }
                        
                        return (
                          <td
                            key={`${a}::${b}`}
                            className={cellClass}
                            title={
                              isDiagonal
                                ? ''
                                : (content || 'Click to cycle CLEAR → & → ⭐&⭐ → X → CLEAR')
                            }
                            onClick={() => !isDiagonal && onCellClick(a, b)}
                          >
                            {content || (isDiagonal ? '—' : '')}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="mt-4 text-xs text-gray-600 flex items-center gap-1">
            <span className="font-semibold">Legend:</span>
            <span className="px-2 py-1 bg-green-100 text-green-800 rounded">&</span> = Must sit together
            <span className="px-2 py-1 bg-yellow-100 text-yellow-800 rounded">⭐&⭐</span> = Adjacent (side-by-side)
            <span className="px-2 py-1 bg-red-100 text-red-800 rounded">X</span> = Cannot sit together
          </div>
          
          <div className="mt-2 text-xs text-gray-600">
            Click any cell to cycle <strong>CLEAR → & → ⭐&⭐ → X → CLEAR</strong>. Adjacency obeys the degree cap.
          </div>
        </div>
      </Card>

      <SavedSettingsAccordion />
    </div>
  );
};

export default ConstraintManager;