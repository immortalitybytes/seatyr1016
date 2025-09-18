import React, { useEffect, useState } from 'react';
import { useApp } from '../context/AppContext';
import { supabase, supabaseConfigured, testSupabaseConnection } from '../lib/supabase';

const DeploymentStatusCheck: React.FC = () => {
  const { state, dispatch } = useApp();
  const [checking, setChecking] = useState(true);
  const [connectionStatus, setConnectionStatus] = useState<'success' | 'error' | 'checking'>('checking');
  const [configStatus, setConfigStatus] = useState<'success' | 'error' | 'checking'>('checking');

  useEffect(() => {
    const checkSupabaseConfig = async () => {
      setChecking(true);
      
      // Check for Supabase configuration
      if (!supabaseConfigured) {
        setConfigStatus('error');
      } else {
        setConfigStatus('success');
      }
      
      // Test connectivity
      try {
        const isConnected = await testSupabaseConnection();
        setConnectionStatus(isConnected ? 'success' : 'error');
        dispatch({ type: 'SET_SUPABASE_CONNECTED', payload: isConnected });
      } catch (error) {
        console.error('Error checking Supabase connection:', error);
        setConnectionStatus('error');
        dispatch({ type: 'SET_SUPABASE_CONNECTED', payload: false });
      }
      
      setChecking(false);
    };
    
    checkSupabaseConfig();
  }, [dispatch]);

  if (!checking && configStatus === 'success' && connectionStatus === 'success') {
    return null; // Everything is fine, don't show anything
  }

  return (
    <div className="fixed bottom-4 right-4 bg-white rounded-lg shadow-md p-4 max-w-md z-50">
      <h3 className="font-bold text-lg mb-2">Supabase Connection Status</h3>
      
      <div className="space-y-2">
        <div className="flex items-center">
          <span className="mr-2">Configuration:</span>
          {configStatus === 'checking' && <span className="text-blue-500">Checking...</span>}
          {configStatus === 'success' && <span className="text-green-600">✓ Valid</span>}
          {configStatus === 'error' && <span className="text-red-600">✗ Missing or invalid</span>}
        </div>
        
        <div className="flex items-center">
          <span className="mr-2">Connection:</span>
          {connectionStatus === 'checking' && <span className="text-blue-500">Checking...</span>}
          {connectionStatus === 'success' && <span className="text-green-600">✓ Connected</span>}
          {connectionStatus === 'error' && <span className="text-red-600">✗ Failed</span>}
        </div>
      </div>
      
      {(configStatus === 'error' || connectionStatus === 'error') && (
        <div className="mt-3 bg-red-50 p-3 rounded-md text-sm">
          <p className="font-semibold text-red-700 mb-1">Troubleshooting:</p>
          <ul className="list-disc pl-5 text-red-700">
            {configStatus === 'error' && (
              <li>Check your .env file has valid VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY values</li>
            )}
            {connectionStatus === 'error' && (
              <>
                <li>Verify your Supabase project is online</li>
                <li>Check your network connection</li>
                <li>Verify the anon key has necessary permissions</li>
              </>
            )}
          </ul>
          <pre className="bg-red-100 p-2 mt-2 rounded overflow-auto text-xs">
            VITE_SUPABASE_URL=https://your-project-id.supabase.co<br/>
            VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
          </pre>
        </div>
      )}
    </div>
  );
};

export default DeploymentStatusCheck;