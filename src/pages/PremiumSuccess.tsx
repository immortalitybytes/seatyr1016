import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown } from 'lucide-react';
import Card from '../components/Card';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';

const PremiumSuccess: React.FC = () => {
  const navigate = useNavigate();
  const { dispatch } = useApp();

  // Re-fetch subscription status after successful payment
  useEffect(() => {
    const syncSubscription = async () => {
      try {
        // Get current user
        const { data: userData } = await supabase.auth.getUser();
        const user = userData?.user;
        
        if (user) {
          console.log('Refreshing subscription data after payment');
          
          // Fetch the latest subscription data
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
            // Update global app state
            dispatch({ type: 'SET_SUBSCRIPTION', payload: subscriptionData[0] });
          } else {
            // Special case: if user should have premium but no subscription found
            if (user.email && (
                user.email.toLowerCase() === 'danabrams999@yahoo.com' || 
                user.email.toLowerCase() === 'dan@corpania.com' || 
                user.email.toLowerCase() === 'immortality.bytes.book@gmail.com'
            )) {
              console.log('Special user detected, creating fallback premium subscription');
              const fakeSubscription = {
                id: 'special-user',
                user_id: user.id,
                status: 'active',
                current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
                created: new Date().toISOString()
              };
              dispatch({ type: 'SET_SUBSCRIPTION', payload: fakeSubscription });
            }
          }
        }
      } catch (err) {
        console.error('Error syncing subscription after payment:', err);
      }
    };
    
    syncSubscription();
    
    // Redirect to home after 5 seconds
    const timeout = setTimeout(() => {
      navigate('/');
    }, 5000);

    return () => clearTimeout(timeout);
  }, [navigate, dispatch]);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-gray-800 flex items-center">
        <Crown className="mr-2" />
        Welcome to Premium!
      </h1>

      <Card>
        <div className="text-center py-8">
          <Crown className="w-16 h-16 text-yellow-500 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Thank you for upgrading to Premium!
          </h2>
          <p className="text-gray-600 mb-4">
            Your premium features are now active. You can now:
          </p>
          <ul className="text-left max-w-md mx-auto space-y-2 mb-8">
            <li className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Create seating plans with unlimited guests
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Save multiple seating configurations
            </li>
            <li className="flex items-center">
              <span className="w-2 h-2 bg-green-500 rounded-full mr-2"></span>
              Access premium support
            </li>
          </ul>
          <p className="text-sm text-gray-500">
            Redirecting you to the home page in a few seconds...
          </p>
        </div>
      </Card>
    </div>
  );
};

export default PremiumSuccess;