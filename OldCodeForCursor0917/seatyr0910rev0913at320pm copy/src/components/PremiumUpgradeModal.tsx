import React, { useState } from 'react';
import { Crown, ArrowRight } from 'lucide-react';
import Button from './Button';
import { supabase } from '../lib/supabase';
import { activateBetaCode } from '../lib/betacode';

interface PremiumUpgradeModalProps {
  onClose: () => void;
  onSuccess: () => void;
  onProceedToPayment: () => void;
  userId: string;
}

const PremiumUpgradeModal: React.FC<PremiumUpgradeModalProps> = ({ 
  onClose, 
  onSuccess, 
  onProceedToPayment, 
  userId 
}) => {
  const [step, setStep] = useState<'initial' | 'betaCode'>('initial');
  const [betaCode, setBetaCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleBetaCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      if (!betaCode.trim()) {
        throw new Error('Please enter a beta code');
      }

      // Verify and activate the beta code
      await activateBetaCode(userId, betaCode.trim());
      
      // If successful, call onSuccess to refresh subscription data
      onSuccess();
    } catch (err) {
      console.error('Error activating beta code:', err);
      setError(err.message || 'Failed to activate beta code');
      setBetaCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-[#7973BB] flex items-center">
            <Crown className="w-6 h-6 text-yellow-500 mr-2" />
            Upgrade to Premium
          </h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 text-2xl"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {step === 'initial' ? (
          <div className="space-y-5">
            <p className="text-lg text-gray-700 mb-4">
              Great! Please click a button:
            </p>
            
            <button 
              className="w-full py-3 px-4 rounded-lg flex items-center justify-center text-[#a78bfa] bg-[#fadeee] border border-[#a78bfa] font-medium hover:bg-amber-50 transition-colors"
              onClick={onProceedToPayment}
            >
              <span className="mr-2">Sign Me Up!</span>
              <ArrowRight size={18} />
            </button>
            
            <button 
              className="w-full py-3 px-4 rounded-lg flex items-center justify-center text-[#fadeee] bg-[#a78bfa] font-medium hover:bg-indigo-500 transition-colors"
              onClick={() => setStep('betaCode')}
            >
              <span>Beta Tester Code</span>
            </button>
            
            <div className="pt-2 text-sm text-gray-500">
              <p>Premium gives you unlimited guests, 50 saved settings, and premium support!</p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleBetaCodeSubmit} className="space-y-4">
            <div>
              <label htmlFor="betaCode" className="block text-sm font-medium text-gray-700 mb-1">
                Enter Beta Tester Code
              </label>
              <input
                id="betaCode"
                type="text"
                value={betaCode}
                onChange={(e) => setBetaCode(e.target.value)}
                className={`w-full px-3 py-2 border ${error ? 'border-red-300 bg-red-50' : 'border-gray-300'} rounded-md focus:outline-none focus:ring-2 focus:ring-[#7973BB]`}
                placeholder="Enter Beta Tester Code"
              />
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 text-red-600 text-sm">
                {error}
              </div>
            )}

            <div className="bg-amber-50 border border-amber-200 rounded-md p-3">
              <p className="text-sm text-amber-700">
                Beta tester codes provide 30 days of premium access without a credit card. Each code can be used up to 3 times.
              </p>
            </div>

            <div className="flex justify-between space-x-3 pt-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setStep('initial');
                  setError(null);
                  setBetaCode('');
                }}
                disabled={loading}
              >
                Back
              </Button>
              
              <Button
                type="submit"
                disabled={!betaCode.trim() || loading}
                className="flex-1"
                icon={loading ? <span className="animate-spin">⟳</span> : undefined}
              >
                {loading ? 'Verifying...' : 'Activate Premium'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};

export default PremiumUpgradeModal;