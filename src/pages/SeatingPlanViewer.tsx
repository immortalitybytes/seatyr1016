import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapPin, ArrowLeft, ArrowRight, RefreshCw, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '../components/Card';
import { getCapacity } from '../utils/tables';
import { generateSeatingPlans } from '../utils/seatingAlgorithm';
import { ValidationError } from '../types';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import { isPremiumSubscription } from '../utils/premium';
import { seatingTokensFromGuestUnit, nOfNTokensFromSuffix } from '../utils/formatters';
import { computePlanSignature } from '../utils/planSignature';
import FormatGuestName from '../components/FormatGuestName';
import { getDisplayName, extractPartySuffix } from '../utils/guestCount';

// Helper component to handle both bolding and % marker styling
const BoldedGuestName: React.FC<{ name: string; shouldBold: boolean }> = ({ name, shouldBold }) => {
  const suffix = extractPartySuffix(name);
  const display = getDisplayName(name);

  // Early return for invalid or non-special names
  if (!display || typeof display !== 'string' || !display.includes('%')) {
    const content = (
      <>
        {display}
        {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
      </>
    );
    return shouldBold ? <strong>{content}</strong> : <span>{content}</span>;
  }

  // Split on % and handle multiple % characters gracefully
  const [prefix, ...restParts] = display.split('%');
  const rest = restParts.join('%');

  // Handle edge case where % is at the end
  if (!rest.trim()) {
    const content = (
      <>
        {prefix.replace('%', '')}
        {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
      </>
    );
    return shouldBold ? <strong>{content}</strong> : <span>{content}</span>;
  }

  // Extract the first word after % for styling using robust regex
  const match = rest.match(/(\s*)(\S+)(.*)/);
  if (!match) {
    const content = (
      <>
        {prefix}{rest}
        {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
      </>
    );
    return shouldBold ? <strong>{content}</strong> : <span>{content}</span>;
  }

  const [, leadingSpace, styledWord, suffixText] = match;

  const content = (
    <>
      {prefix}
      {leadingSpace}
      <span style={{ 
        color: '#959595', 
        fontStyle: 'italic',
        fontWeight: shouldBold ? 'bold' : 'normal'
      }}>
        {styledWord}
      </span>
      {suffixText}
      {suffix && <span className="ml-0.5 font-normal">{suffix}</span>}
    </>
  );
  
  return shouldBold ? <strong>{content}</strong> : <span>{content}</span>;
};

const formatGuestNameForSeat = (rawName: string, seatIndex: number): React.ReactNode => {
    if (!rawName) return '';
    
    const originalName = rawName.trim();
    
    // Parse the guest name to extract base names and additional guests
    const baseTokens = seatingTokensFromGuestUnit(rawName);
    const extraTokens = nOfNTokensFromSuffix(rawName);
    
    // Calculate total seats needed
    const totalSeats = baseTokens.length + extraTokens.length;
    
    // Determine what to display based on seat index
    if (seatIndex < baseTokens.length) {
      // This is one of the base name tokens - bold the specific name
      const tokenToBold = baseTokens[seatIndex];
      
      // Build display with the specific name bolded and % marker styling
      const parts = originalName.split(tokenToBold);
      if (parts.length > 1) {
        return (
          <span>
            <BoldedGuestName name={parts[0]} shouldBold={false} />
            <BoldedGuestName name={tokenToBold} shouldBold={true} />
            <BoldedGuestName name={parts[1]} shouldBold={false} />
          </span>
        );
      } else {
        return <BoldedGuestName name={originalName} shouldBold={true} />;
      }
    } else {
      // This is an additional seat - show ordinal number
      const ordinalIndex = seatIndex - baseTokens.length;
      const ordinalNumber = ordinalIndex + 1;
      
      // Generate ordinal text (1st, 2nd, 3rd, etc.)
      const getOrdinalText = (num: number): string => {
        const lastDigit = num % 10;
        const lastTwoDigits = num % 100;
        
        if (lastTwoDigits >= 11 && lastTwoDigits <= 13) {
          return `${num}th`;
        }
        
        switch (lastDigit) {
          case 1: return `${num}st`;
          case 2: return `${num}nd`;
          case 3: return `${num}rd`;
          default: return `${num}th`;
        }
      };
      
      const ordinalText = getOrdinalText(ordinalNumber);
      const totalAdditional = extraTokens.length;
      
      // Build display with ordinal number bolded and % marker styling
      // Format: "BaseName + 1st (of X)"
      const baseName = baseTokens.join(' & ');
      const additionalPart = originalName.match(/[&+]|\b(?:and|plus)\b.*$/i)?.[0] || '';
      
      return (
        <span>
          <BoldedGuestName name={baseName} shouldBold={false} /> {additionalPart.replace(/\d+/, '').trim()}
          <strong> {ordinalText}</strong> (of {totalAdditional})
        </span>
      );
    }
};

const displayTableLabel = (table: { id: number; name?: string | null }, index: number): string => {
    const displayNumber = index + 1;
    const baseLabel = `Table #${displayNumber}`;
    if (!table.name || table.name.trim() === '' || table.name.trim().toLowerCase() === `table ${displayNumber}`) {
      return baseLabel;
    }
    return `Table #${displayNumber} (${table.name.trim()})`;
};


// Constants for guest pagination (matching Constraints page)
const GUEST_THRESHOLD = 120; // pagination threshold
const GUESTS_PER_PAGE = 10;

const SeatingPlanViewer: React.FC = () => {
  const { state, dispatch } = useApp();
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  
  // Guest pagination state (matching Constraints page)
  const [currentPage, setCurrentPage] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  
  // Get premium status from subscription
  const isPremium = isPremiumSubscription(state.subscription);

  const plan = state.seatingPlans[state.currentPlanIndex] ?? null;

  // Debounced auto-generation with proper signature checking
  const inFlightRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      const ready = state.guests.length && state.tables.length;
      const planSigNow = computePlanSignature(state);
      const stale = state.lastGeneratedPlanSig !== planSigNow;
      if (!ready || !stale || inFlightRef.current) return;
      inFlightRef.current = true;
      generateSeatingPlans(
        state.guests,
        state.tables,
        state.constraints,
        state.adjacents,
        state.assignments,
        isPremium
      ).then(({ plans, errors }) => {
        if (!cancelled) {
          dispatch({ type: 'SET_SEATING_PLANS', payload: plans });
          dispatch({ type: 'SET_PLAN_ERRORS', payload: errors ?? [] });
          dispatch({ type: 'SET_LAST_GENERATED_PLAN_SIG', payload: planSigNow });
        }
      }).finally(() => {
        inFlightRef.current = false;
      });
    }, 300); // Debounce window
    return () => { cancelled = true; clearTimeout(timer); };
  }, [state.assignmentSignature, state.guests, state.tables, state.constraints, state.adjacents]);

  // Guest pagination logic (matching Constraints page)
  useEffect(() => {
    setCurrentPage(0);
    if (isPremium && state.user && state.guests.length > GUEST_THRESHOLD) {
      setTotalPages(Math.ceil(state.guests.length / GUESTS_PER_PAGE));
    } else {
      setTotalPages(1);
    }
  }, [state.guests, isPremium, state.user]);

  const capacityById = useMemo(() => {
    const map = new Map<number, number>();
    state.tables.forEach(t => map.set(t.id, getCapacity(t)));
    return map;
  }, [state.tables]);

  const tablesNormalized = useMemo(() => {
    if (!plan) return [];
    return [...plan.tables].sort((a, b) => a.id - b.id);
  }, [plan]);

  // Navigation functions (matching Constraints page)
  const needsPagination = isPremium && state.user && state.guests.length > GUEST_THRESHOLD;
  const shouldShowPagination = state.guests.length >= GUEST_THRESHOLD;
  const handleNavigatePage = (delta: number) => setCurrentPage(p => Math.max(0, Math.min(totalPages - 1, p + delta)));

  const handleGenerateSeatingPlan = async () => {
      setIsGenerating(true);
      setErrors([]);
      try {
          const { plans, errors: validationErrors } = await generateSeatingPlans(
              state.guests, state.tables, state.constraints, state.adjacents, state.assignments, isPremium
          );
          if (validationErrors.length > 0) setErrors(validationErrors);
          if (plans.length > 0) {
              dispatch({ type: 'SET_SEATING_PLANS', payload: plans });
              dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
          } else if (validationErrors.length === 0) {
              setErrors([{ type: 'error', message: 'No valid seating plans could be generated. Try relaxing constraints.' }]);
          }
      } catch (e) {
          setErrors([{ type: 'error', message: 'An unexpected error occurred during plan generation.' }]);
      } finally {
          setIsGenerating(false);
      }
  };

  // Render page numbers function (matching Constraints page)
  const renderPageNumbers = () => {
    if (totalPages <= 9) {
      return Array.from({ length: totalPages }, (_, i) => (
        <button key={i} onClick={() => setCurrentPage(i)} className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-4' : 'danstyle1c-btn mx-1 w-4'}>
          {i + 1}
        </button>
      ));
    }
    const buttons: JSX.Element[] = [];
    for (let i = 0; i < 3; i++) if (i < totalPages) buttons.push(
      <button key={i} onClick={() => setCurrentPage(i)} className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-4' : 'danstyle1c-btn mx-1 w-4'}>{i + 1}</button>
    );
    if (currentPage > 2) {
      buttons.push(<span key="ellipsis1" className="mx-1">...</span>);
      if (currentPage < totalPages - 3) buttons.push(
        <button key={currentPage} onClick={() => setCurrentPage(currentPage)} className="danstyle1c-btn selected mx-1 w-4">{currentPage + 1}</button>
      );
    }
    if (currentPage < totalPages - 3) buttons.push(<span key="ellipsis2" className="mx-1">...</span>);
    for (let i = Math.max(3, totalPages - 3); i < totalPages; i++) buttons.push(
      <button key={i} onClick={() => setCurrentPage(i)} className={currentPage === i ? 'danstyle1c-btn selected mx-1 w-4' : 'danstyle1c-btn mx-1 w-4'}>{i + 1}</button>
    );
    return buttons;
  };

  const handleNavigatePlan = (delta: number) => {
    const newIndex = state.currentPlanIndex + delta;
    if (newIndex >= 0 && newIndex < state.seatingPlans.length) {
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: newIndex });
    }
  };

  const renderCurrentPlan = () => {
    if (!plan) {
      return <div className="text-center py-8 text-gray-500">No seating plan available.</div>;
    }
    
    const maxCapacity = Math.max(0, ...Array.from(capacityById.values()));

    return (
      <div className="overflow-x-auto">
        <table className="min-w-full border-collapse">
          <thead>
            <tr>
              {tablesNormalized.map((table, index) => {
                const capacity = capacityById.get(table.id) ?? 0;
                const occupied = table.seats.length;
                const tableInfo = state.tables.find(t => t.id === table.id);
                return (
                  <th key={table.id} className="bg-indigo-100 text-[#586D78] font-medium p-2 border border-indigo-200">
                    {displayTableLabel({id: table.id, name: tableInfo?.name }, index)}
                    <span className="text-xs block text-gray-600">{occupied}/{capacity} seats</span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxCapacity }).map((_, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {tablesNormalized.map(table => {
                  const capacity = capacityById.get(table.id) ?? 0;
                  if (rowIndex >= capacity) {
                    return <td key={`cell-blackout-${table.id}-${rowIndex}`} className="p-2 border border-gray-700 bg-black" aria-hidden="true" style={{ pointerEvents: 'none' }} />;
                  }
                  
                  const guestData = table.seats[rowIndex];
                  if (!guestData) {
                    return <td key={`cell-empty-${table.id}-${rowIndex}`} className="p-2 border border-gray-200 bg-gray-50"><div className="text-xs text-gray-400 text-center">Empty</div></td>;
                  }

                  // Safe type validation (Grok feature)
                  const safeName = (typeof guestData.name === 'string' && guestData.name.trim()) ? guestData.name.trim() : '';
                  const safePartyIndex = Number.isFinite((guestData as any).partyIndex) ? (guestData as any).partyIndex : -1;

                  return (
                    <td key={`cell-guest-${table.id}-${rowIndex}`} className="p-2 border border-indigo-200 align-top">
                      <div className="font-medium text-[#586D78] text-sm">
                        {formatGuestNameForSeat(safeName, safePartyIndex)}
                      </div>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Card>
          <h2 className="text-lg font-bold text-[#586D78] mb-4">Seating Plan</h2>
          <p className="text-gray-700">Generate and review seating plans based on your guests, tables, and constraints.</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="danstyle1c-btn" onClick={handleGenerateSeatingPlan} disabled={isGenerating}>
              {isGenerating && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              {isGenerating ? 'Generating...' : 'Generate Seating Plan'}
            </button>
          </div>
          {errors.length > 0 && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
                  <h3 className="flex items-center text-red-800 font-medium mb-2"><AlertCircle className="w-4 h-4 mr-1" /> Errors</h3>
                  <ul className="list-disc pl-5 text-red-700 text-sm space-y-1">
                      {errors.map((error, index) => (<li key={index}>{error.message}</li>))}
                  </ul>
              </div>
          )}
          {state.warnings && state.warnings.length > 0 && (
              <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <h3 className="flex items-center text-yellow-800 font-medium mb-2"><AlertCircle className="w-4 h-4 mr-1" /> Warnings</h3>
                  <ul className="list-disc pl-5 text-yellow-700 text-sm space-y-1">
                      {state.warnings.map((warning, index) => (<li key={index}>{warning}</li>))}
                  </ul>
              </div>
          )}
      </Card>
      <Card title={`Current Plan (${state.currentPlanIndex + 1} of ${state.seatingPlans.length})`}>
        {/* Previous/Next buttons above the grid - right justified */}
        {state.seatingPlans.length > 1 && (
          <div className="flex justify-end space-x-2 mb-4">
            <button
              className="danstyle1c-btn w-32 mx-1"
              onClick={() => handleNavigatePlan(-1)}
              disabled={state.currentPlanIndex <= 0}
            >
              ← Previous
            </button>
            <button
              className="danstyle1c-btn w-24 mx-1"
              onClick={() => handleNavigatePlan(1)}
              disabled={state.currentPlanIndex >= state.seatingPlans.length - 1}
            >
              Next
              <ArrowRight className="w-4 h-4 ml-2" />
            </button>
          </div>
        )}

        {/* Guest pagination controls - top (matching Constraints page) */}
        {shouldShowPagination && state.user && state.guests.length > 0 && (
          <div className="flex justify-end space-x-2 mb-4">
            <button className="danstyle1c-btn w-24 mx-1" onClick={() => handleNavigatePage(-1)} disabled={currentPage === 0}><ChevronLeft className="w-4 h-4 mr-1" /> Previous</button>
            <button className="danstyle1c-btn w-24 mx-1" onClick={() => handleNavigatePage(1)} disabled={currentPage >= totalPages - 1}>Next <ChevronRight className="w-4 h-4 ml-1" /></button>
          </div>
        )}

        {renderCurrentPlan()}
        
        {/* Multi-buttons below the grid */}
        {state.seatingPlans.length > 1 && (
          <div className="flex justify-center space-x-2 mt-4">
            {/* Page number buttons */}
            {state.seatingPlans.length <= 7 ? (
              // Show all page numbers if 7 or fewer
              Array.from({ length: state.seatingPlans.length }, (_, i) => (
                <button
                  key={i}
                  className={`danstyle1c-btn w-8 mx-1 ${state.currentPlanIndex === i ? 'selected' : ''}`}
                  onClick={() => dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: i })}
                >
                  {i + 1}
                </button>
              ))
            ) : (
              // Show pagination with ellipsis for many pages
              <>
                {/* First page */}
                <button
                  className={`danstyle1c-btn w-8 mx-1 ${state.currentPlanIndex === 0 ? 'selected' : ''}`}
                  onClick={() => dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 })}
                >
                  1
                </button>

                {/* Ellipsis if needed */}
                {state.currentPlanIndex > 2 && (
                  <span className="mx-2 text-gray-500">...</span>
                )}

                {/* Current page and neighbors */}
                {state.currentPlanIndex > 0 && (
                  <button
                    className="danstyle1c-btn w-8 mx-1"
                    onClick={() => dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex - 1 })}
                  >
                    {state.currentPlanIndex}
                  </button>
                )}

                <button className="danstyle1c-btn w-8 mx-1 selected">
                  {state.currentPlanIndex + 1}
                </button>

                {state.currentPlanIndex < state.seatingPlans.length - 1 && (
                  <button
                    className="danstyle1c-btn w-8 mx-1"
                    onClick={() => dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: state.currentPlanIndex + 1 })}
                  >
                    {state.currentPlanIndex + 2}
                  </button>
                )}

                {/* Ellipsis if needed */}
                {state.currentPlanIndex < state.seatingPlans.length - 3 && (
                  <span className="mx-2 text-gray-500">...</span>
                )}

                {/* Last page */}
                {state.currentPlanIndex < state.seatingPlans.length - 1 && (
                  <button
                    className={`danstyle1c-btn w-8 mx-1 ${state.currentPlanIndex === state.seatingPlans.length - 1 ? 'selected' : ''}`}
                    onClick={() => dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: state.seatingPlans.length - 1 })}
                  >
                    {state.seatingPlans.length}
                  </button>
                )}
              </>
            )}
          </div>
        )}
        
        {/* Guest pagination controls - bottom (matching Constraints page) */}
        {needsPagination && (
          <div className="flex flex-col md:flex-row items-center justify-between py-4 border-t mt-4">
            <div className="flex items-center w-full justify-between">
              <div className="pl-[140px]">
                <button onClick={() => handleNavigatePage(-1)} disabled={currentPage === 0} className="danstyle1c-btn w-24 mx-1">
                  <ChevronLeft className="w-4 h-4 mr-1" /> Previous
                </button>
              </div>
                <div className="flex flex-wrap justify-center">{renderPageNumbers()}</div>
                <div className="pr-[10px]">
                <button onClick={() => handleNavigatePage(1)} disabled={currentPage >= totalPages - 1} className="danstyle1c-btn w-24 mx-1">
                  Next <ChevronRight className="w-4 h-4 ml-1" />
                </button>
              </div>
            </div>
          </div>
        )}
        
        {/* Bottom navigation buttons - preserved */}
        {plan && (
            <div className="mt-6 flex justify-center space-x-4">
                <button className="danstyle1c-btn" onClick={() => handleNavigatePlan(-1)} disabled={state.currentPlanIndex <= 0}><ArrowLeft className="w-4 h-4 mr-2" /> Previous</button>
                <button className="danstyle1c-btn" onClick={() => handleNavigatePlan(1)} disabled={state.currentPlanIndex >= state.seatingPlans.length - 1}>Next <ArrowRight className="w-4 h-4 ml-2" /></button>
            </div>
        )}
      </Card>
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default SeatingPlanViewer;