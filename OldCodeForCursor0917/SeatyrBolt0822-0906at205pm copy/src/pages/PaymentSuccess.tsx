import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, CheckCircle } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';

const PaymentSuccess: React.FC = () => {
  const navigate = useNavigate();
  const { state, dispatch } = useApp();
  const { user } = state;

  useEffect(() => {
    const refreshSubscriptionData = async () => {
      if (!user) return;

      try {
        console.log('Refreshing subscription data after successful payment');
        
        // Get session ID from the URL if available
        const url = new URL(window.location.href);
        const sessionId = url.searchParams.get('session_id');
        
        if (sessionId) {
          console.log('Found session ID in URL:', sessionId);
          
          // Call the verify-session function to validate and process the session
          const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/verify-session`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
            },
            body: JSON.stringify({ sessionId, userId: user.id })
          });
          
          if (!response.ok) {
            console.error('Error verifying session:', await response.text());
          }
        }
        
        // Fetch latest subscription data
        const { data: subscriptionData, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .order('current_period_end', { ascending: false })
          .limit(1);
          
        if (error) {
          console.error('Error fetching subscription after payment:', error);
        } else if (subscriptionData && subscriptionData.length > 0) {
          console.log('Updated subscription data:', subscriptionData[0]);
          dispatch({ type: 'SET_SUBSCRIPTION', payload: subscriptionData[0] });
        }
      } catch (err) {
        console.error('Error syncing subscription after payment:', err);
      }
    };
    
    refreshSubscriptionData();
    
    // Redirect to home after delay
    const timeout = setTimeout(() => {
      navigate('/account');
    }, 5000);

    return () => clearTimeout(timeout);
  }, [navigate, dispatch, user]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center">
        <Crown className="mr-2" />
        Welcome to Premium!
      </h1>

      <Card>
        <div className="text-center py-8">
          <div className="mb-6">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Thank you for your purchase!
          </h2>
          <p className="text-gray-600 mb-4">
            Your payment was successful and your premium features are now active. You can now:
          </p>
          <ul className="text-left max-w-md mx-auto space-y-2 mb-8">
            <li className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Create seating plans with unlimited guests
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Save up to 50 seating configurations
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Access premium support
            </li>
          </ul>
          
          <div className="mt-6">
            <Button onClick={() => navigate('/account')}>
              Go to Account
            </Button>
          </div>
          
          <p className="text-sm text-gray-500 mt-4">
            Redirecting to your account page in a few seconds...
          </p>
        </div>
      </Card>
    </div>
  );
};

export default PaymentSuccess;
