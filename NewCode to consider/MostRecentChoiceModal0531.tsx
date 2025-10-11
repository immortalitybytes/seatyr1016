import React, { useState } from 'react';
import { X, Save, FilePlus, FolderOpen, RefreshCw } from 'lucide-react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';
import { clearMostRecentState } from '../lib/mostRecentState';

interface Props {
  userId: string;
  isPremium: boolean;
  recentTimestamp?: string;
  onClose: () => void;
  onRestoreRecent: () => void;
  onKeepCurrent: () => void;
  onRetryFetch?: () => void;
  error?: string | null;
  loading?: boolean;
}

const MostRecentChoiceModal: React.FC<Props> = ({
  userId,
  isPremium,
  recentTimestamp,
  onClose,
  onRestoreRecent,
  onKeepCurrent,
  onRetryFetch,
  error,
  loading = false
}) => {
  const navigate = useNavigate();
  const [localLoading, setLocalLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  
  const formattedTimestamp = recentTimestamp 
    ? new Date(recentTimestamp).toLocaleString() 
    : 'recent session';

  const handleRestoreRecent = async () => {
    try {
      setLocalLoading(true);
      setLocalError(null);
      await onRestoreRecent();
    } catch (err) {
      console.error('Error restoring recent state:', err);
      setLocalError('Failed to restore your most recent session. Please try again or use saved settings.');
    } finally {
      setLocalLoading(false);
    }
  };

  const handleKeepCurrent = async () => {
    try {
      setLocalLoading(true);
      setLocalError(null);
      await onKeepCurrent();
    } catch (err) {
      console.error('Error clearing recent state:', err);
      setLocalError('Error clearing recent state, but continuing with current data.');
      // Even if clearing fails, we still want to continue with current data
      onClose();
    } finally {
      setLocalLoading(false);
    }
  };

  const handleGoToSavedSettings = () => {
    navigate('/saved-settings');
    onClose();
  };

  const handleRetry = () => {
    setLocalError(null);
    if (onRetryFetch) {
      onRetryFetch();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md p-6 rounded-xl shadow-xl relative">
        <button
          className="absolute top-3 right-3 text-gray-500 hover:text-gray-800"
          onClick={onClose}
          disabled={loading || localLoading}
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold text-[#7973BB] mb-4">
          Load Recent Session?
        </h2>

        {recentTimestamp && (
          <p className="text-xs text-gray-500 mb-4">
            Saved: {formattedTimestamp}
          </p>
        )}

        {loading && (
          <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded p-3 text-indigo-700 text-sm flex items-center">
            <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
            <span>Loading your most recent session data...</span>
          </div>
        )}

        {(error || localError) && (
          <div className="mb-4 bg-red-50 border border-red-200 rounded p-3 text-red-700 text-sm">
            <p>{error || localError}</p>
            {onRetryFetch && (
              <Button 
                variant="secondary"
                onClick={handleRetry}
                className="mt-2 text-sm"
                disabled={localLoading || loading}
                icon={<RefreshCw className={`w-4 h-4 ${localLoading || loading ? 'animate-spin' : ''}`} />}
                size="sm"
              >
                Try Again
              </Button>
            )}
          </div>
        )}

        <p className="text-sm text-gray-700 mb-6">
          {!error && !localError 
            ? "We found data from your last session. What would you like to do?" 
            : "Please choose an option to continue:"}
        </p>

        <div className="flex flex-col gap-3">
          <Button
            className="w-full bg-[#7973BB] text-white hover:bg-[#5f58a5]"
            onClick={handleKeepCurrent}
            disabled={loading || localLoading}
          >
            {localLoading ? 'Processing...' : '✅ Continue with Current Data'}
          </Button>

          <Button
            className="w-full border border-[#7973BB] text-[#7973BB] hover:bg-[#7973BB]/10"
            onClick={handleRestoreRecent}
            disabled={loading || localLoading || (!!error && !recentTimestamp)}
          >
            {localLoading ? 'Restoring...' : '🕘 Return to Most Recent Settings'}
          </Button>

          <Button
            variant="secondary"
            className="w-full"
            onClick={handleGoToSavedSettings}
            disabled={loading || localLoading}
          >
            💾 Saved Settings
          </Button>
        </div>
      </div>
    </div>
  );
};

export default MostRecentChoiceModal;