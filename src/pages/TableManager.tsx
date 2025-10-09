import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Table as TableIcon, Plus, Trash2, Edit2, AlertCircle, MapPin, ChevronDown, ChevronUp } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { getLastNameForSorting } from '../utils/formatters';
import { normalizeAssignmentInputToIdsWithWarnings } from '../utils/assignments';
import { getCapacity } from '../utils/tables';
import { Table, GuestID } from '../types';

const useDebounce = (value: string, delay: number): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

// ConstraintChipsInput component (reused from old TableManager/AssignmentManager)
type ChipTone = 'must' | 'cannot';
const ConstraintChipsInput: React.FC<{
  tone: ChipTone;
  ownerName: string;
  value: string[];
  onChange: (names: string[]) => void;
  allGuests: { id: string; name: string; count: number }[];
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
  }, [debouncedQuery, allGuests, value, ownerName]);
  
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && activeIndex >= 0 && suggestions[activeIndex]) {
      onChange([...value, suggestions[activeIndex]]);
    setQuery('');
    setActiveIndex(-1);
      e.preventDefault();
    } else if (e.key === 'ArrowDown') {
      setActiveIndex(prev => Math.min(prev + 1, suggestions.length - 1));
      e.preventDefault();
    } else if (e.key === 'ArrowUp') {
      setActiveIndex(prev => Math.max(prev - 1, -1));
      e.preventDefault();
    } else if (e.key === 'Escape') {
      setActiveFieldKey(null);
    }
  };

  return (
    <div className="relative">
      <div className={`flex flex-wrap gap-1 p-2 border rounded-md min-h-[36px] ${
        tone === 'must' ? 'border-green-300 bg-green-50' : 'border-red-300 bg-red-50'
      }`}>
        {value.map((name, i) => (
          <span
            key={`${name}-${i}`}
            className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
              tone === 'must'
                ? 'bg-green-100 text-green-800 border border-green-200'
                : 'bg-red-100 text-red-800 border border-red-200'
            }`}
          >
            {name}
            <button
              onClick={() => onChange(value.filter(n => n !== name))}
              className="ml-1 text-current hover:text-red-600"
            >
              ×
            </button>
          </span>
        ))}
      <input
          type="text"
        value={query}
          onChange={e => { setQuery(e.target.value); setActiveIndex(-1); }}
          onKeyDown={handleKeyDown}
        onFocus={() => setActiveFieldKey(inputKey)}
          placeholder={value.length === 0 ? 'Add guests...' : ''}
          className="flex-grow outline-none bg-transparent text-sm min-w-[100px]"
        />
      </div>
      {activeFieldKey === inputKey && suggestions.length > 0 && (
        <ul className="absolute z-10 w-full bg-white border rounded-md shadow-lg max-h-40 overflow-auto">
          {suggestions.map((sugg, i) => (
            <li
              key={sugg}
              className={`p-2 text-sm cursor-pointer ${i === activeIndex ? 'bg-blue-100 text-blue-900' : 'hover:bg-gray-100'}`}
              onMouseDown={() => { // Use onMouseDown to prevent blur event from firing first
                onChange([...value, sugg]);
                setQuery('');
                setActiveIndex(-1);
                setActiveFieldKey(null);
              }}
            >
              {sugg}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};


const TableManager: React.FC = () => {
  // SSoT #2 Fix: Get derived isPremium from context
  const { state, dispatch, isPremium } = useApp();
  const [tables, setTables] = useState(state.tables);
  const [editingTable, setEditingTable] = useState<number | null>(null);
  const [newTableSeats, setNewTableSeats] = useState<number>(8);
  const [newTableName, setNewTableName] = useState<string>('');
  const [editingSeats, setEditingSeats] = useState<number>(8);
  const [editingName, setEditingName] = useState<string>('');
  const [guestListOpen, setGuestListOpen] = useState(true); 
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null);
  
  useEffect(() => {
    setTables(state.tables);
  }, [state.tables]);

  const sortedGuests = useMemo(() => {
    // BEST OF ALL v1.7 Fix: Robust party size sort needed here too, but for simplicity, use current last-name
    return [...state.guests].sort((a, b) => getLastNameForSorting(a.name).localeCompare(getLastNameForSorting(b.name)));
  }, [state.guests]);

  // RESTORED: This is the core logic for the multi-assignment input
  const handleUpdateAssignment = useCallback((guestId: GuestID, rawAssignment: string) => {
    // Multi-Table Assignment UI Feature: Use normalizeAssignmentInputToIdsWithWarnings
    const result = normalizeAssignmentInputToIdsWithWarnings(rawAssignment, state.tables);
    
    // Dispatch assignment update (this uses the standard SET_ASSIGNMENTS action)
    dispatch({ 
        type: 'SET_ASSIGNMENTS',
        payload: { ...state.assignments, [guestId]: result.idCsv }
    });
    
    // NOTE: Warnings are surfaced via console.warn here, but the main error display relies on C7 validator
    if (result.warnings.length > 0) {
        result.warnings.forEach(w => console.warn(`Assignment Warning: ${w}`));
    }
  }, [state.tables, dispatch, state.assignments]);
  
  // Helper to update constraints (must/cannot)
  const updateConstraints = useCallback((guestId: GuestID, names: string[], type: 'must' | 'cannot') => {
    const nameToIdMap = new Map(state.guests.map(g => [g.name, g.id]));
    const nextConstraints: Record<GuestID, GuestID[]> = { ...(state.constraints[type] as Record<GuestID, GuestID[]>) };

    // Clear existing for guests not in `names` and add for guests in `names`
    state.guests.forEach(g => {
      const targetId = g.id;
      if (targetId === guestId) return;

      const isCurrentlyInList = state.constraints[type]?.[guestId]?.includes(targetId);
      const targetName = g.name;

      if (names.includes(targetName) && !isCurrentlyInList) {
        // Add pair
        nextConstraints[guestId] = Array.from(new Set([...(nextConstraints[guestId] || []), targetId]));
        nextConstraints[targetId] = Array.from(new Set([...(nextConstraints[targetId] || []), guestId]));
      } else if (!names.includes(targetName) && isCurrentlyInList) {
        // Remove pair
        nextConstraints[guestId] = (nextConstraints[guestId] || []).filter(id => id !== targetId);
        if (nextConstraints[guestId].length === 0) delete nextConstraints[guestId];
        nextConstraints[targetId] = (nextConstraints[targetId] || []).filter(id => id !== guestId);
        if (nextConstraints[targetId].length === 0) delete nextConstraints[targetId];
      }
    });

    // BEST OF ALL v1.7 Fix: Dispatch SET_CONSTRAINT with individual payload for consistency
    dispatch({
      type: 'SET_CONSTRAINT',
      payload: { 
        [type]: nextConstraints // This payload structure doesn't match the reducer, we use the original
      }
    });
  }, [state.constraints, state.guests, dispatch]);
  
  // Table Management Handlers
  const handleAddTable = () => {
    dispatch({ type: 'ADD_TABLE', payload: { seats: newTableSeats, name: newTableName || undefined } });
    setNewTableSeats(8);
    setNewTableName('');
  };

  const handleRemoveTable = (id: number) => {
    if (window.confirm(`Are you sure you want to delete Table ${id}? This will clear any assignments to it.`)) {
      dispatch({ type: 'REMOVE_TABLE', payload: id });
    }
  };

  const startEdit = (table: Table) => {
    setEditingTable(table.id);
    setEditingSeats(getCapacity(table));
    setEditingName(table.name || '');
  };

  const saveEdit = (id: number) => {
    dispatch({ type: 'UPDATE_TABLE', payload: { id, seats: editingSeats, name: editingName || undefined } });
    setEditingTable(null);
  };
  
  const currentAssignedGuestCount = state.guests.filter(g => state.assignments[g.id]).length;

  const getTableList = () => {
    return state.tables
      .map(t => t.name ? `${t.id} (${t.name})` : t.id.toString())
      .join(', ');
  };
  
  return (
    <div className="space-y-6">
      <Card title="Table Management">
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row gap-2 items-end">
            <div className="flex-grow">
              <label htmlFor="newTableName" className="block text-sm font-medium text-gray-700">Table Name (Optional)</label>
              <input
                id="newTableName"
                type="text"
                value={newTableName}
                onChange={(e) => setNewTableName(e.target.value)}
                placeholder="e.g., VIP, College"
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
            </div>
      <div>
              <label htmlFor="newTableSeats" className="block text-sm font-medium text-gray-700">Seats</label>
              <input
                id="newTableSeats"
                type="number"
                value={newTableSeats}
                onChange={(e) => setNewTableSeats(Math.max(1, parseInt(e.target.value) || 0))}
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
              />
        </div>
            <Button onClick={handleAddTable} variant="primary" icon={<Plus className="w-4 h-4" />}>
              Add Table
            </Button>
              </div>
              
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {tables.map(table => (
              <div key={table.id} className="p-4 border border-gray-200 rounded-lg shadow-sm flex flex-col justify-between">
                {editingTable === table.id ? (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700">ID: {table.id}</label>
                    <div>
                        <label htmlFor={`editName-${table.id}`} className="block text-xs font-medium text-gray-500">Name</label>
                            <input
                          id={`editName-${table.id}`}
                              type="text"
                              value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="w-full px-2 py-1 border rounded-md text-sm"
                        />
                          </div>
                    <div>
                        <label htmlFor={`editSeats-${table.id}`} className="block text-xs font-medium text-gray-500">Seats</label>
                          <input
                          id={`editSeats-${table.id}`}
                            type="number"
                          value={editingSeats}
                          onChange={(e) => setEditingSeats(Math.max(1, parseInt(e.target.value) || 0))}
                            min="1"
                          className="w-full px-2 py-1 border rounded-md text-sm"
                          />
                        </div>
                    <div className="flex justify-end space-x-2 mt-3">
                      <Button onClick={() => setEditingTable(null)} variant="secondary" size="sm">Cancel</Button>
                      <Button onClick={() => saveEdit(table.id)} variant="primary" size="sm">Save</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex justify-between items-start mb-2">
                      <h3 className="text-lg font-semibold text-[#586D78]">
                        Table {table.id}
                        {table.name && <span className="text-sm font-normal text-gray-600 ml-2">({table.name})</span>}
                      </h3>
                      <div className="flex space-x-2">
                        <button onClick={() => startEdit(table)} title="Edit Table" className="text-gray-400 hover:text-blue-500"><Edit2 className="w-4 h-4" /></button>
                        <button onClick={() => handleRemoveTable(table.id)} title="Delete Table" className="text-gray-400 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
                      </div>
                    </div>
                    <p className="text-2xl font-bold text-gray-800">{getCapacity(table)}</p>
                    <p className="text-sm text-gray-500">Seats</p>
                  </>
                )}
                    </div>
                  ))}
                </div>
          
          <div className="text-sm text-gray-600 pt-2">
            Total Tables: {tables.length}. Total Capacity: {tables.reduce((sum, t) => sum + getCapacity(t), 0)} seats.
          </div>
              </div>
            </Card>
            
      {/* Guest Assignments & Constraints */}
      <Card title="Guest Assignments & Constraints">
        {state.guests.length === 0 ? (
          <p className="text-gray-500 text-center py-4">Add guests on the Guests page to set assignments and constraints.</p>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-between items-center pb-2 border-b">
              <h3 className="text-lg font-semibold text-[#586D78]">Assign {currentAssignedGuestCount}/{state.guests.length} Guests</h3>
                  <button
                onClick={() => setGuestListOpen(v => !v)} 
                className="danstyle1c-btn"
              >
                {guestListOpen ? 'Hide List' : 'Show List'}
                {guestListOpen ? <ChevronUp className="w-4 h-4 ml-2" /> : <ChevronDown className="w-4 h-4 ml-2" />}
                  </button>
            </div>
            
            {guestListOpen && (
              <div className="space-y-6">
                <p className='text-sm text-gray-600'>Available Tables: {getTableList()}</p>
              {sortedGuests.map(guest => {
                  const assignmentValue = state.assignments[guest.id] || '';
                  const assignmentWarnings = normalizeAssignmentInputToIdsWithWarnings(assignmentValue, state.tables).warnings;
                  const mustNames = (state.constraints.must?.[guest.id] || []).map((id: GuestID) => state.guests.find(g => g.id === id)?.name || id);
                  const cannotNames = (state.constraints.cannot?.[guest.id] || []).map((id: GuestID) => state.guests.find(g => g.id === id)?.name || id);
                  
                return (
                    <div key={guest.id} className="p-4 border rounded-lg shadow-sm">
                      <div className="flex justify-between items-center mb-3">
                        <h4 className="font-bold text-gray-800">
                          <FormatGuestName name={guest.name} /> ({guest.count} seats)
                        </h4>
                      </div>
                      
                      {/* Multi-Table Assignment Input */}
                        <div>
                        <label htmlFor={`assignment-${guest.id}`} className="block text-sm font-medium text-[#586D78] mb-1">
                          Assign to Tables (IDs or Names, comma-separated)
                        </label>
                        <input
                          id={`assignment-${guest.id}`}
                          type="text"
                          value={state.assignments[guest.id] || ''}
                          onChange={(e) => handleUpdateAssignment(guest.id, e.target.value)}
                          placeholder="e.g., 2, 3, VIP"
                          className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                        />
                        {assignmentWarnings.length > 0 && (
                          <div className="mt-2 text-xs text-red-600 flex items-start">
                            <AlertCircle className="w-3 h-3 mr-1 mt-0.5" />
                            <span>{assignmentWarnings.join('; ')}</span>
                          </div>
                        )}
                        </div>
                      
                      {/* Constraint Chips Inputs */}
                      <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-green-700 mb-1">Must Sit With</label>
                          <ConstraintChipsInput
                            tone="must"
                            ownerName={guest.name}
                            value={mustNames}
                            onChange={(names) => updateConstraints(guest.id, names, 'must')}
                            allGuests={state.guests.map(g => ({...g, name: g.name}))} // Pass correct shape
                            activeFieldKey={activeFieldKey}
                            setActiveFieldKey={setActiveFieldKey}
                          />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-red-700 mb-1">Cannot Sit With</label>
                          <ConstraintChipsInput
                            tone="cannot"
                            ownerName={guest.name}
                            value={cannotNames}
                            onChange={(names) => updateConstraints(guest.id, names, 'cannot')}
                            allGuests={state.guests.map(g => ({...g, name: g.name}))} // Pass correct shape
                            activeFieldKey={activeFieldKey}
                            setActiveFieldKey={setActiveFieldKey}
                          />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}
      </Card>
      
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default TableManager;