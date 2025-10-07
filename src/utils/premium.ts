/**
 * Utility functions for handling premium status and features
 * Implements C3 Fix (robust date parsing with UTC fallback)
 */

import type { UserSubscription, TrialSubscription } from '../types';

export type UserSubscription = any; // keep flexible to match existing DB row shape
export type TrialSubscription = any; // idem

/** Parse ISO string, seconds(10), ms(13+), Date, or numberlike string; default ambiguous ISO to UTC.
 * Implements C3 date robustness fix.
 */
function parseAnyDate(input: unknown): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return isNaN(+input) ? null : input;

  const s = String(input).trim();
  if (!s) return null;

  // Handle Unix timestamps (seconds or milliseconds)
  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const ms = s.length === 10 ? n * 1000 : n;
    const d = new Date(ms);
    return isNaN(+d) ? null : d;
  }

  // If ISO string lacks TZ info (e.g., '2025-01-01T10:00:00'), default to UTC 'Z'
  const hasTZ = s.endsWith('Z') || /[+\-]\d{2}:?\d{2}$/.test(s);
  const isISODateTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);
  const sWithTZ = isISODateTime && !hasTZ ? s + 'Z' : s;
  const d = new Date(sWithTZ); 
  return isNaN(+d) ? null : d;
}

/** Best-effort extraction of a trial expiry across common shapes. */
function trialExpiry(trial: TrialSubscription | null | undefined): Date | null {
  if (!trial) return null;

  const candidates = [
    (trial as any).expires_on,
    (trial as any).expiresAt,
    (trial as any).expiry,
    (trial as any).ends_at,
    (trial as any).endAt,
  ];
  for (const c of candidates) {
    const d = parseAnyDate(c);
    if (d) return d;
  }

  return null;
}

/** Pulls end-of-period timestamps from a subscription row. */
function subscriptionEndDate(subscription: any): Date | null {
  if (!subscription) return null;

  const candidates = [
    subscription.current_period_end, 
    subscription.period_end
  ];
  for (const c of candidates) {
    const d = parseAnyDate(c);
    if (d) return d;
  }

  return null;
}

/** Trial-aware premium check. Treats active trial as premium. */
export function isPremiumSubscription(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): boolean {
  // 1) Trial wins if unexpired
  const tEnd = trialExpiry(trial);
  if (tEnd && tEnd > new Date()) return true;

  // 2) Subscription states (tolerant of providers and old 'active' status without date)
  if (!subscription) return false;
  const status: string = (subscription as any).status ?? '';
  if (['active', 'trialing', 'past_due'].includes(status)) {
    // Legacy C4 Fallback: If status is 'active' but no end date is present, assume active (backward compatibility)
    if (status === 'active' && !subscriptionEndDate(subscription)) return true;

    // 3) Fall back to period end time (handles providers that don't set status usefully)
    const end = subscriptionEndDate(subscription);
    if (end && end > new Date()) return true;

    // If status is active/trialing/past_due and no end date is present, it's premium
    return true;
  }

  return false;
}

export function getMaxGuestLimit(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): number {
  return isPremiumSubscription(subscription, trial) ? Number.MAX_SAFE_INTEGER : 80;
}

export function getMaxSavedSettingsLimit(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): number {
  return isPremiumSubscription(subscription, trial) ? 50 : 5;
}

export function canAddGuests(
  subscription: UserSubscription | null | undefined,
  currentCount: number,
  addCount: number,
  trial?: TrialSubscription | null
): boolean {
  const maxLimit = getMaxGuestLimit(subscription, trial);
  return currentCount + addCount <= maxLimit;
}

export function canSaveMoreSettings(
  subscription: UserSubscription | null | undefined,
  currentCount: number,
  trial?: TrialSubscription | null
): boolean {
  const maxLimit = getMaxSavedSettingsLimit(subscription, trial);
  return currentCount < maxLimit;
}

export function isSettingLoadable(
  setting: any,
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): boolean {
  if (!setting?.data?.guests) return true;

  if (isPremiumSubscription(subscription, trial)) return true;

  return setting.data.guests.length <= getMaxGuestLimit(subscription, trial);
}

export function getGuestLimitMessage(
  subscription: UserSubscription | null | undefined,
  currentCount: number,
  trial?: TrialSubscription | null
): string {
  return isPremiumSubscription(subscription, trial)
    ? `${currentCount} guests`
    : `${currentCount}/80 guests used`;
}

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