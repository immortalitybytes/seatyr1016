import React, { useState, useEffect, useMemo } from 'react';
import { Table as TableIcon, Plus, Trash2, Edit2, Crown, AlertCircle, X, MapPin, Info, ChevronDown, ChevronUp } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { saveRecentSessionSettings } from '../lib/sessionSettings';
import { canReduceTables } from '../utils/tables';
import { useNavigate } from 'react-router-dom';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';


const TableManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const [editingTableId, setEditingTableId] = useState<number | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [showReduceNotice, setShowReduceNotice] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isTablesOpen, setIsTablesOpen] = useState(false);
  const [isAssignmentsOpen, setIsAssignmentsOpen] = useState(true);
  const navigate = useNavigate();
  
  // NEW#8 Fix: Scoped autocomplete state
  const [activeFieldKey, setActiveFieldKey] = useState<string | null>(null); // e.g., "must:Alice"
  
  const totalSeats = state.tables.reduce((sum, table) => sum + table.seats, 0);
  
  // NEW#8: ConstraintChipsInput component
  type ChipTone = 'must' | 'cannot';
  function ConstraintChipsInput({ tone, ownerName, value, onChange }:{ 
    tone: ChipTone; ownerName: string; value: string[]; onChange:(names:string[])=>void 
  }){
    const inputKey = `${tone}:${ownerName}`;
    const [query, setQuery] = useState('');
    const [activeIndex, setActiveIndex] = useState(-1);

    const suggestions = useMemo(()=>{
      const raw = query.trim().toLowerCase();
      if (!raw) return [] as string[];
      const ignore = /(?:\b(?:and|plus|with|guest|guests?)\b|[&+]|[0-9]+)/gi;
      const norm = (s:string)=> s.toLowerCase().replace(ignore,'').replace(/\s+/g,' ').trim();
      return (state.guests ?? [])
        .map(g=>g.name)
        .filter(n=> norm(n).includes(raw))
        .slice(0,8)
        .filter(n=> !value.includes(n) && n !== ownerName);
    }, [query, value, ownerName, state.guests]);

    function addChip(name:string){ onChange([...value, name]); setQuery(''); setActiveIndex(-1); }
    function removeChip(name:string){ onChange(value.filter(v=> v!==name)); }
    const chipClass = tone==='must' ? 'bg-green-50' : 'bg-red-50';

    return (
      <div className="relative">
        <div className="mb-1">
          {value.map(v=> (
            <span key={v} className={`inline-flex items-center rounded-full px-2 py-0.5 text-sm mr-1 mb-1 ${chipClass} border border-gray-200`}>
              {v}
              <button type="button" className="ml-1 text-xs" onClick={()=>removeChip(v)}>✕</button>
            </span>
          ))}
        </div>

        <input 
          value={query} 
          onChange={e=>{ setQuery(e.target.value); setActiveIndex(-1); }}
          onFocus={()=> setActiveFieldKey(inputKey)}
          onBlur={(e)=>{ setTimeout(()=>{ if (document.activeElement !== e.currentTarget) setActiveFieldKey(prev => prev === inputKey ? null : prev); }, 100); }}
          onKeyDown={e=>{
            if (e.key==='ArrowDown') setActiveIndex(i=> Math.min(i+1, suggestions.length-1));
            else if (e.key==='ArrowUp') setActiveIndex(i=> Math.max(i-1, 0));
            else if (e.key==='Enter') { e.preventDefault(); suggestions[activeIndex] ? addChip(suggestions[activeIndex]) : (query.trim() && addChip(query.trim())); }
          }}
          role="combobox" 
          aria-expanded={activeFieldKey===inputKey && suggestions.length>0} 
          aria-controls={`${inputKey}-listbox`} 
          aria-autocomplete="list" 
          className="w-full border rounded px-2 py-1 text-sm" 
          placeholder={tone==='must' ? 'Type to add "must sit with"…' : 'Type to add "cannot sit with"…'} 
        />

        {activeFieldKey===inputKey && suggestions.length>0 && (
          <ul id={`${inputKey}-listbox`} role="listbox" className="absolute z-10 mt-1 w-full bg-white border rounded shadow max-h-48 overflow-auto">
            {suggestions.map((s,i)=> (
              <li key={s} role="option" aria-selected={i===activeIndex} onMouseDown={()=> addChip(s)} className={`px-2 py-1 text-sm ${i===activeIndex ? 'bg-gray-100' : ''}`}>
                {s}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }
  
  // Check if user has premium subscription
  const isPremium = isPremiumSubscription(state.subscription);
  
  // Save recent session settings when tables change
  useEffect(() => {
    const saveTablesForPremiumUsers = async () => {
      if (state.user && isPremium && state.userSetTables) {
        // Only save if there are tables with custom names
        const hasNamedTables = state.tables.some(table => table.name !== undefined);
        if (hasNamedTables) {
          await saveRecentSessionSettings(state.user.id, isPremium, state.tables);
        }
      }
    };
    
    saveTablesForPremiumUsers();
  }, [state.tables, state.user, isPremium, state.userSetTables]);

  // Function to purge seating plans when tables change
  const purgeSeatingPlans = () => {
    // Reset seating plans
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    
    // Reset plan name in localStorage
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    
    // Mark as not from saved setting
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };
  
  // Check if tables can be reduced whenever guest count changes
  useEffect(() => {
    const tableInfo = canReduceTables(state.guests, state.tables);
    // Only show the notice if reduction is possible AND the user hasn't dismissed it
    setShowReduceNotice(tableInfo.canReduce && !state.hideTableReductionNotice);
  }, [state.guests, state.tables, state.hideTableReductionNotice]);
  

  
  // New#8 Fix: Debounced query processing for autocomplete
  useEffect(() => {
    const timer = setTimeout(() => {
      // Process must queries
      Object.keys(mustQuery).forEach(guestName => {
        const query = mustQuery[guestName];
        if (!query) {
          setMustSuggestions(prev => ({ ...prev, [guestName]: [] }));
          return;
        }
        
        const ignore = /\b(and|plus|with|guest|guests?|one|two|three|four|five|six|seven|eight|nine|ten)\b|[&+]|\d+/gi;
        const norm = (s: string) => s.toLowerCase().replace(ignore, '').trim();
        const q = query.toLowerCase();
        
        const suggestions = state.guests
          .map(g => g.name)
          .filter(n => norm(n).includes(norm(q)))
          .slice(0, 10);
        
        setMustSuggestions(prev => ({ ...prev, [guestName]: suggestions }));
      });
      
      // Process cannot queries
      Object.keys(cannotQuery).forEach(guestName => {
        const query = cannotQuery[guestName];
        if (!query) {
          setCannotSuggestions(prev => ({ ...prev, [guestName]: [] }));
          return;
        }
        
        const ignore = /\b(and|plus|with|guest|guests?|one|two|three|four|five|six|seven|eight|nine|ten)\b|[&+]|\d+/gi;
        const norm = (s: string) => s.toLowerCase().replace(ignore, '').trim();
        const q = query.toLowerCase();
        
        const suggestions = state.guests
          .map(g => g.name)
          .filter(n => norm(n).includes(norm(q)))
          .slice(0, 10);
        
        setCannotSuggestions(prev => ({ ...prev, [guestName]: suggestions }));
      });
    }, 300);
    
    return () => clearTimeout(timer);
  }, [mustQuery, cannotQuery, state.guests]);
  
  const handleAddTable = () => {
    if (state.tables.length >= 100) {
      alert('Maximum number of tables (100) reached.');
      return;
    }
    
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'ADD_TABLE', payload: {} });
    purgeSeatingPlans();
    
    // Hide the table reduction notice when user manually adds tables
    if (showReduceNotice) {
      dispatch({ type: 'HIDE_TABLE_REDUCTION_NOTICE' });
      setShowReduceNotice(false);
    }
  };
  
  const handleRemoveTable = (id: number) => {
    if (window.confirm('Are you sure you want to remove this table? This will also update any assignments that reference this table.')) {
      dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
      dispatch({ type: 'REMOVE_TABLE', payload: id });
      purgeSeatingPlans();
    }
  };
  
  const handleUpdateSeats = (id: number, value: string) => {
    const seats = parseInt(value);
    if (!isNaN(seats) && seats >= 1 && seats <= 20) {
      // Get current table info
      const currentTable = state.tables.find(t => t.id === id);
      
      // Update with user set tables flag
      dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
      
      // Only if increasing seats, hide table reduction notice
      if (currentTable && seats > currentTable.seats) {
        dispatch({ type: 'HIDE_TABLE_REDUCTION_NOTICE' });
        setShowReduceNotice(false);
      }
      
      dispatch({ 
        type: 'UPDATE_TABLE_SEATS', 
        payload: { id, seats } 
      });
      
      purgeSeatingPlans();
    }
  };
  
  const handleTableNameDoubleClick = (id: number, currentName?: string) => {
    if (!isPremium) return; // Only premium users can rename tables
    
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
    
    // If the name is empty, revert to default
    if (!trimmedName) {
      setEditingTableId(null);
      return;
    }
    
    // Check for duplicate names
    const nameExists = state.tables.some(
      table => table.id !== editingTableId && 
               (table.name?.toLowerCase() === trimmedName.toLowerCase() || 
                (!table.name && `Table ${table.id}`.toLowerCase() === trimmedName.toLowerCase()))
    );
    
    if (nameExists) {
      setNameError("That name is already in use. Please choose another.");
      return;
    }
    
    // Update the table name
    dispatch({ 
      type: 'UPDATE_TABLE_NAME', 
      payload: { id: editingTableId, name: trimmedName === `Table ${editingTableId}` ? undefined : trimmedName } 
    });
    
    setEditingTableId(null);
    purgeSeatingPlans();
  };
  
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTableNameBlur();
    } else if (e.key === 'Escape') {
      setEditingTableId(null);
      setNameError(null);
    }
  };

  const getTableDisplayName = (table: { id: number, name?: string }) => {
    return table.name || `Table ${table.id}`;
  };

  // Calculate the minimum tables needed
  const tableInfo = canReduceTables(state.guests, state.tables);
  
  const handleReduceTables = () => {
    if (!tableInfo.canReduce) return;
    
    // Create a new array with the minimum required tables
    const newTables = state.tables.slice(0, tableInfo.minTablesNeeded);
    
    dispatch({ type: 'SET_USER_SET_TABLES', payload: true });
    dispatch({ type: 'UPDATE_DEFAULT_TABLES', payload: newTables });
    
    // Hide the notice after reducing tables
    setShowReduceNotice(false);
    dispatch({ type: 'HIDE_TABLE_REDUCTION_NOTICE' });
    
    purgeSeatingPlans();
  };
  
  const handleDismissReduceNotice = () => {
    setShowReduceNotice(false);
    dispatch({ type: 'HIDE_TABLE_REDUCTION_NOTICE' });
  };

  // Functions for Assignment Manager functionality
  const handleUpdateAssignment = (name: string, value: string) => {
    setErrorMessage(null);
    try {
      // For premium users, we need to handle both table names and numbers
      if (isPremium) {
        // Process the input to convert any table names to table numbers
        const processedValue = value.split(',').map(t => {
          const trimmed = t.trim();
          if (!trimmed) return '';
          
          // If it's a number, keep it as is
          if (!isNaN(Number(trimmed))) return trimmed;
          
          // If it's a name, try to find the matching table
          const matchingTable = state.tables.find(
            t => (t.name && t.name.toLowerCase() === trimmed.toLowerCase())
          );
          
          return matchingTable ? matchingTable.id.toString() : trimmed;
        }).filter(Boolean).join(', ');
        
        dispatch({
          type: 'UPDATE_ASSIGNMENT',
          payload: { name, tables: value }
        });
      } else {
        // For non-premium users, keep the original behavior
        dispatch({
          type: 'UPDATE_ASSIGNMENT',
          payload: { name, tables: value }
        });
      }

      // Purge seating plans when assignments change
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating assignment:', error);
      setErrorMessage(`Failed to update assignment: ${error instanceof Error ? error.message : 'An unexpected error occurred'}`);
    }
  };
  
  // Handle updating must/cannot constraints from the constraint boxes
  const handleUpdateMustConstraints = (guestName: string, mustNames: string) => {
    setErrorMessage(null);
    try {
      // Get current must constraints
      const currentMusts = Object.entries(state.constraints[guestName] || {})
        .filter(([otherGuest, value]) => value === 'must')
        .map(([otherGuest]) => otherGuest);
      
      // Parse new list of must guests
      const newMusts = mustNames.split(',').map(name => name.trim()).filter(Boolean);
      
      // Remove constraints that are no longer in the list
      currentMusts.forEach(mustGuest => {
        if (!newMusts.includes(mustGuest)) {
          dispatch({
            type: 'SET_CONSTRAINT',
            payload: { guest1: guestName, guest2: mustGuest, value: '' }
          });
        }
      });
      
      // Add new constraints
      newMusts.forEach(mustGuest => {
        if (mustGuest.startsWith('★') && mustGuest.endsWith('★')) {
          const adj = mustGuest.slice(1, -1);
          if (state.adjacents[guestName]?.length < 2) {
            dispatch({ type: 'SET_ADJACENT', payload: { guest1: guestName, guest2: adj } });
            dispatch({ type: 'SET_CONSTRAINT', payload: { guest1: guestName, guest2: adj, value: 'must' } });
          }
        } else {
          // Skip if it's the same guest or if constraint already exists
          if (mustGuest !== guestName && !currentMusts.includes(mustGuest)) {
            // Verify the guest exists in the guest list
            const guestExists = state.guests.some(g => g.name === mustGuest);
            if (guestExists) {
              dispatch({
                type: 'SET_CONSTRAINT',
                payload: { guest1: guestName, guest2: mustGuest, value: 'must' }
              });
            }
          }
        }
      });
      
      // Purge seating plans when constraints change
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating must constraints:', error);
      setErrorMessage(`Failed to update must constraints: ${error instanceof Error ? error.message : 'An unexpected error occurred'}`);
    }
  };
  
  const handleUpdateCannotConstraints = (guestName: string, cannotNames: string) => {
    setErrorMessage(null);
    try {
      // Get current cannot constraints
      const currentCannots = Object.entries(state.constraints[guestName] || {})
        .filter(([otherGuest, value]) => value === 'cannot')
        .map(([otherGuest]) => otherGuest);
      
      // Parse new list of cannot guests
      const newCannots = cannotNames.split(',').map(name => name.trim()).filter(Boolean);
      
      // Remove constraints that are no longer in the list
      currentCannots.forEach(cannotGuest => {
        if (!newCannots.includes(cannotGuest)) {
          dispatch({
            type: 'SET_CONSTRAINT',
            payload: { guest1: guestName, guest2: cannotGuest, value: '' }
          });
        }
      });
      
      // Add new constraints
      newCannots.forEach(cannotGuest => {
        // Skip if it's the same guest or if constraint already exists
        if (cannotGuest !== guestName && !currentCannots.includes(cannotGuest)) {
          // Verify the guest exists in the guest list
          const guestExists = state.guests.some(g => g.name === cannotGuest);
          if (guestExists) {
            dispatch({
              type: 'SET_CONSTRAINT',
              payload: { guest1: guestName, guest2: cannotGuest, value: 'cannot' }
            });
          }
        }
      });
      
      // Purge seating plans when constraints change
      purgeSeatingPlans();
    } catch (error) {
      console.error('Error updating cannot constraints:', error);
      setErrorMessage(`Failed to update cannot constraints: ${error instanceof Error ? error.message : 'An unexpected error occurred'}`);
    }
  };
  
  // Helper function to get all "must" constraints for a guest
  const getMustConstraints = (guestName: string) => {
    if (!state.constraints[guestName]) return [];
    
    return Object.entries(state.constraints[guestName])
      .filter(([_, value]) => value === 'must')
      .map(([otherGuest]) => otherGuest);
  };
  
  // Helper function to get all "cannot" constraints for a guest
  const getCannotConstraints = (guestName: string) => {
    if (!state.constraints[guestName]) return [];
    
    return Object.entries(state.constraints[guestName])
      .filter(([_, value]) => value === 'cannot')
      .map(([otherGuest]) => otherGuest);
  };
  
  const getTableList = () => {
    if (!isPremium || !state.tables.some(t => t.name)) {
      return state.tables.map(t => t.id).join(', ');
    }
    
    // For premium users with renamed tables, show both IDs and names
    return state.tables.map(t => {
      if (t.name) {
        return `${t.id} (${t.name})`;
      }
      return t.id;
    }).join(', ');
  };

  // Get adjacent pairings for a guest
  const getAdjacentGuests = (guestName: string) => {
    if (!state.adjacents[guestName] || state.adjacents[guestName].length === 0) return null;
    
    return state.adjacents[guestName];
  };
  
  // New#8 Fix: Helper functions for autocomplete
  const addMustChip = (guestName: string, chipValue: string) => {
    const currentValue = mustQuery[guestName] || '';
    const chips = currentValue.split(',').map(s => s.trim()).filter(Boolean);
    if (!chips.includes(chipValue)) {
      const newValue = chips.length > 0 ? `${chips.join(', ')}, ${chipValue}` : chipValue;
      setMustQuery(prev => ({ ...prev, [guestName]: newValue }));
      handleUpdateMustConstraints(guestName, newValue);
    }
  };
  
  const removeMustChip = (guestName: string, chipValue: string) => {
    const currentValue = mustQuery[guestName] || '';
    const chips = currentValue.split(',').map(s => s.trim()).filter(Boolean);
    const newChips = chips.filter(chip => chip !== chipValue);
    const newValue = newChips.join(', ');
    setMustQuery(prev => ({ ...prev, [guestName]: newValue }));
    handleUpdateMustConstraints(guestName, newValue);
  };
  
  const addCannotChip = (guestName: string, chipValue: string) => {
    const currentValue = cannotQuery[guestName] || '';
    const chips = currentValue.split(',').map(s => s.trim()).filter(Boolean);
    if (!chips.includes(chipValue)) {
      const newValue = chips.length > 0 ? `${chips.join(', ')}, ${chipValue}` : chipValue;
      setCannotQuery(prev => ({ ...prev, [guestName]: newValue }));
      handleUpdateCannotConstraints(guestName, newValue);
    }
  };
  
  const removeCannotChip = (guestName: string, chipValue: string) => {
    const currentValue = cannotQuery[guestName] || '';
    const chips = currentValue.split(',').map(s => s.trim()).filter(Boolean);
    const newChips = chips.filter(chip => chip !== chipValue);
    const newValue = newChips.join(', ');
    setCannotQuery(prev => ({ ...prev, [guestName]: newValue }));
    handleUpdateCannotConstraints(guestName, newValue);
  };
  
  const handleMustKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, guestName: string) => {
    const suggestions = mustSuggestions[guestName] || [];
    const activeIndex = mustActiveIndex[guestName] || -1;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setMustActiveIndex(prev => ({ 
        ...prev, 
        [guestName]: Math.min(activeIndex + 1, suggestions.length - 1) 
      }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setMustActiveIndex(prev => ({ 
        ...prev, 
        [guestName]: Math.max(activeIndex - 1, 0) 
      }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = suggestions[activeIndex] || mustQuery[guestName]?.trim();
      if (selected) {
        addMustChip(guestName, selected);
        setMustQuery(prev => ({ ...prev, [guestName]: '' }));
        setMustActiveIndex(prev => ({ ...prev, [guestName]: -1 }));
      }
    }
  };
  
  const handleCannotKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, guestName: string) => {
    const suggestions = cannotSuggestions[guestName] || [];
    const activeIndex = cannotActiveIndex[guestName] || -1;
    
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCannotActiveIndex(prev => ({ 
        ...prev, 
        [guestName]: Math.min(activeIndex + 1, suggestions.length - 1) 
      }));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCannotActiveIndex(prev => ({ 
        ...prev, 
        [guestName]: Math.max(activeIndex - 1, 0) 
      }));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const selected = suggestions[activeIndex] || cannotQuery[guestName]?.trim();
      if (selected) {
        addCannotChip(guestName, selected);
        setCannotQuery(prev => ({ ...prev, [guestName]: '' }));
        setCannotActiveIndex(prev => ({ ...prev, [guestName]: -1 }));
      }
    }
  };
  
  const accordionHeaderStyles = "flex justify-between items-center p-3 rounded-md bg-[#D7E5E5] cursor-pointer";
  
  // New#8 Fix: Chip component for displaying constraints
  const Chip = ({ label, tone, onRemove }: { label: string; tone: 'must' | 'cannot'; onRemove: () => void }) => {
    return (
      <span className={`rounded-full px-2 py-0.5 text-sm mr-1 bg-${tone === 'must' ? 'green' : 'red'}-50`}>
        {label}
        <X className="ml-1 w-3 h-3 cursor-pointer" onClick={onRemove} />
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <TableIcon className="mr-2" />
        Tables

      </h1>
      
      {/* Tables Section - Accordion */}
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
                <div className="space-y-4 w-1/2">
                  <p className="text-gray-700">
                    Add, remove, and manage tables for your seating arrangement.<br />
                    Each table can have between 1 and 20 seats.
                  </p>
                  

                  
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
                
                {/* Table Reduction Notice - Right Justified */}
                
              </div>
            </Card>
            
            <Card>
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-lg font-semibold text-[#586D78]">Tables ({state.tables.length})</h2>
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

      {/* Guest Assignments Section - Accordion */}
      <div>
        <div 
          className={accordionHeaderStyles}
          onClick={() => setIsAssignmentsOpen(!isAssignmentsOpen)}
        >
          <h2 className="text-lg font-semibold text-[#586D78] flex items-center">
            <MapPin className="mr-2 h-5 w-5" />
            Guest Assignments
          </h2>
          {isAssignmentsOpen ? <ChevronUp className="h-5 w-5 text-[#586D78]" /> : <ChevronDown className="h-5 w-5 text-[#586D78]" />}
        </div>

        {isAssignmentsOpen && (
          <div className="mt-4 space-y-4">
            <Card>
              <div className="space-y-4">
                <div className="text-sm text-[#586D78] space-y-1">
                  <p>You can specify which tables each guest can be assigned to.</p>
                  <p>Simply, enter table numbers separated by commas, or leave blank for automatic assignment. Tip: You can assign a guest to a range of tables by entering comma-separated numbers (e.g., "1,3,5").</p>
                  <p>This means the seating algorithm will place them at one of these tables.</p>
                </div>
              </div>
            </Card>

            {errorMessage && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start mt-4">
                <AlertCircle className="text-red-500 mr-2 mt-1 flex-shrink-0" />
                <div>
                  <p className="text-red-700 font-medium">Error</p>
                  <p className="text-red-600 text-sm">{errorMessage}</p>
                </div>
              </div>
            )}
            
            {state.guests.length === 0 ? (
              <p className="text-gray-500 text-center py-4 mt-4">No guests added yet. Add guests to create assignments.</p>
            ) : (
              <div className="space-y-6 mt-4">
                {state.guests.map((guest, index) => {
                  // Get adjacent guest names if any
                  const adjacentGuests = getAdjacentGuests(guest.name);
                  
                  // Get must/cannot constraints
                  const mustConstraints = getMustConstraints(guest.name);
                  const cannotConstraints = getCannotConstraints(guest.name);
                  
                  // Create mustValue with ★adj★ format
                  const mustValue = [...mustConstraints, ...(adjacentGuests ? adjacentGuests.map(ag => `★${ag}★`) : [])].join(', ');
                  
                  return (
                    <div key={`${guest.name}-${index}`} className="rounded-2xl border-[3px] border-white bg-white/90 shadow-sm p-3">
                      <div className="flex flex-col space-y-2">
                        <div className="min-w-[150px] font-medium text-[#586D78]">
                          <div className="flex items-center">
                            <span className="font-medium">
                              {guest.name.includes('%') ? (
                                <>
                                  {guest.name.split('%')[0]}
                                  <span style={{ color: '#959595' }}>%{guest.name.split('%')[1]}</span>
                                </>
                              ) : guest.name}
                            </span>
                            <span className="ml-2 px-2 py-0.5 text-xs rounded-full border border-gray-300">
                              Party size: {Math.max(1, guest.count ?? 1)}
                            </span>
                          </div>
                          
                          {/* Display adjacent pairing information with stars */}
                          {adjacentGuests && adjacentGuests.length > 0 && (
                            <div className="text-xs text-amber-600 mt-1">
                              ⭐ {adjacentGuests.join(' ⭐ ')} ⭐
                            </div>
                          )}
                          
                          {/* Table assignment line */}
                          <div className="text-xs text-[#586D78] mt-1">
                            {formatAssignment(state.assignments, state.tables, guest.name)}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                          {/* Table Assignment */}
                          <div>
                            <label 
                              htmlFor={`assignment-${guest.name}`} 
                              className="block text-sm font-medium text-gray-700 mb-1"
                            >
                              Table Assignment
                            </label>
                            <div className="relative">
                              <input
                                id={`assignment-${guest.name}`}
                                type="text"
                                value={state.assignments[guest.name] || ''}
                                onChange={(e) => handleUpdateAssignment(guest.name, e.target.value)}
                                placeholder={isPremium && state.user ? "Enter table numbers or table names..." : "Enter table numbers..."}
                                className="w-full px-3 py-2 border border-[#586D78] rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                              />
                            </div>
                            
                            {/* Available tables reminder */}
                            {state.tables.length > 0 && (
                              <div className="mt-1 text-xs text-[#586D78]">
                                Available tables: {getTableList()}
                              </div>
                            )}
                          </div>
                          
                          {/* Must Constraints Box */}
                          <div>
                            <label 
                              htmlFor={`must-${guest.name}`} 
                              className="block text-sm font-medium text-green-600 mb-1"
                            >
                              Must Sit With
                            </label>
                            <ConstraintChipsInput 
                              tone="must" 
                              ownerName={guest.name} 
                              value={mustConstraints} 
                              onChange={(names) => updateMustForGuest(guest.name, names)} 
                            />
                            <div className="mt-1 text-xs text-green-600">
                              These guests will be seated at the same table
                            </div>
                          </div>
                          
                          {/* Cannot Constraints Box */}
                          <div>
                            <label 
                              htmlFor={`cannot-${guest.name}`} 
                              className="block text-sm font-medium text-red-600 mb-1"
                            >
                              Cannot Sit With
                            </label>
                            <ConstraintChipsInput 
                              tone="cannot" 
                              ownerName={guest.name} 
                              value={cannotConstraints} 
                              onChange={(names) => updateCannotForGuest(guest.name, names)} 
                            />
                            
                            <div className="mt-1 text-xs text-red-600">
                              These guests will not be seated at the same table
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
      
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default TableManager;