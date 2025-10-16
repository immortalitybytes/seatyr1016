import React, { useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const AuthCallback: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Handle the auth callback
    const handleAuthCallback = async () => {
      try {
        const { error } = await supabase.auth.getSession();
        if (error) throw error;
        
        // Check if this is a password recovery flow
        const url = new URL(window.location.href);
        const type = url.searchParams.get('type');
        const isPasswordRecovery = type === 'recovery';
        
        // Store the recovery flag in sessionStorage if needed
        if (isPasswordRecovery) {
          console.log('Password reset detected, redirecting to account page');
          sessionStorage.setItem('password_reset_redirect', 'true');
          // Redirect to account page after successful password reset auth
          navigate('/account', { replace: true });
        } else {
          // Normal flow - redirect to home page
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('Error during auth callback:', error);
        navigate('/', { replace: true });
      }
    };

    handleAuthCallback();
  }, [navigate, location]);

  return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-indigo-500 mx-auto mb-4"></div>
        <p className="text-gray-600">Completing authentication...</p>
      </div>
    </div>
  );
};

export default AuthCallback;