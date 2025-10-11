import React, { useState, useEffect } from 'react';
import { Save, FolderOpen, Edit2, Copy, Trash2, AlertCircle, Crown, RefreshCw } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { isPremiumSubscription, getMaxSavedSettingsLimit, getMaxSavedSettingsLimitByMode, canSaveMoreSettings } from '../utils/premium';
import AuthModal from '../components/AuthModal';
import { useNavigate } from 'react-router-dom';
import { clearRecentSessionSettings } from '../lib/sessionSettings';

interface SavedSetting {
  id: string;
  name: string;
  data: any;
  created_at: string;
  updated_at: string;
}

const SavedSettings: React.FC = () => {
  const { state, dispatch, mode } = useApp();
  const [settings, setSettings] = useState<SavedSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newSettingName, setNewSettingName] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const navigate = useNavigate();

  // Get user and subscription from global app state (AppContext is SSoT)
  const { user, subscription } = state;

  // Load settings when user is available from AppContext (trust AppContext session handling)
  useEffect(() => {
    const effectiveUser = user;
    
    if (effectiveUser) {
      loadSettings();
    } else {
      setSettings([]);
      setLoading(false);
    }
  }, [user]);

  const loadSettings = async () => {
    try {
      const effectiveUser = user;
      
      if (!effectiveUser) {
        setSettings([]);
        setLoading(false);
        return;
      }
      
      setLoading(true);
      setError(null);
      
      const { data, error } = await supabase
        .from('saved_settings')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });

      if (error) {
        if (error.status === 401) {
          console.error('Session expired when loading settings');
          setSessionError('Your session has expired. Please log in again.');
          setSessionUser(null);
          dispatch({ type: 'SET_USER', payload: null });
          throw new Error('Session expired');
        }
        
        console.error('Error loading settings:', error);
        throw error;
      }
      
      console.log('Loaded settings:', data?.length || 0);
      setSettings(data || []);
    } catch (err) {
      setError('Failed to load saved settings. Please try again or refresh the page.');
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleLoadSetting = async (setting: any) => {
    try {
      // Ensure the data object is complete
      if (!setting.data) {
        throw new Error('Saved setting data is missing or corrupted');
      }
      
      // Check if tables have the seats property
      if (setting.data.tables) {
        setting.data.tables = setting.data.tables.map(table => {
          if (!table.hasOwnProperty('seats')) {
            return { ...table, seats: 8 };
          }
          return table;
        });
      }
      
      // Add userSetTables flag if missing
      if (!setting.data.hasOwnProperty('userSetTables')) {
        setting.data.userSetTables = true; // Default to true for saved settings
      }
      
      // Store the name of the loaded setting in localStorage
      localStorage.setItem('seatyr_current_setting_name', setting.name);
      
      // For full replacement, we don't need to check for duplicates
      // Just import the entire state directly
      dispatch({ type: 'IMPORT_STATE', payload: setting.data });
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
      dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
      
      // Update the setting's last_accessed timestamp
      await supabase
        .from('saved_settings')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', setting.id)
        .eq('user_id', (user || sessionUser).id);
      
      // Navigate to the Seating tab page
      navigate('/seating');
    } catch (err) {
      console.error('Failed to load settings:', err);
      setOperationError('Failed to load settings: ' + (err.message || 'Unknown error'));
    }
  };

  const handleSave = async () => {
    setError(null);
    const effectiveUser = user || sessionUser;
    
    if (!effectiveUser) {
      setShowAuthModal(true);
      return;
    }
    
    if (!newSettingName.trim()) {
      setError('Please enter a name for your settings');
      return;
    }

    try {
      setSavingSettings(true);
      
      // Check if user is premium
      const isPremium = isPremiumSubscription(subscription);
      const maxSettings = getMaxSavedSettingsLimitByMode(mode);
      
      // Check if user has reached their limit
      if (settings.length >= maxSettings && !isPremium) {
        setError(`Free users can only save up to ${maxSettings} settings. Upgrade to Premium for unlimited settings.`);
        return;
      }

      // Ensure we capture the full state including tables and their seats
      const settingData = {
        version: "1.0",
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

      const { error } = await supabase
        .from('saved_settings')
        .insert({
          name: newSettingName,
          data: settingData,
          user_id: effectiveUser.id // Explicitly set user_id for RLS
        });

      if (error) {
        console.error('Error saving settings:', error);
        if (error.message.includes('violates row-level security policy')) {
          throw new Error('You don\'t have permission to save settings. Please make sure you\'re logged in.');
        } else if (error.message.includes('enforce_save_rate_limit')) {
          throw new Error('You\'re saving too quickly. Please wait a moment and try again.');
        } else if (error.message.includes('check_settings_limit')) {
          throw new Error(`You've reached your limit of saved settings. Upgrade to Premium for more.`);
        } else {
          throw error;
        }
      }

      setShowSaveModal(false);
      setNewSettingName('');
      
      // Reset current setting name in localStorage
      localStorage.setItem('seatyr_current_setting_name', newSettingName);
      
      // Update loadedSavedSetting to true
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
      
      await loadSettings();
    } catch (err) {
      console.error('Failed to save settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleDuplicate = async (setting: SavedSetting) => {
    setOperationError(null);
    try {
      const effectiveUser = user || sessionUser;
      if (!effectiveUser) {
        setShowAuthModal(true);
        return;
      }

      // Check if user is premium
      const isPremium = isPremiumSubscription(subscription);
      const maxSettings = getMaxSavedSettingsLimitByMode(mode);
      
      // Check if user has reached their limit
      if (settings.length >= maxSettings && !isPremium) {
        setOperationError(`Free users can only save up to ${maxSettings} settings. Upgrade to Premium for more settings.`);
        return;
      }
      
      const { error } = await supabase
        .from('saved_settings')
        .insert({
          name: `${setting.name} (Copy)`,
          data: setting.data,
          user_id: effectiveUser.id // Explicitly set user_id for RLS
        });

      if (error) {
        if (error.message.includes('enforce_save_rate_limit')) {
          throw new Error('You\'re duplicating too quickly. Please wait a moment and try again.');
        } else if (error.message.includes('check_settings_limit')) {
          throw new Error(`You've reached your limit of saved settings. Upgrade to Premium for more.`);
        } else if (error.message.includes('duplicate key') || error.message.includes('unique constraint')) {
          throw new Error('A setting with this name already exists. Please choose a different name.');
        } else {
          throw error;
        }
      }
      
      await loadSettings();
    } catch (err) {
      console.error('Failed to duplicate settings:', err);
      setOperationError('Failed to duplicate settings: ' + (err.message || 'Unknown error'));
    }
  };

  const handleDelete = async (id: string) => {
    setOperationError(null);
    if (!window.confirm('Are you sure you want to delete these settings?')) return;

    try {
      const { error } = await supabase
        .from('saved_settings')
        .delete()
        .eq('id', id)
        .eq('user_id', (user || sessionUser).id);

      if (error) {
        if (error.status === 401) {
          throw new Error('Your session has expired. Please log in again.');
        } else {
          throw error;
        }
      }
      
      // If we just deleted the currently loaded setting, update the name
      const currentSettingName = localStorage.getItem('seatyr_current_setting_name');
      const settingToDelete = settings.find(s => s.id === id);
      
      if (settingToDelete && currentSettingName === settingToDelete.name) {
        localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
        dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
      }
      
      await loadSettings();
    } catch (err) {
      console.error('Failed to delete settings:', err);
      setOperationError('Failed to delete settings: ' + (err.message || 'Unknown error'));
    }
  };

  const handleRename = async (id: string, currentName: string) => {
    setOperationError(null);
    const newName = prompt('Enter new name:', currentName);
    if (!newName || newName === currentName) return;

    try {
      const { error } = await supabase
        .from('saved_settings')
        .update({ name: newName })
        .eq('id', id)
        .eq('user_id', (user || sessionUser).id);

      if (error) {
        if (error.status === 401) {
          throw new Error('Your session has expired. Please log in again.');
        } else {
          throw error;
        }
      }
      
      // If we just renamed the currently loaded setting, update the name
      const currentSettingName = localStorage.getItem('seatyr_current_setting_name');
      if (currentSettingName === currentName) {
        localStorage.setItem('seatyr_current_setting_name', newName);
      }
      
      await loadSettings();
    } catch (err) {
      console.error('Failed to rename settings:', err);
      setOperationError('Failed to rename settings: ' + (err.message || 'Unknown error'));
    }
  };

  const handleRetrySession = async () => {
    try {
      setSessionLoading(true);
      setSessionError(null);
      
      const { data, error } = await supabase.auth.getSession();
      
      if (error) {
        console.error('Error retrying session check:', error);
        setSessionError('Failed to verify authentication. Please log in again.');
        return;
      }
      
      const sessionUser = data?.session?.user;
      if (sessionUser) {
        console.log('Found authenticated user in session:', sessionUser.id);
        setSessionUser(sessionUser);
        dispatch({ type: 'SET_USER', payload: sessionUser });
        loadSettings();
      } else {
        setSessionError('No active session found. Please log in.');
      }
    } catch (err) {
      console.error('Error in retry session:', err);
      setSessionError('An unexpected error occurred. Please try again.');
    } finally {
      setSessionLoading(false);
    }
  };

  // Check premium status from global state
  const isPremium = isPremiumSubscription(subscription);
  const maxSettings = getMaxSavedSettingsLimit(isPremium ? { status: 'active' } : null);
  
  // Check if we have an effective user (either from context or session)
  const effectiveUser = user || sessionUser;
  
  // Get the current setting name from localStorage
  const currentSettingName = localStorage.getItem('seatyr_current_setting_name') || null;
  
  // Check if the current setting has been modified
  const isSettingModified = state.loadedSavedSetting && state.seatingPlans.length === 0;

  // Show login prompt if no user found in context or session
  if (!effectiveUser && !sessionLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <FolderOpen className="mr-2" />
          Saved Settings
        </h1>

        <Card>
          <div className="text-center py-8">
            {sessionError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 mb-4 text-red-700">
                <p>{sessionError}</p>
                <button 
                  onClick={handleRetrySession}
                  className="danstyle1c-btn mt-2 text-sm"
                  disabled={sessionLoading}
                >
                  {sessionLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                  {sessionLoading ? 'Checking...' : 'Try Again'}
                </button>
              </div>
            )}

            <p className="text-gray-600 mb-4">
              You need to be logged in to access saved settings.
            </p>
            <Button onClick={() => setShowAuthModal(true)}>
              Log In or Sign Up
            </Button>
          </div>
        </Card>
        
        {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
      </div>
    );
  }

  // Show loading state while checking session
  if (sessionLoading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <FolderOpen className="mr-2" />
          Saved Settings
        </h1>

        <Card>
          <div className="text-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#586D78] mx-auto mb-4"></div>
            <p className="text-gray-600">Verifying your account...</p>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
        <FolderOpen className="mr-2" />
        Saved Settings

      </h1>

      <Card>
        <div className="space-y-4">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
            <p className="text-gray-700">
              Save and manage your seating arrangements.
              {!isPremium 
                ? ` Free users can save up to ${maxSettings} configurations. Premium users can save up to 50.`
                : ` Premium users can save up to 50 configurations.`}
            </p>
            

          </div>

          <button
            className="danstyle1c-btn"
            onClick={() => setShowSaveModal(true)}
            disabled={isPremium ? settings.length >= 50 : settings.length >= maxSettings}
          >
            <Save className="w-4 h-4 mr-2" />
            Save Current Settings
          </button>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start">
              <AlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
              <p className="text-red-700">{error}</p>
            </div>
          )}
          
          {!isPremium && settings.length >= maxSettings && (
            <div className="bg-indigo-50 border border-indigo-200 rounded-md p-3">
              <p className="text-indigo-700">
                You've reached your limit of {maxSettings} saved settings. 
                <span className="font-bold"> Upgrade to Premium for more saved settings!</span>
              </p>
            </div>
          )}
        </div>
      </Card>

      <Card title="Saved Configurations">
        {loading ? (
          <div className="text-center py-4">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
            <p className="mt-2 text-gray-600">Loading saved settings...</p>
          </div>
        ) : settings.length === 0 ? (
          <div className="text-center py-4 text-gray-500">
            No saved settings yet. Click "Save Current Settings" to create your first configuration.
          </div>
        ) : (
          <div className="space-y-4">
            {operationError && (
              <div className="bg-red-50 border border-red-200 rounded-md p-3 flex items-start">
                <AlertCircle className="w-5 h-5 text-red-500 mr-2 flex-shrink-0 mt-0.5" />
                <p className="text-red-700">{operationError}</p>
              </div>
            )}
            
            {settings.map((setting) => {
              // Check if this setting is the currently loaded one
              const isCurrentSetting = setting.name === currentSettingName;
              
              // Determine border class based on loaded state and modification status
              let borderClass = "border border-gray-200";
              if (isCurrentSetting) {
                borderClass = isSettingModified 
                  ? "border-2 border-[#d1d5db]" 
                  : "border-2 border-[#06b6d4]";
              }
              
              return (
                <div
                  key={setting.id}
                  className={`${borderClass} rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer`}
                  onClick={() => handleLoadSetting(setting)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-[#586D78]">{setting.name}</h3>
                      <p className="text-sm text-gray-500">
                        Last modified: {new Date(setting.updated_at).toLocaleDateString()}
                      </p>
                      {setting.data?.guests && (
                        <p className="text-sm text-gray-600">
                          {setting.data.guests.length} guests • {setting.data.tables?.length || 0} tables
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        className="danstyle1c-btn bg-[#586D78] text-white"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleLoadSetting(setting);
                        }}
                      >
                        <FolderOpen className="w-4 h-4 mr-2" />
                        Load
                      </button>
                      <button
                        className="danstyle1c-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRename(setting.id, setting.name);
                        }}
                      >
                        <Edit2 className="w-4 h-4 mr-2" />
                        Rename
                      </button>
                      <button
                        className="danstyle1c-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDuplicate(setting);
                        }}
                        disabled={!isPremium && settings.length >= maxSettings}
                      >
                        <Copy className="w-4 h-4 mr-2" />
                        Duplicate
                      </button>
                      <button
                        className="danstyle1c-btn danstyle1c-remove"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(setting.id);
                        }}
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Save Current Settings</h3>
            <div className="mb-4">
              <label htmlFor="settingName" className="block text-sm font-medium text-gray-700 mb-1">
                Configuration Name
              </label>
              <input
                id="settingName"
                type="text"
                value={newSettingName}
                onChange={(e) => setNewSettingName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78]"
                placeholder="Enter a name for these settings"
              />
            </div>
            
            {error && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
            
            <div className="flex justify-end space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={() => {
                  setShowSaveModal(false);
                  setError(null);
                }}
                disabled={savingSettings}
              >
                Cancel
              </button>
              <button
                className="danstyle1c-btn bg-[#586D78] text-white"
                onClick={handleSave}
                disabled={!newSettingName.trim() || savingSettings}
              >
                <Save className="w-4 h-4 mr-2" />
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        </div>
      )}
      
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  );
};

export default SavedSettings;