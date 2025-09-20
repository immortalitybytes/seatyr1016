import React, { useState, useEffect, useRef } from 'react';
import { Save, FolderOpen, Edit2, Copy, Trash2, AlertCircle, Crown, ChevronDown, ChevronUp } from 'lucide-react';
import Card from './Card';
import Button from './Button';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { isPremiumSubscription, getMaxSavedSettingsLimit, isSettingLoadable } from '../utils/premium';
import AuthModal from './AuthModal';
import { useNavigate } from 'react-router-dom';

interface SavedSetting {
  id: string;
  name: string;
  data: any;
  created_at: string;
  updated_at: string;
}

interface SavedSettingsAccordionProps {
  isDefaultOpen?: boolean;
}

const SavedSettingsAccordion: React.FC<SavedSettingsAccordionProps> = ({ isDefaultOpen = false }) => {
  const { state, dispatch } = useApp();
  const [settings, setSettings] = useState<SavedSetting[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [newSettingName, setNewSettingName] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [sessionUser, setSessionUser] = useState<any | null>(null);
  const [sessionLoading, setSessionLoading] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(isDefaultOpen);
  
  // In-line editing states
  const [editingSettingId, setEditingSettingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState<string>('');
  const [nameError, setNameError] = useState<string | null>(null);
  
  // Safety mechanisms for inline editing
  const [clickingDisabled, setClickingDisabled] = useState(false);
  
  const editInputRef = useRef<HTMLInputElement>(null);
  
  const navigate = useNavigate();

  // Get user and subscription from global app state
  const { user, subscription } = state;

  // Effect to fetch settings when the accordion is opened
  useEffect(() => {
    if (isOpen && (user || sessionUser)) {
      loadSettings();
    }
  }, [isOpen, user, sessionUser]);

  // Try to get session user if context user is not available
  useEffect(() => {
    const checkSession = async () => {
      if (!user) {
        try {
          setSessionLoading(true);
          setSessionError(null);
          
          const { data, error } = await supabase.auth.getSession();
          
          if (error) {
            console.error('Error fetching session:', error);
            setSessionError('Failed to verify authentication. Please try again or log in.');
            return;
          }
          
          const sessionUser = data?.session?.user;
          if (sessionUser) {
            console.log('Found authenticated user in session:', sessionUser.id);
            setSessionUser(sessionUser);
            
            // Also dispatch to context so other components can use it
            dispatch({ type: 'SET_USER', payload: sessionUser });
            
            // Fetch subscription data for this user
            try {
              const { data: subData, error: subError } = await supabase
                .from('subscriptions')
                .select('*')
                .eq('user_id', sessionUser.id)
                .order('current_period_end', { ascending: false })
                .limit(1);

              if (!subError && subData && subData.length > 0) {
                dispatch({ type: 'SET_SUBSCRIPTION', payload: subData[0] });
              }
            } catch (err) {
              console.error('Error fetching subscription data:', err);
            }
          } else {
            console.log('No authenticated user found in session');
          }
        } catch (err) {
          console.error('Error checking session:', err);
          setSessionError('Failed to verify your session. Please try again later.');
        } finally {
          setSessionLoading(false);
        }
      }
    };
    
    checkSession();
  }, [user, dispatch]);

  // Listen for clicks outside the editing input to save
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (editInputRef.current && !editInputRef.current.contains(event.target as Node)) {
        handleSaveInlineRename();
      }
    }
    
    if (editingSettingId) {
      document.addEventListener("mousedown", handleClickOutside);
    } else {
      document.removeEventListener("mousedown", handleClickOutside);
    }
    
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [editingSettingId]);

  const toggleAccordion = () => {
    setIsOpen(prev => !prev);
  };

  const loadSettings = async () => {
    try {
      const effectiveUser = user || sessionUser;
      
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

  const handleLoadSetting = async (setting: any, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    
    // Don't load if we're currently editing or if clicks are disabled
    if (editingSettingId || clickingDisabled) return;
    
    try {
      // Ensure the data object is complete
      if (!setting.data) {
        throw new Error('Saved setting data is missing or corrupted');
      }
      
      // Check if this setting is loadable based on subscription status
      if (!isSettingLoadable(setting, state.subscription)) {
        throw new Error(`This setting contains ${setting.data.guests.length} guests, which exceeds the free account limit of 80 guests. Upgrade to Premium to load this setting.`);
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
      
      // Import the state directly with no trimming
      dispatch({ type: 'IMPORT_STATE', payload: setting.data });
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
      
      // Update the setting's last_accessed timestamp
      await supabase
        .from('saved_settings')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', setting.id);
      
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
      const maxSettings = getMaxSavedSettingsLimit(isPremium ? { status: 'active' } : null);
      
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

  const handleDuplicate = async (setting: SavedSetting, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent loading the setting when clicking the duplicate button
    
    // Don't proceed if clicks are disabled
    if (clickingDisabled) return;
    
    setOperationError(null);
    try {
      const effectiveUser = user || sessionUser;
      if (!effectiveUser) {
        setShowAuthModal(true);
        return;
      }

      // Check if user is premium
      const isPremium = isPremiumSubscription(subscription);
      const maxSettings = getMaxSavedSettingsLimit(isPremium ? { status: 'active' } : null);
      
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

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent loading the setting when clicking the delete button
    
    // Don't proceed if clicks are disabled
    if (clickingDisabled) return;
    
    setOperationError(null);
    if (!window.confirm('Are you sure you want to delete these settings?')) return;

    try {
      const { error } = await supabase
        .from('saved_settings')
        .delete()
        .eq('id', id);

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
  
  // Start inline editing when double-clicking the setting name
  const handleStartInlineRename = (e: React.MouseEvent, id: string, currentName: string) => {
    e.stopPropagation(); // Prevent triggering the load function
    
    // Don't allow editing if clicks are disabled
    if (clickingDisabled) return;
    
    setEditingSettingId(id);
    setEditingName(currentName);
    setNameError(null);
  };
  
  // Handle input change for inline rename
  const handleEditNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setEditingName(e.target.value);
    setNameError(null);
  };
  
  // Save the inline rename
  const handleSaveInlineRename = async () => {
    if (!editingSettingId) return;
    
    const trimmedName = editingName.trim();
    if (!trimmedName) {
      setEditingSettingId(null);
      return;
    }
    
    const currentSetting = settings.find(s => s.id === editingSettingId);
    if (!currentSetting || trimmedName === currentSetting.name) {
      setEditingSettingId(null);
      return;
    }
    
    setNameError(null);
    
    try {
      const { error } = await supabase
        .from('saved_settings')
        .update({ name: trimmedName })
        .eq('id', editingSettingId);

      if (error) {
        if (error.status === 401) {
          throw new Error('Your session has expired. Please log in again.');
        } else {
          throw error;
        }
      }
      
      // If we just renamed the currently loaded setting, update the name
      const currentSettingName = localStorage.getItem('seatyr_current_setting_name');
      if (currentSettingName === currentSetting.name) {
        localStorage.setItem('seatyr_current_setting_name', trimmedName);
      }
      
      setEditingSettingId(null);
      
      // Disable clicks for 2 seconds after saving to prevent accidental interactions
      setClickingDisabled(true);
      setTimeout(() => {
        setClickingDisabled(false);
      }, 2000);
      
      await loadSettings();
    } catch (err) {
      console.error('Failed to rename settings:', err);
      setNameError(err.message || 'Failed to rename settings');
    }
  };
  
  // Handle key press for inline rename
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSaveInlineRename();
    } else if (e.key === 'Escape') {
      setEditingSettingId(null);
      setNameError(null);
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

  // Use the #D7E5E5 color for header
  const accordionHeaderStyles = "flex justify-between items-center p-3 rounded-md bg-[#D7E5E5] cursor-pointer";

  return (
    <div className="mt-6">
      <div 
        className={accordionHeaderStyles}
        onClick={toggleAccordion}
      >
        <h2 className="text-lg font-semibold text-[#586D78] flex items-center">
          <FolderOpen className="mr-2 h-5 w-5" />
          Saved Settings
        </h2>
        <div className="flex items-center space-x-2">
          {isPremium && state.user && (
            <span className="flex items-center danstyle1c-btn danstyle1c-premium">
              <Crown className="w-4 h-4 mr-1" />
              Premium
            </span>
          )}
          {isOpen ? <ChevronUp className="h-5 w-5 text-[#586D78]" /> : <ChevronDown className="h-5 w-5 text-[#586D78]" />}
        </div>
      </div>

      {isOpen && (
        <div className="mt-4 space-y-4 p-4 bg-[#D7E5E5] rounded-md">
          {!effectiveUser && !sessionLoading ? (
            <Card>
              <div className="text-center py-4">
                <p className="text-gray-600 mb-4">
                  You need to be logged in to access saved settings.
                </p>
                <Button onClick={() => setShowAuthModal(true)}>
                  Log In or Sign Up
                </Button>
              </div>
            </Card>
          ) : sessionLoading ? (
            <Card>
              <div className="text-center py-4">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#586D78] mx-auto mb-4"></div>
                <p className="text-gray-600">Verifying your account...</p>
              </div>
            </Card>
          ) : (
            <>
              <div className="space-y-4">
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                  <p className="text-gray-700">
                    Save and manage your seating arrangements.
                    {!isPremium 
                      ? ` Free users can save up to ${maxSettings} configurations. Premium users can save up to 50.`
                      : ` Premium users can save up to 50 configurations.`}
                  </p>
                  
                  {isPremium && state.user && (
                    <div className="bg-green-50 border border-green-300 rounded-md p-2 flex-none">
                      <p className="text-sm text-green-700 flex items-center whitespace-nowrap">
                        <Crown className="w-4 h-4 mr-1 text-yellow-500" />
                        Premium users: Your Current Settings are preserved between sessions.
                      </p>
                    </div>
                  )}
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

              <div className="mt-4">
                <h3 className="text-lg font-medium text-[#586D78] mb-4">Saved Configurations</h3>
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
                      // Check if this setting has more guests than allowed for free users
                      const exceedsGuestLimit = !isPremiumSubscription(subscription) && 
                                             setting.data?.guests?.length > 80;
                      
                      // Check if this setting is the currently loaded one
                      const isCurrentSetting = setting.name === currentSettingName;
                      
                      // Determine border class based on loaded state and modification status
                      let borderClass = "border border-gray-200";
                      if (isCurrentSetting) {
                        borderClass = isSettingModified 
                          ? "border-2 border-[#d1d5db]" 
                          : "border-2 border-[#06b6d4]";
                      }
                      
                      // Is this setting being edited?
                      const isEditing = editingSettingId === setting.id;
                      
                      // If the setting has too many guests for a free user, add special styling
                      const disabledClass = exceedsGuestLimit ? 
                        "opacity-50 cursor-not-allowed pointer-events-none" : "";
                      
                      return (
                        <div
                          key={setting.id}
                          className={`${borderClass} rounded-lg p-4 bg-white hover:bg-gray-50 transition-colors cursor-pointer ${disabledClass} ${clickingDisabled ? 'pointer-events-none opacity-90' : ''}`}
                          onClick={() => !isEditing && !exceedsGuestLimit && handleLoadSetting(setting)}
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                            <div className="relative">
                              {isEditing ? (
                                <div className="mb-2">
                                  <input
                                    type="text"
                                    value={editingName}
                                    onChange={handleEditNameChange}
                                    onBlur={handleSaveInlineRename}
                                    onKeyDown={handleKeyDown}
                                    className={`px-3 py-2 border rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78] w-full ${
                                      nameError ? 'border-red-300 bg-red-50' : 'border-[#586D78]'
                                    }`}
                                    autoFocus
                                    onClick={(e) => e.stopPropagation()}
                                    ref={editInputRef}
                                  />
                                  {nameError && (
                                    <p className="text-red-600 text-xs mt-1">{nameError}</p>
                                  )}
                                </div>
                              ) : (
                                <div
                                  className="font-medium text-[#586D78] relative"
                                  onDoubleClick={(e) => handleStartInlineRename(e, setting.id, setting.name)}
                                  // Increased hit area to 50px height with invisible padding
                                  style={{ 
                                    padding: '25px 15px', 
                                    margin: '-25px -15px',
                                    display: 'inline-block',
                                    position: 'relative',
                                    zIndex: 10
                                  }}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  {setting.name}
                                </div>
                              )}
                              <p className="text-sm text-gray-500">
                                Last modified: {new Date(setting.updated_at).toLocaleDateString()}
                              </p>
                              {setting.data?.guests && (
                                <p className="text-sm text-gray-600">
                                  {setting.data.guests.length} guests • {setting.data.tables?.length || 0} tables
                                  {exceedsGuestLimit && (
                                    <span className="ml-2 text-red-500 font-medium">
                                      Exceeds free guest limit
                                    </span>
                                  )}
                                </p>
                              )}
                              
                              {/* Warning tooltip for settings with too many guests */}
                              {exceedsGuestLimit && (
                                <div className="absolute right-0 top-0 bg-red-50 text-red-600 rounded-full p-1" title="This setting has more than 80 guests and requires a Premium account to load.">
                                  <AlertCircle className="w-5 h-5" />
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                className={`danstyle1c-btn bg-[#586D78] text-white ${exceedsGuestLimit ? 'opacity-50 cursor-not-allowed' : ''}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (!exceedsGuestLimit) {
                                    handleLoadSetting(setting, e);
                                  }
                                }}
                                disabled={exceedsGuestLimit || clickingDisabled}
                                title={exceedsGuestLimit ? 'Upgrade to Premium to load settings with more than 80 guests' : 'Load this setting'}
                              >
                                <FolderOpen className="w-4 h-4 mr-2" />
                                Load
                              </button>
                              <button
                                className="danstyle1c-btn"
                                onClick={(e) => handleDuplicate(setting, e)}
                                disabled={(!isPremium && settings.length >= maxSettings) || clickingDisabled}
                              >
                                <Copy className="w-4 h-4 mr-2" />
                                Duplicate
                              </button>
                              <button
                                className="danstyle1c-btn danstyle1c-remove"
                                onClick={(e) => handleDelete(setting.id, e)}
                                disabled={clickingDisabled}
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
              </div>
            </>
          )}
        </div>
      )}

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

export default SavedSettingsAccordion;