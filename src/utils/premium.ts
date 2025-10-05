// src/utils/premium.ts
// Production-ready, trial-aware premium helpers (robust date parsing)

export type UserSubscription = any;   // Replace with your real type if available
export type TrialSubscription  = any; // Replace with your real type if available

/** Parse ISO string, seconds (10), milliseconds (13+), Date, or number-like string. */
function parseAnyDate(input: unknown): Date | null {
  if (input == null) return null;
  if (input instanceof Date) return isNaN(+input) ? null : input;

  const s = String(input).trim();
  if (!s) return null;

  if (/^\d+$/.test(s)) {
    const n  = Number(s);
    const ms = s.length === 10 ? n * 1000 : n;
    const d  = new Date(ms);
    return isNaN(+d) ? null : d;
  }

  const d = new Date(s);
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
    subscription.period_end,
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
  // Debug logging for premium detection
  console.log('[PREMIUM DEBUG] isPremiumSubscription called:', {
    subscription,
    trial,
    subscriptionType: typeof subscription,
    trialType: typeof trial,
    timestamp: new Date().toISOString()
  });

  // 1) Trial wins if unexpired
  const tEnd = trialExpiry(trial);
  console.log('[PREMIUM DEBUG] Trial expiry check:', { tEnd, isFuture: tEnd && tEnd > new Date() });
  if (tEnd && tEnd > new Date()) {
    console.log('[PREMIUM DEBUG] Trial is active, returning true');
    return true;
  }

  // 2) Subscription states (kept simple & tolerant)
  if (!subscription) {
    console.log('[PREMIUM DEBUG] No subscription, returning false');
    return false;
  }
  
  const status: string = (subscription as any).status ?? '';
  console.log('[PREMIUM DEBUG] Subscription status check:', { status, isActive: ['active', 'trialing', 'past_due'].includes(status) });
  if (['active', 'trialing', 'past_due'].includes(status)) {
    console.log('[PREMIUM DEBUG] Subscription status is premium, returning true');
    return true;
  }

  // 3) Fall back to period end time (handles providers that don't set status usefully)
  const end = subscriptionEndDate(subscription);
  console.log('[PREMIUM DEBUG] Subscription end date check:', { end, isFuture: end && end > new Date() });
  if (end && end > new Date()) {
    console.log('[PREMIUM DEBUG] Subscription period end is in future, returning true');
    return true;
  }

  console.log('[PREMIUM DEBUG] No premium conditions met, returning false');
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