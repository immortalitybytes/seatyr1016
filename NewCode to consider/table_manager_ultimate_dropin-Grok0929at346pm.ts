import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useAppState } from '../context/AppContext';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Plus, Trash2, Edit3, Save, X, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import { isPremiumSubscription } from '../utils/premium';

// Ultimate, feature-maximized, viable TableManager
// - Enforces user-controlled table edits via userSetTables flag
// - Auto-reconciles capacity to guest headcount when user hasn't set tables
// - Purges plans on seat/name changes and assignment deltas
// - Premium-only table renaming; seat edits allowed for all within bounds (1..20)
// - Name uniqueness validation; friendly errors
// - Guards: max 100 tables; seat range 1..20; graceful no-op on invalid
// - Displays friendly notices; preserves previously approved behaviors

const MIN_SEATS = 1;
const MAX_SEATS = 20;
const MAX_TABLES = 100;

const TableManager: React.FC = () => {
  const { state, dispatch } = useAppState();
  const isPremium = isPremiumSubscription(state.subscription);

  // Derive total heads
  const totalHeads = useMemo(
    () => state.guests.reduce((s, g) => s + Math.max(1, g.count ?? 1), 0),
    [state.guests]
  );

  // Debounced plan purge (avoid thrashing)
  const purgeRef = useRef<number | null>(null);
  const purgePlans = () => {
    if (purgeRef.current) window.clearTimeout(purgeRef.current);
    purgeRef.current = window.setTimeout(() => {
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
    }, 150);
  };

  // Auto-reconcile when user has not manually set tables
  useEffect(() => {
    dispatch({ type: 'AUTO_RECONCILE_TABLES' });
    purgePlans();
  }, [totalHeads, state.assignments, dispatch]);

  // Editing state
  const [editingTableId, setEditingTableId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);

  const stopEditing = () => {
    setEditingTableId(null);
    setEditingName('');
    setNameError(null);
  };

  const handleAddTable = () => {
    if (state.tables.length >= MAX_TABLES) {
      alert(`Maximum number of tables (${MAX_TABLES}) reached.`);
      return;
    }
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'ADD_TABLE', payload: {} });
    purgePlans();
  };

  const handleRemoveTable = (id: number) => {
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'REMOVE_TABLE', payload: { id } });
    purgePlans();
  };

  const handleUpdateSeats = (id: number, value: string) => {
    const seats = parseInt(value, 10);
    if (!Number.isFinite(seats)) return;
    if (seats < MIN_SEATS || seats > MAX_SEATS) return;
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'UPDATE_TABLE', payload: { id, seats } });
    purgePlans();
  };

  const handleTableNameDoubleClick = (id: number, currentName?: string | null) => {
    if (!isPremium) return; // premium-gated renaming
    setEditingTableId(id);
    setEditingName(currentName || `Table ${id}`);
    setNameError(null);
  };

  const handleTableNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingName(e.target.value);
    setNameError(null);
  };

  const handleTableNameBlur = () => {
    if (editingTableId === null) return;
    const trimmed = editingName.trim();
    if (!trimmed) { stopEditing(); return; }

    const exists = state.tables.some(t => t.id !== editingTableId && (
      (t.name?.toLowerCase() === trimmed.toLowerCase()) ||
      (!t.name && `Table ${t.id}`.toLowerCase() === trimmed.toLowerCase())
    ));
    if (exists) { setNameError('That name is already in use. Please choose another.'); return; }

    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'UPDATE_TABLE', payload: { id: editingTableId, name: trimmed === `Table ${editingTableId}` ? undefined : trimmed } });
    stopEditing();
    purgePlans();
  };

  // Sorting (stable by id; premium can rename but sorting remains by id here)
  const tables = useMemo(() => [...state.tables].sort((a, b) => a.id - b.id), [state.tables]);

  // Capacity summaries
  const totalCapacity = useMemo(() => tables.reduce((s, t) => s + Math.max(1, t.seats ?? 0), 0), [tables]);
  const capacityDelta = totalCapacity - totalHeads;

  return (
    <div className="space-y-6">
      <Card>
        <div className="p-4 md:p-6 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-semibold">Tables</h2>
            <p className="text-sm text-gray-600">Manage table count, capacity, and names. Names are a premium feature.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button onClick={handleAddTable}>
              <Plus className="w-4 h-4 mr-2" /> Add Table
            </Button>
          </div>
        </div>
      </Card>

      {!state.userSetTables && (
        <Card>
          <div className="p-4 md:p-6 text-sm text-gray-700">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 mt-1" />
              <div>
                <p>
                  We’re auto-matching table capacity to your current guest count. As soon as you edit tables
                  (add/remove, change seats, or rename), auto-reconcile turns off and your settings are preserved.
                </p>
              </div>
            </div>
          </div>
        </Card>
      )}

      <Card>
        <div className="p-4 md:p-6">
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm text-gray-700">
              Total heads: <span className="font-semibold">{totalHeads}</span>
              <span className="mx-2">|</span>
              Total capacity: <span className="font-semibold">{totalCapacity}</span>
              <span className="mx-2">|</span>
              {capacityDelta === 0 ? (
                <span className="text-green-700 font-medium">Perfect fit</span>
              ) : capacityDelta > 0 ? (
                <span className="text-amber-700 font-medium">{capacityDelta} extra seat{capacityDelta === 1 ? '' : 's'}</span>
              ) : (
                <span className="text-red-700 font-medium">{-capacityDelta} seat{capacityDelta === -1 ? '' : 's'} short</span>
              )}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {tables.map((table) => (
              <div key={table.id} className="rounded-2xl border p-4 shadow-sm bg-white">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {editingTableId === table.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={handleTableNameChange}
                          onBlur={handleTableNameBlur}
                          autoFocus
                          className="h-9 w-48"
                        />
                        <Button variant="ghost" size="icon" onClick={handleTableNameBlur} aria-label="Save">
                          <Save className="w-4 h-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={stopEditing} aria-label="Cancel">
                          <X className="w-4 h-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span
                          className={`text-base font-semibold ${isPremium ? 'cursor-text' : 'cursor-default'}`}
                          onDoubleClick={() => handleTableNameDoubleClick(table.id, table.name)}
                          title={isPremium ? 'Double-click to rename (Premium)' : 'Premium feature'}
                        >
                          {table.name ?? `Table ${table.id}`}
                        </span>
                        {nameError && editingTableId === table.id && (
                          <span className="text-xs text-red-600">{nameError}</span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleRemoveTable(table.id)} aria-label="Remove table">
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <label className="text-sm text-gray-700">Seats:</label>
                  <Input
                    type="number"
                    min={MIN_SEATS}
                    max={MAX_SEATS}
                    value={Math.max(MIN_SEATS, Math.min(MAX_SEATS, table.seats ?? 0))}
                    onChange={(e) => handleUpdateSeats(table.id, e.target.value)}
                    className="h-9 w-24"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex items-center justify-end gap-2 text-sm text-gray-600">
            <ChevronDown className="w-4 h-4" />
            <span>Double-click a table name to rename (Premium)</span>
          </div>
        </div>
      </Card>

      {/* Optional performance note when many tables */}
      {tables.length > 60 && (
        <div className="text-xs text-gray-500">Rendering {tables.length} tables. Consider fewer tables for faster updates.</div>
      )}
    </div>
  );
};

export default TableManager;
