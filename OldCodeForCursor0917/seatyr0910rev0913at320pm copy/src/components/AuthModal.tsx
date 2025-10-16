import React, { useState, useEffect } from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase, supabaseConfigured } from '../lib/supabase';
import Button from './Button';
import { useApp } from '../context/AppContext';
import { RefreshCw } from 'lucide-react';
import { X } from 'lucide-react';

interface AuthModalProps {
  onClose: () => void;
}

const AuthModal: React.FC<AuthModalProps> = ({ onClose }) => {
  const { state, dispatch } = useApp();
  const { isSupabaseConnected } = state;
  const [authError, setAuthError] = useState<string | null>(null);
  const [view, setView] = useState<'sign_in' | 'sign_up'>('sign_in');
  const [verificationSent, setVerificationSent] = useState(false);
  const [lastEmailSent, setLastEmailSent] = useState<number>(0);
  const [cooldownRemaining, setCooldownRemaining] = useState<number>(0);
  const [dailyEmailCount, setDailyEmailCount] = useState<number>(0);
  const [connectionRetries, setConnectionRetries] = useState<number>(0);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [showForgotPassword, setShowForgotPassword] = useState<boolean>(false);
  const [resetEmail, setResetEmail] = useState<string>('');
  const [isResettingPassword, setIsResettingPassword] = useState<boolean>(false);
  const [resetSuccess, setResetSuccess] = useState<boolean>(false);

  useEffect(() => {
    if (!supabaseConfigured || !isSupabaseConnected) {
      setAuthError('Supabase is not configured correctly or cannot connect. Please check your .env file and verify your Supabase project is accessible.');
      return;
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN') {
        console.log('Auth event: SIGNED_IN, user:', session?.user?.id);
        if (session?.user) {
          dispatch({ type: 'SET_USER', payload: session.user });
          
          // We'll fetch saved settings in the GuestManager component now
        }
        onClose();
      } else if (event === 'SIGNED_OUT') {
        console.log('Auth event: SIGNED_OUT');
        setVerificationSent(false);
        dispatch({ type: 'SET_USER', payload: null });
        dispatch({ type: 'SET_SUBSCRIPTION', payload: null });
      } else if (event === 'USER_UPDATED') {
        console.log('Auth event: USER_UPDATED');
        if (session?.user?.email_confirmed_at) {
          if (session.user) {
            dispatch({ type: 'SET_USER', payload: session.user });
          }
          onClose();
        }
      } else if (event === 'PASSWORD_RECOVERY') {
        console.log('Auth event: PASSWORD_RECOVERY');
        setView('sign_in');
        setAuthError('Please enter your new password');
      }
    });

    const url = new URL(window.location.href);
    const error = url.searchParams.get('error');
    const errorDescription = url.searchParams.get('error_description');
    const code = url.searchParams.get('code');

    if (error && errorDescription) {
      setAuthError(decodeURIComponent(errorDescription));
    }

    if (error || errorDescription || code) {
      url.searchParams.delete('error');
      url.searchParams.delete('error_description');
      url.searchParams.delete('code');
      window.history.replaceState({}, '', url.toString());
    }

    // Load email counters from localStorage
    const storedTimestamp = localStorage.getItem('lastEmailSent');
    const storedCount = localStorage.getItem('dailyEmailCount');
    const storedDate = localStorage.getItem('emailCountDate');
    
    if (storedTimestamp) {
      setLastEmailSent(parseInt(storedTimestamp));
    }
    
    // Reset daily counter if it's a new day
    const today = new Date().toDateString();
    if (storedDate === today && storedCount) {
      setDailyEmailCount(parseInt(storedCount));
    } else {
      localStorage.setItem('emailCountDate', today);
      localStorage.setItem('dailyEmailCount', '0');
      setDailyEmailCount(0);
    }

    return () => {
      subscription.unsubscribe();
    };
  }, [onClose, isSupabaseConnected, dispatch]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      const timeSinceLastEmail = now - lastEmailSent;
      const cooldownPeriod = 3000; // Reduced to 3 seconds
      
      if (timeSinceLastEmail < cooldownPeriod) {
        setCooldownRemaining(Math.ceil((cooldownPeriod - timeSinceLastEmail) / 1000));
      } else {
        setCooldownRemaining(0);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [lastEmailSent]);

  const handleEmailSent = () => {
    const now = Date.now();
    const today = new Date().toDateString();
    const newCount = dailyEmailCount + 1;
    
    setLastEmailSent(now);
    setDailyEmailCount(newCount);
    localStorage.setItem('lastEmailSent', now.toString());
    localStorage.setItem('dailyEmailCount', newCount.toString());
    localStorage.setItem('emailCountDate', today);
    setVerificationSent(true);
  };

  const handleAuthError = (error: any) => {
    console.error('Auth error:', error);
    
    if (dailyEmailCount >= 10) {
      setAuthError('Daily email limit reached (10/10). Please try again tomorrow.');
      return;
    }
    
    if (error.message && error.message.includes('rate limit')) {
      setAuthError(`Please wait ${cooldownRemaining} seconds before trying again.`);
      return;
    }

    // Check if the error has a JSON body that needs to be parsed
    let errorBody = null;
    if (error.body && typeof error.body === 'string') {
      try {
        errorBody = JSON.parse(error.body);
      } catch (e) {
        console.error('Failed to parse error body:', e);
      }
    }

    // Check for invalid_credentials in various error formats
    const hasInvalidCredentials = 
      (errorBody && errorBody.code === 'invalid_credentials') || 
      (error.error && error.error.code === 'invalid_credentials') ||
      (error.code === 'invalid_credentials') ||
      (error.message && error.message.includes('invalid_credentials'));

    // Provide more user-friendly error messages
    if (hasInvalidCredentials) {
      if (view === 'sign_in') {
        setAuthError('Invalid email or password. Please try again or click "Forgot your password?" below.');
      } else {
        setAuthError('Please ensure your password meets all requirements listed above.');
      }
    } else if (error.message && error.message.includes('Email not confirmed')) {
      setAuthError('Please check your email and click the confirmation link before signing in.');
    } else if (error.message && error.message.includes('User already registered')) {
      setAuthError('An account with this email already exists. Please sign in instead.');
    } else if (errorBody && errorBody.message) {
      setAuthError(errorBody.message);
    } else if (error.message) {
      setAuthError(error.message);
    } else {
      setAuthError('An error occurred during authentication. Please try again later.');
    }
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    
    if (!resetEmail || !resetEmail.includes('@')) {
      setAuthError('Please enter a valid email address');
      return;
    }
    
    if (dailyEmailCount >= 10) {
      setAuthError('Daily email limit reached (10/10). Please try again tomorrow.');
      return;
    }
    
    setIsResettingPassword(true);
    
    try {
      // Call Supabase API to send password reset email
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/callback?next=/account`,
      });
      
      if (error) throw error;
      
      // Update email counters
      handleEmailSent();
      setResetSuccess(true);
      
    } catch (error) {
      console.error('Password reset error:', error);
      
      if (error.message.includes('rate limit')) {
        setAuthError(`Please wait ${cooldownRemaining} seconds before trying again.`);
      } else {
        setAuthError(error.message);
      }
    } finally {
      setIsResettingPassword(false);
    }
  };

  const retryConnection = async () => {
    setIsRetrying(true);
    setConnectionRetries(prev => prev + 1);
    
    try {
      // Try to ping Supabase to check connection
      const { data, error } = await supabase.from('subscriptions').select('count', { count: 'exact', head: true });
      
      if (!error) {
        window.location.reload(); // Reload the page to reinitialize Supabase
      } else {
        setAuthError('Still unable to connect to Supabase. Please check your network connection or try again later.');
      }
    } catch (err) {
      console.error('Error during connection retry:', err);
      setAuthError('Connection retry failed. Please check your network connection or try again later.');
    } finally {
      setIsRetrying(false);
    }
  };

  const siteUrl = window.location.origin;

  if (!supabaseConfigured || !isSupabaseConnected) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-bold">Authentication Error</h2>
            <button
              onClick={onClose}
              className="danstyle1c-btn"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <div className="p-4 bg-red-50 rounded-md">
            <p className="text-red-700 text-lg">
              Supabase is not configured correctly or cannot connect. Please check:
            </p>
            <ol className="list-decimal ml-5 mt-2 text-red-700">
              <li>Your .env file has valid Supabase credentials</li>
              <li>Your Supabase project is active and accessible</li>
              <li>Your network connection is working properly</li>
            </ol>
            <pre className="bg-red-100 p-2 mt-4 rounded overflow-auto text-sm">
              VITE_SUPABASE_URL=https://your-project-id.supabase.co<br/>
              VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
            </pre>
            
            <div className="mt-4 flex justify-center">
              <button 
                onClick={retryConnection}
                disabled={isRetrying}
                className="danstyle1c-btn"
              >
                {isRetrying ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {isRetrying ? 'Retrying...' : 'Retry Connection'}
              </button>
            </div>
            
            {connectionRetries > 0 && (
              <p className="text-sm text-red-600 mt-4">
                {connectionRetries > 2 
                  ? 'Multiple retries failed. You may need to check your Supabase configuration or try again later.'
                  : `Retry attempt ${connectionRetries} failed. Please try again.`}
              </p>
            )}
          </div>
          <div className="mt-6 text-center">
            <button onClick={onClose} className="danstyle1c-btn">
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <div className="flex space-x-4">
            <button
              onClick={() => {
                setView('sign_in');
                setVerificationSent(false);
                setAuthError(null);
                setShowForgotPassword(false);
                setResetSuccess(false);
              }}
              className={`px-4 py-2 rounded-md transition-all ${
                view === 'sign_in' && !showForgotPassword
                  ? 'font-bold text-black border-2 border-[#586D78]'
                  : 'text-gray-500 border border-gray-300'
              }`}
            >
              Log In
            </button>
            <button
              onClick={() => {
                setView('sign_up');
                setVerificationSent(false);
                setAuthError(null);
                setShowForgotPassword(false);
                setResetSuccess(false);
              }}
              className={`px-4 py-2 rounded-md transition-all ${
                view === 'sign_up'
                  ? 'font-bold text-black border-2 border-[#586D78]'
                  : 'text-gray-500 border border-gray-300'
              }`}
            >
              Sign Up
            </button>
          </div>
          <button
            onClick={onClose}
            className="danstyle1c-btn"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {showForgotPassword ? (
          <div className="mb-6 space-y-4">
            <h3 className="text-lg font-medium text-[#586D78]">Reset your password</h3>
            
            {resetSuccess ? (
              <div className="p-4 bg-green-50 rounded-md">
                <p className="text-sm text-green-700">
                  Password reset email sent! Please check your inbox and follow the instructions to reset your password.
                  {cooldownRemaining > 0 && (
                    <span className="block mt-2">
                      You can request another email in {cooldownRemaining} seconds.
                    </span>
                  )}
                  <span className="block mt-2">
                    Email requests remaining today: {10 - dailyEmailCount}/10
                  </span>
                </p>
                <button
                  onClick={() => {
                    setShowForgotPassword(false);
                    setResetSuccess(false);
                    setResetEmail('');
                  }}
                  className="danstyle1c-btn mt-3"
                >
                  Back to Login
                </button>
              </div>
            ) : (
              <form onSubmit={handleForgotPassword} className="space-y-4">
                <p className="text-sm text-gray-600">
                  Enter your email address below, and we'll send you a password reset link.
                </p>
                
                <div>
                  <label htmlFor="resetEmail" className="block text-sm font-medium text-gray-700 mb-1">
                    Email Address
                  </label>
                  <input
                    id="resetEmail"
                    type="email"
                    value={resetEmail}
                    onChange={(e) => setResetEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                    placeholder="Your email address"
                    required
                  />
                </div>
                
                {authError && (
                  <div className="p-4 bg-red-50 rounded-md">
                    <p className="text-sm text-red-700">{authError}</p>
                  </div>
                )}
                
                <div className="flex justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(false);
                      setAuthError(null);
                    }}
                    className="danstyle1c-btn"
                  >
                    Back to Login
                  </button>
                  <button
                    type="submit"
                    className="danstyle1c-btn"
                    disabled={isResettingPassword || !resetEmail || cooldownRemaining > 0}
                  >
                    {isResettingPassword ? (
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                    ) : null}
                    {isResettingPassword ? 'Sending...' : 'Send Reset Link'}
                  </button>
                </div>
                
                {dailyEmailCount > 0 && (
                  <p className="text-xs text-gray-500 text-center">
                    Email requests remaining today: {10 - dailyEmailCount}/10
                  </p>
                )}
              </form>
            )}
          </div>
        ) : (
          <div className="mb-4 space-y-2">
            <div className="p-3 bg-blue-50 rounded-md">
              <p className="text-sm text-blue-700">
                Password requirements:
              </p>
              <ul className="text-sm text-blue-700 list-disc list-inside mt-1">
                <li>At least 6 characters long</li>
                <li>Contains at least one letter</li>
                <li>Contains at least one number</li>
              </ul>
            </div>
            
            {verificationSent && (
              <div className="p-4 bg-green-50 rounded-md">
                <p className="text-sm text-green-700">
                  Please check your email to verify your account. The verification link will expire in 1 hour.
                  {cooldownRemaining > 0 && (
                    <span className="block mt-2">
                      You can request another email in {cooldownRemaining} seconds.
                    </span>
                  )}
                  <span className="block mt-2">
                    Email requests remaining today: {10 - dailyEmailCount}/10
                  </span>
                </p>
              </div>
            )}
            
            {authError && (
              <div className="p-4 bg-red-50 rounded-md">
                <p className="text-sm text-red-700">{authError}</p>
              </div>
            )}
          </div>
        )}
        
        {!showForgotPassword && (
          <>
            <Auth
              key={view}
              supabaseClient={supabase}
              appearance={{ 
                theme: ThemeSupa,
                variables: {
                  default: {
                    colors: {
                      brand: '#586D78',
                      brandAccent: '#586D78',
                    }
                  }
                }
              }}
              view={view}
              showLinks={view === 'sign_in'}
              providers={[]}
              redirectTo={siteUrl}
              onError={handleAuthError}
              onEmailVerificationSent={handleEmailSent}
            />
            
            {view === 'sign_in' && (
              <div className="text-center mt-4">
                <button
                  onClick={() => {
                    setShowForgotPassword(true);
                    setAuthError(null);
                  }}
                  className="text-[#586D78] hover:text-[#7973BB] text-sm"
                >
                  Forgot your password?
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default AuthModal;