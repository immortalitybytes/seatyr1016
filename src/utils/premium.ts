import type { UserSubscription, TrialSubscription } from '../types';

/** Parse ISO string, seconds(10), ms(13+), Date, or numberish string. */
function parseAnyDate(input: unknown): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return isNaN(+input) ? null : input;

  const s = String(input).trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n = Number(s);
    const ms = s.length === 10 ? n * 1000 : n; // 10→seconds, 13+→ms
    const d = new Date(ms);
    return isNaN(+d) ? null : d;
  }

  const d = new Date(s);
  return isNaN(+d) ? null : d;
}

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

function subscriptionEndDate(subscription: any): Date | null {
  if (!subscription) return null;
  const candidates = [
    subscription.current_period_end,
    subscription.ends_at,
    subscription.cancel_at,
  ];
  for (const c of candidates) {
    const d = parseAnyDate(c);
    if (d) return d;
  }
  return null;
}

/** Trial-first premium check; robust to field/format variance. */
export function isPremiumSubscription(
  subscription: UserSubscription | null | undefined,
  trial?: TrialSubscription | null
): boolean {
  // 1) Trial treated as premium if unexpired
  const tEnd = trialExpiry(trial);
  if (tEnd && tEnd > new Date()) return true;

  // 2) Subscription states
  if (!subscription) return false;
  const status = String((subscription as any).status || '').toLowerCase();
  if (status === 'active' || status === 'trialing' || status === 'past_due') return true;

  // 3) Time-bounded premium
  const end = subscriptionEndDate(subscription);
  if (end && end > new Date()) return true;

  return false;
}

/** Keep the rest of your helpers, but pass `trial` through. */
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