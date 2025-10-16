import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

// Flag to check if Supabase is properly configured
export const supabaseConfigured = 
  supabaseUrl && supabaseUrl !== '' && 
  supabaseAnonKey && supabaseAnonKey !== '';

if (!supabaseConfigured && typeof window !== 'undefined') {
  console.error("Supabase is misconfigured: missing URL or anon key.");
}

// Get the site URL for redirects, ensuring HTTPS
const siteUrl = typeof window !== 'undefined' 
  ? window.location.origin.replace('http:', 'https:') 
  : '';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
    // Disabling PKCE flow for now as it can cause issues in preview/iframe environments
    // flowType: 'pkce',
    storage: typeof window !== 'undefined' ? window.localStorage : undefined,
    storageKey: 'seatyr-auth-token',
    redirectTo: `${siteUrl}/auth/callback`,
    onAuthStateChange: (event, session) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
        // Clear URL parameters after successful auth
        if (typeof window !== 'undefined') {
          const url = new URL(window.location.href);
          url.searchParams.delete('code');
          url.searchParams.delete('error');
          url.searchParams.delete('error_description');
          window.history.replaceState({}, '', url.toString());
        }
      }
    }
  }
});

// Helper function to check if Supabase connection is working
export const testSupabaseConnection = async (): Promise<boolean> => {
  if (!supabaseConfigured) return false;
  
  try {
    const { error } = await supabase.from('subscriptions').select('count', { count: 'exact', head: true });
    return !error;
  } catch (err) {
    console.error('Error testing Supabase connection:', err);
    return false;
  }
};

// Log configuration status on startup (for debugging)
if (typeof window !== 'undefined') {
  const maskedKey = supabaseAnonKey 
    ? `${supabaseAnonKey.substring(0, 3)}...${supabaseAnonKey.substring(supabaseAnonKey.length - 3)}`
    : 'not set';

  console.log(`Supabase Configuration:
    URL: ${supabaseUrl || 'not set'}
    Key: ${maskedKey}
    Configured: ${supabaseConfigured}
  `);
}