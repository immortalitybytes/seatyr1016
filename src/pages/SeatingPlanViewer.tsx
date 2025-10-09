// SeatingPlanViewer.tsx

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import { Settings, Play, RefreshCw, ChevronLeft, ChevronRight, AlertTriangle, Info } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription, getMaxSavedSettingsLimit } from '../utils/premium';
import { generateSeatingPlans } from '../utils/seatingAlgorithm'; // Note: This should ideally not be called directly
import { Table, SeatingPlan, ValidationError } from '../types';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import { getCapacity } from '../utils/tables';
import { computePlanSignature } from '../utils/planSignature';
import FormatGuestName from '../components/FormatGuestName';

// NOTE: Since the full utility library is not provided, we must rely on the existing imported signature
// The fix assumes isPremiumSubscription is updated to accept trial status, and we route through dispatch.

const SeatingPlanViewer: React.FC = () => {
  const { state, dispatch, isPremium } = useApp();
  const [isGenerating, setIsGenerating] = useState(false);
  const [errors, setErrors] = useState<ValidationError[]>(state.planErrors || []);
  const plans = state.seatingPlans || [];
  
  // CRUCIAL FIX B: Ensure isPremium status is derived using ALL inputs (subscription AND trial)
  // We rely on the enhanced isPremium in useApp(), but if calling generatePlans locally, must ensure it's passed.
  const isPremiumNow = useMemo(() => isPremiumSubscription(state.subscription, state.trial), [state.subscription, state.trial]);
  const maxPlans = isPremiumNow ? 30 : 10;
  
  useEffect(() => {
    // Sync errors from state after plan generation runs in AppContext
    setErrors(state.planErrors || []);
    // Stop spinner if generation was initiated locally and plans/errors have updated
    if (isGenerating && (plans.length > 0 || state.planErrors.length > 0)) {
        setIsGenerating(false);
    }
  }, [state.planErrors, plans.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // SURGICAL TASK 1: Persistence - restore index if signature unchanged, clear if mismatch
  useEffect(() => {
    const userKey = state.user?.id || 'unsigned';
    const currentSig = computePlanSignature(
      state.guests, state.tables, state.constraints, state.adjacents, state.assignments
    );
    const saved = localStorage.getItem(`seatyr_plan_${userKey}`);
    
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (parsed.sig === currentSig && parsed.index != null && plans.length > 0) {
          // Signature matches: restore index
          dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: parsed.index });
        } else if (parsed.sig !== currentSig && plans.length > 0) {
          // Signature mismatch: clear plans
          dispatch({ type: 'SET_SEATING_PLANS', payload: { plans: [], planErrors: [], currentPlanIndex: 0 } });
        }
      } catch {}
    }
  }, [state.guests, state.tables, state.constraints, state.adjacents, state.assignments, state.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleNextPlan = () => {
    if (plans.length > 0) {
      dispatch({ 
        type: 'SET_CURRENT_PLAN_INDEX', 
        payload: (state.currentPlanIndex + 1) % plans.length 
      });
    }
  };

  const handlePrevPlan = () => {
    if (plans.length > 0) {
      dispatch({ 
        type: 'SET_CURRENT_PLAN_INDEX', 
        payload: (state.currentPlanIndex - 1 + plans.length) % plans.length 
      });
    }
  };
  
  // SURGICAL TASK 1: Generate button only dispatches GENERATE_PLANS (no payload needed)
  const handleGenerateSeatingPlan = () => {
    setIsGenerating(true);
    setErrors([]);
    dispatch({ type: 'GENERATE_PLANS' });
  };
  
  const currentPlan = plans[state.currentPlanIndex] || null;
  const tables = state.tables || [];
  const totalGuests = state.guests.reduce((sum, g) => sum + (g.count || 1), 0);
  const totalSeats = tables.reduce((sum, t) => sum + getCapacity(t), 0);
  
  // Calculate unseated guests
  const seatedGuestIds = new Set(currentPlan?.tables.flatMap(t => t.seats.map(s => s.id)).filter(Boolean) || []);
  const unseatedGuests = state.guests.filter(g => !seatedGuestIds.has(g.id));


  const renderTable = (planTable: PlanTable) => {
    const originalTable = tables.find(t => t.id === planTable.id);
    const tableCapacity = getCapacity(originalTable || planTable);
    const seatsFilled = planTable.seats.length;
    
    const isOverCapacity = seatsFilled > tableCapacity;

    return (
      <Card key={planTable.id} className="h-full">
        <div className="flex justify-between items-start mb-3">
          <h3 className="text-xl font-bold text-[#586D78]">
            Table {planTable.id}
            {originalTable?.name && (
              <span className="text-base font-normal text-gray-600 ml-2">({originalTable.name})</span>
            )}
          </h3>
          <div className={`text-sm font-semibold p-1 rounded ${isOverCapacity ? 'bg-red-100 text-red-700' : 'bg-indigo-100 text-[#586D78]'}`}>
            {seatsFilled} / {tableCapacity} Seats
          </div>
        </div>
        
        {isOverCapacity && (
            <div className="mb-3 bg-red-50 border border-red-200 p-2 rounded flex items-center">
                <AlertTriangle className="w-4 h-4 text-red-500 mr-2" />
                <p className="text-sm text-red-700">Warning: Table is over capacity!</p>
            </div>
        )}

        <ul className="space-y-2">
          {planTable.seats.map((seat, index) => (
            <li key={index} className={`p-2 rounded-md flex justify-between items-center ${seat.partyIndex === 0 ? 'bg-white border' : 'bg-gray-50 text-gray-600 border border-dashed'}`}>
              <span className="font-medium">
                <FormatGuestName name={seat.name} />
              </span>
              <span className="text-xs text-gray-500">
                {seat.partyIndex === 0 ? 'Lead Guest' : `Party Member ${seat.partyIndex + 1}`}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    );
  };

  if (!currentPlan) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <Settings className="mr-2" />
          Seating Plan Viewer
        </h1>

        <Card title="Generate Seating Plan">
          <div className="space-y-4 text-center p-8">
            <Settings className="w-12 h-12 text-[#586D78] mx-auto" />
            <p className="text-lg text-gray-700">
              Your seating plan hasn't been generated yet.
            </p>
            <p className="text-sm text-gray-500">
              Click the button below to process your guests, tables, and constraints.
            </p>

            <Button 
              onClick={handleGenerateSeatingPlan}
              disabled={isGenerating || state.guests.length === 0 || tables.length === 0}
              icon={isGenerating ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5" />}
              variant="primary"
            >
              {isGenerating ? 'Generating...' : 'Generate Plan'}
            </Button>
            
            {state.guests.length === 0 && (
                <p className="text-sm text-red-500">Please add guests first.</p>
            )}
            {tables.length === 0 && (
                <p className="text-sm text-red-500">Please add tables first.</p>
            )}
            
          </div>
        </Card>
        
        <SavedSettingsAccordion isDefaultOpen={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center justify-between">
        <span className="flex items-center">
          <Settings className="mr-2" />
          Seating Plan Viewer
        </span>
        <Button 
          onClick={handleGenerateSeatingPlan}
          disabled={isGenerating || state.guests.length === 0 || tables.length === 0}
          icon={isGenerating ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
          variant="primary"
          size="sm"
        >
          {isGenerating ? 'Generating...' : 'Re-Generate Plan'}
        </Button>
      </h1>

      <Card>
        <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
          <div className="text-gray-700 text-sm">
            Plan {state.currentPlanIndex + 1} of {plans.length} available results (Max: {maxPlans}).
            {unseatedGuests.length > 0 && (
                <span className="ml-4 text-red-600 font-medium flex items-center">
                    <AlertTriangle className="w-4 h-4 mr-1"/>
                    {unseatedGuests.length} guests ({unseatedGuests.reduce((s, g) => s + g.count, 0)} seats) remain unseated.
                </span>
            )}
          </div>
          <div className="flex space-x-2">
            <Button 
              onClick={handlePrevPlan} 
              disabled={plans.length <= 1 || isGenerating}
              icon={<ChevronLeft className="w-4 h-4" />}
              variant="secondary"
              size="sm"
            >
              Previous
            </Button>
            <Button 
              onClick={handleNextPlan} 
              disabled={plans.length <= 1 || isGenerating}
              icon={<ChevronRight className="w-4 h-4" />}
              variant="secondary"
              size="sm"
            >
              Next
            </Button>
          </div>
        </div>
        
        <div className="space-y-4">
          <div className="flex space-x-6 text-sm text-gray-600">
            <p>Total Guests: {totalGuests}</p>
            <p>Total Seats Available: {totalSeats}</p>
            <p>Seating Ratio: {totalGuests} / {totalSeats} ({(totalGuests / totalSeats * 100).toFixed(1)}%)</p>
          </div>
        </div>
        
        {errors.length > 0 && (
          <div className="mt-4 mb-4 bg-red-50 border border-red-200 rounded-md p-4">
            <h3 className="text-lg font-semibold text-red-700 mb-2">Errors & Warnings</h3>
            <ul className="space-y-2">
              {errors.map((error, index) => (
                <li key={index} className="flex items-start text-sm text-red-700">
                  <AlertTriangle className="w-4 h-4 mr-2 mt-0.5 flex-shrink-0" />
                  <span>{error.message}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        
        <div className="mt-6 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {currentPlan.tables.map(renderTable)}
        </div>
        
        {unseatedGuests.length > 0 && (
            <Card title="Unseated Guests" className="mt-6 bg-yellow-50 border-yellow-200">
                <ul className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                    {unseatedGuests.map(guest => (
                        <li key={guest.id} className="text-sm text-yellow-800 bg-yellow-100 p-2 rounded-md">
                            <FormatGuestName name={guest.name} /> ({guest.count} seats)
                        </li>
                    ))}
                </ul>
                <p className="text-xs text-gray-500 mt-3 flex items-center">
                    <Info className="w-3 h-3 mr-1" />
                    Guests may be unseated due to capacity limits or conflicting constraints.
                </p>
            </Card>
        )}
      </Card>
      
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default SeatingPlanViewer;