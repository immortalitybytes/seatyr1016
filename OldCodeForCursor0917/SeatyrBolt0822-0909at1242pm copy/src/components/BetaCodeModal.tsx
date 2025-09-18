import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import Button from './Button';
import { Crown, AlertCircle, RefreshCw } from 'lucide-react';

interface BetaCodeModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

const BetaCodeModal: React.FC<BetaCodeModalProps> = ({ onClose, onSuccess }) => {
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [retries, setRetries] = useState(0);

  const handleBetaSubmit = async () => {
    const { data: sessionData, error: authError } = await supabase.auth.getSession();
    const user = sessionData?.session?.user;

    if (!user) {
      setError("You must be signed in to use a beta code. Please sign in and try again.");
      return false;
    }

    const code = codeInput.trim();
    if (!code) {
      setError("Please enter a valid beta code");
      return false;
    }

    try {
      const { data: validCode, error: codeError } = await supabase
        .from('valid_beta_codes_ui')
        .select('*')
        .eq('code', code)
        .single();

      if (!validCode || codeError) {
        console.warn("Beta code validation failed:", codeError?.message);
        setError("Invalid or expired code. Please check and try again.");
        return false;
      }

      const trialEnds = new Date();
      trialEnds.setDate(trialEnds.getDate() + 30);

      const { error: trialError } = await supabase.from('trial_subscriptions').upsert({
        user_id: user.id,
        trial_code: code,
        start_date: new Date().toISOString(),
        expires_on: trialEnds.toISOString(),
      });

      if (trialError) {
        console.error("Trial upsert error:", trialError.message);
        setError("Failed to activate trial: " + (trialError.message || "Unknown error"));
        return false;
      }

      return true;
    } catch (err) {
      console.error("Beta code activation error:", err);
      setError("Failed to process beta code. Please try again later.");
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    try {
      const success = await handleBetaSubmit();
      if (success) {
        onSuccess();
      }
    } catch (err) {
      console.error('Error activating beta code:', err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
      setRetries(prev => prev + 1);
    } finally {
      setLoading(false);
    }
  };

  // Handle retry logic
  const handleRetry = () => {
    if (retries >= 3) {
      setError("Maximum retries reached. Please try again later or contact support.");
      return;
    }
    
    setError(null);
    setRetries(prev => prev + 1);
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
        <h2 className="text-2xl font-bold text-[#586D78] mb-4 flex items-center">
          <Crown className="mr-2 text-yellow-500" />
          Beta Tester Access
        </h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="betaCode" className="block text-sm font-medium text-gray-700 mb-1">
              Enter your beta tester code:
            </label>
            <input
              id="betaCode"
              type="text"
              value={codeInput}
              onChange={(e) => setCodeInput(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
              placeholder="e.g., bt-rabbit-car"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3">
              <div className="flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-red-600 text-sm">{error}</p>
                  {retries > 0 && retries < 3 && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={handleRetry}
                      className="mt-2"
                      icon={<RefreshCw className="w-4 h-4" />}
                    >
                      Try Again
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}

          <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
            <p className="text-sm text-amber-700">
              Beta tester codes provide 30 days of premium access. Each code can be used up to 3 times.
            </p>
          </div>

          <div className="flex justify-end space-x-2">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            
            <Button
              type="submit"
              disabled={!codeInput.trim() || loading}
              icon={loading ? <span className="animate-spin">⟳</span> : undefined}
            >
              {loading ? 'Activating...' : 'Activate Trial'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default BetaCodeModal;