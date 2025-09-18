import React, { useState } from 'react';
import { Crown, AlertCircle } from 'lucide-react';
import Button from './Button';
import BetaCodeModal from './BetaCodeModal';
import { redirectToCheckout } from '../lib/stripe';

interface PremiumModalProps {
  onClose: () => void;
  userId: string;
  onSuccess?: () => void;
}

const PremiumModal: React.FC<PremiumModalProps> = ({ onClose, userId, onSuccess }) => {
  const [showBetaModal, setShowBetaModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleProceedToPayment = async () => {
    try {
      setLoading(true);
      setError(null);
      await redirectToCheckout(userId);
    } catch (error) {
      console.error('Error initiating checkout:', error);
      setError(`Failed to start checkout: ${error.message || 'Please try again later'}`);
      setLoading(false);
    }
  };

  const handleBetaSuccess = () => {
    if (onSuccess) {
      onSuccess();
    }
    onClose();
  };

  return (
    <>
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

          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3 flex items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-red-700">{error}</p>
                <p className="text-sm text-red-600 mt-1">
                  Please try again or contact support if this persists.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-5">
            <p className="text-lg text-gray-700 mb-4">
              Great! Please click a button:
            </p>
            
            <button 
              className="w-full py-3 px-4 rounded-lg flex items-center justify-center text-[#fadeee] bg-[#a78bfa] border border-[#a78bfa] font-medium hover:bg-[#a78bfa]/90 transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
              onClick={handleProceedToPayment}
              disabled={loading}
            >
              {loading ? 'Processing...' : 'Sign Me Up!'}
            </button>
            
            <button 
              className="w-full py-3 px-4 rounded-lg flex items-center justify-center text-[#a78bfa] bg-[#fadeee] font-medium hover:bg-[#fadeee]/90 transition-colors"
              onClick={() => setShowBetaModal(true)}
              disabled={loading}
            >
              Beta Tester Code
            </button>
            
            <div className="pt-2 text-sm text-gray-500">
              <p>Premium gives you unlimited guests, 50 saved settings, and premium support!</p>
            </div>
          </div>
        </div>
      </div>

      {showBetaModal && (
        <BetaCodeModal
          onClose={() => setShowBetaModal(false)}
          onSuccess={handleBetaSuccess}
        />
      )}
    </>
  );
};

export default PremiumModal;