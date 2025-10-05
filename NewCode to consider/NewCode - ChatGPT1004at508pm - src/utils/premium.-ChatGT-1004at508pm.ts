/**
 * Utility functions for handling premium status and features
 */

import type { UserSubscription, TrialSubscription } from '../types';

/**
 * Determine if a subscription indicates premium status
 */
export function isPremiumSubscription(subscription: any, trial?: any): boolean {
  if (trial && (trial.expires_on || trial.expiresAt)) {
    try {
      const raw = trial.expires_on ?? trial.expiresAt;
      const isUnix = /^(\d{10})$/.test(String(raw));
      const expiry = isUnix ? new Date(Number(raw) * 1000) : new Date(raw);
      if (expiry > new Date()) return true;
    } catch {}
  }
  if (!subscription) return false;
  if (['active','trialing','past_due'].includes(subscription.status || '')) return true;
  if (subscription.current_period_end) {
    try {
      const raw = subscription.current_period_end;
      const isUnix = /^(\d{10})$/.test(String(raw));
      const end = isUnix ? new Date(Number(raw) * 1000) : new Date(raw);
      if (end > new Date()) return true;
    } catch {}
  }
  return false;
}
  } catch {}

  // Debug logging (remove in production)
  if (process.env.NODE_ENV === 'development') {
    console.log('[PREMIUM DEBUG] Checking subscription:', {
      hasSub: !!sub,
      status: sub?.status,
      current_period_end: sub?.current_period_end,
      cancel_at_period_end: sub?.cancel_at_period_end,
      fullSub: sub
    });
  }

  if (!sub) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] No subscription data - returning false');
    }
    return false;
  }

  // Handle edge case: subscription object exists but is empty/null
  if (typeof sub !== 'object' || sub === null) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] Invalid subscription object type - returning false');
    }
    return false;
  }

  // Check for valid status
  const validStatuses = ['active', 'trialing', 'past_due'];
  if (!sub.status || !validStatuses.includes(sub.status)) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] Invalid status:', sub.status, '- returning false');
    }
    return false;
  }

  // Handle edge case: canceled subscription
  if (sub.status === 'canceled' || sub.canceled_at) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] Subscription canceled - returning false');
    }
    return false;
  }

  // Parse current_period_end with robust error handling
  let end: Date | null = null;
  if (sub.current_period_end) {
    try {
      // Handle both Unix timestamp (seconds) and ISO string formats
      if (Number.isFinite(+sub.current_period_end)) {
        // Unix timestamp - convert to milliseconds
        end = new Date(+sub.current_period_end * 1000);
      } else {
        // ISO string or other date format
        end = new Date(sub.current_period_end);
      }
      
      // Validate the parsed date
      if (isNaN(end.getTime())) {
        if (process.env.NODE_ENV === 'development') {
          console.warn('[PREMIUM DEBUG] Invalid date format for current_period_end:', sub.current_period_end);
        }
        return false;
      }
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.warn('[PREMIUM DEBUG] Error parsing current_period_end:', error);
      }
      return false;
    }
  }

  // Check if subscription is expired
  const now = new Date();
  const isValid = !end || end > now;
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[PREMIUM DEBUG] Period check:', {
      end,
      now,
      isValid,
      isExpired: end && end <= now,
      timeUntilExpiry: end ? (end.getTime() - now.getTime()) / 1000 / 60 / 60 / 24 : 'N/A (no expiry)'
    });

    console.log('[PREMIUM DEBUG] Final result:', isValid);
  }
  return isValid;
}

// Helper function to check if a value is likely a Unix timestamp in seconds
function isUnixTimestamp(value: string): boolean {
  return !isNaN(Number(value)) && value.length === 10;
}

/**
 * Get maximum number of guests allowed based on subscription status
 */
export function getMaxGuestLimit(subscription: UserSubscription | null | undefined): number {
  return isPremiumSubscription(subscription) ? Number.MAX_SAFE_INTEGER : 80;
}

/**
 * Get maximum number of saved settings allowed based on subscription status
 */
export function getMaxSavedSettingsLimit(subscription: UserSubscription | null | undefined): number {
  return isPremiumSubscription(subscription) ? 50 : 5;
}

/**
 * Check if user can add more guests
 */
export function canAddGuests(subscription: UserSubscription | null | undefined, currentCount: number, addCount: number): boolean {
  const maxLimit = getMaxGuestLimit(subscription);
  return (currentCount + addCount) <= maxLimit;
}

/**
 * Check if user can save more settings
 */
export function canSaveMoreSettings(subscription: UserSubscription | null | undefined, currentCount: number): boolean {
  const maxLimit = getMaxSavedSettingsLimit(subscription);
  return currentCount < maxLimit;
}

/**
 * Check if a saved setting is loadable based on the current subscription
 * Free users cannot load settings with more than 80 guests
 */
export function isSettingLoadable(setting: any, subscription: UserSubscription | null | undefined): boolean {
  if (!setting?.data?.guests) return true;
  
  if (isPremiumSubscription(subscription)) return true;
  
  return setting.data.guests.length <= getMaxGuestLimit(subscription);
}

/**
 * Get message for guest limits
 */
export function getGuestLimitMessage(subscription: UserSubscription | null | undefined, currentCount: number): string {
  const isPremium = isPremiumSubscription(subscription);
  if (isPremium) {
    return `${currentCount} guests`;
  } else {
    return `${currentCount}/80 guests used`;
  }
}

/**
 * Get debug information about subscription
 */
export function getSubscriptionDebugInfo(subscription: UserSubscription | null | undefined): string {
  if (!subscription) return 'No subscription data';
  
  return JSON.stringify({
    id: subscription.id,
    status: subscription.status,
    current_period_end: subscription.current_period_end,
    cancelled: subscription.cancel_at_period_end,
  }, null, 2);
}

/**
 * Get all features based on subscription status
 */
export function getFeatures(subscription: UserSubscription | null | undefined): Record<string, boolean | number> {
  const isPremium = isPremiumSubscription(subscription);
  
  return {
    isPremium,
    maxGuests: getMaxGuestLimit(subscription),
    maxSavedSettings: getMaxSavedSettingsLimit(subscription),
    unlimitedExports: isPremium,
    prioritySupport: isPremium,
    advancedConstraints: isPremium
  };
}