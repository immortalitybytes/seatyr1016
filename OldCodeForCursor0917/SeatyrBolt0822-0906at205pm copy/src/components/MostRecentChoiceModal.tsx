import React, { useState, useEffect } from 'react';
import { X, Save, FilePlus, FolderOpen, RefreshCw, AlertCircle } from 'lucide-react';
import Button from './Button';
import { useNavigate } from 'react-router-dom';

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

  // Add an effect to log when the modal is mounted
  useEffect(() => {
    console.log('MostRecentChoiceModal mounted', {
      userId,
      isPremium,
      recentTimestamp,
      error,
      loading
    });
  }, []);

  const handleRestoreRecent = async () => {
    try {
      console.log('Restoring recent state');
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
      console.log('Keeping current state');
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
    navigate('/account');
    onClose();
  };

  const handleRetry = () => {
    console.log('Retrying fetch of recent state');
    setLocalError(null);
    if (onRetryFetch) {
      onRetryFetch();
    }
  };

  return (
    <div className="fixed inset-0 bg-black/30 z-50 flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-md p-6 rounded-xl shadow-xl relative">
        <button
          className="absolute top-3 right-3 danstyle1c-btn"
          onClick={onClose}
          disabled={loading || localLoading}
          aria-label="Close dialog"
        >
          <X className="w-5 h-5" />
        </button>

        <h2 className="text-lg font-semibold text-[#586D78] mb-4">
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
            <div className="flex items-start">
              <AlertCircle className="w-4 h-4 mr-2 flex-shrink-0 mt-1" />
              <div>
                <p>{error || localError}</p>
                {onRetryFetch && (
                  <button
                    className="danstyle1c-btn mt-2 text-sm"
                    onClick={handleRetry}
                    disabled={localLoading || loading}
                  >
                    {localLoading || loading ? 
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : 
                      <RefreshCw className="w-4 h-4 mr-2" />}
                    Try Again
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        <p className="text-sm text-gray-700 mb-6">
          {!error && !localError 
            ? "We found data from your last session. What would you like to do?" 
            : "Please choose an option to continue:"}
        </p>

        <div className="flex flex-col gap-3">
          <button
            className="danstyle1c-btn"
            onClick={handleKeepCurrent}
            disabled={loading || localLoading}
          >
            {localLoading ? 'Processing...' : '✅ Continue with Current Data'}
          </button>

          <button
            className="danstyle1c-btn"
            onClick={handleRestoreRecent}
            disabled={loading || localLoading}
          >
            {localLoading ? 'Restoring...' : '🕘 Return to Most Recent Settings'}
          </button>

          <button
            className="danstyle1c-btn"
            onClick={handleGoToSavedSettings}
            disabled={loading || localLoading}
          >
            <FolderOpen className="w-4 h-4 mr-2" />
            Saved Settings
          </button>
        </div>
      </div>
    </div>
  );
};

export default MostRecentChoiceModal;