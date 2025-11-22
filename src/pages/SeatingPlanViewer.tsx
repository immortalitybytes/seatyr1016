import React, { useState, useEffect, useMemo, useRef } from 'react';
import { MapPin, ArrowLeft, ArrowRight, RefreshCw, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react';
import Card from '../components/Card';
import { getCapacity } from '../utils/tables';
import { generateSeatingPlans } from '../utils/seatingAlgorithm';
import { ValidationError } from '../types';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import { seatingTokensFromGuestUnit, nOfNTokensFromSuffix } from '../utils/formatters';
import { computePlanSignature } from '../utils/planSignature';
import FormatGuestName from '../components/FormatGuestName';
import { getDisplayName, extractPartySuffix } from '../utils/guestCount';
import { formatGuestUnitName } from '../utils/formatGuestName';
import { useApp } from '../context/AppContext'; // SEATYR-CANONICAL-IMPORT

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
    
    // Ensure the name is formatted before processing (defensive - should already be formatted)
    const formattedName = formatGuestUnitName(rawName.trim());
    const originalName = formattedName;
    
    // Parse the guest name to extract base names and additional guests
    const baseTokens = seatingTokensFromGuestUnit(formattedName);
    const extraTokens = nOfNTokensFromSuffix(formattedName);
    
    // Fallback: parse numeric suffix directly from formatted name if token parsing fails
    const plusSuffixMatch = formattedName.match(/[&+]\s*(\d+)\s*$/);
    const plusSuffixCount = plusSuffixMatch ? parseInt(plusSuffixMatch[1], 10) : 0;
    
    // Prefer extraTokens length, but fall back to numeric suffix if needed
    const totalAdditional = extraTokens.length > 0
      ? extraTokens.length
      : Math.max(0, plusSuffixCount);
    
    // Calculate total seats needed
    const totalSeats = baseTokens.length + totalAdditional;
    
    // Clamp seatIndex to valid range
    const safeSeatIndex = Math.max(0, Math.min(seatIndex, Math.max(0, totalSeats - 1)));
    
    // Determine what to display based on seat index
    if (safeSeatIndex < baseTokens.length) {
      // This is one of the base name tokens - bold the specific name
      const tokenToBold = baseTokens[safeSeatIndex];
      
      // Reconstruct the name with proper spacing using normalized format ( + )
      // Since formattedName uses normalized spacing ( + ), we use baseTokens directly
      const tokenIndex = safeSeatIndex;
      
      // Build display by reconstructing with proper spacing
      const beforeParts: string[] = [];
      const afterParts: string[] = [];
      
      // Collect tokens before the one to bold
      for (let i = 0; i < tokenIndex && i < baseTokens.length; i++) {
        beforeParts.push(baseTokens[i]);
      }
      
      // Collect tokens after the one to bold
      for (let i = tokenIndex + 1; i < baseTokens.length; i++) {
        afterParts.push(baseTokens[i]);
      }
      
      // Reconstruct with normalized spacing ( + )
      const beforeText = beforeParts.length > 0 ? beforeParts.join(' + ') : '';
      const afterText = afterParts.length > 0 ? afterParts.join(' + ') : '';
      
      // Build the display with proper spacing around connectors
      // Check if there are additional guests to append
      const hasAdditionalGuests = totalAdditional > 0;
      let suffixNumber = '';
      if (hasAdditionalGuests) {
        if (totalAdditional === 1) {
          suffixNumber = '1';
        } else {
          const suffixMatch = originalName.match(/\s+\+\s+(\d+)\s*$/);
          suffixNumber = suffixMatch ? suffixMatch[1] : String(totalAdditional);
        }
      }
      
      if (beforeText && afterText) {
        return (
          <span>
            <BoldedGuestName name={beforeText} shouldBold={false} /> + <BoldedGuestName name={tokenToBold} shouldBold={true} /> + <BoldedGuestName name={afterText} shouldBold={false} />
            {hasAdditionalGuests && <>{totalAdditional === 1 ? ' + 1' : ` + ${suffixNumber}`}</>}
          </span>
        );
      } else if (beforeText) {
        return (
          <span>
            <BoldedGuestName name={beforeText} shouldBold={false} /> + <BoldedGuestName name={tokenToBold} shouldBold={true} />
            {hasAdditionalGuests && <>{totalAdditional === 1 ? ' + 1' : ` + ${suffixNumber}`}</>}
          </span>
        );
      } else if (afterText) {
        return (
          <span>
            <BoldedGuestName name={tokenToBold} shouldBold={true} /> + <BoldedGuestName name={afterText} shouldBold={false} />
            {hasAdditionalGuests && <>{totalAdditional === 1 ? ' + 1' : ` + ${suffixNumber}`}</>}
          </span>
        );
      } else {
        // Single token - check if there are additional guests to append
        if (totalAdditional > 0) {
          if (totalAdditional === 1) {
            // +1 case: Show "*name* + 1"
            return (
              <span>
                <BoldedGuestName name={tokenToBold} shouldBold={true} /> + 1
              </span>
            );
          } else {
            // +N case: Show "*name* + N" (where N is the number)
            const suffixMatch = originalName.match(/\s+\+\s+(\d+)\s*$/);
            const suffixNumber = suffixMatch ? suffixMatch[1] : String(totalAdditional);
            return (
              <span>
                <BoldedGuestName name={tokenToBold} shouldBold={true} /> + {suffixNumber}
              </span>
            );
          }
        } else {
          // Single token with no additional guests - just bold it
          return <BoldedGuestName name={tokenToBold} shouldBold={true} />;
        }
      }
    } else {
      // This is an additional seat - show ordinal number
      const ordinalIndex = safeSeatIndex - baseTokens.length;
      const ordinalNumber = ordinalIndex + 1;
      
      // Clamp ordinalNumber to [1, totalAdditional]
      const safeOrdinalNumber = totalAdditional > 0
        ? Math.min(Math.max(1, ordinalNumber), totalAdditional)
        : 1;
      
      const baseName = baseTokens.join(' + ');
      
      // Guard: If we think there are "extra" seats but couldn't parse any extras
      if (totalAdditional <= 0) {
        // Fallback: just show the base name
        return <span>{baseName}</span>;
      }
      
      // +1 case: second seat → "BaseName + *1*" (no "(of X)")
      if (totalAdditional === 1) {
        return (
          <span>
            <BoldedGuestName name={baseName} shouldBold={false} /> <strong>+ 1</strong>
          </span>
        );
      }
      
      // totalAdditional > 1 → "+N" case
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
      
      const ordinalText = getOrdinalText(safeOrdinalNumber);
      
      return (
        <span>
          <BoldedGuestName name={baseName} shouldBold={false} />{' '}
          <strong>+{ordinalText}</strong> (of {totalAdditional})
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


const SeatingPlanViewer: React.FC = () => {
  const { state, dispatch, mode, sessionTag, lockTableFromCurrentPlan, unlockTable } = useApp();
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  
  // B1: Add refs for state-driven completion
  const lastSeenSignatureRef = useRef<string | null>(null);
  const generationStartTimeRef = useRef<number | null>(null);
  const prevHadPlansRef = useRef<boolean>(false);
  
  // Get premium status from subscription
  const isPremium = mode === 'premium';
  
  // CRITICAL: Safety check to prevent crashes
  const safeSeatingPlans = state.seatingPlans || [];
  const safeCurrentPlanIndex = state.currentPlanIndex || 0;

  const plan = safeSeatingPlans[safeCurrentPlanIndex] ?? null;

  // Mode-aware: Signal mount to trigger auto-generation (SSoT)
  useEffect(() => {
    dispatch({ type: 'SEATING_PAGE_MOUNTED' });
  }, [dispatch]);

  const capacityById = useMemo(() => {
    const map = new Map<number, number>();
    state.tables.forEach(t => map.set(t.id, getCapacity(t)));
    return map;
  }, [state.tables]);

  const tablesNormalized = useMemo(() => {
    if (!plan) return [];
    return [...plan.tables].sort((a, b) => a.id - b.id);
  }, [plan]);

  // Calculate number of guests (seats needed) and total seats available for current plan
  const planMetrics = useMemo(() => {
    if (!plan) {
      return { numberOfGuests: 0, numberOfSeats: 0 };
    }
    
    // Count total guests (sum of all guest.count values from state.guests)
    // This represents total number of people requiring seats, not just assigned seats in the plan
    const numberOfGuests = state.guests.reduce((sum, guest) => {
      return sum + Math.max(1, guest.count ?? 1);
    }, 0);
    
    // Count total seats available from plan tables
    // Use plan-specific capacity if available (from engine), otherwise fallback to capacityById
    const numberOfSeats = plan.tables.reduce((sum, table) => {
      const capacity = (table as any).capacity ?? capacityById.get(table.id) ?? 0;
      return sum + capacity;
    }, 0);
    
    return { numberOfGuests, numberOfSeats };
  }, [plan, state.guests, capacityById]);

  // Lock table helpers
  const isTableLocked = (tableId: number): boolean => {
    return !!(state.lockedTableAssignments?.[tableId]?.length);
  };

  const handleLockToggle = (tableId: number) => {
    if (isTableLocked(tableId)) {
      unlockTable(tableId);
    } else {
      lockTableFromCurrentPlan(tableId);
    }
  };
  
  // Loading guard - use state.isReady (single source of truth)
  if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING' || !state.isReady) {
    return (
      <div className="flex items-center justify-center min-h-[300px]" role="status" aria-label="Loading...">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600 mr-3" aria-hidden="true"></div>
        <span>Loading...</span>
      </div>
    );
  }

  // B3: Harden the generation trigger
  const handleGenerateSeatingPlan = () => {
    if (state.regenerationNeeded) {
      console.log("[SeatingPlanViewer] Generation already in progress");
      return;
    }

    lastSeenSignatureRef.current = state.lastGeneratedSignature ?? null;
    generationStartTimeRef.current = Date.now();

    setErrors([]);
    setIsGenerating(true);
    dispatch({ type: "TRIGGER_REGENERATION" });
  };
  
  // Detect when auto-generation starts (regenerationNeeded becomes true)
  useEffect(() => {
    // If regeneration is needed and we're not already tracking a generation, start tracking
    if (state.regenerationNeeded && generationStartTimeRef.current === null && !isGenerating) {
      console.log("[SeatingPlanViewer] Auto-generation detected, starting tracking");
      lastSeenSignatureRef.current = state.lastGeneratedSignature ?? null;
      generationStartTimeRef.current = Date.now();
      setIsGenerating(true);
      setErrors([]);
    }
  }, [state.regenerationNeeded, isGenerating, state.lastGeneratedSignature]);

  // B2: Replace timer-based completion with state-driven effect + safety timeout
  useEffect(() => {
    // 30s safety valve to prevent indefinite spinner during an active generation
    if (isGenerating && generationStartTimeRef.current !== null) {
      const elapsed = Date.now() - generationStartTimeRef.current;
      if (elapsed > 30_000) {
        console.error("[SeatingPlanViewer] Generation timeout after 30s");
        setIsGenerating(false);
        setErrors([{ type: "error", message: "Generation took too long. Try simplifying your constraints." }]);
        generationStartTimeRef.current = null;
        prevHadPlansRef.current = (state.seatingPlans?.length ?? 0) > 0;
        return;
      }
    }

    const hasPlans = (state.seatingPlans?.length ?? 0) > 0;

    // Fire the "plans appeared" path only once per active generation cycle
    const becameValidThisCycle =
      generationStartTimeRef.current !== null &&
      hasPlans &&
      !prevHadPlansRef.current;

    const completed =
      // Complete when regeneration is done (either manual or auto)
      generationStartTimeRef.current !== null &&
      state.regenerationNeeded === false &&
      (
        // Normal: signature advanced
        (state.lastGeneratedSignature !== null && lastSeenSignatureRef.current !== state.lastGeneratedSignature)
        // Same-signature success: plans newly appeared this cycle
        || becameValidThisCycle
        // Or if we have plans and regeneration completed (fallback for edge cases)
        || (hasPlans && !state.regenerationNeeded)
      );

    // Track transition before any early return
    prevHadPlansRef.current = hasPlans;

    if (!completed) return;

    // Mark the generation cycle as finished and update refs
    lastSeenSignatureRef.current = state.lastGeneratedSignature;
    generationStartTimeRef.current = null;

    setIsGenerating(false);

    if (hasPlans) {
      // Success path: clear any lingering local errors
      setErrors([]);
    } else {
      // Failure path: show the standard message
      setErrors([{ type: "error", message: "No valid seating plans could be generated. Try relaxing your constraints." }]);
    }
  }, [isGenerating, state.regenerationNeeded, state.lastGeneratedSignature, state.seatingPlans]);

  const handleNavigatePlan = (delta: number) => {
    const newIndex = state.currentPlanIndex + delta;
    if (newIndex >= 0 && newIndex < safeSeatingPlans.length) {
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
                const locked = isTableLocked(table.id);
                return (
                  <th key={table.id} className={`bg-indigo-100 text-[#586D78] font-medium p-2 ${locked ? "border-4 border-green-800 bg-green-50" : "border border-indigo-200"}`}>
                    {displayTableLabel({id: table.id, name: tableInfo?.name }, index)}
                    <div className="flex items-center gap-2">
                      <span className="text-xs block text-gray-600">{occupied}/{capacity} seats</span>
                      <button
                        type="button"
                        onClick={() => handleLockToggle(table.id)}
                        className="inline-flex items-center justify-center text-xs"
                        aria-label={isTableLocked(table.id) ? 'Unlock table' : 'Lock table'}
                        aria-pressed={isTableLocked(table.id)}
                      >
                        {isTableLocked(table.id) ? '🔒' : '⛓️‍💥'}
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: maxCapacity }).map((_, rowIndex) => (
              <tr key={`row-${rowIndex}`}>
                {tablesNormalized.map(table => {
                  // CRITICAL FIX: Use plan's table capacity, not state.tables capacity
                  const capacity = table.capacity ?? capacityById.get(table.id) ?? 0;
                  if (rowIndex >= capacity) {
                    return <td key={`cell-blackout-${table.id}-${rowIndex}`} className="p-2 border border-gray-700 bg-black" aria-hidden="true" style={{ pointerEvents: 'none' }} />;
                  }
                  
                  const guestData = table.seats[rowIndex];
                  const locked = isTableLocked(table.id);
                  if (!guestData) {
                    return <td key={`cell-empty-${table.id}-${rowIndex}`} className={`p-2 ${locked ? "border-4 border-green-800 bg-green-50" : "border border-gray-200 bg-gray-50"}`}><div className="text-xs text-gray-400 text-center">Empty</div></td>;
                  }

                  // Safe type validation (Grok feature)
                  const rawName = (typeof guestData.name === 'string' && guestData.name.trim()) ? guestData.name.trim() : '';
                  // Apply formatting to ensure consistent spacing (handles legacy plans with unformatted names)
                  const safeName = formatGuestUnitName(rawName);
                  const safePartyIndex = Number.isFinite((guestData as any).partyIndex) ? (guestData as any).partyIndex : -1;

                  const lockedGuestsForTable = new Set((state.lockedTableAssignments?.[table.id] ?? []).map(String));
                  
                  // TypeScript-safe guest identifier detection (per addendum)
                  const seatAny = guestData as any; // minimal local cast ONLY for optional runtime fields
                  const seatGuestKey =
                    seatAny.guestId != null ? String(seatAny.guestId) :
                    (guestData as any).id != null ? String((guestData as any).id) :
                    null;

                  const isLockedGuest =
                    seatGuestKey != null && lockedGuestsForTable.has(seatGuestKey);

                  return (
                    <td key={`cell-guest-${table.id}-${rowIndex}`} className={`p-2 ${locked ? "border-4 border-green-800 bg-green-50" : "border border-indigo-200"} align-top`}>
                      <div
                        className={`font-medium text-sm ${
                          isLockedGuest
                            ? 'text-green-900 font-semibold'
                            : 'text-[#586D78]'
                        }`}
                      >
                        {isLockedGuest && <span className="mr-1 text-green-900">●</span>}
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
          <p className="text-gray-700">Generate and review seating plans based on your guests, tables, and constraints. {mode === 'premium' ? 'Premium: up to 30 plans' : 'Free: up to 10 plans'}</p>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="danstyle1c-btn" onClick={handleGenerateSeatingPlan} disabled={isGenerating}>
              {isGenerating && <RefreshCw className="w-4 h-4 mr-2 animate-spin" />}
              {isGenerating ? `Generating ${mode === 'premium' ? '30' : '10'} plans...` : `Generate ${mode === 'premium' ? '30' : '10'} Seating Plans`}
            </button>
          </div>
          {errors.length > 0 && (state.seatingPlans?.length ?? 0) === 0 && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3">
                  <h3 className="flex items-center text-red-800 font-medium mb-2"><AlertCircle className="w-4 h-4 mr-1" /> Errors</h3>
                  <ul className="list-disc pl-5 text-red-700 text-sm space-y-1">
                      {errors.map((error, index) => (<li key={index}>{error.message}</li>))}
                  </ul>
              </div>
          )}
          {state.warnings && state.warnings.length > 0 && (state.seatingPlans?.length ?? 0) === 0 && (
              <div className="mt-4 bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <h3 className="flex items-center text-yellow-800 font-medium mb-2"><AlertCircle className="w-4 h-4 mr-1" /> Warnings</h3>
                  <ul className="list-disc pl-5 text-yellow-700 text-sm space-y-1">
                      {state.warnings.map((warning, index) => (<li key={index}>{warning}</li>))}
                  </ul>
              </div>
          )}
      </Card>
      <Card title={`Current Plan (${safeCurrentPlanIndex + 1} of ${safeSeatingPlans.length})`}>
        {/* Guest/Seats count and navigation buttons on same row */}
        <div className="flex justify-between items-center mb-4">
          {/* Left-justified: Guest and Seats count */}
          <div className="text-sm text-[#586D78]">
            Number of Guests: {planMetrics.numberOfGuests} / Number of Seats: {planMetrics.numberOfSeats}
          </div>
          {/* Right-justified: Previous/Next buttons */}
          {safeSeatingPlans.length > 1 && (
            <div className="flex space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={() => handleNavigatePlan(-1)}
                disabled={safeCurrentPlanIndex <= 0}
              >
                <ChevronLeft className="w-4 h-4 mr-1" /> Previous
              </button>
              <button
                className="danstyle1c-btn"
                onClick={() => handleNavigatePlan(1)}
                disabled={safeCurrentPlanIndex >= safeSeatingPlans.length - 1}
              >
                Next <ChevronRight className="w-4 h-4 ml-1" />
              </button>
            </div>
          )}
        </div>

        {renderCurrentPlan()}
        
        {/* Below grid (centered): 3-button Previous/Page#/Next for plan navigation */}
        {safeSeatingPlans.length > 1 && (
          <div className="flex justify-center items-center gap-3 mt-4">
            <button
              className="danstyle1c-btn"
              onClick={() => handleNavigatePlan(-1)}
              disabled={safeCurrentPlanIndex <= 0}
            >
              <ChevronLeft className="w-4 h-4 mr-1" /> Previous
            </button>
            <button className="danstyle1c-btn selected">
              {safeCurrentPlanIndex + 1}
            </button>
            <button
              className="danstyle1c-btn"
              onClick={() => handleNavigatePlan(1)}
              disabled={safeCurrentPlanIndex >= safeSeatingPlans.length - 1}
            >
              Next <ChevronRight className="w-4 h-4 ml-1" />
            </button>
          </div>
        )}
      </Card>
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default SeatingPlanViewer;