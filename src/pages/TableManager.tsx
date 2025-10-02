import React, { useState, useEffect, useMemo } from 'react';
import { Table as TableIcon, Plus, Trash2, Edit2, Crown, AlertCircle, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import Card from '../components/Card';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { getLastNameForSorting } from '../utils/formatters';
import { normalizeAssignmentInputToIdsWithWarnings } from '../utils/assignments';

const useDebounce = (value: string, delay: number): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// ConstraintChipsInput component for autocomplete functionality
type ChipTone = 'must' | 'cannot';
const ConstraintChipsInput: React.FC<{
  tone: ChipTone;
  ownerName: string;
  value: string[];
  onChange: (names: string[]) => void;
  allGuests: { name: string; count: number }[];
  activeFieldKey: string | null;
  setActiveFieldKey: (key: string | null) => void;
}> = ({ tone, ownerName, value, onChange, allGuests, activeFieldKey, setActiveFieldKey }) => {
  const inputKey = `${tone}:${ownerName}`;
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const debouncedQuery = useDebounce(query, 300);

  const suggestions = useMemo(() => {
    const raw = debouncedQuery.trim().toLowerCase();
    if (!raw) return [];
    const ignore = /(?:\b(?:and|plus|with|guest|guests?)\b|[&+]|[0-9]+)/gi;
    const norm = (s: string) => s.toLowerCase().replace(ignore, '').replace(/\s+/g, ' ').trim();
    return allGuests
      .map(g => g.name)
      .filter(n => norm(n).includes(raw) && !value.includes(n) && n !== ownerName)
      .slice(0, 8);
  }, [debouncedQuery, value, ownerName, allGuests]);

  const addChip = (name: string) => {
    const trimmedName = name.trim();
    if (trimmedName && !value.includes(trimmedName)) {
      onChange([...value, trimmedName]);
    }
    setQuery('');
    setActiveIndex(-1);
  };

  const removeChip = (name: string) => {
    onChange(value.filter(v => v !== name));
  };

  const chipClass = tone === 'must' ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200';

  return (
    <div className="relative">
      <div className="mb-1">
        {value.map(v => (
          <span
            key={v}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-sm mr-1 mb-1 ${chipClass} border`}
          >
            {v}
            <button
              type="button"
              className="ml-1 text-xs hover:text-red-600"
              onClick={() => removeChip(v)}
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      <input
        value={query}
        onChange={e => {
          setQuery(e.target.value);
          setActiveIndex(-1);
        }}
        onFocus={() => setActiveFieldKey(inputKey)}
        onBlur={e => {
          setTimeout(() => {
            if (document.activeElement !== e.currentTarget) {
              setActiveFieldKey((prev: string | null) => prev === inputKey ? null : prev);
            }
          }, 100);
        }}
        onKeyDown={e => {
          if (e.key === 'ArrowDown') {
            setActiveIndex(i => Math.min(i + 1, suggestions.length - 1));
          } else if (e.key === 'ArrowUp') {
            setActiveIndex(i => Math.max(i - 1, 0));
          } else if (e.key === 'Enter') {
            e.preventDefault();
            if (suggestions[activeIndex]) {
              addChip(suggestions[activeIndex]);
            } else if (query.trim()) {
              addChip(query.trim());
            }
          }
        }}
        role="combobox"
        aria-expanded={activeFieldKey === inputKey && suggestions.length > 0}
        aria-controls={`${inputKey}-listbox`}
        aria-autocomplete="list"
        className="w-full border-2 border-gray-300 rounded px-2 py-1 text-sm"
        placeholder={tone === 'must' ? 'Type to add "must sit with"…' : 'Type to add "cannot sit with"…'}
      />

      {activeFieldKey === inputKey && suggestions.length > 0 && (
        <ul
          id={`${inputKey}-listbox`}
          role="listbox"
          className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-auto"
        >
          {suggestions.map((s, i) => (
            <li
              key={s}
              role="option"
              aria-selected={i === activeIndex}
              onMouseDown={() => addChip(s)}
              className={`px-2 py-1 text-sm cursor-pointer ${i === activeIndex ? 'bg-gray-100' : 'hover:bg-gray-50'}`}
            >
              {s}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};

const TableManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const [editingTableId, setEditingTableId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [isTablesOpen, setIsTablesOpen] = useState(true);
  const [isAssignmentsOpen, setIsAssignmentsOpen] = useState(true);
  const [sortOption, setSortOption] = useState<'as-entered' | 'first-name' | 'last-name' | 'current-table'>('last-name');
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  
  const totalSeats = useMemo(() => state.tables.reduce((sum, table) => sum + table.seats, 0), [state.tables]);
  const isPremium = isPremiumSubscription(state.subscription);

  // Premium gating for sorting options
  const allowedSortOptions: ('as-entered' | 'first-name' | 'last-name' | 'current-table')[] = isPremium
    ? ['first-name', 'last-name', 'as-entered', 'current-table']
    : ['first-name', 'last-name'];

  // If current sort became disallowed (e.g., downgrade), coerce safely
  useEffect(() => {
    if (!allowedSortOptions.includes(sortOption)) setSortOption('last-name');
  }, [isPremium]); // eslint-disable-line react-hooks/exhaustive-deps
  
  const purgePlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };
  
  const totalSeatsNeeded = useMemo(() => state.guests.reduce((s, g) => s + Math.max(1, g.count), 0), [state.guests]);
  useEffect(() => {
    dispatch({ type: 'AUTO_RECONCILE_TABLES' });
    purgePlans();
  }, [totalSeatsNeeded, state.assignments, state.tables, dispatch]);
  
  const handleAddTable = () => {
    if (state.tables.length >= 100) {
      alert('Maximum number of tables (100) reached.');
      return;
    }
    
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'ADD_TABLE', payload: { seats: 8 } });
    purgePlans();
  };
  
  const handleRemoveTable = (id: number) => {
    if (window.confirm('Are you sure you want to remove this table? This will also update any assignments that reference this table.')) {
      dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
      dispatch({ type: 'REMOVE_TABLE', payload: id });
      purgePlans();
    }
  };
  
  const handleUpdateSeats = (id: number, value: string) => {
    const seats = parseInt(value, 10);
    if (Number.isFinite(seats) && seats >= 1 && seats <= 20) {
      dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
      dispatch({ type: 'UPDATE_TABLE', payload: { id, seats } });
      dispatch({ type: 'AUTO_RECONCILE_TABLES' });
      dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    }
  };
  
  const handleTableNameDoubleClick = (id: number, currentName?: string | null) => {
    if (!isPremium) return;
    
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
    
    const trimmedName = editingName.trim();
    
    if (!trimmedName) {
      setEditingTableId(null);
      return;
    }
    
    const nameExists = state.tables.some(
      table => table.id !== editingTableId && 
               (table.name?.toLowerCase() === trimmedName.toLowerCase() || 
                (!table.name && `Table ${table.id}`.toLowerCase() === trimmedName.toLowerCase()))
    );
    
    if (nameExists) {
      setNameError("That name is already in use. Please choose another.");
      return;
    }
    
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ 
      type: 'UPDATE_TABLE', 
      payload: { id: editingTableId, name: trimmedName === `Table ${editingTableId}` ? undefined : trimmedName } 
    });
    
    setEditingTableId(null);
    purgePlans();
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTableNameBlur();
    } else if (e.key === 'Escape') {
      setEditingTableId(null);
      setNameError(null);
    }
  };

  const getTableDisplayName = (table: { id: number, name?: string | null }) => {
    return table.name || `Table ${table.id}`;
  };

  const handleUpdateAssignment = (guestId: string, value: string) => {
    const { idCsv, warnings } = normalizeAssignmentInputToIdsWithWarnings(value, state.tables);
    if (warnings.length > 0) {
      dispatch({
        type: 'SET_WARNING',
        payload: warnings.map(w => `Guest ${guestId}: ${w}`)
      });
    }
    dispatch({
      type: 'UPDATE_ASSIGNMENT',
      payload: { guestId, raw: idCsv }
    });
    purgePlans();
  };
  
  const updateConstraints = (guestId: string, newNames: string[], type: 'must' | 'cannot') => {
    // Get old constraint IDs and convert to names
    const oldConstraintIds = Object.entries(state.constraints[guestId] ?? {})
      .filter(([, v]) => v === type)
      .map(([k]) => k);
    const oldConstraintNames = oldConstraintIds
      .map(id => state.guests.find(g => g.id === id)?.name)
      .filter(Boolean) as string[];
    
    // Find what was added/removed
    const added = newNames.filter(n => !oldConstraintNames.includes(n));
    const removed = oldConstraintNames.filter(n => !newNames.includes(n));
    
    const nameToIdMap = new Map(state.guests.map(g => [g.name, g.id]));
    
    added.forEach(name => {
      const otherId = nameToIdMap.get(name);
      if (otherId) {
        dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: guestId, guest2: otherId, value: type } });
      }
    });
    removed.forEach(name => {
      const otherId = nameToIdMap.get(name);
      if (otherId) {
        dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: guestId, guest2: otherId, value: '' } });
      }
    });
    
    if (added.length || removed.length) purgePlans();
  };
  
  const getTableList = () => {
    return state.tables.map(t => {
      if (t.name) {
        return `${t.id} (${t.name})`;
      }
      return t.id;
    }).join(', ');
  };
  
  const getGuestConstraints = (guestId: string) => {
    const must = Object.entries(state.constraints[guestId] ?? {})
      .filter(([,v]) => v === 'must')
      .map(([id]) => state.guests.find(g => g.id === id)?.name ?? '')
      .filter(Boolean);
    const cannot = Object.entries(state.constraints[guestId] ?? {})
      .filter(([,v]) => v === 'cannot')
      .map(([id]) => state.guests.find(g => g.id === id)?.name ?? '')
      .filter(Boolean);
    const adjacent = (state.adjacents[guestId] ?? [])
      .map(id => state.guests.find(g => g.id === id)?.name ?? '')
      .filter(Boolean);
    return { must, cannot, adjacent };
  };

  const currentTableKey = (guestId: string, plan: any) => {
    if (plan?.tables) {
      if (plan.tables.some((t: any) => t.seats.some((s: any) => s.id === guestId))) {
        return plan.tables.find((t: any) => t.seats.some((s: any) => s.id === guestId))!.id;
      }
    }
    const raw = state.assignments[guestId];
    if (raw) {
      const ids = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(Number.isFinite);
      if (ids.length) return ids[0];
    }
    return Number.POSITIVE_INFINITY;
  };

  const sortedGuests = useMemo(() => {
    const guests = [...state.guests];
    const plan = state.seatingPlans[state.currentPlanIndex] ?? null;
    switch (sortOption) {
      case 'first-name': return guests.sort((a, b) => a.name.localeCompare(b.name));
      case 'last-name': return guests.sort((a, b) => (getLastNameForSorting(a.name)).localeCompare(getLastNameForSorting(b.name)));
      case 'current-table': return guests.sort((a, b) => currentTableKey(a.id, plan) - currentTableKey(b.id, plan));
      default: return guests;
    }
  }, [state.guests, sortOption, state.seatingPlans, state.currentPlanIndex, state.assignments]);
  
  const accordionHeaderStyles = "flex justify-between items-center p-3 rounded-md bg-[#D7E5E5] cursor-pointer";
  
  return (
    <div className="space-y-6">
      <div>
        <div 
          className={accordionHeaderStyles}
          onClick={() => setIsTablesOpen(!isTablesOpen)}
        >
          <h2 className="text-lg font-semibold text-[#586D78] flex items-center">
            <TableIcon className="mr-2 h-5 w-5" />
            Tables
          </h2>
          {isTablesOpen ? <ChevronUp className="h-5 w-5 text-[#586D78]" /> : <ChevronDown className="h-5 w-5 text-[#586D78]" />}
        </div>
        {isTablesOpen && (
          <div className="mt-4 space-y-4">
            <Card>
              <div className="flex justify-between items-start">
                <div className="space-y-4 w-full">
                  <p className="text-gray-700">
                    Add, remove, and manage tables for your seating arrangement.
                  </p>
                  <p className="text-gray-700">
                    Each table can have between 1 and 20 seats.
                  </p>
                  
                  {isPremium && state.user && (
                    <div className="bg-green-50 border border-green-300 rounded-md p-2 max-w-max">
                      <p className="text-sm text-green-700 flex items-center whitespace-nowrap">
                        <Crown className="w-4 h-4 mr-1 text-yellow-500" />
                        Premium feature: Double-click to rename any table.
                      </p>
                    </div>
                  )}
                  
                  {!state.userSetTables && (
                    <div className="bg-blue-50 border border-[#586D78] rounded-md p-3">
                      <p className="text-sm text-[#586D78]">
                        Tables are currently in auto-adjust mode. The number of tables will automatically increase based on your guest list.
                        Any manual changes will switch to fixed table settings.
                      </p>
                    </div>
                  )}
                  
                  <button
                    onClick={handleAddTable}
                    className="danstyle1c-btn"
                  >
                    <Plus className="w-4 h-4 mr-2" />
                    Add New Table
                  </button>
                </div>
              </div>
            </Card>
            
            <Card>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-normal text-[#586D78]">Tables ({state.tables.length})</h2>
                <div className="text-[#586D78]">
                  Total Seats: {totalSeats}
                </div>
              </div>
              
              {state.tables.length === 0 ? (
                <p className="text-gray-500 text-center py-4">No tables added yet. Add a table to get started.</p>
              ) : (
                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3">
                  {state.tables.map((table) => (
                    <div 
                      key={table.id} 
                      className="bg-[#f9f9f9] rounded-lg p-3 border border-solid border-[#586D78] border-[1px] shadow-sm flex justify-between items-center"
                    >
                      <div className="flex-grow">
                        {editingTableId === table.id ? (
                          <div className="mb-2">
                            <input
                              type="text"
                              value={editingName}
                              onChange={handleTableNameChange}
                              onBlur={handleTableNameBlur}
                              onKeyDown={handleKeyDown}
                              className={`px-3 py-1 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78] w-full ${
                                nameError ? 'border-red-300 bg-red-50' : 'border-[#586D78]'
                              }`}
                              autoFocus
                            />
                            {nameError && (
                              <p className="text-red-600 text-xs mt-1">{nameError}</p>
                            )}
                          </div>
                        ) : (
                          <div 
                            className={`font-medium text-[#586D78] ${isPremium ? 'cursor-pointer' : ''}`}
                            onDoubleClick={() => handleTableNameDoubleClick(table.id, table.name)}
                            title={isPremium ? "Double-click to rename (Premium feature)" : ""}
                          >
                            {getTableDisplayName(table)}
                            {isPremium && (
                              <Edit2 className="w-3 h-3 ml-1 text-gray-400 inline-block" />
                            )}
                            <span className="text-xs bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded ml-2">
                              #{table.id}
                            </span>
                          </div>
                        )}
                        
                        <div className="flex items-center space-x-3 mt-2">
                          <label htmlFor={`table-${table.id}-seats`} className="text-[#586D78]">
                            Seats:
                          </label>
                          <input
                            id={`table-${table.id}-seats`}
                            type="number"
                            min="1"
                            max="20"
                            value={table.seats}
                            onChange={(e) => handleUpdateSeats(table.id, e.target.value)}
                            className="px-3 py-1 border border-[#586D78] rounded-md w-16 focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                          />
                        </div>
                      </div>
                      
                      <button
                        className="danstyle1c-btn danstyle1c-remove h-10"
                        onClick={() => handleRemoveTable(table.id)}
                        aria-label="Remove table"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>
        )}
      </div>
      
      <div>
        <div className={accordionHeaderStyles} onClick={() => setIsAssignmentsOpen(!isAssignmentsOpen)}>
          <h2 className="text-lg font-semibold text-[#586D78] flex items-center">
            <MapPin className="mr-2 h-5 w-5" />
            Guest Assignments
          </h2>
          {isAssignmentsOpen ? <ChevronUp className="h-5 w-5 text-[#586D78]" /> : <ChevronDown className="h-5 w-5 text-[#586D78]" />}
        </div>
        
        {isAssignmentsOpen && (
          <div className="mt-4 space-y-4">
            <Card>
              <div className="text-sm text-black space-y-1">
                <p>You can specify which tables each guest can be assigned to.</p>
                <p>Tip: You can assign a guest to a range of tables by entering comma-separated numbers (e.g., "1,3,5").</p>
                <p>Simply, enter table numbers separated by commas, or leave blank for automatic assignment.</p>
                <p>This means the seating algorithm will place them at one of these tables.</p>
              </div>
            </Card>
            
            {state.conflictWarnings.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start">
                <AlertCircle className="text-red-500 mr-2 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-red-700 font-medium">Assignment Warnings</p>
                  <ul className="list-disc pl-5 text-red-600 text-sm">
                    {state.conflictWarnings.map((warn, index) => (
                      <li key={index}>{warn}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
            
            {state.warnings && state.warnings.length > 0 && (
              <div className="text-red-50 mt-2">
                {state.warnings.map(w => <p key={w}>{w}</p>)}
              </div>
            )}
            
            <div className="flex flex-wrap gap-2 items-center">
              <span className="text-sm text-gray-600">Sort by:</span>
              {allowedSortOptions.includes('first-name') && (
                <button
                  onClick={() => setSortOption('first-name')}
                  className={`danstyle1c-btn ${sortOption === 'first-name' ? 'selected' : ''}`}
                >
                  First Name
                </button>
              )}
              {allowedSortOptions.includes('last-name') && (
                <button
                  onClick={() => setSortOption('last-name')}
                  className={`danstyle1c-btn ${sortOption === 'last-name' ? 'selected' : ''}`}
                >
                  Last Name
                </button>
              )}
              {allowedSortOptions.includes('as-entered') && (
                <button
                  onClick={() => setSortOption('as-entered')}
                  className={`danstyle1c-btn ${sortOption === 'as-entered' ? 'selected' : ''}`}
                >
                  As Entered
                </button>
              )}
              {allowedSortOptions.includes('current-table') && (
                <button
                  onClick={() => setSortOption('current-table')}
                  className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''}`}
                >
                  Current Table
                </button>
              )}
            </div>
            
            <div className="space-y-4">
              {sortedGuests.map(guest => {
                const { must, cannot, adjacent } = getGuestConstraints(guest.id);
                const assignedTables = state.assignments[guest.id] || '';
                return (
                  <div key={guest.id} className="rounded-2xl border-[3px] border-white bg-white/90 shadow-sm p-3">
                    <div className="flex flex-col space-y-2">
                      <div className="flex items-center">
                        <FormatGuestName name={guest.name} />
                        <span className="ml-2 px-2 py-0.5 text-xs rounded-full border border-gray-300">Party size: {guest.count}</span>
                      </div>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Table Assignment</label>
                          <input type="text" value={assignedTables} onChange={e => handleUpdateAssignment(guest.id, e.target.value)} className="w-full border-2 border-gray-300 rounded px-2 py-1 text-sm" placeholder="e.g., 1, 3, 5" />
                          {state.tables.length > 0 && <p className="text-xs text-gray-500 mt-1">Available: {getTableList()}</p>}
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-green-700 mb-1">Must Sit With</label>
                          {adjacent.length > 0 && <div className="flex flex-wrap gap-1 mb-1">{adjacent.map(name => <span key={`adj-${name}`} className="inline-flex items-center rounded-full px-2 py-0.5 text-xs border bg-yellow-50 border-yellow-200 text-yellow-900" title="Adjacent preference">⭐ {name}</span>)}</div>}
                          <ConstraintChipsInput
                            tone="must"
                            ownerName={guest.name}
                            value={must}
                            onChange={(names) => updateConstraints(guest.id, names, 'must')}
                            allGuests={state.guests}
                            activeFieldKey={activeFieldKey}
                            setActiveFieldKey={setActiveFieldKey}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-red-700 mb-1">Cannot Sit With</label>
                          <ConstraintChipsInput
                            tone="cannot"
                            ownerName={guest.name}
                            value={cannot}
                            onChange={(names) => updateConstraints(guest.id, names, 'cannot')}
                            allGuests={state.guests}
                            activeFieldKey={activeFieldKey}
                            setActiveFieldKey={setActiveFieldKey}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
      
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default TableManager;