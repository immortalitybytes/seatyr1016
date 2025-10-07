import React, { useState, useEffect } from 'react';
import { Save, FolderOpen, Edit2, Copy, Trash2, AlertCircle, Crown, RefreshCw, X } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { isPremiumSubscription, getMaxSavedSettingsLimit, canSaveMoreSettings, getGuestLimitMessage } from '../utils/premium';
import AuthModal from '../components/AuthModal';
import { useNavigate } from 'react-router-dom';
import { clearRecentSessionSettings } from '../lib/sessionSettings';

interface SavedSetting {
  id: string;
  name: string;
  data: any;
  created_at: string;
  updated_at: string;
  is_premium_setting: boolean; // Flag to show it's a large setting
}

const SavedSettings: React.FC = () => {
  const { state, dispatch, isPremium } = useApp(); // SSoT #2 Fix: Get derived isPremium
  const navigate = useNavigate();
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
  
  // SSoT #2 Fix: Use derived isPremium
  const maxLimit = getMaxSavedSettingsLimit(state.subscription, state.trial);
  const canSave = canSaveMoreSettings(state.subscription, settings.length, state.trial);
  
  // Function to load the settings
  const fetchSettings = async () => {
    if (!state.user) {
      setSettings([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      // SSoT #7: All saved_settings SELECT/UPDATE/DELETE calls are user-scoped
      const { data, error: fetchError } = await supabase
        .from('saved_settings')
        .select('*')
        .eq('user_id', state.user.id)
        .order('updated_at', { ascending: false });

      if (fetchError) throw fetchError;

      const userSettings: SavedSetting[] = data.map(s => ({
        ...s,
        is_premium_setting: s.data?.guests?.length > 80, // Assuming 80 is the free limit
      }));
      setSettings(userSettings);
    } catch (err) {
      console.error('Error fetching settings:', err);
      setError('Failed to load saved settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSettings();
    
    if (state.user) {
      setSessionUser(state.user);
    } else {
      setSessionUser(null);
    }
  }, [state.user, state.subscription, state.trial]);
  // eslint-disable-line react-hooks/exhaustive-deps


  // Handler for loading a saved setting
  const handleLoadSetting = (setting: SavedSetting) => {
    // SSoT #2 Fix: Use derived isPremium
    if (setting.is_premium_setting && !isPremium) {
      setError(`This setting contains ${setting.data?.guests?.length || 'many'} guests, which exceeds the free user limit of 80. Upgrade to Premium to load this setting.`);
      return;
    }
    
    try {
      // SSoT #7: IMPORT_STATE now clears plans, resets index, and reconciles tables before navigating.
      dispatch({ type: 'CLEAR_PLAN_ERRORS' }); // Explicitly clear any stale errors
      dispatch({ type: 'LOAD_SAVED_SETTING', payload: setting.data });
      
      navigate('/constraints');
      setError(null);
      clearRecentSessionSettings(); 
    } catch (e) {
      setError('Failed to load setting. Data may be corrupted.');
      console.error(e);
    }
  };
  
  const handleSave = async () => {
    if (!newSettingName.trim()) {
      setError('Setting name cannot be empty.');
      return;
    }
    if (!canSave) {
      setError(`You have reached the limit of ${maxLimit} saved settings.`);
      return;
    }
    
    setSavingSettings(true);
    setError(null);

    const dataToSave = {
      guests: state.guests,
      tables: state.tables,
      constraints: state.constraints,
      adjacents: state.adjacents,
      assignments: state.assignments,
    };

    try {
      const existing = settings.find(s => s.name.toLowerCase() === newSettingName.trim().toLowerCase());
      
      if (existing) {
        // SSoT #7: All saved_settings UPDATE calls are user-scoped
        const { error: updateError } = await supabase
          .from('saved_settings')
          .update({ name: newSettingName.trim(), data: dataToSave, updated_at: new Date().toISOString() })
          .eq('id', existing.id);
        
        if (updateError) throw updateError;
      } else {
        // SSoT #7: All saved_settings INSERT calls are user-scoped
        const { error: insertError } = await supabase
          .from('saved_settings')
          .insert({ user_id: state.user.id, name: newSettingName.trim(), data: dataToSave });
        
        if (insertError) throw insertError;
      }
      
      await fetchSettings();
      setShowSaveModal(false);
      setNewSettingName('');
    } catch (err) {
      console.error('Error saving settings:', err);
      setError('Failed to save settings. Please try again.');
    } finally {
      setSavingSettings(false);
    }
  };
  
  const handleLogout = async () => {
    const { error: logoutError } = await supabase.auth.signOut();
    if (logoutError) console.error('Error logging out:', logoutError.message);
    clearRecentSessionSettings();
    navigate('/');
  };
  
  const handleUpgrade = () => {
    // redirectToCheckout(state.user.id);
  };

  const handleCopy = (setting: SavedSetting) => {
    setNewSettingName(`Copy of ${setting.name}`);
    setShowSaveModal(true);
  };

  const handleDelete = async (settingId: string) => {
    if (window.confirm('Are you sure you want to delete this saved setting?')) {
      try {
        // SSoT #7: All saved_settings DELETE calls are user-scoped
        const { error: deleteError } = await supabase
          .from('saved_settings')
          .delete()
          .eq('id', settingId);

        if (deleteError) throw deleteError;

        await fetchSettings();
      } catch (err) {
        console.error('Error deleting settings:', err);
        setError('Failed to delete setting. Please try again.');
      }
    }
  };


  return (
    <div className="space-y-6">
      <Card title="Saved Settings">
        {sessionLoading && <p className="text-gray-500">Loading user session...</p>}
        {sessionError && <div className="bg-red-50 border border-red-200 rounded-md p-3"><p className="text-sm text-red-700">{sessionError}</p></div>}
        
        {!state.user && !sessionLoading && (
          <div className="flex flex-col items-center justify-center p-6 bg-yellow-50 border border-yellow-200 rounded-md">
            <Crown className="w-8 h-8 text-yellow-600 mb-3" />
            <h3 className="text-lg font-semibold text-gray-800 mb-2">Sign In to Save Settings</h3>
            <p className="text-center text-gray-600 mb-4">You must be signed in to save and load your seating plan settings.</p>
            <Button onClick={() => setShowAuthModal(true)} variant="primary">
              Sign In / Sign Up
            </Button>
          </div>
        )}
        
        {state.user && (
          <>
            <div className="mb-6 flex justify-between items-center">
              <Button onClick={() => setShowSaveModal(true)} disabled={!canSave} variant="primary" icon={<Save className="w-4 h-4" />}>
                Save Current Settings
              </Button>
              <div className="text-sm text-gray-600">
                {/* SSoT #2 Fix: Use derived isPremium */}
                {isPremium 
                  ? `${settings.length} saved settings`
                  : `Limit: ${settings.length}/${maxLimit} saved settings used`}
              </div>
            </div>
            
            {!canSave && !isPremium && (
              <div className="mb-4 bg-red-50 border border-red-200 rounded-md p-3">
                <p className="text-sm text-red-700 flex items-center">
                  <AlertCircle className="w-4 h-4 mr-2" />
                  You have reached the limit of {maxLimit} saved settings for free users. Upgrade to Premium to save more!
                </p>
              </div>
            )}
            
            {loading ? (
              <p className="text-gray-500">Loading saved settings...</p>
            ) : settings.length === 0 ? (
              <p className="text-gray-500">You have no saved settings yet.</p>
            ) : (
              <ul className="space-y-3">
                {settings.map((setting) => (
                  <li key={setting.id} className={`flex items-center justify-between p-4 border rounded-md transition-shadow ${setting.is_premium_setting && !isPremium ? 'bg-red-50 border-red-200' : 'bg-white hover:shadow-md'}`}>
                    <div className="flex flex-col">
                      <span className={`font-semibold text-gray-800 ${setting.is_premium_setting && !isPremium ? 'text-red-700' : ''}`}>
                        {setting.name}
                        {setting.is_premium_setting && !isPremium && (
                          <span className="ml-2 text-xs font-medium bg-red-200 text-red-800 px-2 py-0.5 rounded-full">Premium Size</span>
                        )}
                      </span>
                      <span className="text-xs text-gray-500 mt-1">
                        Last saved: {new Date(setting.updated_at).toLocaleDateString()}
                      </span>
                      <span className="text-xs text-gray-500">
                        {/* SSoT #2 Fix: Use derived isPremium */}
                        Guests: {getGuestLimitMessage(state.subscription, setting.data?.guests?.length || 0, state.trial)}
                      </span>
                    </div>
                    <div className="flex space-x-2">
                      <Button 
                        onClick={() => handleLoadSetting(setting)} 
                        variant="secondary" 
                        icon={<FolderOpen className="w-4 h-4" />}
                        disabled={setting.is_premium_setting && !isPremium}
                      >
                        Load
                      </Button>
                      <Button onClick={() => handleCopy(setting)} variant="secondary" icon={<Copy className="w-4 h-4" />}>
                        Copy
                      </Button>
                      <Button onClick={() => handleDelete(setting.id)} variant="danger" icon={<Trash2 className="w-4 h-4" />}>
                        Delete
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            
            {error && (
              <div className="mt-4 bg-red-50 border border-red-200 rounded-md p-3 flex items-start">
                <AlertCircle className="w-5 h-5 mr-3 text-red-600 flex-shrink-0" />
                <p className="text-sm text-red-700">{error}</p>
              </div>
            )}
          </>
        )}
      </Card>
      
      {/* Save Modal */}
      {showSaveModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md">
            <h3 className="text-xl font-semibold text-[#586D78] mb-4 flex justify-between items-center">
              Save Current Settings
              <button onClick={() => setShowSaveModal(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
            </h3>
            
            <div className="mb-4">
              <label htmlFor="setting-name" className="block text-sm font-medium text-gray-700 mb-1">
                Setting Name
              </label>
              <input
                id="setting-name"
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