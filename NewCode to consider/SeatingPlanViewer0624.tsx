import React, { useState, useEffect } from 'react';
import { MapPin, Download, ArrowLeft, ArrowRight, RefreshCw, AlertCircle, Save, Crown } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { solveSeatingPlan } from '../utils/seatingAlgorithm';
import type { Guest, ValidationError } from '../types';
import { countHeads } from '../utils/guestCount';
import { supabase } from '../lib/supabase';
import { isPremiumSubscription, getMaxSavedSettingsLimit } from '../utils/premium';
import AuthModal from '../components/AuthModal';
import { useNavigate } from 'react-router-dom';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';

const SeatingPlanViewer: React.FC = () => {
  const { state, dispatch } = useApp();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newSettingName, setNewSettingName] = useState('');
  const [exportSuccess, setExportSuccess] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [currentSettingName, setCurrentSettingName] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Get user and subscription directly from AppContext
  const { user, subscription } = state;
  // Check premium status
  const isPremium = isPremiumSubscription(subscription);
  
  // Auto-generate seating plan on component mount if conditions are met
  useEffect(() => {
    const canGenerate = 
      state.guests.reduce((sum, g) => sum + g.count, 0) > 0 && // Guests exist
      state.tables.length > 0 && // Tables exist
      state.seatingPlans.length === 0 && // No seating plans currently exist
      !isGenerating; // Not already generating

    if (canGenerate) {
      handleGenerateSeatingPlan();
    }
  }, []); // Empty dependency array - runs once on mount
  
  // Update current setting name when loaded saved setting status changes
  useEffect(() => {
    if (state.loadedSavedSetting) {
      // Get the name from localStorage
      const savedName = localStorage.getItem('seatyr_current_setting_name');
      if (savedName) {
        setCurrentSettingName(savedName);
      } else {
        setCurrentSettingName(null);
      }
    } else {
      setCurrentSettingName(null);
    }
  }, [state.loadedSavedSetting]);

  // Determine if current setting is modified
  const isSettingModified = state.loadedSavedSetting && state.seatingPlans.length === 0;
  
  const handleGenerateSeatingPlan = async () => {
    setIsGenerating(true);
    setErrors([]);

    try {
      const maxPlans = isPremium ? 30 : 10; // Premium users get more plans
      const plans = await solveSeatingPlan(
        state.guests,
        state.tables,
        state.constraints,
        state.adjacents,
        state.assignments,
        maxPlans
      );

      if (plans.length === 0) {
        setErrors([{
          message: 'No valid seating plans could be generated. Try relaxing constraints or reducing adjacency links.',
          type: 'error'
        }]);
      } else {
        dispatch({ type: 'SET_SEATING_PLANS', payload: plans });
        dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
      }
    } catch (error) {
      console.error('Error generating seating plans:', error);
      if (error instanceof ValidationError) {
        setErrors([{ message: error.message, type: 'error' }]);
      } else {
        setErrors([{
          message: 'Unexpected error generating seating plans: ' + (error.message || 'Unknown'),
          type: 'error'
        }]);
      }
    } finally {
      setIsGenerating(false);
    }
  };

  const handleNavigatePlan = (delta: number) => {
    const newIndex = state.currentPlanIndex + delta;
    if (newIndex >= 0 && newIndex < state.seatingPlans.length) {
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: newIndex });
    }
  };

  const generateExportText = () => {
    if (state.seatingPlans.length === 0) return '';

    const sections = [];

    // Section 1: Seating Plans
    sections.push('SEATING PLANS\n' + '='.repeat(80) + '\n');

    // Find the maximum number of people (not guest units) across all tables in all plans
    const maxPeople = Math.max(
      ...state.seatingPlans.flatMap(plan => 
        plan.tables.map(t => t.seats.reduce((sum, guest) => sum + guest.count, 0))
      )
    );

    // Generate CSV header for seating plans
    const header = [
      '"Table Name"',
      ...Array.from({ length: maxPeople }, (_, i) => `"Seat ${i + 1}"`)
    ].join(',');
    sections.push(header);

    // Generate seating plan data
    state.seatingPlans.forEach((plan, i) => {
      sections.push(`\nPlan #${i + 1}\n`);
      plan.tables.forEach(t => {
        const tableName = state.tables.find(tbl => tbl.id === t.id)?.name || `Table ${t.id}`;
        // Expand guest units with multiple people into individual seats
        const expandedSeats: string[] = [];
        t.seats.forEach((guest) => {
          // DEBUG: verify stored count matches countHeads
          if (guest.count !== countHeads(guest.name)) {
            console.warn(`Guest count mismatch for "${guest.name}": stored=${guest.count}, computed=${countHeads(guest.name)}`);
          }
          const count = guest.count;
          // FIXED: split names exactly like countHeads (non-capturing group)
          const names = guest.name.split(/(?:\s+and\s+|&)/i).map(n => n.trim()).filter(Boolean);
          if (names.length === count) {
            // If split count matches guest count, use individual names
            names.forEach((n, i) => {
              let cell = n.replace(/"/g, '""');
              if (state.adjacents[guest.name]?.length > 0) cell += ' *';
              expandedSeats.push(`"${cell}"`);
            });
          } else {
            // If counts don't match, replicate the full name
            for (let i = 0; i < count; i++) {
              let cell = guest.name.replace(/"/g, '""');
              if (i > 0) cell += ` (${i + 1})`;
              if (state.adjacents[guest.name]?.length > 0) cell += ' *';
              expandedSeats.push(`"${cell}"`);
            }
          }
        });
        
        const row = [
          `"${tableName} (${t.capacity} seats)"`, // Quote table name
          ...expandedSeats,
          ...Array(Math.max(0, t.capacity - expandedSeats.length)).fill('""') // Pad with empty cells
        ];
        sections.push(row.join(','));
      });
    });

    // Section 2: Guest List
    sections.push('\nGUEST LIST\n' + '='.repeat(80));
    sections.push('Name\tGroup Size');
    sections.push(state.guests.map(g => `${g.name}\t${g.count}`).join('\n'));

    // Section 3: Tables
    sections.push('\nTABLES\n' + '='.repeat(80));
    sections.push('Table ID\tName\tSeats');
    sections.push(state.tables.map(t => `${t.id}\t${t.name || `Table ${t.id}`}\t${t.seats}`).join('\n'));

    // Section 4: Constraints
    sections.push('\nCONSTRAINTS\n' + '='.repeat(80));
    sections.push('Guest 1\tGuest 2\tConstraint Type');
    const constraintRows = [];
    Object.entries(state.constraints).forEach(([guest1, constraints]) => {
      Object.entries(constraints).forEach(([guest2, value]) => {
        if (value && guest1 < guest2) { // Only include each pair once
          constraintRows.push(`${guest1}\t${guest2}\t${value}`);
        }
      });
    });
    sections.push(constraintRows.join('\n'));

    // Section 5: Adjacent Seating Requirements
    sections.push('\nADJACENT SEATING\n' + '='.repeat(80));
    sections.push('Guest 1\tGuest 2');
    const adjacentRows = [];
    Object.entries(state.adjacents).forEach(([guest1, adjacents]) => {
      adjacents.forEach(guest2 => {
        if (guest1 < guest2) { // Only include each pair once
          adjacentRows.push(`${guest1}\t${guest2}`);
        }
      });
    });
    sections.push(adjacentRows.join('\n'));

    // Section 6: Table Assignments
    sections.push('\nTABLE ASSIGNMENTS\n' + '='.repeat(80));
    sections.push('Guest\tAssigned Tables');
    sections.push(Object.entries(state.assignments)
      .map(([guest, tables]) => `${guest}\t${tables}`)
      .join('\n'));

    // Section 7: Configuration Data (for import)
    const configData = {
      version: "1.0",
      guests: state.guests,
      tables: state.tables.map(table => ({
        id: table.id,
        seats: table.seats,
        name: table.name
      })),
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments,
      seatingPlans: state.seatingPlans,
      currentPlanIndex: state.currentPlanIndex,
      userSetTables: state.userSetTables
    };

    sections.push('\nCONFIGURATION DATA\n' + '='.repeat(80));
    sections.push(JSON.stringify(configData, null, 2));

    return {
      csv: sections.join('\n'),
      fullText: sections.join('\n'),
      configData: JSON.stringify(configData, null, 2)
    };
  };

  const handleCopyToClipboard = async () => {
    setExportError(null);
    try {
      const { fullText } = generateExportText();
      await navigator.clipboard.writeText(fullText);
      setExportSuccess(true);
      setTimeout(() => {
        setShowExportModal(false);
        setExportSuccess(false);
      }, 2000);
    } catch (err) {
      console.error('Failed to copy to clipboard:', err);
      setExportError('Unable to copy to clipboard. Please try again or use the download option.');
    }
  };

  const handleDownloadSpreadsheet = () => {
    setExportError(null);
    try {
      if (state.seatingPlans.length === 0) {
        setExportError('No seating plans to export.');
        return;
      }

      const { csv } = generateExportText();
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = 'seating_plans.csv';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      setExportSuccess(true);
      setTimeout(() => {
        setShowExportModal(false);
        setExportSuccess(false);
      }, 2000);
    } catch (error) {
      console.error('Error downloading spreadsheet:', error);
      setExportError('Failed to create download. Please try the copy option instead.');
    }
  };
  
  const handleSavePlan = async () => {
    setSaveError(null);
    if (!user) {
      setShowAuthModal(true);
      return;
    }
    
    if (!newSettingName.trim()) {
      setSaveError('Please enter a name for your settings');
      return;
    }
    
    setSavingSettings(true);
    
    try {
      // Check if user is premium
      const isPremium = isPremiumSubscription(subscription);
      
      // Get settings count
      const { data: existingSettings, error: countError } = await supabase
        .from('saved_settings')
        .select('id', { count: 'exact' });
        
      if (countError) {
        if (countError.status === 401) {
          throw new Error('Your session has expired. Please log in again.');
        }
        throw countError;
      }
      
      // Check limits
      const maxAllowed = getMaxSavedSettingsLimit(isPremium ? { status: 'active' } : null);
      if (existingSettings.length >= maxAllowed && !isPremium) {
        throw new Error(`Free users can only save up to ${maxAllowed} settings. Upgrade to Premium for more.`);
      }
      
      // Ensure we save complete table configuration
      const settingData = {
        version: "1.0",
        guests: state.guests,
        tables: state.tables.map(table => ({
          id: table.id,
          seats: table.seats,
          name: table.name
        })),
        constraints: state.constraints,
        adjacents: state.adjacents,
        assignments: state.assignments,
        seatingPlans: state.seatingPlans,
        currentPlanIndex: state.currentPlanIndex,
        userSetTables: state.userSetTables
      };
      
      // Explicitly set the user_id to satisfy RLS policy
      const { error } = await supabase
        .from('saved_settings')
        .insert({
          user_id: user.id, // Add user_id explicitly
          name: newSettingName,
          data: settingData
        });
        
      if (error) {
        console.error('Error saving plan:', error);
        if (error.status === 401) {
          throw new Error('Your session has expired. Please log in again.');
        } else if (error.message.includes('check_settings_limit')) {
          throw new Error(`You've reached your limit of ${maxAllowed} saved settings. Upgrade to Premium for more.`);
        } else {
          throw new Error(error.message);
        }
      }
      
      // Update the current setting name in state and localStorage
      setCurrentSettingName(newSettingName);
      localStorage.setItem('seatyr_current_setting_name', newSettingName);
      
      // Set loadedSavedSetting to true
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
      
      setSaveSuccess(true);
      setTimeout(() => {
        setShowSaveModal(false);
        setSaveSuccess(false);
        setNewSettingName('');
      }, 2000);
    } catch (err) {
      console.error('Failed to save plan:', err);
      setSaveError(err.message || 'Failed to save settings. Please try again.');
    } finally {
      setSavingSettings(false);
    }
  };

  const renderCurrentPlan = () => {
    if (state.seatingPlans.length === 0) {
      return (
        <div className="text-center py-8 text-gray-500">
          No seating plans generated yet. Click "Generate Seating Plan\" to create plans.
        </div>
      );
    }

    const plan = state.seatingPlans[state.currentPlanIndex];
    // Calculate maximum based on people count, not guest units
    const maxSeats = Math.max(...plan.tables.map(t => 
      t.seats.reduce((sum, guest) => {
        // DEBUG: verify stored count matches countHeads
        if (guest.count !== countHeads(guest.name)) {
          console.warn(`Guest count mismatch for "${guest.name}": stored=${guest.count}, computed=${countHeads(guest.name)}`);
        }
        return sum + guest.count;
      }, 0)
    ));
    
    // Function to get table display name
    const getTableDisplayName = (tableId: number) => {
      const table = state.tables.find(t => t.id === tableId);
      return table?.name || `Table ${tableId}`;
    };

    // Helper function to check if a guest appears in any adjacency list
    const findAllAdjacentGuests = (guestName: string) => {
      // Get guests that this guest is adjacent to
      const directAdjacents = state.adjacents[guestName] || [];
      
      // Get guests that have this guest as adjacent
      const reverseAdjacents = [];
      Object.entries(state.adjacents).forEach(([otherGuest, adjacents]) => {
        if (adjacents.includes(guestName) && otherGuest !== guestName) {
          reverseAdjacents.push(otherGuest);
        }
      });
      
      // Combine both lists (removing duplicates)
      const allAdjacents = [...new Set([...directAdjacents, ...reverseAdjacents])];
      return allAdjacents;
    };

    return (
      <div>
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-lg font-medium text-[#586D78]">
            Plan #{state.currentPlanIndex + 1} of {state.seatingPlans.length}
          </h3>
          
          <div className="flex space-x-2">
            <button
              className="danstyle1c-btn"
              onClick={() => handleNavigatePlan(-1)}
              disabled={state.currentPlanIndex === 0}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous Plan
            </button>

            <button
              className="danstyle1c-btn"
              onClick={() => handleNavigatePlan(1)}
              disabled={state.currentPlanIndex === state.seatingPlans.length - 1}
            >
              Next Plan
              <ArrowRight className="w-4 h-4 ml-2" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full border-collapse">
            <thead>
              <tr>
                {plan.tables.map(table => {
                  // Calculate total people (not just units) by summing guest counts
                  const totalPeople = table.seats.reduce((sum, guest) => sum + guest.count, 0);
                  
                  // Get the table display name
                  const tableObj = state.tables.find(t => t.id === table.id);
                  const tableDisplay = tableObj?.name 
                    ? (
                      <>
                        <span>{tableObj.name}</span>
                        <span className="text-xs block text-gray-600">
                          (Table {table.id})
                        </span>
                      </>
                    ) 
                    : <span>Table {table.id}</span>;
                  
                  return (
                    <th
                      key={`table-${table.id}`}
                      className="bg-indigo-100 text-[#586D78] font-medium p-2 border border-indigo-200"
                    >
                      {tableDisplay}
                      <span className="text-xs block text-gray-600">
                        ({totalPeople}/{table.capacity} seats)
                      </span>
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: maxSeats }).map((_, rowIndex) => (
                <tr key={`row-${rowIndex}`}>
                  {plan.tables.map(table => {
                    // Generate expanded seat list for multi-person guest units
                    const expandedSeats: Array<{
                      name: string;
                      originalGuest: Guest;
                      isMultiPerson: boolean;
                      personIndex?: number;
                    }> = [];
                    
                    table.seats.forEach((guest) => {
                      // DEBUG: verify stored count matches countHeads
                      if (guest.count !== countHeads(guest.name)) {
                        console.warn(`Guest count mismatch for "${guest.name}": stored=${guest.count}, computed=${countHeads(guest.name)}`);
                      }
                      const count = guest.count;
                      // FIXED: split names exactly like countHeads (non-capturing group)
                      const names = guest.name.split(/(?:\s+and\s+|&)/i).map(n => n.trim()).filter(Boolean);
                      if (names.length === count) {
                        names.forEach((n, i) => {
                          expandedSeats.push({ name: n, originalGuest: guest, isMultiPerson: count > 1, personIndex: i });
                        });
                      } else {
                        for (let i = 0; i < count; i++) {
                          expandedSeats.push({
                            name: guest.name + (i > 0 ? ` (${i+1})` : ''),
                            originalGuest: guest,
                            isMultiPerson: count > 1,
                            personIndex: i
                          });
                        }
                      }
                    });

                    const seatInfo = expandedSeats[rowIndex];
                    const isEmptySeat = rowIndex >= expandedSeats.length && rowIndex < table.capacity;

                    // Find all guests adjacent to the original guest (bidirectional check)
                    const adjacentGuests = seatInfo ? findAllAdjacentGuests(seatInfo.originalGuest.name) : [];
                    const adjacentCount = adjacentGuests.length;
                    const tableGuestNames = table.seats.map(g => g.name);
                    const adjacentGuestsAtTable = adjacentGuests.filter(adj => tableGuestNames.includes(adj));

                    return (
                      <td
                        key={`cell-${table.id}-${rowIndex}`}
                        className={`p-2 border ${
                          seatInfo ? 'border-indigo-200' : 'border-gray-200'
                        } ${
                          seatInfo && state.assignments[seatInfo.originalGuest?.name] ? 'bg-amber-50' : 
                          isEmptySeat ? 'bg-gray-50' : 'bg-white'
                        }`}
                      >
                        {seatInfo && (
                          <>
                            <div className="font-medium text-[#586D78]">
                              {seatInfo.name.includes('%') ? (
                                <>
                                  {seatInfo.name.split('%')[0]}
                                  <span style={{ color: '#959595' }}>%</span>
                                  {seatInfo.name.split('%')[1]}
                                </>
                              ) : seatInfo.name}
                              {seatInfo.isMultiPerson && seatInfo.originalGuest.count > 1 && (
                                <span className="text-xs text-gray-500 ml-1">
                                  ({seatInfo.personIndex + 1}/{seatInfo.originalGuest.count})
                                </span>
                              )}
                              {adjacentCount > 0 && (
                                <span className="text-[#b3b508] font-bold ml-1" title={`Adjacent to: ${adjacentGuests.join(', ')}`}>
                                  {adjacentCount === 1 ? '*' : '**'}
                                </span>
                              )}
                            </div>

                            {adjacentGuestsAtTable.length > 0 && (
                              <div className="text-xs text-amber-600 mt-1">
                                Adjacent to: {adjacentGuestsAtTable.join(', ')}
                              </div>
                            )}
                          </>
                        )}
                        {isEmptySeat && (
                          <div className="text-xs text-gray-400 text-center">Empty</div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <MapPin className="mr-2" />
        Seating Plan Viewer
        {isPremium && state.user && (
          <span className="flex items-center danstyle1c-btn danstyle1c-premium ml-2">
            <Crown className="w-4 h-4 mr-1" />
            Premium
          </span>
        )}
      </h1>

      <Card>
        <div className="space-y-4">
          <p className="text-gray-700">
            Generate and review seating plans based on your guests, tables, and constraints.
            {isPremium && state.user && (
              <span className="ml-1 text-[#586D78]">
                As a Premium user, you'll get up to 30 different seating plan options.
              </span>
            )}
          </p>

          <div className="flex flex-wrap gap-2">
            <button
              className="danstyle1c-btn"
              onClick={handleGenerateSeatingPlan}
              disabled={isGenerating || state.guests.reduce((sum, g) => sum + g.count, 0) === 0 || state.tables.length === 0}
            >
              {isGenerating ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : null}
              {isGenerating ? 'Generating...' : 'Generate Seating Plan'}
            </button>

            <button
              className="danstyle1c-btn"
              onClick={() => setShowExportModal(true)}
              disabled={state.seatingPlans.length === 0}
            >
              <Download className="w-4 h-4 mr-2" />
              Export Plans
            </button>
            
            {user && (
              <button
                className="danstyle1c-btn"
                onClick={() => setShowSaveModal(true)}
                disabled={state.seatingPlans.length === 0}
              >
                <Save className="w-4 h-4 mr-2" />
                Save Plan
              </button>
            )}
          </div>

          {errors.length > 0 && (
            <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
              <h3 className="flex items-center text-red-800 font-medium mb-2">
                <AlertCircle className="w-4 h-4 mr-1" />
                Validation Errors
              </h3>
              <ul className="list-disc pl-5 text-red-700 text-sm space-y-1">
                {errors.map((error, index) => (
                  <li key={index}>{error.message}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </Card>

      <Card title={
        <div className="flex items-center justify-between">
          <span>Seating Plan</span>
          {currentSettingName && (
            <div className={`px-3 py-1 text-sm font-medium ml-2 max-w-[280px] truncate rounded ${
              isSettingModified 
                ? "border-2 border-[#d1d5db] bg-gray-50 text-gray-700" 
                : "border-2 border-[#06b6d4] bg-cyan-50 text-[#586D78]"
            }`}>
              {currentSettingName}
            </div>
          )}
        </div>
      }>
        {renderCurrentPlan()}

        {state.seatingPlans.length > 0 && (
          <div className="mt-6 flex justify-center space-x-4">
            <button
              className="danstyle1c-btn"
              onClick={() => handleNavigatePlan(-1)}
              disabled={state.currentPlanIndex === 0}
            >
              <ArrowLeft className="w-4 h-4 mr-2" />
              Previous Plan
            </button>

            <button
              className="danstyle1c-btn"
              onClick={() => handleNavigatePlan(1)}
              disabled={state.currentPlanIndex === state.seatingPlans.length - 1}
            >
              Next Plan
              <ArrowRight className="w-4 h-4 ml-2" />
            </button>
          </div>
        )}
      </Card>

      <SavedSettingsAccordion isDefaultOpen={false} />

      {showExportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Export Options</h3>

            {exportSuccess ? (
              <div className="text-green-600 text-center py-4">
                Export successful!
              </div>
            ) : (
              <>
                <p className="text-gray-700 mb-6">
                  Choose how you'd like to export your seating plans:
                </p>

                {exportError && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                    <p className="text-red-700 text-sm">{exportError}</p>
                  </div>
                )}

                <div className="space-y-4">
                  <button
                    className="danstyle1c-btn bg-[#586D78] text-white w-full"
                    onClick={handleCopyToClipboard}
                  >
                    Copy to Clipboard
                  </button>

                  <button
                    className="danstyle1c-btn bg-[#586D78] text-white w-full"
                    onClick={handleDownloadSpreadsheet}
                  >
                    Download as Spreadsheet (CSV)
                  </button>
                </div>

                <div className="mt-6 flex justify-end">
                  <button
                    className="danstyle1c-btn"
                    onClick={() => {
                      setShowExportModal(false);
                      setExportError(null);
                    }}
                  >
                    Cancel
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Save Seating Plan</h3>

            {saveSuccess ? (
              <div className="text-green-600 text-center py-4">
                Plan saved successfully!
              </div>
            ) : (
              <>
                <p className="text-gray-700 mb-4">
                  Save your current seating plan to access it later.
                  {!isPremium && (
                    <span className="block mt-2 text-sm text-[#586D78]">
                      Free users can save up to 5 settings.
                    </span>
                  )}
                </p>

                {saveError && (
                  <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4">
                    <p className="text-red-700 text-sm">{saveError}</p>
                  </div>
                )}

                <div className="mb-4">
                  <label htmlFor="planName" className="block text-sm font-medium text-gray-700 mb-1">
                    Plan Name
                  </label>
                  <input
                    id="planName"
                    type="text"
                    value={newSettingName}
                    onChange={(e) => {
                      setNewSettingName(e.target.value);
                      setSaveError(null);
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                    placeholder="Enter a name for this plan"
                  />
                </div>

                <div className="flex justify-end space-x-2">
                  <button
                    className="danstyle1c-btn"
                    onClick={() => {
                      setShowSaveModal(false);
                      setSaveError(null);
                    }}
                    disabled={savingSettings}
                  >
                    Cancel
                  </button>
                  <button
                    className="danstyle1c-btn bg-[#586D78] text-white"
                    onClick={handleSavePlan}
                    disabled={savingSettings || !newSettingName.trim()}
                  >
                    {savingSettings ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
                    {savingSettings ? 'Saving...' : 'Save Plan'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
      
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  );
};

export default SeatingPlanViewer;