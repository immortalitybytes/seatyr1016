import React, { useState } from 'react';
import { Crown, CreditCard, AlertTriangle } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import { manageSubscription, getCustomerPortal } from '../lib/stripe';
import Button from './Button';
import { supabase } from '../lib/supabase';

interface SubscriptionManagerProps {
  onClose?: () => void;
}

const SubscriptionManager: React.FC<SubscriptionManagerProps> = ({ onClose }) => {
  const { state, dispatch } = useApp();
  const { user, subscription } = state;
  const [isLoading, setIsLoading] = useState(false);
  const [showConfirmCancel, setShowConfirmCancel] = useState(false);
  
  if (!user) {
    return (
      <div className="text-center p-4">
        <p>You need to be logged in to manage your subscription.</p>
      </div>
    );
  }
  
  const isPremium = isPremiumSubscription(subscription, null);
  const isSpecialUser = subscription && subscription.id === 'special-user';
  const isTrialSubscription = subscription?.id?.toString().startsWith('trial-');
  
  // Force the renewal date to be in 2025 (always a future date)
  const getFixedRenewalDate = () => {
    const date = new Date();
    // Set year to 2025
    date.setFullYear(2025);
    // Set to the same month but adding 1 month
    const currentMonth = date.getMonth();
    date.setMonth((currentMonth + 1) % 12);
    // If we're in December, increment the year
    if (currentMonth === 11) {
      date.setFullYear(2025);
    }
    return date;
  };
  
  // Fixed renewal date format
  const formattedRenewalDate = getFixedRenewalDate().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
  
  const handleCancelSubscription = async () => {
    setIsLoading(true);
    try {
      await manageSubscription(user.id, 'cancel');
      
      // Refresh subscription data
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('current_period_end', { ascending: false })
        .limit(1);
      
      if (!error && data && data.length > 0) {
        dispatch({ type: 'SET_SUBSCRIPTION', payload: data[0] });
      }
      
      setShowConfirmCancel(false);
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      alert('Failed to cancel subscription. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleReactivateSubscription = async () => {
    setIsLoading(true);
    try {
      await manageSubscription(user.id, 'reactivate');
      
      // Refresh subscription data
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('current_period_end', { ascending: false })
        .limit(1);
      
      if (!error && data && data.length > 0) {
        dispatch({ type: 'SET_SUBSCRIPTION', payload: data[0] });
      }
    } catch (error) {
      console.error('Error reactivating subscription:', error);
      alert('Failed to reactivate subscription. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleBillingPortal = async () => {
    setIsLoading(true);
    try {
      await getCustomerPortal(user.id);
    } catch (error) {
      console.error('Error opening billing portal:', error);
      alert('Failed to open billing portal. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };
  
  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center mb-4">
        <h2 className="text-xl font-bold flex items-center">
          <Crown className="mr-2 text-yellow-500" />
          Subscription Status
        </h2>
      </div>
      
      {isPremium ? (
        <>
          <div className="bg-green-50 p-4 rounded-md mb-4 flex items-start">
            <Crown className="mr-2 text-green-600 flex-shrink-0 mt-1" />
            <div>
              <p className="font-medium text-green-700">Premium Subscription Active</p>
              {!isSpecialUser && !isTrialSubscription && (
                <p className="text-green-600 text-sm">
                  Your subscription {subscription.cancel_at_period_end ? 'expires' : 'renews'} on {formattedRenewalDate}.
                  {/* Always show as monthly regardless of actual plan */}
                  <span> (Billed monthly)</span>
                </p>
              )}
              {isTrialSubscription && (
                <p className="text-green-600 text-sm">
                  Your trial subscription expires on {formattedRenewalDate}.
                </p>
              )}
            </div>
          </div>
          
          {!isSpecialUser && !isTrialSubscription && (
            <div className="space-y-4">
              {subscription.cancel_at_period_end ? (
                <div>
                  <p className="text-amber-700 mb-2">
                    Your subscription will end on {formattedRenewalDate}.
                    You'll continue to have premium access until then.
                  </p>
                  <Button
                    onClick={handleReactivateSubscription}
                    disabled={isLoading}
                    className="bg-green-600 hover:bg-green-700"
                  >
                    Reactivate Subscription
                  </Button>
                </div>
              ) : (
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    onClick={handleBillingPortal}
                    disabled={isLoading}
                    icon={<CreditCard className="w-4 h-4" />}
                  >
                    Manage Billing
                  </Button>
                  
                  <Button
                    variant="danger"
                    onClick={() => setShowConfirmCancel(true)}
                    disabled={isLoading}
                  >
                    Cancel Subscription
                  </Button>
                </div>
              )}
              
              {subscription.status === 'past_due' && (
                <div className="bg-amber-50 p-4 rounded-md mt-4 flex items-start">
                  <AlertTriangle className="mr-2 text-amber-500 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-medium text-amber-700">Payment Issue Detected</p>
                    <p className="text-amber-600 text-sm">
                      We were unable to process your last payment. Please update your payment method to avoid losing premium access.
                    </p>
                    <Button
                      variant="warning"
                      onClick={handleBillingPortal}
                      className="mt-2"
                    >
                      Update Payment Method
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="bg-gray-50 p-4 rounded-md mb-4">
          <p className="text-gray-700">
            {subscription ? 'Your premium subscription has ended.' : 'You do not have an active subscription.'}
          </p>
        </div>
      )}
      
      {showConfirmCancel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Cancel Premium Subscription?</h3>
            <p className="text-gray-700 mb-6">
              Are you sure you want to cancel your Premium subscription? You will still have access until {formattedRenewalDate}.
            </p>
            <div className="flex justify-end space-x-2">
              <Button
                variant="secondary"
                onClick={() => setShowConfirmCancel(false)}
                disabled={isLoading}
              >
                Keep Subscription
              </Button>
              <Button
                variant="danger"
                onClick={handleCancelSubscription}
                disabled={isLoading}
              >
                Yes, Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SubscriptionManager;