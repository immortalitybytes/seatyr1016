import React, { useState } from 'react';
import { supabase } from '../lib/supabase';
import Button from './Button';

interface CouponModalProps {
  onClose: () => void;
  onSuccess: () => void;
  onProceedToPayment: () => void;
}

const CouponModal: React.FC<CouponModalProps> = ({ onClose, onSuccess, onProceedToPayment }) => {
  const [couponCode, setCouponCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // Check if coupon exists and is unused
      const { data: coupons, error: couponError } = await supabase
        .from('coupon_codes')
        .select('*')
        .eq('code', couponCode)
        .is('used_at', null)
        .limit(1);

      const coupon = coupons?.[0] || null;
      
      if (couponError || !coupon) {
        setError('Invalid or expired coupon code');
        return;
      }

      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setError('You must be logged in to use a coupon code');
        return;
      }

      // Mark coupon as used
      const { error: updateError } = await supabase
        .from('coupon_codes')
        .update({
          used_at: new Date().toISOString(),
          used_by: user.id
        })
        .eq('id', coupon.id);

      if (updateError) {
        setError('Error applying coupon code');
        return;
      }

      // Create or update a free 30-day subscription (UPSERT to prevent duplicate-key errors)
      const { error: subscriptionError } = await supabase
        .from('subscriptions')
        .upsert({
          user_id: user.id,
          status: 'active',
          quantity: 1,
          cancel_at_period_end: true,
          current_period_start: new Date().toISOString(),
          current_period_end: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
        }, { onConflict: 'user_id' });

      if (subscriptionError) {
        setError('Error creating subscription');
        return;
      }

      onSuccess();
    } catch (err) {
      console.error('Error:', err);
      setError('An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
        <h2 className="text-2xl font-bold text-gray-800 mb-4">Premium Access</h2>
        
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="couponCode" className="block text-sm font-medium text-gray-700 mb-1">
              Do you have a coupon code? If so, enter it here:
            </label>
            <input
              id="couponCode"
              type="text"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
              placeholder="Enter coupon code"
            />
          </div>

          {error && (
            <div className="text-red-600 text-sm bg-red-50 p-2 rounded">
              {error}
            </div>
          )}

          <div className="flex justify-end space-x-2">
            <Button
              variant="secondary"
              onClick={onClose}
              disabled={loading}
            >
              Cancel
            </Button>
            
            <Button
              type="submit"
              disabled={!couponCode.trim() || loading}
            >
              Apply Coupon
            </Button>

            <Button
              onClick={onProceedToPayment}
              disabled={loading}
            >
              Pay Here
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CouponModal;