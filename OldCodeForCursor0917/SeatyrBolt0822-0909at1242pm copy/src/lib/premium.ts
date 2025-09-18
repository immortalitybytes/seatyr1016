// Utility functions for premium status management

export const isPremiumUser = (subscription: any): boolean => {
  if (!subscription) return false;
  
  // Consider multiple valid subscription statuses
  return ['active', 'trialing', 'past_due'].includes(subscription.status);
};

export const getMaxSavedSettings = (subscription: any): number => {
  return isPremiumUser(subscription) ? 50 : 5;
};

export const getMaxGuests = (subscription: any): number => {
  return isPremiumUser(subscription) ? 10000 : 80; // Effectively unlimited for premium
};

export const getFeatures = (subscription: any): Record<string, boolean | number> => {
  const isPremium = isPremiumUser(subscription);
  
  return {
    isPremium,
    maxGuests: getMaxGuests(subscription),
    maxSavedSettings: getMaxSavedSettings(subscription),
    unlimitedExports: isPremium,
    prioritySupport: isPremium,
    advancedConstraints: isPremium
  };
};