import React, { useState, useEffect } from 'react';
import { useNavigate, NavLink } from 'react-router-dom';
import { Users, Table, ClipboardList, Crown, UserCircle, ArmchairIcon as ChairIcon } from 'lucide-react';
import AuthModal from './AuthModal';
import PremiumModal from './PremiumModal';
import MostRecentChoiceModal from './MostRecentChoiceModal';
import { supabase } from '../lib/supabase';
import { useApp } from '../context/AppContext';
import { isPremiumSubscription } from '../utils/premium';
import {
  getMostRecentState
} from '../lib/mostRecentState';
import { clearAllSeatyrData } from '../lib/sessionSettings';

const Header: React.FC = () => {
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showPremiumModal, setShowPremiumModal] = useState(false);
  const [showRecentChoice, setShowRecentChoice] = useState(false);
  const [user, setUser] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [subscriptionSyncing, setSubscriptionSyncing] = useState(false);
  const [syncRequested, setSyncRequested] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState(0);
  const navigate = useNavigate();
  const { state, dispatch } = useApp();

  // Use only context state for premium status to avoid race conditions
  const isPremium = isPremiumSubscription(state.subscription, state.trial);
  
  // Debug logging for premium status
  useEffect(() => {
    console.log("[HEADER DEBUG]", {
      isPremium,
      subscription: state.subscription,
      trial: state.trial,
      user: state.user?.email
    });
  }, [isPremium, state.subscription, state.trial, state.user]);

  useEffect(() => {
    // Initialize user from session
    const initUser = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        setUser(session?.user ?? null);
        
        if (session?.user) {
          dispatch({ type: 'SET_USER', payload: session.user });
          fetchSubscription(session.user.id, true); // Initial fetch - forced
        }
      } catch (err) {
        console.error('Error initializing user in Header:', err);
      }
    };
    
    initUser();

    // Listen for auth changes
    const {
      data: { subscription: authSubscription }
    } = supabase.auth.onAuthStateChange(async (event, session) => {
      console.log('Auth state changed in Header:', event);
      const newUser = session?.user ?? null;
      setUser(newUser);

      if (newUser) {
        dispatch({ type: 'SET_USER', payload: newUser });
        fetchSubscription(newUser.id, true); // Force fetch on auth change
      } else {
        // Clear subscription and reset app state when user logs out
        dispatch({ type: 'SET_SUBSCRIPTION', payload: null });
        dispatch({ type: 'RESET_APP_STATE' });
      }
    });

    return () => authSubscription.unsubscribe();
  }, [dispatch]);

  // Keep local user state in sync with context state
  useEffect(() => {
    if (state.user && state.user !== user) {
      setUser(state.user);
    }
  }, [state.user, user]);

  // Throttled subscription syncing
  useEffect(() => {
    if (!syncRequested) return;

    const now = Date.now();
    const timeSinceLastSync = now - lastSyncTime;
    const minSyncInterval = 10000; // 10 seconds minimum between syncs

    if (subscriptionSyncing) {
      // Already syncing, ignore this request
      setSyncRequested(false);
      return;
    }

    if (timeSinceLastSync < minSyncInterval) {
      // Too soon, schedule for later
      const timeout = setTimeout(() => {
        setSyncRequested(true);
      }, minSyncInterval - timeSinceLastSync);
      
      return () => clearTimeout(timeout);
    }

    // It's been long enough, perform the sync
    const doSync = async () => {
      if (!user?.id) {
        setSyncRequested(false);
        return;
      }
      
      setSubscriptionSyncing(true);
      
      try {
        // First try to get the most recent subscription record
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', user.id)
          .order('current_period_end', { ascending: false })
          .limit(1);

        if (error) {
          console.error('Subscription fetch error:', error);
          return;
        }

        const sub = data || null;
        dispatch({ type: 'SET_SUBSCRIPTION', payload: sub });

        if (!sub) {
          // If no regular subscription, check for trial subscription
          const { data: trialData, error: trialError } = await supabase
            .from('trial_subscriptions')
            .select('*')
            .eq('user_id', user.id)
            .gt('expires_on', new Date().toISOString())
            .maybeSingle();

          if (!trialError && trialData?.length > 0) {
            const trialSubscription = {
              id: `trial-${trialData[0].id}`,
              user_id: user.id,
              status: 'active',
              current_period_start: trialData[0].start_date,
              current_period_end: trialData[0].expires_on,
              cancel_at_period_end: true
            };
            dispatch({ type: 'SET_SUBSCRIPTION', payload: trialSubscription });
          } else {
            // Special case for VIP users - check only once on login, not repeatedly
            const { data: userData } = await supabase.auth.getUser();
            const email = userData?.user?.email?.toLowerCase();
            if (
              email === 'danabrams999@yahoo.com' ||
              email === 'immortality.bytes.book@gmail.com'
            ) {
              try {
                await fetch(
                  `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/sync-user-premium`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
                    },
                    body: JSON.stringify({ email })
                  }
                );

                const { data: refreshedData } = await supabase
                  .from('subscriptions')
                  .select('*')
                  .eq('user_id', user.id)
                  .order('current_period_end', { ascending: false })
                  .maybeSingle();

                const refreshedSubscription = refreshedData?.[0] || null;
                if (refreshedSubscription) {
                  dispatch({
                    type: 'SET_SUBSCRIPTION',
                    payload: refreshedSubscription
                  });
                }
              } catch (vipError) {
                console.error('VIP sync error:', vipError);
              }
            }
          }
        }
      } catch (err) {
        console.error('Error in fetchSubscription:', err);
      } finally {
        setLastSyncTime(Date.now());
        setSubscriptionSyncing(false);
        setSyncRequested(false);
      }
    };

    doSync();
  }, [syncRequested, subscriptionSyncing, lastSyncTime, user, dispatch]);

  const fetchSubscription = async (userId: string, force = false) => {
    if (!userId) return;
    
    // If forced, sync right away; otherwise use the throttled system
    if (force) {
      if (subscriptionSyncing) return;
      setSubscriptionSyncing(true);
      
      try {
        // Same logic as in the effect above, but for immediate execution
        const { data, error } = await supabase
          .from('subscriptions')
          .select('*')
          .eq('user_id', userId)
          .order('current_period_end', { ascending: false })
          .maybeSingle();

        if (error) {
          console.error('Subscription fetch error:', error);
          return;
        }

        const sub = data || null;
        dispatch({ type: 'SET_SUBSCRIPTION', payload: sub });

        if (!sub) {
          const { data: trialData, error: trialError } = await supabase
            .from('trial_subscriptions')
            .select('*')
            .eq('user_id', userId)
            .gt('expires_on', new Date().toISOString())
            .maybeSingle();

          if (!trialError && trialData) {
            const trialSubscription = {
              id: `trial-${trialData.id}`,
              user_id: userId,
              status: 'active',
              current_period_start: trialData.start_date,
              current_period_end: trialData.expires_on,
              cancel_at_period_end: true
            };
            dispatch({ type: 'SET_SUBSCRIPTION', payload: trialSubscription });
          }
        }
      } catch (err) {
        console.error('Error in forced fetchSubscription:', err);
      } finally {
        setLastSyncTime(Date.now());
        setSubscriptionSyncing(false);
      }
    } else {
      // Request a sync using the throttled system
      setSyncRequested(true);
    }
  };

  const handleLogout = async () => {
    try {
      setIsLoading(true);
      
      // Clear local storage first
      clearAllSeatyrData();
      
      // Sign out - this will trigger the auth state change handler
      // which will automatically reset app state and component state
      await supabase.auth.signOut();
      
      // Navigate back to home
      navigate('/');
    } catch (error) {
      console.error('Error during logout:', error);
      // Attempt forced logout anyway in case of error
      try {
        await supabase.auth.signOut();
        clearAllSeatyrData();
        navigate('/');
      } catch (finalError) {
        console.error('Final error during forced logout:', finalError);
        alert('An error occurred during logout. Please refresh the page.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const handleUpgrade = () => {
    if (!user) setShowAuthModal(true);
    else setShowPremiumModal(true);
  };

  const handlePremiumSuccess = () => {
    if (user?.id) {
      fetchSubscription(user.id, true);
    }
  };
  return (
    <header className="bg-[#ddele3] shadow-md" style={{ paddingTop: "1.3rem", paddingBottom: "1.3rem" }}>
      <div className="container mx-auto px-4 py-3">
        <div className="flex flex-col space-y-3 md:space-y-2">
          <div className="flex flex-col md:flex-row md:justify-between md:items-center">
            <div className="flex items-center">
              <img
                src="https://i.imgur.com/FD3PWnT.png"
                alt="Seatyr Logo"
                className="h-6 w-auto mr-8"
                style={{ height: "8rem" }} // Changed to 8rem
              />
              <div className="flex flex-col">
                <div className="relative">
                  <h3 className="text-8xl font-bold text-[#586D78]" style={{ fontSize: "4.3rem", lineHeight: "1" }}>Seatyr</h3>
                  <span className="text-xs text-[#586D78] absolute" style={{ top: "4.5rem", left: "0", whiteSpace: "nowrap", fontSize: "0.8rem" }}>Preview Version 0.976</span>
                </div>
                <span className="text-2xl italic text-[#586D78]" style={{ marginTop: "2rem", fontSize: "0.9rem" }}>Guaranteed Fewer Headaches...</span>
                <span className="text-2xl italic text-[#586D78]" style={{ fontSize: "0.9rem", marginTop: "0.3rem", lineHeight: "0.3" }}>*seating-related headaches only.</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 mt-2 md:mt-0">
              {isPremium && user && (
                <span className="flex items-center danstyle1c-btn danstyle1c-premium">
                  <Crown className="w-4 h-4 mr-1" />
                  Premium
                </span>
              )}
              {subscriptionSyncing && (
                <span className="flex items-center text-gray-600 px-2 py-0.5 text-xs">
                  Syncing...
                </span>
              )}
              {user ? (
                <>
                  <button
                    className="danstyle1c-btn"
                    onClick={() => navigate('/account')}
                  >
                    <UserCircle className="w-4 h-4 mr-2" />
                    <span className="text-xs truncate max-w-[140px]">{user.email}</span>
                  </button>
                  <button
                    className="danstyle1c-btn"
                    onClick={handleLogout}
                    disabled={isLoading}
                  >
                    {isLoading ? 'Signing Out...' : 'Sign Out'}
                  </button>
                </>
              ) : (
                <button
                  className="danstyle1c-btn"
                  onClick={() => setShowAuthModal(true)}
                >
                  Login/Join
                </button>
              )}
              {user && !isPremium && (
                <button
                  className="danstyle1c-btn danstyle1c-premium"
                  onClick={handleUpgrade}
                  disabled={isLoading}
                >
                  <Crown className="w-4 h-4 mr-2" />
                  {isLoading ? 'Processing...' : 'Upgrade'}
                </button>
              )}
            </div>
          </div>

          <nav className="flex flex-wrap gap-3 w-full" style={{ marginTop: "3.0rem" }}>
            <ul className="flex flex-wrap justify-start gap-3 w-full">
              <NavItem to="/" icon={<Users className="w-4 h-4" />} label="Guests" />
              <NavItem to="/constraints" icon={<ClipboardList className="w-4 h-4" />} label="Your Rules" />
              <NavItem to="/tables" icon={<Table className="w-4 h-4" />} label="Tables" />
              <NavLink
                to="/seating"
                className={({ isActive }) =>
                  `flex items-center ${
                    isActive
                      ? 'danstyle1c-btn selected'
                      : 'danstyle1c-btn'
                  }`
                }
              >
                {({ isActive }) => (
                  <>
                    <ChairIcon className="w-4 h-4 mr-1" />
                    <span>Seating</span>
                  </>
                )}
              </NavLink>
            </ul>
          </nav>
        </div>
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      {showPremiumModal && user && (
        <PremiumModal
          onClose={() => setShowPremiumModal(false)}
          userId={user.id}
          onSuccess={handlePremiumSuccess}
        />
      )}
      {showRecentChoice && user && isPremium && (
        <MostRecentChoiceModal
          userId={user.id}
          isPremium={isPremium}
          onClose={() => setShowRecentChoice(false)}
          onRestoreRecent={() => {
            getMostRecentState(user.id).then(recent => {
              if (recent) {
                dispatch({ type: 'LOAD_MOST_RECENT', payload: recent });
              }
              setShowRecentChoice(false);
            });
          }}
          onKeepCurrent={() => setShowRecentChoice(false)}
        />
      )}
    </header>
  );
};

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
}

const NavItem: React.FC<NavItemProps> = ({ to, icon, label }) => {
  return (
    <li className="flex-none">
      <NavLink
        to={to}
        className={({ isActive }) =>
          `flex items-center ${
            isActive
              ? 'danstyle1c-btn selected'
              : 'danstyle1c-btn'
          }`
        }
      >
        {icon}
        <span className="ml-1">{label}</span>
      </NavLink>
    </li>
  );
};

export default Header;