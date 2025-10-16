import React, { useState, useEffect } from "react";
import { Trash2, AlertCircle, UserPlus } from "lucide-react";
import Card from "../components/Card";
import Button from "../components/Button";
import { useApp } from "../context/AppContext";
import AuthModal from "../components/AuthModal";
import { getMaxGuestLimit, isPremiumSubscription } from "../utils/premium";
import { calculateTotalCapacity } from "../utils/tables";
import { supabase } from "../lib/supabase";
import { countHeads } from '../utils/formatters';

const useDebounce = (value: string, delay: number): string => {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => setDebouncedValue(value), delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
};

const GuestManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestCount, setNewGuestCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const isPremium = isPremiumSubscription(state.subscription);
  const debouncedGuestName = useDebounce(newGuestName, 300);

  const validateSession = async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) {
      setError("Session expired. Please log in.");
      setShowAuthModal(true);
      return null;
    }
    return data.session.user;
  };

  const handleAddGuest = async () => {
    if (!debouncedGuestName.trim()) {
      setError("Guest name cannot be empty.");
      return;
    }

    const guestId = `g-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    const count = countHeads(debouncedGuestName);
    const isDuplicate = state.guests.some(g => g.name.toLowerCase().trim() === debouncedGuestName.toLowerCase().trim());
    if (isDuplicate) {
      dispatch({ type: 'SET_WARNING', payload: [`Duplicate guest: ${debouncedGuestName}`] });
    }

    const maxGuests = getMaxGuestLimit(state.subscription);
    if (!isPremium && state.guests.length >= maxGuests) {
      setShowLimitWarning(true);
      return;
    }

    const user = await validateSession();
    if (!user) return;
    
    const newGuest = {
      id: guestId,
      name: debouncedGuestName.trim(),
      count: count
    };

    dispatch({ type: "ADD_GUEST", payload: newGuest });
    dispatch({ type: 'PURGE_PLANS' }); // Debounced
    setNewGuestName("");
    setNewGuestCount(1);
    setError(null);

    const totalNeeded = state.guests.reduce((sum, g) => sum + Math.max(1, g.count), 0) + count;
    const totalCap = calculateTotalCapacity(state.tables);
    if (totalNeeded > totalCap && state.userSetTables) {
      dispatch({
        type: "SET_WARNING",
        payload: `Capacity short (${totalCap} seats for ${totalNeeded} guests). Add tables or adjust.`
      });
    }
  };

  const handleRemoveGuest = (id: string) => {
    dispatch({ type: "REMOVE_GUEST", payload: id });
    setError(null);
  };

  const handleUpgrade = () => {
    window.location.href = "https://x.ai/grok";
  };
  
  return (
    <div className="space-y-6">
      {state.warnings && state.warnings.length > 0 && (
        <div className="text-red-50 mt-2">
          {state.warnings.map(w => <p key={w}>{w}</p>)}
        </div>
      )}
      
      <Card title="Guest Manager">
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name</label>
              <input
                type="text"
                value={newGuestName}
                onChange={(e) => setNewGuestName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleAddGuest();
                  }
                }}
                placeholder="Enter guest name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                role="textbox"
                aria-label="Guest name input"
              />
            </div>
            <div className="w-32">
              <label className="block text-sm font-medium text-gray-700 mb-1">Party Size</label>
              <input
                type="number"
                value={newGuestCount}
                onChange={(e) => setNewGuestCount(parseInt(e.target.value) || 1)}
                min="1"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                role="spinbutton"
                aria-label="Party size input"
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="primary"
                onClick={handleAddGuest}
                disabled={!debouncedGuestName.trim() || newGuestCount < 1}
                icon={<UserPlus className="w-4 h-4 mr-2" />}
                role="button"
                aria-label="Add guest"
              >
                Add Guest
              </Button>
            </div>
          </div>
          {error && (
            <div className="mt-2 bg-red-50 border border-red-200 rounded-md p-2 flex items-center">
              <AlertCircle className="w-4 h-4 text-red-600 mr-2" />
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}
        </div>
        {state.guests.length === 0 ? (
          <p className="text-gray-500 text-center py-4">No guests added yet. Add a guest to get started.</p>
        ) : (
          <div className="space-y-4">
            {state.guests.map(guest => (
              <div key={guest.id} className="flex items-center justify-between p-4 border rounded-lg bg-white hover:bg-gray-50">
                <div>
                  <span className="font-medium text-[#586D78]">{guest.name}</span>
                  <span className="ml-2 text-xs text-gray-500">(Party of {guest.count})</span>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  onClick={() => handleRemoveGuest(guest.id)}
                  icon={<Trash2 className="w-4 h-4" />}
                  role="button"
                  aria-label={`Remove guest ${guest.name}`}
                >
                  Remove
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showLimitWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4 text-[#586D78]">Guest Limit Reached</h3>
            <p className="text-gray-700 mb-6">
              You've reached the guest limit for free accounts. Upgrade to Premium for unlimited guests.
            </p>
            <div className="flex justify-end space-x-2">
              <Button
                variant="secondary"
                onClick={() => setShowLimitWarning(false)}
                role="button"
                aria-label="Cancel upgrade"
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-[#586D78] text-white"
                onClick={handleUpgrade}
                role="button"
                aria-label="Upgrade to Premium"
              >
                Upgrade to Premium
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default GuestManager;