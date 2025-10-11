import { supabase } from './supabase';
import { isPremiumSubscription } from '../utils/premium';
import { AppState } from '../types';

/**
 * Saves the current application state as the most recent state for premium users
 */
export async function saveMostRecentState(userId: string, state: AppState, isPremium: boolean): Promise<boolean> {
  if (!userId || !isPremium) {
    return false;
  }

  try {
    // Check for valid session first
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session error when saving most recent state:', sessionError);
      throw new Error('Your session has expired. Please log in again.');
    }
    
    if (!sessionData.session) {
      console.log('No active session, skipping most recent state save');
      throw new Error('No active session. Please log in to save your state.');
    }

    // Create a copy of the state without subscription and user info
    const stateToSave = { 
      version: "1.0",
      timestamp: new Date().toISOString(),
      guests: state.guests,
      tables: state.tables.map(table => ({
        id: table.id,
        seats: table.seats,
        name: table.name
      })),
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments,
      seatingPlans: state.seatingPlans,
      currentPlanIndex: state.currentPlanIndex,
      userSetTables: state.userSetTables
    };
    
    // First check if a record already exists for this user
    const { data: existingData, error: checkError } = await supabase
      .from('recent_session_states')
      .select('user_id')
      .eq('user_id', userId)
      .maybeSingle();

    if (checkError) {
      if (checkError.status === 401) {
        console.error('Unauthorized when checking for existing recent state (session expired)');
        throw new Error('Your session has expired. Please log in again.');
      }
      console.error('Error checking for existing recent state:', checkError);
      throw new Error('Failed to check for existing state: ' + checkError.message);
    }

    // Use upsert to either update or insert
    const { error } = await supabase
      .from('recent_session_states')
      .upsert({
        user_id: userId,
        data: stateToSave
      }, {
        onConflict: 'user_id'
      });

    if (error) {
      if (error.status === 401) {
        console.error('Unauthorized when saving recent state (session expired)');
        throw new Error('Your session has expired. Please log in again.');
      }
      console.error('Error saving most recent state:', error);
      throw new Error('Failed to save most recent state: ' + error.message);
    }

    console.log('Most recent state saved successfully for user:', userId);
    return true;
  } catch (error) {
    console.error('Error saving most recent state:', error);
    throw error;
  }
}

/**
 * Retrieves the most recently saved state for a user
 */
export async function getMostRecentState(userId: string): Promise<AppState | null> {
  if (!userId) {
    return null;
  }

  try {
    // Check for valid session first
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      console.error('Session error when retrieving most recent state:', sessionError);
      throw new Error('Your session has expired. Please log in again.');
    }
    
    if (!sessionData.session) {
      console.log('No active session, skipping most recent state fetch');
      throw new Error('No active session. Please log in to access your recent state.');
    }
    
    const { data, error } = await supabase
      .from('recent_session_states')
      .select('data, updated_at')
      .eq('user_id', userId)
      .maybeSingle();

    if (error) {
      if (error.status === 401) {
        console.error('Unauthorized when retrieving most recent state (session expired)');
        throw new Error('Session expired. Please log in again to access your recent state.');
      }
      console.error('Error retrieving most recent state:', error);
      throw new Error('Failed to retrieve your most recent state: ' + error.message);
    }

    if (!data || !data.data) {
      return null;
    }
    
    // Validate the retrieved data has the required fields
    const requiredFields = ['guests', 'tables', 'constraints', 'adjacents', 'assignments'];
    const missingFields = requiredFields.filter(field => !data.data[field]);
    
    if (missingFields.length > 0) {
      console.error('Retrieved state is missing fields:', missingFields);
      throw new Error('Your recent state data appears to be incomplete or corrupted.');
    }
    
    return data.data;
  } catch (error) {
    console.error('Error retrieving most recent state:', error);
    throw error; // Re-throw to handle in UI
  }
}

/**
 * Clears the most recently saved state for a user
 * @returns Object with success status and optional error message
 */
export async function clearMostRecentState(userId: string): Promise<{ success: boolean; error?: string }> {
  if (!userId) {
    // [CHANGE: safety/clarity] Return structured result for missing userId
    return { success: false, error: 'No user ID provided' };
  }

  try {
    // [CHANGE: safety/clarity] Check for valid session first and return structured result if no session
    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    
    if (sessionError) {
      // [CHANGE: safety/clarity] Just log the error and return structured response instead of throwing
      console.error('Session error when clearing most recent state:', sessionError);
      return { success: false, error: 'No active session' };
    }
    
    if (!sessionData.session) {
      // [CHANGE: safety/clarity] Just log and return structured response instead of throwing
      console.log('No active session, skipping most recent state clear');
      return { success: false, error: 'No active session' };
    }
    
    const { error } = await supabase
      .from('recent_session_states')
      .delete()
      .eq('user_id', userId);

    if (error) {
      // [CHANGE: safety/clarity] Return structured error response
      if (error.status === 401) {
        console.error('Unauthorized when clearing most recent state (session expired)');
        return { success: false, error: 'Session expired' };
      }
      console.error('Error clearing most recent state:', error);
      return { success: false, error: error.message };
    }

    console.log('Most recent state cleared for user:', userId);
    return { success: true };
  } catch (error) {
    // [CHANGE: safety/clarity] Log the error but return structured response instead of re-throwing
    console.error('Error clearing most recent state:', error);
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}