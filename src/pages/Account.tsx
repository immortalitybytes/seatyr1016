import React, { useState, useEffect } from 'react';
import { UserCircle, Crown, Receipt, CreditCard, RefreshCw, AlertCircle, Key, Eye, EyeOff, Check, ChevronDown, ChevronUp } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { useNavigate } from 'react-router-dom';
import SubscriptionCard from '../components/SubscriptionCard';
import PaymentHistoryTable from '../components/PaymentHistoryTable';
import { getCustomerPortal, manageSubscription } from '../lib/stripe';
import { isPremiumSubscription } from '../utils/premium';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';

const Account: React.FC = () => {
  const { state, mode, sessionTag } = useApp();
  const navigate = useNavigate();
  const [showPaymentHistory, setShowPaymentHistory] = useState(false);
  const [loadingSubscription, setLoadingSubscription] = useState(false);
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isAccountInfoOpen, setIsAccountInfoOpen] = useState(true);

  // Use SSOT for all auth/subscription state
  const { user, subscription, trial } = state;
  const isPremium = mode === 'premium';

  // Password change state
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [passwordSuccess, setPasswordSuccess] = useState<string | null>(null);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  
  // Password reset highlight
  const [showPasswordResetHighlight, setShowPasswordResetHighlight] = useState(false);
  const [animationCount, setAnimationCount] = useState(0);

  // Auth state is now managed by AppContext - no local effects needed
  
  // Check for password reset redirect
  useEffect(() => {
    // Check if this is a redirect from password reset
    const isPasswordResetRedirect = sessionStorage.getItem('password_reset_redirect') === 'true';
    
    if (isPasswordResetRedirect) {
      // Clear the flag
      sessionStorage.removeItem('password_reset_redirect');
      
      // Set the highlight flag
      setShowPasswordResetHighlight(true);
      
      // Ensure account info section is open
      setIsAccountInfoOpen(true);
      
      // Focus the password change section
      const passwordSection = document.getElementById('password-change-section');
      if (passwordSection) {
        passwordSection.scrollIntoView({ behavior: 'smooth' });
      }
      
      // Start animation count
      setAnimationCount(0);
    }
  }, []);
  
  // Handle animation cycles
  useEffect(() => {
    let timer: NodeJS.Timeout;
    
    if (showPasswordResetHighlight) {
      // Each animation cycle is 5 seconds (defined in CSS)
      timer = setTimeout(() => {
        // Increment animation count
        setAnimationCount(prev => prev + 1);
        
        // After 2 cycles, stop the animation
        if (animationCount >= 1) {
          setShowPasswordResetHighlight(false);
        }
      }, 5000);
    }
    
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [showPasswordResetHighlight, animationCount]);

  const refreshSubscription = async () => {
    if (!user) return;
    
    try {
      setLoadingSubscription(true);
      console.log('Refreshing subscription data for user:', user.id);
      
      // First check for regular subscription
      const { data, error } = await supabase
        .from('subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .order('current_period_end', { ascending: false })
        .maybeSingle();
        
      if (!error && data) {
        console.log('Found subscription:', data);
        dispatch({ type: 'SET_SUBSCRIPTION', payload: data });
        return;
      } else if (error) {
        console.error('Error fetching subscription:', error);
      }
      
      // If no regular subscription, check for trial subscription
      const { data: trialData, error: trialError } = await supabase
        .from('trial_subscriptions')
        .select('*')
        .eq('user_id', user.id)
        .gt('expires_on', new Date().toISOString())
        .order('expires_on', { ascending: false })
        .maybeSingle();
        
      if (!trialError && trialData) {
        console.log('Found trial subscription:', trialData);
        // Create a virtual subscription object from the trial
        const virtualSubscription = {
          id: `trial-${trialData.id}`,
          user_id: user.id,
          status: 'active',
          current_period_start: trialData.start_date,
          current_period_end: trialData.expires_on,
          cancel_at_period_end: true,
          trial_end: trialData.expires_on
        };
        dispatch({ type: 'SET_SUBSCRIPTION', payload: virtualSubscription });
      } else if (trialError) {
        console.error('Error fetching trial subscription:', trialError);
      }
    } catch (error) {
      console.error('Error refreshing subscription:', error);
    } finally {
      setLoadingSubscription(false);
    }
  };

  const handleRetrySession = async () => {
    try {
      setSessionLoading(true);
      setSessionError(null);
      
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Error retrying session check:', error);
        setSessionError('Failed to verify authentication. Please log in again.');
        return;
      }
      
      const sessionUser = data?.session?.user;
      if (sessionUser) {
        console.log('Found authenticated user in session:', sessionUser.id);
        setUser(sessionUser);
        dispatch({ type: 'SET_USER', payload: sessionUser });
        refreshSubscription();
      } else {
        setSessionError('No active session found. Please log in.');
      }
    } catch (err) {
      console.error('Error in retry session:', err);
      setSessionError('An unexpected error occurred. Please try again.');
    } finally {
      setSessionLoading(false);
    }
  };

  // Password change handler
  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Reset states
    setPasswordError(null);
    setPasswordSuccess(null);
    setIsChangingPassword(true);

    try {
      // Validation
      if (newPassword.length < 6) {
        setPasswordError('Password must be at least 6 characters long');
        return;
      }

      if (newPassword !== confirmPassword) {
        setPasswordError('Passwords do not match');
        return;
      }

      // Regular expressions for validation
      const hasLetter = /[a-zA-Z]/.test(newPassword);
      const hasNumber = /[0-9]/.test(newPassword);

      if (!hasLetter || !hasNumber) {
        setPasswordError('Password must contain at least one letter and one number');
        return;
      }

      // Update password with Supabase
      const { error } = await supabase.auth.updateUser({ 
        password: newPassword 
      });

      if (error) {
        throw error;
      }

      setPasswordSuccess('Password successfully changed');
      
      // Reset form
      setNewPassword('');
      setConfirmPassword('');

    } catch (err) {
      console.error('Error changing password:', err);
      setPasswordError(err.message || 'Failed to change password. Please try again.');
    } finally {
      setIsChangingPassword(false);
    }
  };

  // User is now managed by AppContext SSOT

  const toggleAccountInfo = () => {
    setIsAccountInfoOpen(!isAccountInfoOpen);
  };

  // Redirect to login if no user (handled by AppContext)
  if (sessionTag === 'INITIALIZING' || sessionTag === 'AUTHENTICATING') {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <UserCircle className="mr-2" />
          Account
        </h1>
        <Card>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#586D78] mx-auto mb-4"></div>
            <p className="text-gray-600">Loading account information...</p>
          </div>
        </Card>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <UserCircle className="mr-2" />
          Account
        </h1>
        <Card>
          <div className="text-center py-8">
            {sessionError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-red-700">
                <p>{sessionError}</p>
                <Button 
                  onClick={handleRetrySession}
                  className="mt-2"
                  disabled={sessionLoading}
                  size="sm"
                  icon={sessionLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                >
                  {sessionLoading ? 'Checking...' : 'Try Again'}
                </Button>
              </div>
            )}
            <p className="text-gray-600 text-lg">Please log in to view your account details.</p>
          </div>
        </Card>
      </div>
    );
  }

  const accordionHeaderStyles = "flex justify-between items-center p-3 rounded-md bg-[#D7E5E5] cursor-pointer";

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <UserCircle className="mr-2" />
        Account

      </h1>

      {/* Account Info Accordion */}
      <div>
        <div 
          className={accordionHeaderStyles}
          onClick={toggleAccountInfo}
        >
          <h2 className="text-lg font-semibold text-[#586D78] flex items-center">
            <UserCircle className="mr-2 h-5 w-5" />
            Account Info
          </h2>
          {isAccountInfoOpen ? <ChevronUp className="h-5 w-5 text-[#586D78]" /> : <ChevronDown className="h-5 w-5 text-[#586D78]" />}
        </div>

        {isAccountInfoOpen && (
          <div className="mt-4 space-y-6">
            <Card>
              <div className="space-y-4">
                <div>
                  <h2 className="text-lg font-semibold text-[#586D78]">Account Details</h2>
                  <p className="text-gray-600 text-lg">{user.email}</p>
                </div>
                
                <div className="border-t pt-4">
                  <h3 className="font-medium text-[#586D78] mb-2">Account Type</h3>
                  <p className="text-gray-600 text-lg">
                    {state.subscription?.status === 'active' ? 
                      (state.subscription.id.toString().startsWith('trial-') ? 'Beta Tester (Premium Trial)' : 'Premium Member') : 
                      'Free Member'}
                  </p>
                </div>
              </div>
            </Card>

            {/* Change Password Card */}
            <Card title="Change Password" id="password-change-section">
              <div 
                className={`space-y-4 ${showPasswordResetHighlight ? 'password-reset-highlight' : ''}`}
                style={showPasswordResetHighlight ? {
                  animation: 'highlight-password-section 5s ease-in-out 2',
                  padding: '1rem',
                  borderRadius: '0.5rem'
                } : {}}
              >
                <form onSubmit={handleChangePassword} className="space-y-4">
                  <div>
                    <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
                      New Password
                    </label>
                    <div className="relative">
                      <input
                        id="newPassword"
                        type={showNewPassword ? "text" : "password"}
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                        placeholder="Enter new password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      >
                        {showNewPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
                      Confirm New Password
                    </label>
                    <div className="relative">
                      <input
                        id="confirmPassword"
                        type={showConfirmPassword ? "text" : "password"}
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                        placeholder="Confirm new password"
                        required
                      />
                      <button
                        type="button"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                      >
                        {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                      </button>
                    </div>
                  </div>

                  <div className="bg-blue-50 p-3 rounded-md">
                    <p className="text-sm text-blue-700">
                      Password requirements:
                    </p>
                    <ul className="text-xs text-blue-700 list-disc list-inside mt-1">
                      <li>At least 6 characters long</li>
                      <li>Contains at least one letter</li>
                      <li>Contains at least one number</li>
                    </ul>
                  </div>

                  {passwordError && (
                    <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start">
                      <AlertCircle className="w-4 h-4 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                      <p className="text-red-700 text-sm">{passwordError}</p>
                    </div>
                  )}

                  {passwordSuccess && (
                    <div className="bg-green-50 border border-green-200 rounded-md p-3 flex items-start">
                      <Check className="w-4 h-4 text-green-500 mr-2 flex-shrink-0 mt-0.5" />
                      <p className="text-green-700 text-sm">{passwordSuccess}</p>
                    </div>
                  )}

                  <div>
                    <Button
                      type="submit"
                      disabled={isChangingPassword || (!newPassword && !confirmPassword)}
                      icon={isChangingPassword ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Key className="w-4 h-4" />}
                    >
                      {isChangingPassword ? 'Changing Password...' : 'Change Password'}
                    </Button>
                  </div>
                </form>
              </div>
            </Card>

            {/* Subscription Information Card */}
            <Card>
              <div className="space-y-4">
                <h2 className="text-lg font-semibold text-[#586D78] flex items-center">
                  <Crown className="mr-2 text-yellow-500" />
                  Subscription Status
                  {loadingSubscription && (
                    <RefreshCw className="w-4 h-4 ml-2 animate-spin text-[#586D78]" />
                  )}
                </h2>
                
                <SubscriptionCard onSuccess={refreshSubscription} />
              </div>
            </Card>

            <Card 
              title="Payment & Billing" 
              actions={
                <Button 
                  variant="secondary"
                  size="sm"
                  icon={showPaymentHistory ? undefined : <Receipt className="w-4 h-4" />}
                  onClick={() => setShowPaymentHistory(!showPaymentHistory)}
                >
                  {showPaymentHistory ? 'Hide History' : 'View Payment History'}
                </Button>
              }
            >
              <div className="space-y-4">
                <p className="text-gray-700">Manage your payment methods and view your billing history.</p>
                
                {state.subscription?.status === 'active' && !state.subscription.id.toString().startsWith('trial-') && (
                  <Button
                    variant="secondary"
                    onClick={() => getCustomerPortal(user.id)}
                    icon={<CreditCard className="w-4 h-4" />}
                    disabled={loadingSubscription}
                  >
                    {loadingSubscription ? 'Processing...' : 'Manage Payment Methods'}
                  </Button>
                )}
                
                {showPaymentHistory && (
                  <div className="mt-6">
                    <h3 className="text-lg font-medium text-[#586D78] mb-4">Payment History</h3>
                    <PaymentHistoryTable userId={user.id} />
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
      
      {/* Saved Settings Accordion */}
      <SavedSettingsAccordion isDefaultOpen={false} />
    </div>
  );
};

export default Account;