import type { UserSubscription, TrialSubscription } from "../types";

function isUnixTimestamp(v: string | number): boolean {
  return !isNaN(Number(v)) && String(v).length === 10;
}

// Trial-first premium check; used everywhere with (subscription, trial?)
export function isPremiumSubscription(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): boolean {
  // Debug logging in development
  if (process.env.NODE_ENV === 'development') {
    console.log('[PREMIUM DEBUG] Checking premium status:', {
      hasSubscription: !!subscription,
      subscriptionStatus: subscription?.status,
      subscriptionEnd: subscription?.current_period_end,
      hasTrial: !!trial,
      trialExpires: trial?.expires_on,
      fullSubscription: subscription,
      fullTrial: trial
    });
  }

  if (trial && (trial as any).expires_on) {
    try {
      const expiry = new Date((trial as any).expires_on);
      const isValid = expiry > new Date();
      if (process.env.NODE_ENV === 'development') {
        console.log('[PREMIUM DEBUG] Trial check:', { expiry, now: new Date(), isValid });
      }
      if (isValid) return true;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[PREMIUM DEBUG] Trial parsing error:', error);
      }
    }
  }

  if (!subscription) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] No subscription - returning false');
    }
    return false;
  }

  if (["active", "trialing", "past_due"].includes((subscription as any).status || "")) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] Valid subscription status - returning true');
    }
    return true;
  }

  // Explicitly check for canceled status
  if ((subscription as any).status === "canceled" || (subscription as any).canceled_at) {
    if (process.env.NODE_ENV === 'development') {
      console.log('[PREMIUM DEBUG] Canceled subscription - returning false');
    }
    return false;
  }

  if ((subscription as any).current_period_end) {
    try {
      const raw = (subscription as any).current_period_end;
      const end = isUnixTimestamp(raw) ? new Date(Number(raw) * 1000) : new Date(raw);
      const isValid = end > new Date();
      if (process.env.NODE_ENV === 'development') {
        console.log('[PREMIUM DEBUG] Period end check:', { raw, end, now: new Date(), isValid });
      }
      if (isValid) return true;
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.log('[PREMIUM DEBUG] Period end parsing error:', error);
      }
    }
  }
  
  if (process.env.NODE_ENV === 'development') {
    console.log('[PREMIUM DEBUG] No valid premium status found - returning false');
  }
  return false;
}

export function getMaxGuestLimit(subscription: UserSubscription | null | undefined, trial?: TrialSubscription | null): number {
  return isPremiumSubscription(subscription, trial) ? Number.MAX_SAFE_INTEGER : 80;
}
export function getMaxSavedSettingsLimit(subscription: UserSubscription | null | undefined, trial?: TrialSubscription | null): number {
  return isPremiumSubscription(subscription, trial) ? 50 : 5;
}
export function canAddGuests(subscription: UserSubscription | null | undefined, currentCount: number, addCount: number, trial?: TrialSubscription | null): boolean {
  const max = getMaxGuestLimit(subscription, trial);
  return currentCount + addCount <= max;
}
export function canSaveMoreSettings(subscription: UserSubscription | null | undefined, currentCount: number, trial?: TrialSubscription | null): boolean {
  const max = getMaxSavedSettingsLimit(subscription, trial);
  return currentCount < max;
}
export function isSettingLoadable(setting: any, subscription: UserSubscription | null | undefined, trial?: TrialSubscription | null): boolean {
  if (!setting?.data?.guests) return true;
  if (isPremiumSubscription(subscription, trial)) return true;
  return setting.data.guests.length <= getMaxGuestLimit(subscription, trial);
}
export function getGuestLimitMessage(subscription: UserSubscription | null | undefined, currentCount: number, trial?: TrialSubscription | null): string {
  return isPremiumSubscription(subscription, trial) ? `${currentCount} guests` : `${currentCount}/80 guests used`;
}