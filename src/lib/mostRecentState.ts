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
    console.log('Saving most recent state for user:', userId);
    
    // Trust that AppContext has already validated session before calling this
    // If session is invalid, Supabase will return 401 which we handle below
    
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
    console.log('Retrieving most recent state for user:', userId);
    
    // Trust that AppContext has already validated session before calling this
    // If session is invalid, Supabase will return 401 which we handle below
    
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
      console.log('No most recent state found for user:', userId);
      return null;
    }
    
    // Validate the retrieved data has the required fields
    const requiredFields = ['guests', 'tables', 'constraints', 'adjacents', 'assignments'];
    const missingFields = requiredFields.filter(field => !data.data[field]);
    
    if (missingFields.length > 0) {
      console.error('Retrieved state is missing fields:', missingFields);
      throw new Error('Your recent state data appears to be incomplete or corrupted.');
    }
    
    console.log('Successfully retrieved most recent state with timestamp:', data.data.timestamp);
    return data.data;
  } catch (error) {
    console.error('Error retrieving most recent state:', error);
    throw error; // Re-throw to handle in UI
  }
}

/**
 * Clears the most recently saved state for a user
 */
export async function clearMostRecentState(userId: string): Promise<boolean> {
  if (!userId) {
    return false;
  }

  try {
    console.log('Clearing most recent state for user:', userId);
    
    // Trust that AppContext has already validated session before calling this
    // If session is invalid, Supabase will return 401 which we handle below
    
    const { error } = await supabase
      .from('recent_session_states')
      .delete()
      .eq('user_id', userId);

    if (error) {
      if (error.status === 401) {
        console.error('Unauthorized when clearing most recent state (session expired)');
        return false;
      }
      console.error('Error clearing most recent state:', error);
      return false;
    }

    console.log('Most recent state cleared for user:', userId);
    return true;
  } catch (error) {
    console.error('Error clearing most recent state:', error);
    return false;
  }
}