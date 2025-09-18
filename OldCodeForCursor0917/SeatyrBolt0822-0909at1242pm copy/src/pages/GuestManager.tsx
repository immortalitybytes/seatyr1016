import React, { useState } from "react";
import { Trash2, AlertCircle, UserPlus } from "lucide-react";
import Card from "../components/Card";
import Button from "../components/Button";
import { useApp } from "../context/AppContext";
import AuthModal from "../components/AuthModal";
import { getMaxGuestLimit, isPremiumSubscription } from "../utils/premium";
import { calculateTotalCapacity } from "../utils/tables";

const GuestManager: React.FC = () => {
  const { state, dispatch } = useApp();
  const [newGuestName, setNewGuestName] = useState("");
  const [newGuestCount, setNewGuestCount] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const isPremium = isPremiumSubscription(state.subscription);

  const handleAddGuest = async () => {
    if (!newGuestName.trim()) {
      setError("Guest name cannot be empty.");
      return;
    }
    if (state.guests.some(g => g.name.toLowerCase() === newGuestName.trim().toLowerCase())) {
      setError("Guest name already exists.");
      return;
    }
    if (newGuestCount < 1) {
      setError("Party size must be at least 1.");
      return;
    }

    const maxGuests = getMaxGuestLimit(state.subscription);
    if (!isPremium && state.guests.length >= maxGuests) {
      setShowLimitWarning(true);
      return;
    }

    if (!state.user) {
      setShowAuthModal(true);
      return;
    }

    const newGuest = {
      id: `g${state.guests.length + 1}`,
      name: newGuestName.trim(),
      count: newGuestCount,
    };

    dispatch({ type: "ADD_GUEST", payload: newGuest });
    setNewGuestName("");
    setNewGuestCount(1);
    setError(null);

    // Capacity warn after add
    const totalNeeded = state.guests.reduce((sum, g) => sum + Math.max(1, g.count), 0) + newGuestCount;
    const totalCap = calculateTotalCapacity(state.tables);
    if (totalNeeded > totalCap && state.userSetTables) {
      dispatch({
        type: "SET_WARNING",
        payload: `Capacity short (${totalCap} seats for ${totalNeeded} guests). Add or adjust tables.`,
      });
    }
  };

  const handleRemoveGuest = (id: string) => {
    dispatch({ type: "REMOVE_GUEST", payload: id });
    setError(null);
  };

  const handleUpgrade = () => {
    window.location.href = "https://x.ai/grok"; // Redirect to subscription
  };

  return (
    <div className="space-y-6">
      <Card title="Guest Manager">
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:space-x-4 space-y-4 sm:space-y-0">
            <div className="flex-1">
              <label className="block text-sm font-medium text-gray-700 mb-1">Guest Name</label>
              <input
                type="text"
                value={newGuestName}
                onChange={(e) => setNewGuestName(e.target.value)}
                placeholder="Enter guest name"
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
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
              />
            </div>
            <div className="flex items-end">
              <Button
                variant="primary"
                onClick={handleAddGuest}
                disabled={!newGuestName.trim() || newGuestCount < 1}
                icon={<UserPlus className="w-4 h-4 mr-2" />}
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
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                className="bg-[#586D78] text-white"
                onClick={handleUpgrade}
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