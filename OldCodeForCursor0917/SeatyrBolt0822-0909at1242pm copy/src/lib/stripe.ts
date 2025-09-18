import { loadStripe } from '@stripe/stripe-js';
import { supabase } from './supabase';

// Load Stripe outside of functions to avoid recreating instance
const stripePromise = loadStripe(import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY);

export const redirectToCheckout = async (userId: string) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    // Check if user already has an active subscription
    const { data: subscriptionData, error: subError } = await supabase
      .from('subscriptions')
      .select('*')
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('canceled_at', null)
      .limit(1);
    
    if (subError) {
      console.error('Error checking existing subscription:', subError);
      throw new Error('Unable to verify subscription status');
    }

    if (subscriptionData?.length > 0) {
      throw new Error('You already have an active subscription');
    }

    console.log('Creating checkout session for user:', userId);
    
    // Use direct Stripe checkout link as fallback
    try {
      // First try using the edge function
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
        },
        body: JSON.stringify({ userId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error response from create-checkout:', errorText);
        throw new Error(`Failed to create checkout session: ${errorText}`);
      }
      
      const { sessionId, url } = await response.json();
      console.log('Checkout session created:', sessionId);
      
      if (url) {
        // If we get a direct URL, use that
        window.location.href = url;
        return;
      }
      
      // Otherwise use the session ID with Stripe.js
      const stripe = await stripePromise;
      if (!stripe) {
        throw new Error('Failed to load Stripe');
      }
      
      const { error } = await stripe.redirectToCheckout({ sessionId });
      
      if (error) {
        console.error('Stripe redirect error:', error);
        throw error;
      }
    } catch (error) {
      console.error('Edge function failed, using direct link fallback', error);
      // Fall back to direct Stripe link if edge function fails
      window.location.href = 'https://buy.stripe.com/3cs4ju9Y113D8hi5kk';
    }
  } catch (error) {
    console.error('Error redirecting to checkout:', error);
    throw new Error('Failed to start checkout process: ' + (error.message || 'Please try again.'));
  }
};

export const manageSubscription = async (userId: string, action: 'cancel' | 'reactivate') => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const functionUrl = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/manage-subscription`;
    
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({
        userId,
        action
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to ${action} subscription`);
    }

    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Error managing subscription:', error);
    throw error;
  }
};

export const getCustomerPortal = async (userId: string) => {
  try {
    if (!userId) {
      throw new Error('User ID is required');
    }

    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-portal-session`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create customer portal session');
    }

    const { url } = await response.json();
    window.location.href = url;
  } catch (error) {
    console.error('Error redirecting to customer portal:', error);
    throw error;
  }
};

// Get payment history for a user
export const getPaymentHistory = async (userId: string) => {
  try {
    const { data, error } = await supabase
      .from('payment_history')
      .select('*')
      .eq('user_id', userId)
      .order('payment_date', { ascending: false });
      
    if (error) throw error;
    return data || [];
  } catch (error) {
    console.error('Error fetching payment history:', error);
    throw error;
  }
};

// Create a payment method setup session
export const createSetupIntent = async (userId: string) => {
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-setup-intent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ userId }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create setup intent');
    }

    const { clientSecret } = await response.json();
    return clientSecret;
  } catch (error) {
    console.error('Error creating setup intent:', error);
    throw error;
  }
};

// Create a coupon code with Stripe
export const createCoupon = async (code: string, percentOff: number, duration: string) => {
  try {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-coupon`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ code, percentOff, duration }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Failed to create coupon');
    }

    return await response.json();
  } catch (error) {
    console.error('Error creating coupon:', error);
    throw error;
  }
};