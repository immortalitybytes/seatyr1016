import { useApp } from '../context/AppContext';
import { getFeatures } from '../utils/premium';

/**
 * Hook to easily access subscription features throughout the app
 * Returns an object with feature flags and limits based on subscription status
 */
export const useSubscriptionFeatures = () => {
  const { state } = useApp();
  return getFeatures(state.subscription);
};