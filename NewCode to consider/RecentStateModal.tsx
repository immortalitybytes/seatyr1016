import React, { useState } from 'react';
import { FolderOpen, FilePlus, X, Save, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { clearMostRecentState } from '../lib/mostRecentState';

interface RecentStateModalProps {
  onClose: () => void;
  onRestoreRecent: () => void;
  onKeepCurrent: () => void;
  userId: string;
  isPremium: boolean;
  recentTimestamp?: string;
}

const RecentStateModal: React.FC<RecentStateModalProps> = ({
  onClose,
  onRestoreRecent,
  onKeepCurrent,
  userId,
  isPremium,
  recentTimestamp
}) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const formattedTimestamp = recentTimestamp 
    ? new Date(recentTimestamp).toLocaleString() 
    : 'recent session';

  const handleGoToSavedSettings = async () => {
    try {
      setLoading(true);
      setError(null);
      // Clear the most recent state since the user is choosing to ignore it
      await clearMostRecentState(userId);
      onClose();
      navigate('/saved-settings');
    } catch (err) {
      console.error('Error clearing recent state:', err);
      setError('Failed to clear recent state. Please try again.');
      setLoading(false);
    }
  };

  const handleRetryRestore = async () => {
    try {
      setLoading(true);
      setError(null);
      await onRestoreRecent();
    } catch (err) {
      console.error('Error restoring recent state:', err);
      setError('Failed to restore recent state. Please try again or check your session.');
      setLoading(false);
    }
  };

  const handleKeepCurrent = async () => {
    try {
      setLoading(true);
      setError(null);
      await onKeepCurrent();
    } catch (err) {
      console.error('Error handling current state:', err);
      setError('Error processing request, but continuing with current data.');
      onClose(); // Still close the modal
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-xl font-bold text-[#586D78]">Restore Previous Session?</h2>
          <button
            onClick={onClose}
            className="danstyle1c-btn"
            aria-label="Close"
            disabled={loading}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="space-y-4">
          {recentTimestamp && (
            <p className="text-xs text-gray-500">
              Saved: {formattedTimestamp}
            </p>
          )}

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <p className="text-red-700 text-sm">{error}</p>
              <button
                className="danstyle1c-btn mt-2 text-sm"
                onClick={handleRetryRestore}
                disabled={loading}
              >
                <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                Retry
              </button>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-md p-4">
            <p className="text-amber-700">
              We found unsaved work from your {formattedTimestamp}. Would you like to restore it or continue with your current data?
            </p>
          </div>

          <div className="space-y-3">
            <button
              className="danstyle1c-btn bg-[#586D78] text-white w-full"
              onClick={handleRetryRestore}
              disabled={loading}
            >
              {loading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Save className="w-4 h-4 mr-2" />}
              {loading ? 'Restoring...' : 'Restore Previous Session'}
            </button>
            
            <button
              className="danstyle1c-btn w-full"
              onClick={handleKeepCurrent}
              disabled={loading}
            >
              <FilePlus className="w-4 h-4 mr-2" />
              Continue with Current Data
            </button>
            
            <button
              className="danstyle1c-btn w-full"
              onClick={handleGoToSavedSettings}
              disabled={loading}
            >
              <FolderOpen className="w-4 h-4 mr-2" />
              Go to Saved Settings
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RecentStateModal;