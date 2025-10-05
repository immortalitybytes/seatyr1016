import { describe, it, expect } from 'vitest';
import { isPremiumSubscription } from '../../utils/premium';
const secFromNow = (s:number)=> Math.floor(Date.now()/1000) + s;
const isoFromNow = (ms:number)=> new Date(Date.now()+ms).toISOString();

describe('isPremiumSubscription (trial-aware)', () => {
  it('treats unexpired trial (seconds) as premium', () => {
    expect(isPremiumSubscription(null, { expires_on: String(secFromNow(3600)) })).toBe(true);
  });
  it('treats unexpired trial (ISO) as premium', () => {
    expect(isPremiumSubscription(null, { expiresAt: isoFromNow(7200_000) })).toBe(true);
  });
  it('falls back to subscription period end', () => {
    expect(isPremiumSubscription({ current_period_end: String(secFromNow(1800)) } as any, null)).toBe(true);
  });
});