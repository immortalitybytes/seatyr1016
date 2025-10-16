import { supabase } from './supabase';

/**
 * Saves the user's recent table settings to Supabase (for premium users)
 * or localStorage (for non-premium users)
 */
export const saveRecentSessionSettings = async (
  userId: string | undefined,
  isPremium: boolean,
  tables: any[]
) => {
  if (!tables || tables.length === 0) return;

  try {
    localStorage.setItem('seatyr_recent_tables', JSON.stringify(tables));

    if (isPremium && userId) {
      // Check for valid session first
      const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
      
      if (sessionError) {
        console.error('Session error when saving recent session settings:', sessionError);
        throw new Error('Your session has expired. Please log in again.');
      }
      
      if (!sessionData.session) {
        console.log('No active session, skipping recent session settings save');
        throw new Error('No active session. Please log in to save your settings.');
      }
      
      const { data, error: fetchError } = await supabase
        .from('recent_session_settings')
        .select('id')
        .eq('user_id', userId)
        .maybeSingle();

      if (fetchError) {
        if (fetchError.status === 401) {
          console.error('Unauthorized when fetching session settings (session expired)');
          throw new Error('Your session has expired. Please log in again.');
        }
        console.error('Error fetching recent session settings:', fetchError);
        throw new Error('Failed to fetch recent session settings: ' + fetchError.message);
      }

      const tableData = {
        tables: tables,
        timestamp: new Date().toISOString(),
      };

      if (data) {
        const { error: updateError } = await supabase
          .from('recent_session_settings')
          .update({ data: tableData })
          .eq('user_id', userId);
          
        if (updateError) {
          console.error('Error updating recent session settings:', updateError);
          throw new Error('Failed to update recent session settings: ' + updateError.message);
        }
      } else {
        const { error: insertError } = await supabase
          .from('recent_session_settings')
          .insert([{ user_id: userId, data: tableData }]);
          
        if (insertError) {
          console.error('Error inserting recent session settings:', insertError);
          throw new Error('Failed to save recent session settings: ' + insertError.message);
        }
      }
    }
  } catch (err) {
    console.error('Error saving recent session settings:', err);
    throw err; // Re-throw for handling in the UI
  }
};

/**
 * Loads the user's most recent session settings
 */
export const loadRecentSessionSettings = async (
  userId: string | undefined
): Promise<any[] | null> => {
  if (!userId) return null;

  try {
    // Check for valid session first
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session error when loading recent session settings:', sessionError);
      throw new Error('Your session has expired. Please log in again.');
    }
    
    if (!sessionData.session) {
      console.log('No active session, skipping recent session settings load');
      throw new Error('No active session. Please log in to load your settings.');
    }
    
    const { data, error } = await supabase
      .from('recent_session_settings')
      .select('data')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (error.status === 401) {
        console.error('Unauthorized when loading session settings (session expired)');
        throw new Error('Your session has expired. Please log in again.');
      }
      console.error('Error loading recent session settings:', error);
      throw new Error('Failed to load recent session settings: ' + error.message);
    }

    if (!data) {
      return null;
    }

    return data.data.tables;
  } catch (err) {
    console.error('Exception loading session settings:', err);
    throw err; // Re-throw for handling in the UI
  }
};

/**
 * Clears the recent session settings for a user
 * @returns Object with success status and optional error message
 */
export const clearRecentSessionSettings = async (
  userId: string | undefined,
  skipLocal = false
): Promise<{ success: boolean, error?: string }> => {
  // [CHANGE: safety/clarity] Still clear localStorage even if userId is missing
  if (!skipLocal) {
    localStorage.removeItem('seatyr_recent_tables');
  }

  if (!userId) {
    // [CHANGE: safety/clarity] Return clear result for missing userId
    return { success: false, error: 'No user ID provided' };
  }

  try {
    // [CHANGE: safety/clarity] Check for valid session first and return silently if no session
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      // [CHANGE: safety/clarity] Just log the error and return structured response instead of throwing
      console.error('Session error when clearing session settings:', sessionError);
      return { success: false, error: 'No active session' };
    }
    
    if (!sessionData.session) {
      // [CHANGE: safety/clarity] Just log and return structured response instead of throwing
      console.log('No active session, skipping clear session settings');
      return { success: false, error: 'No active session' };
    }
    
    const { error } = await supabase
      .from('recent_session_settings')
      .delete()
      .eq('user_id', userId);
      
    if (error) {
      // [CHANGE: safety/clarity] Log error but return structured response
      console.error('Error clearing session settings from Supabase:', error);
      if (error.status !== 401) {
        // Only log detailed errors if it's not an auth error
        console.error('Failed to clear session settings: ' + error.message);
      }
      return { success: false, error: error.message };
    }

    // [CHANGE: safety/clarity] Return success object
    return { success: true };
  } catch (err) {
    // [CHANGE: safety/clarity] Log the error but return structured response instead of re-throwing
    console.error('Error clearing session settings from Supabase:', err);
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
  }
};

/**
 * Clears all Seatyr-related data from localStorage and sessionStorage
 * This is called during logout to ensure no user data remains in the browser
 */
export const clearAllSeatyrData = () => {
  try {
    // Clear all items with keys starting with "seatyr_" from localStorage
    Object.keys(localStorage).forEach(key => {
      if (key.startsWith('seatyr_')) {
        localStorage.removeItem(key);
      }
    });
    
    // Clear main app state
    localStorage.removeItem('seatyr_app_state');
    localStorage.removeItem('seatyr_current_setting_name');
    
    // Clear all items with keys starting with "seatyr_" from sessionStorage
    Object.keys(sessionStorage).forEach(key => {
      if (key.startsWith('seatyr_')) {
        sessionStorage.removeItem(key);
      }
    });
    
    // Clear Supabase auth session storage
    localStorage.removeItem('seatyr-auth-token');
    localStorage.removeItem('supabase.auth.token');
    
    // Clear any other potential storage items
    localStorage.removeItem('lastEmailSent');
    localStorage.removeItem('dailyEmailCount');
    localStorage.removeItem('emailCountDate');
    
    console.log('All Seatyr data cleared from browser storage');
  } catch (err) {
    console.error('Error clearing Seatyr data from storage:', err);
  }
};