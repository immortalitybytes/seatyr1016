// src/utils/premium.ts
import type { User } from '@supabase/supabase-js';
import type { UserSubscription, TrialSubscription } from '../types';

export type Mode = 'unsigned' | 'free' | 'premium';

export function deriveMode(
  user: User | null,
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): Mode {
  if (!user) return 'unsigned';
  return isPremiumSubscription(subscription, trial) ? 'premium' : 'free';
}

export function isPremiumSubscription(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): boolean {
  // Active trial grants premium
  if (trial?.expires_on) {
    const expiry = new Date(trial.expires_on);
    if (expiry > new Date()) return true;
  }

  if (!subscription) return false;

  // Treat active/trialing/past_due as premium (grace period)
  const activeStatuses = ['active', 'trialing', 'past_due'];
  if (activeStatuses.includes(subscription.status ?? '')) {
    // Stripe timestamps may be ISO or epoch seconds -> normalize
    if (subscription.current_period_end) {
      const endDate = /^\d{10}$/.test(String(subscription.current_period_end))
        ? new Date(Number(subscription.current_period_end) * 1000) // seconds -> ms
        : new Date(subscription.current_period_end as any);
      return endDate > new Date();
    }
    // Back-compat: if no current_period_end is present, keep premium
    return true;
  }

  // Canceled but still inside paid window
  if (subscription.status === 'canceled' && subscription.cancel_at_period_end) {
    if (subscription.current_period_end) {
      const endDate = /^\d{10}$/.test(String(subscription.current_period_end))
        ? new Date(Number(subscription.current_period_end) * 1000)
        : new Date(subscription.current_period_end as any);
      return endDate > new Date();
    }
  }
  return false;
}

export function getMaxGuestLimit(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): number {
  return isPremiumSubscription(subscription, trial) ? 10000 : 80;
}

export function getMaxSavedSettingsLimit(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): number {
  return isPremiumSubscription(subscription, trial) ? 50 : 5;
}

export function isSettingLoadable(
  setting: any,
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): boolean {
  if (!setting?.data?.guests) return true;
  if (isPremiumSubscription(subscription, trial)) return true;
  const totalHeads = (setting.data.guests || []).reduce(
    (sum: number, g: any) => sum + (Number(g?.count) || 1),
    0
  );
  return totalHeads <= getMaxGuestLimit(subscription, trial);
}

// Legacy mode-based helpers (wrappers for backward compatibility)
export function getMaxGuestLimitByMode(mode: Mode): number {
  return mode === 'premium' ? 10000 : 80;
}

export function getMaxSavedSettingsLimitByMode(mode: Mode): number {
  return mode === 'premium' ? 50 : 5;
}

export function canAddGuests(subscription: UserSubscription | null | undefined, trial: TrialSubscription | null | undefined, currentCount: number, addCount: number): boolean {
  const maxLimit = getMaxGuestLimit(subscription, trial);
  return (currentCount + addCount) <= maxLimit;
}

export function canSaveMoreSettings(subscription: UserSubscription | null | undefined, trial: TrialSubscription | null | undefined, currentCount: number): boolean {
  const maxLimit = getMaxSavedSettingsLimit(subscription, trial);
  return currentCount < maxLimit;
}
