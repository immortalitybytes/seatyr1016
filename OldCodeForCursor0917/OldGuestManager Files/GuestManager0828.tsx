import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Edit2, Users, Upload, Crown, ArrowDownAZ, AlertCircle, ChevronDown, ChevronUp, FolderOpen, ArrowRight, X, Play, RefreshCw, Info, MapPin } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import AuthModal from '../components/AuthModal';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { redirectToCheckout } from '../lib/stripe';
import { isPremiumSubscription, getMaxGuestLimit, getGuestLimitMessage } from '../utils/premium';
import { clearRecentSessionSettings } from '../lib/sessionSettings';
import { getLastNameForSorting } from '../utils/formatters';
import { getDisplayName } from '../utils/guestCount';

import { useNavigate } from 'react-router-dom';
import { saveRecentSessionSettings } from '../lib/sessionSettings';

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GuestManager: React.FC = () => {
  const { state, dispatch, user, subscription } = useApp();
  const [guestInput, setGuestInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const navigate = useNavigate();
  const [editingGuestId, setEditingGuestId] = useState<number | null>(null);
  const [editingGuestName, setEditingGuestName] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [videoVisible, setVideoVisible] = useState(false);
  const videoRef = useRef<HTMLIFrameElement>(null);
  
  // Use duplicateGuests from state (if available) or local state as fallback
  const [localDuplicateGuests, setLocalDuplicateGuests] = useState<string[]>([]);
  const duplicateGuests = state.duplicateGuests || localDuplicateGuests;
  
  // State for showing the duplicate warning
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);

  // Add missing state variables
  const [savedSettings, setSavedSettings] = useState<any[]>([]);
  const [loadingSavedSettings, setLoadingSavedSettings] = useState(false);
  const [savedSettingsError, setSavedSettingsError] = useState<string | null>(null);
  const [showSavedSettings, setShowSavedSettings] = useState(false);
  const [realtimeSubscription, setRealtimeSubscription] = useState<any>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Check if we need to trim the guest list (non-premium users)
  useEffect(() => {
    // Only run this check if we're not premium
    if (!isPremiumSubscription(subscription)) {
      const maxGuests = getMaxGuestLimit(subscription);
      
      // If current guest list exceeds the limit, trim it
      if (state.guests.length > maxGuests) {
        console.log(`Trimming guest list from ${state.guests.length} to ${maxGuests} (free user limit)`);
        const trimmedGuests = state.guests.slice(0, maxGuests);
        
        // Dispatch SET_GUESTS action (not ADD_GUESTS which has its own limit check)
        dispatch({ type: 'SET_GUESTS', payload: trimmedGuests });
        
        // Show a warning to the user
        alert(`Your guest list has been trimmed to ${maxGuests} guests (free user limit). Upgrade to Premium for unlimited guests.`);
      }
    }
  }, [subscription, state.guests.length, dispatch]);

  // --- IMPROVED: Fetch saved settings immediately on login/user change ---
  useEffect(() => {
    if (user) {
      fetchSavedSettings();
    } else {
      setSavedSettings([]);
    }
    // eslint-disable-next-line
  }, [user]);

  // Real-time subscription to saved_settings table
  useEffect(() => {
    if (!user) return;
    if (realtimeSubscription) {
      realtimeSubscription.unsubscribe();
    }
    const subscription = supabase
      .channel('saved_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saved_settings',
          filter: `user_id=eq.${user.id}`
        },
        () => {
          fetchSavedSettings();
        }
      )
      .subscribe();
    setRealtimeSubscription(subscription);
    return () => {
      subscription.unsubscribe();
      setRealtimeSubscription(null);
    };
    // eslint-disable-next-line
  }, [user]);

  // Set showDuplicateWarning when duplicateGuests changes
  useEffect(() => {
    const hasWarnings = duplicateGuests && duplicateGuests.length > 0;
    setShowDuplicateWarning(hasWarnings);
  }, [duplicateGuests]);

  // Load video section collapsed/expanded state from localStorage and set based on login status
  useEffect(() => {
    // Determine default state based on login status
    const userIsLoggedIn = !!user;
    
    if (userIsLoggedIn) {
      // For logged in users: default to collapsed
      setVideoVisible(false);
    } else {
      // For non-logged in users: default to expanded with autoplay
      setVideoVisible(true);
      
      // If there's a video reference and it's now visible, update src for autoplay
      if (videoRef.current) {
        const iframe = videoRef.current;
        const currentSrc = iframe.src;
        if (currentSrc.includes('autoplay=0')) {
          iframe.src = currentSrc.replace('autoplay=0', 'autoplay=1');
        } else if (!currentSrc.includes('autoplay=1')) {
          iframe.src = currentSrc + (currentSrc.includes('?') ? '&' : '?') + 'autoplay=1';
        }
      }
    }
    
    // If user manually changed this setting before, respect that preference
    const savedPreference = localStorage.getItem('seatyr_video_visible');
    if (savedPreference !== null) {
      setVideoVisible(savedPreference === 'true');
    } else {
      // Save the default preference to localStorage
      localStorage.setItem('seatyr_video_visible', userIsLoggedIn ? 'false' : 'true');
    }
  }, [user]);

  // Save recent session settings when tables change
  useEffect(() => {
    const saveTablesForPremiumUsers = async () => {
      if (state.user && isPremiumSubscription(subscription) && state.userSetTables) {
        // Only save if there are tables with custom names
        const hasNamedTables = state.tables.some(table => table.name !== undefined);
        if (hasNamedTables) {
          await saveRecentSessionSettings(state.user.id, isPremiumSubscription(subscription), state.tables);
        }
      }
    };
    
    saveTablesForPremiumUsers();
  }, [state.tables, state.user, subscription, state.userSetTables]);



  // Function to toggle video visibility
  const toggleVideo = () => {
    const newVisibility = !videoVisible;
    setVideoVisible(newVisibility);
    localStorage.setItem('seatyr_video_visible', newVisibility.toString());
    
    // If expanding, set autoplay
    if (newVisibility && videoRef.current) {
      const iframe = videoRef.current;
      // Update the src to include autoplay parameter
      const currentSrc = iframe.src;
      if (currentSrc.includes('autoplay=0')) {
        iframe.src = currentSrc.replace('autoplay=0', 'autoplay=1');
      } else if (!currentSrc.includes('autoplay=1')) {
        iframe.src = currentSrc + (currentSrc.includes('?') ? '&' : '?') + 'autoplay=1';
      }
    }
  };

  // Function to fetch saved settings from the central source
  const fetchSavedSettings = async () => {
    try {
      if (!user) return;
      
      setLoadingSavedSettings(true);
      setSavedSettingsError(null);
      
      const { data, error } = await supabase
        .from('saved_settings')
        .select('*')
        .eq('user_id', user.id)
        .order('updated_at', { ascending: false });
        
      if (error) {
        console.error('Error fetching saved settings:', error);
        
        if (error.status === 401) {
          setSavedSettingsError('Your session has expired. Please log in again.');
        } else {
          setSavedSettingsError('Failed to load saved settings. ' + (error.message || 'Please try again'));
        }
        return;
      }
      
      console.log(`Fetched ${data?.length || 0} saved settings`);
      setSavedSettings(data || []);
    } catch (err) {
      console.error('Error fetching saved settings:', err);
      setSavedSettingsError('An error occurred while loading saved settings');
    } finally {
      setLoadingSavedSettings(false);
    }
  };

  // Function to load a saved setting
  const handleLoadSetting = async (setting: any) => {
    try {
      // Ensure the data object is complete
      if (!setting.data) {
        throw new Error('Saved setting data is missing or corrupted');
      }
      
      // Check if tables have the seats property
      if (setting.data.tables) {
        setting.data.tables = setting.data.tables.map((table: any) => {
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
      
      // Clear duplicate warnings since we're doing a full replacement
      setLocalDuplicateGuests([]);
      setShowDuplicateWarning(false);
      dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
      
      // Store the name of the loaded setting in localStorage
      localStorage.setItem('seatyr_current_setting_name', setting.name);
      
      // For full replacement, we don't need to check for duplicates
      // Just import the entire state directly
      dispatch({ type: 'IMPORT_STATE', payload: setting.data });
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
      
      // Collapse the saved settings section after loading
      setShowSavedSettings(false);
      
      // Removed the alert here
    } catch (err: any) {
      console.error('Error loading saved setting:', err);
      alert('Failed to load settings: ' + (err.message || 'Unknown error'));
    }
  };

  // Function to purge seating plans when guests change
  const purgeSeatingPlans = () => {
    // Reset seating plans
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    
    // Reset plan name in localStorage
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    
    // Mark as not from saved setting
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        // First, try to parse as CSV
        const lines = content.split('\n');
        let configData = null;

        // Look for the configuration data section
        const configIndex = lines.findIndex(line => line.includes('CONFIGURATION DATA'));
        if (configIndex !== -1) {
          // Extract and parse the JSON configuration
          const configSection = lines.slice(configIndex + 1).join('\n');
          const jsonStart = configSection.indexOf('{');
          if (jsonStart !== -1) {
            configData = JSON.parse(configSection.substring(jsonStart));
          }
        }

        if (configData?.version && configData?.guests) {
          // This is a full configuration import - complete replacement
          
          // Ensure table structure is complete
          if (configData.tables) {
            configData.tables = configData.tables.map((table: any) => {
              if (!table.hasOwnProperty('seats')) {
                return { ...table, seats: 8 }; // Default value
              }
              return table;
            });
          }
          
          // Make sure userSetTables flag is included
          if (!configData.hasOwnProperty('userSetTables')) {
            configData.userSetTables = true; // Default to true for imported settings
          }
          
          // Check guest limit before importing
          const totalGuests = configData.guests.length;
          const isPremium = isPremiumSubscription(subscription);
          const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
          
          if (totalGuests > maxGuestLimit && !isPremium) {
            setShowLimitWarning(true);
            return;
          }
          
          // Clear duplicate warnings since we're doing a full replacement
          setLocalDuplicateGuests([]);
          setShowDuplicateWarning(false);
          dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
          
          // Clear recent session settings when importing
          if (isPremium && user) {
            clearRecentSessionSettings(user.id, true);
          }
          
          // Import the full configuration - replace everything
          dispatch({ type: 'IMPORT_STATE', payload: configData });
          dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
          setGuestInput('');
          setImportError(null);
          
          // Purge seating plans
          purgeSeatingPlans();
          
          return;
        } else {
          // Try parsing as a simple guest list - this is a partial add
          const guests = lines
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'))
            .map(line => {
              const parts = line.split(',').map(p => p.trim());
              const name = parts[0];
              const count = parseInt(parts[1]) || 1;
              return { name, count };
            })
            .filter(guest => guest.name);

          if (guests.length > 0) {
            const isPremium = isPremiumSubscription(subscription);
            const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
            
            // Calculate total guests (current + new)
            const totalGuestCount = guests.reduce((sum, g) => sum + g.count, 0);
            const currentGuestCount = state.guests.reduce((sum, g) => sum + g.count, 0);
            
            // Check if adding these guests would exceed the limit
            if (currentGuestCount + totalGuestCount > maxGuestLimit && !isPremium) {
              setShowLimitWarning(true);
              return;
            }
            
            // Check for duplicates - this is a partial add
            const currentGuestNames = state.guests.map(g => g.name.toLowerCase());
            const newDuplicates: string[] = [];
            const uniqueGuests = [];
            
            for (const guest of guests) {
              if (currentGuestNames.includes(guest.name.toLowerCase())) {
                newDuplicates.push(guest.name);
              } else {
                uniqueGuests.push(guest);
              }
            }
            
            if (newDuplicates.length > 0) {
              setLocalDuplicateGuests(newDuplicates);
              dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: newDuplicates });
              setShowDuplicateWarning(true);
            } else {
              setLocalDuplicateGuests([]);
              dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
              setShowDuplicateWarning(false);
            }
            
            if (uniqueGuests.length > 0) {
              dispatch({ type: 'ADD_GUESTS', payload: uniqueGuests });
              setGuestInput('');
              setImportError(null);
              
              // Purge seating plans
              purgeSeatingPlans();
            } else if (newDuplicates.length > 0) {
              setImportError('All guests in the file are duplicates of existing guests.');
            }
          } else {
            throw new Error('No valid guest data found');
          }
        }
      } catch (error) {
        console.error('Error parsing file:', error);
        setImportError('Invalid file format. Please ensure it\'s a CSV file with the correct format.');
      }

      // Reset the file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.readAsText(file);
  };

  // Enhanced guest input parsing with improved seat counting
  const parseGuestInput = (input: string) => {
    try {
      // First, check if this is a full export with configuration data
      if (input.includes('CONFIGURATION DATA')) {
        const configSection = input.substring(input.indexOf('CONFIGURATION DATA'));
        const jsonStart = configSection.indexOf('{');
        if (jsonStart !== -1) {
          const configData = JSON.parse(configSection.substring(jsonStart));
          
          if (configData.version && configData.guests) {
            // Ensure tables have the correct structure
            if (configData.tables) {
              configData.tables = configData.tables.map((table: any) => {
                if (!table.hasOwnProperty('seats')) {
                  return { ...table, seats: 8 }; // Default value
                }
                return table;
              });
            }
            
            // Make sure userSetTables flag is included
            if (!configData.hasOwnProperty('userSetTables')) {
              configData.userSetTables = true; // Default to true for imported settings
            }
            
            // For full configuration replacement, we don't need to check duplicates
            setLocalDuplicateGuests([]);
            dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
            setShowDuplicateWarning(false);
            
            // Import the full configuration
            dispatch({ type: 'IMPORT_STATE', payload: configData });
            dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
            setGuestInput('');
            setImportError(null);
            
            // Purge seating plans
            purgeSeatingPlans();
            
            return [];
          }
        }
      }
      
      // If not a full export, try parsing as a guest list
      // Enhanced parsing: Split by both commas and newlines, then analyze each unit
      const names = input
        .split(/[,\n]/)
        .map(name => name.trim())
        .filter(name => name);
      
      return names.map(name => {
        // Use the enhanced countHeads function for accurate seat counting
        const count = countHeads(name);
        return { name, count };
      }).filter(g => g.name);
    } catch (e) {
      console.error('Error parsing input:', e);
      setImportError('Invalid format. Please check your input and try again.');
      return [];
    }
  };

  const handleAddGuests = () => {
    if (!guestInput.trim()) return;
    
    const newGuests = parseGuestInput(guestInput);
    if (newGuests.length > 0) {
      const isPremium = isPremiumSubscription(subscription);
      const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
      
      // Calculate total guests (current + new)
      const totalGuestCount = newGuests.reduce((sum, g) => sum + g.count, 0);
      const currentGuestCount = state.guests.reduce((sum, g) => sum + g.count, 0);
      
      // Check if adding these guests would exceed the limit
      if (currentGuestCount + totalGuestCount > maxGuestLimit && !isPremium) {
        setShowLimitWarning(true);
        return;
      }
      
      // Check for duplicates - this is a partial add
      const currentGuestNames = state.guests.map(g => g.name.toLowerCase());
      const newDuplicates: string[] = [];
      const uniqueGuests = [];
      
      // Also check for duplicates within the new guests being added
      const seenInNewGuests = new Set<string>();
      
      for (const guest of newGuests) {
        const lowerName = guest.name.toLowerCase();
        
        if (currentGuestNames.includes(lowerName)) {
          // Duplicate with existing guest
          newDuplicates.push(guest.name);
        } else if (seenInNewGuests.has(lowerName)) {
          // Duplicate within new guests
          newDuplicates.push(guest.name);
        } else {
          // Unique guest
          uniqueGuests.push(guest);
          seenInNewGuests.add(lowerName);
        }
      }
      
      if (newDuplicates.length > 0) {
        setLocalDuplicateGuests(newDuplicates);
        dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: newDuplicates });
        setShowDuplicateWarning(true);
      } else {
        setLocalDuplicateGuests([]);
        dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
        setShowDuplicateWarning(false);
      }
      
      if (uniqueGuests.length > 0) {
        dispatch({ type: 'ADD_GUESTS', payload: uniqueGuests });
        setGuestInput('');
        setImportError(null);
        
        // Purge seating plans
        purgeSeatingPlans();
      } else if (newDuplicates.length > 0) {
        setImportError('All entered guests are duplicates of existing guests.');
      }
    }
  };

  const handleRemoveGuest = (index: number) => {
    dispatch({ type: 'REMOVE_GUEST', payload: index });
    purgeSeatingPlans();
    
    // Clear any duplicate warnings since we're modifying the list
    setLocalDuplicateGuests([]);
    dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
    setShowDuplicateWarning(false);
  };
  
  const handleRenameGuest = (index: number, guestName?: string) => {
    setEditingGuestId(index);
    setEditingGuestName(typeof guestName === "string" ? guestName : state.guests[index].name);
  };



  const saveEditGuestName = (index: number) => {
    if (!editingGuestName.trim()) {
      setEditingGuestId(null);
      setEditingGuestName('');
      return;
    }
    const lowerNewName = editingGuestName.trim().toLowerCase();
    const isExistingName = state.guests.some((g, i) =>
      i !== index && g.name.toLowerCase() === lowerNewName
    );
    if (isExistingName) {
      alert(`Cannot rename: "${editingGuestName}" already exists in your guest list.`);
      setEditingGuestId(null);
      setEditingGuestName('');
      return;
    }
    const parsed = parseGuestInput(editingGuestName)[0];
    if (parsed) {
      // Automatically update seat count when guest name changes
      const newCount = parsed.count;
      const currentGuest = state.guests[index];
      
      dispatch({
        type: 'RENAME_GUEST',
        payload: { oldName: currentGuest.name, newName: parsed.name }
      });
      
      // Update seat count if it changed
      if (newCount !== currentGuest.count) {
        dispatch({
          type: 'UPDATE_GUEST_COUNT',
          payload: { index, count: newCount }
        });
      }
      
      purgeSeatingPlans();
      setLocalDuplicateGuests([]);
      dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
      setShowDuplicateWarning(false);
    }
    setEditingGuestId(null);
    setEditingGuestName('');
  };

  
  // Re-parse and re-count the guest with the new name
  const handleClearGuestList = () => {
    setShowClearConfirm(true);
  };

  const confirmClearGuestList = () => {
    dispatch({ type: 'CLEAR_GUESTS' });
    setShowClearConfirm(false);
    
    // Clear recent session settings when clearing guest list
    if (isPremiumSubscription(subscription) && user) {
      clearRecentSessionSettings(user.id, true);
    }
    
    // Also reset current setting name
    localStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    
    // Clear any duplicate warnings
    setLocalDuplicateGuests([]);
    dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
    setShowDuplicateWarning(false);
  };

  const loadTestGuestList = () => {
    const testList = "Michael & Enid Lawrence, Sarah & Rachel & Billy Williams, David Chen & Jessica Brown, Christopher Davis, Ashley Miller & Plus One, Matthew Wilson & Amanda Moore, Joshua Taylor & Guest, Jennifer& Andrew &Thomas Bhasin, Elizabeth Jackson, Daniel White, Emily Harris and James Martin, Li Thompson, Robert Garcia, Nicole Martinez, John Jose Rodriguez, Stephanie Lewis, William Lee & Rachel Walker, Thomas Hall and Lauren Allen & Kid1 & Kid2, Richard Bryan %Marx Young, Samantha King+2, Charles Wright, Michelle Lopez, Joseph Scott, Kimberly Green, Mark Adams, Lisa Baker, Steven Gonzalez";
    const testGuests = parseGuestInput(testList);
    
    const isPremium = isPremiumSubscription(subscription);
    const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
    
    // Calculate total guests (current + new)
    const totalGuestCount = testGuests.reduce((sum, g) => sum + g.count, 0);
    const currentGuestCount = state.guests.reduce((sum, g) => sum + g.count, 0);
    
    // Check if adding these guests would exceed the limit
    if (currentGuestCount + totalGuestCount > maxGuestLimit && !isPremium) {
      setShowLimitWarning(true);
      return;
    }
    
    // Check for duplicates
    const currentGuestNames = state.guests.map(g => g.name.toLowerCase());
    const newDuplicates: string[] = [];
    const uniqueGuests = [];
    
    for (const guest of testGuests) {
      if (currentGuestNames.includes(guest.name.toLowerCase())) {
        newDuplicates.push(guest.name);
      } else {
        uniqueGuests.push(guest);
      }
    }
    
    if (newDuplicates.length > 0) {
      setLocalDuplicateGuests(newDuplicates);
      dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: newDuplicates });
      setShowDuplicateWarning(true);
    } else {
      setLocalDuplicateGuests([]);
      dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
      setShowDuplicateWarning(false);
    }
    
    if (uniqueGuests.length > 0) {
      dispatch({ type: 'ADD_GUESTS', payload: uniqueGuests });
      
      // Purge seating plans
      purgeSeatingPlans();
    } else if (newDuplicates.length > 0) {
      setImportError('All test guests are duplicates of existing guests.');
    }
  };

  const handleUpgrade = async () => {
    if (!user) {
      setShowAuthModal(true);
      return;
    }

    try {
      await redirectToCheckout(user.id);
    } catch (error) {
      console.error('Error initiating checkout:', error);
      alert('Failed to start checkout process. Please try again.');
    }
  };
  
  // Handler to close the duplicate names warning
  const handleCloseDuplicateWarning = () => {
    setShowDuplicateWarning(false);
    setLocalDuplicateGuests([]);
    dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
  };

  // Helper function for current table sorting
  const currentTableKey = (name: string, plan: { tables: { id: number; seats: any[] }[] } | null, assigns: Record<string, string> | undefined) => {
    if (plan?.tables) {
      for (const t of plan.tables) {
        const names = (t.seats || []).map((s: any) => typeof s === 'string' ? s : s?.name).filter(Boolean);
        if (names.includes(name)) return t.id;
      }
    }
    const raw = assigns?.[name];
    if (raw) {
      const ids = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
      if (ids.length) return ids[0];
    }
    return Number.POSITIVE_INFINITY;
  };

  // Function to get sorted guests
  const getSortedGuests = () => {
    if (sortOption === 'as-entered') {
      return [...state.guests];
    }
    
    return [...state.guests].sort((a, b) => {
      if (sortOption === 'first-name') {
        // Sort by the first name (everything before the first space)
        const firstNameA = a.name.split(' ')[0].toLowerCase();
        const firstNameB = b.name.split(' ')[0].toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      } 
      else if (sortOption === 'last-name') {
        // For guests with ampersands, only use the part before the ampersand for sorting
        const getLastName = (fullName: string) => {
          // Extract the first person's name (before any ampersand)
          const firstPersonName = fullName.split('&')[0].trim();
          return getLastNameForSorting(firstPersonName).toLowerCase();
        };
        
        const lastNameA = getLastName(a.name);
        const lastNameB = getLastName(b.name);
        
        return lastNameA.localeCompare(lastNameB);
      }
      else if (sortOption === 'current-table') {
        // Sort by current table assignment in the currently active plan
        if (state.seatingPlans.length === 0) {
          return 0; // No sorting if no plans
        }
        
        // Use the currently viewed plan
        const plan = state.seatingPlans[state.currentPlanIndex];
        const tableA = currentTableKey(a.name, plan, state.assignments);
        const tableB = currentTableKey(b.name, plan, state.assignments);
        
        return tableA - tableB;
      }
      
      return 0;
    });
  };

  // Check premium status from app context
  const isPremium = isPremiumSubscription(subscription);
  const showUpgradePrompt = !isPremium && state.guests.length >= 70;
  const sortedGuests = getSortedGuests();
  
  // Get the current guest limit and percentage used
  const maxGuestLimit = getMaxGuestLimit(subscription);
  const guestPercentage = isPremium ? 0 : Math.min(100, Math.round((state.guests.length / maxGuestLimit) * 100));
  const isApproachingLimit = !isPremium && state.guests.length >= maxGuestLimit * 0.8;

  // Handler to refresh saved settings
  const handleRefreshSavedSettings = () => {
    fetchSavedSettings();
  };

  // Function to count heads in a guest name
  const countHeads = (name: string): number => {
    if (!name || !name.trim()) return 0;
    
    let seatCount = 1; // Start with 1 seat for the first person
    
    // Handle "plus one" and "plus 1" as identical
    if (/plus\s+one/i.test(name)) {
      seatCount += 1;
    }
    
    // Split by various connectors while preserving the original structure for numeral detection
    const connectorRegex = /(\s*[&+]\s*|\s+and\s+|\s+plus\s+)/gi;
    const parts = name.split(connectorRegex);
    
    // Count additional seats for each connector found
    for (let i = 1; i < parts.length; i += 2) {
      const connector = parts[i];
      if (connector && connector.match(/[&+]|and|plus/i)) {
        seatCount++; // Each connector adds one more seat
        
        // Check if there's a numeral immediately following this connector
        if (i + 1 < parts.length) {
          const nextPart = parts[i + 1].trim();
          
          // Check for numerals first
          const numeralMatch = nextPart.match(/^(\d+)/);
          if (numeralMatch) {
            const additionalSeats = parseInt(numeralMatch[1], 10);
            if (!isNaN(additionalSeats) && additionalSeats > 0) {
              seatCount += additionalSeats - 1; // Subtract 1 because we already counted the connector
            }
          } else {
            // Check for spelled-out numbers
            const spelledOutNumbers: Record<string, number> = {
              'zero': 0, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
              'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
              'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15,
              'sixteen': 16, 'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20,
              'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60, 'seventy': 70,
              'eighty': 80, 'ninety': 90, 'hundred': 100
            };
            
            const lowerNextPart = nextPart.toLowerCase();
            for (const [word, number] of Object.entries(spelledOutNumbers)) {
              if (lowerNextPart.startsWith(word)) {
                if (number > 0) {
                  seatCount += number - 1;
                }
                break;
              }
            }
          }
        }
      }
    }
    
    // Handle special cases like "guest" (additional unnamed person)
    // This should work for cases like "Daniel White plus guest" = 2
    if (/\bguest\b/i.test(name)) {
      // Only add if we haven't already counted it through connector logic
      // Check if "guest" appears after a connector like "plus"
      const hasGuestAfterConnector = /\b(plus|and|&|\+)\s+guest\b/i.test(name);
      if (hasGuestAfterConnector) {
        // The connector logic already handled this, so don't add again
      } else if (!/\b(plus|and|&|\+)\s+one\b/i.test(name)) {
        // Only add if it's not "plus one" (which we already handled)
        seatCount += 1;
      }
    }
    
    return seatCount;
  };

    return (
    <div className="space-y-14">
      {/* Video Section with Collapse/Expand - Full width */}
      <div className="w-full bg-white rounded-lg shadow-md overflow-hidden">
        {videoVisible ? (
          <div className="relative">
            {/* Hide Section button moved above video with spacing */}
            <div className="p-2 flex justify-end">
              <button 
                onClick={toggleVideo}
                className="danstyle1c-btn"
                aria-label="Hide video section"
              >
                <X className="w-4 h-4 mr-2" />
                Hide Section
              </button>
            </div>
            {/* Video shifted down to accommodate button */}
            <div className="relative w-full pt-[37.5%] overflow-hidden">
              <iframe
                ref={videoRef}
                src={`https://player.vimeo.com/video/1085961997?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=${!user ? '1' : '0'}&muted=1&loop=1&dnt=1`}
                allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                title="SeatyrBannerV1cVideo"
                className="absolute top-0 left-0 w-full h-full"
              />
            </div>
          </div>
        ) : (
          <div className="p-4 flex justify-end items-center">
            <h3 className="text-lg font-medium text-[#586D78] mr-4">Quick Overview Intro</h3>
            <button 
              onClick={toggleVideo}
              className="danstyle1c-btn"
              aria-label="Replay video"
            >
              <Play className="w-4 h-4 mr-2" />
              Replay Video
            </button>
          </div>
        )}
      </div>



      {/* Guest Manager heading hidden per P2.B */}
      {null}
      
      <div className="flex items-stretch gap-4">
        {/* For First-Time Users Box - fixed width, won't expand */}
        <div className="w-[40%] flex-shrink-0 bg-white rounded-lg shadow-md p-4 border border-[#566F9B] mt-2 h-full">
          <h3 className="font-bold text-[#566F9B] mb-3" style={{ fontSize: '1.25em' }}>For First-Time Users</h3>
          <div className="h-full flex flex-col justify-center text-left">
            <div className="space-y-2 text-sm text-[#586D78] pr-1" style={{ fontSize: '1.25em', lineHeight: '1.4' }}>
              <p>1.) Click "Load Test Guest List" button.</p>
              <p>2.) Click "Your Rules" at the top.</p>
              <p>3.) Pair and prevent as you like.</p>
            </div>
            
            {/* Pulsing Arrow Emoji for Unsigned Users - changed to right arrow */}
            {!user && (
              <div className="flex justify-center mt-4">
                <div 
                  className="pulsing-arrow"
                  style={{
                    fontSize: '36pt',
                    animation: 'pulseAndColor 2s ease-in-out infinite',
                    animationIterationCount: 5
                  }}
                >
                  ➡️
                </div>
              </div>
            )}
          </div>
        </div>
        
        <div className="flex-1 space-y-14 h-full">
          <Card>
                          <div className="space-y-14">
              <div>
                <p className="text-gray-700 text-[17px]">Enter guest names separated by commas or line breaks.</p>
                <p className="text-gray-700 text-[17px]">Connect couples and parties with an ampersand (&).</p>
                
                {!isPremium && (
                  <div className="mt-2">
                    {(() => {
                      const totalSeats = (state.guests ?? []).reduce((s,g)=> s + Math.max(1, g.count ?? 1), 0);
                      return (
                        <p className="text-sm text-[#586D78]">Free plan: {totalSeats}/80 guests used</p>
                      );
                    })()}
                  </div>
                )}
                
                {isPremium && state.user && (
                  <p className="text-sm text-green-600 mt-2">
                    Premium plan: Unlimited guests
                  </p>
                )}
              </div>
              
              {/* Display duplicate guest warning */}
              {showDuplicateWarning && (
                <div className="p-3 bg-[#88abc6] border border-[#88abc6] rounded-md relative">
                  <div className="flex items-start pr-8">
                    <AlertCircle className="text-white mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-white font-medium">Duplicate Guest Names Detected</p>
                      <p className="text-white text-sm">
                        The following names already exist in your guest list and were not added:
                      </p>
                      <ul className="text-white text-sm mt-1 list-disc pl-5">
                        {duplicateGuests.map((name, index) => (
                          <li key={index}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <button
                    className="absolute top-2 right-2 text-white hover:text-white"
                    onClick={handleCloseDuplicateWarning}
                    aria-label="Close warning"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}
              
              <div className="flex flex-col space-y-2">
                <div className="mt-2" />
                <textarea
                  value={guestInput}
                  onChange={(e) => {
                    setGuestInput(e.target.value);
                    // Clear duplicate warnings when input changes
                    if (duplicateGuests.length > 0) {
                      setLocalDuplicateGuests([]);
                      dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
                      setShowDuplicateWarning(false);
                    }
                  }}
                  placeholder="e.g., Alice, Bob&#13;&#10;Carol & David"
                  className="w-full px-3 py-2 border border-[#586D78] border-[1.5px] rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78] min-h-[100px]"
                  rows={4}
                  onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleAddGuests()}
                />
              </div>
              
              {importError && (
                <div className="text-red-600 text-sm mt-2">{importError}</div>
              )}
              

              
              <div className="flex space-x-2">
                <button
                  onClick={loadTestGuestList}
                  className={`danstyle1c-btn h-16 inline-flex items-center justify-center px-4 ${!user ? 'visitor-test-button' : ''}`}
                  disabled={!isPremium && state.guests.length + 26 > maxGuestLimit}
                >
                  Load Test Guest List
                </button>
                
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".csv,.txt"
                  className="hidden"
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="danstyle1c-btn h-16 inline-flex items-center justify-center px-4"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Guests & Settings
                </button>
                
                <button
                  onClick={handleAddGuests}
                  className="danstyle1c-btn h-16 inline-flex items-center justify-center px-4"
                  disabled={!isPremium && state.guests.length >= maxGuestLimit}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </button>
              </div>
              
              {!isPremium && state.guests.length >= maxGuestLimit && (
                <div className="p-3 bg-[#88abc6] border border-[#88abc6] rounded-md">
                  <p className="text-white font-medium">
                    You've reached the guest limit of {maxGuestLimit} for free accounts. 
                    Upgrade to Premium for unlimited guests.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
      </div>

      {/* MainSavedSettings collapsible section - Always present */}
      <button
        className="border border-indigo-200 rounded-md p-3 w-full flex justify-between items-center hover:bg-[#d7e5e5] transition-colors cursor-pointer"
        style={{ backgroundColor: '#d7e5e5' }}
        onClick={() => {
          // When opening, fetch the latest data
          if (!showSavedSettings && user) {
            fetchSavedSettings();
          }
          setShowSavedSettings(!showSavedSettings);
        }}
      >
        <span className="text-[#586D78] font-medium"><FolderOpen className="w-4 h-4 mr-2 inline-block" /> Saved Settings</span>
        {showSavedSettings ? (
          <ChevronUp className="w-4 h-4 text-[#586D78]" />
        ) : (
          <ChevronDown className="w-4 h-4 text-[#586D78]" />
        )}
      </button>

      {showSavedSettings && (
        <Card>

          {!user ? (
            <div className="text-center py-4 bg-gray-50 rounded-lg border border-gray-200">
              <p className="text-gray-600 mb-2">Please log in to view your saved settings.</p>
              <button 
                onClick={() => setShowAuthModal(true)}
                className="danstyle1c-btn"
              >
                Log In / Sign Up
              </button>
            </div>
          ) : loadingSavedSettings ? (
            <div className="text-center py-4">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-500 mx-auto"></div>
              <p className="mt-2 text-gray-600">Loading saved settings...</p>
            </div>
          ) : savedSettingsError ? (
            <div className="bg-red-50 border border-red-200 rounded-md p-4 mb-4">
              <div className="flex items-start">
                <AlertCircle className="text-red-600 mr-2 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-red-700">{savedSettingsError}</p>
                  <button
                    className="danstyle1c-btn mt-2 text-sm"
                    onClick={() => fetchSavedSettings()}
                  >
                    <RefreshCw className="w-4 h-4 mr-2" />
                    Try Again
                  </button>
                </div>
              </div>
            </div>
          ) : savedSettings.length === 0 ? (
            <div className="text-center py-4 text-gray-500">
              No saved settings found. Save your settings from the Seating Plan page.
            </div>
          ) : (
            <div className="space-y-14 max-h-[400px] overflow-y-auto">
              {savedSettings.map((setting) => (
                <div
                  key={setting.id}
                  className="border border-gray-200 rounded-lg p-4 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => handleLoadSetting(setting)}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="font-medium text-[#586D78]">{setting.name}</h3>
                      <p className="text-xs text-gray-500">
                        Last modified: {new Date(setting.updated_at).toLocaleDateString()}
                      </p>
                      {setting.data?.guests && (
                        <p className="text-xs text-gray-600">
                          {setting.data.guests.length} guests • {setting.data.tables?.length || 0} tables
                        </p>
                      )}
                    </div>
                    <button
                      className="danstyle1c-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleLoadSetting(setting);
                      }}
                    >
                      <ArrowRight className="w-4 h-4 mr-2" />
                      Load
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}


        </Card>
      )}


      
      <Card 
        title={
          <div className="w-full flex items-center justify-between">
            <span>Guest List ({state.guests.reduce((sum, guest) => sum + guest.count, 0)}{!isPremium ? '/80' : ''})</span>
            <div className="flex space-x-2">
              <span className="text-gray-700 font-medium flex items-center">
                <ArrowDownAZ className="w-4 h-4 mr-1" />
                Sort:
              </span>
              <button
                className={sortOption === 'as-entered' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                onClick={() => setSortOption('as-entered')}
              >
                As Entered
              </button>
              <button
                className={sortOption === 'first-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                onClick={() => setSortOption('first-name')}
              >
                First Name
              </button>
              <button
                className={sortOption === 'last-name' ? 'danstyle1c-btn selected' : 'danstyle1c-btn'}
                onClick={() => setSortOption('last-name')}
              >
                Last Name
              </button>
              <button
                className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''} ${state.seatingPlans.length === 0 ? 'opacity-50' : ''}`}
                onClick={() => setSortOption('current-table')}
                disabled={state.seatingPlans.length === 0}
              >
                Current Table
              </button>
            </div>
          </div>
        } 

      >
        {state.guests.length === 0 ? (
          <div className="text-center">
            <p className="text-gray-500 py-4">Add some guests to get started.</p>
            {!isPremium && (
              <div className="mt-4">
                <button
                  onClick={handleUpgrade}
                  className="danstyle1c-btn"
                >
                  Upgrade to Premium
                </button>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {sortedGuests.map((guest, index) => {
                const originalIndex = state.guests.findIndex(g => g.name === guest.name);
                return (
                  <div 
                    key={`${guest.name}-${index}`}
                    className="border border-[#586D78] border-[0.5px] rounded-lg p-4 flex flex-col items-start bg-white shadow"
                    onDoubleClick={() => handleRenameGuest(originalIndex)}
                  >
                    {editingGuestId === originalIndex ? (
                      <input
                        type="text"
                        value={editingGuestName}
                        autoFocus
                        onChange={e => setEditingGuestName(e.target.value)}
                        onBlur={() => saveEditGuestName(originalIndex)}
                        onKeyDown={e => {
                          if (e.key === "Enter") saveEditGuestName(originalIndex);
                          if (e.key === "Escape") setEditingGuestId(null);
                        }}
                        className="guest-name-input font-medium text-[#586D78] text-xl"
                        style={{ fontWeight: "bold" }}
                      />
                    ) : (
                      <span
                        className="font-medium text-[#586D78] text-xl flex items-center"
                        onDoubleClick={() => handleRenameGuest(originalIndex, guest.name)}
                        style={{ cursor: "pointer" }}
                      >
                        {(() => {
                          const displayName = getDisplayName(guest.name);
                          return displayName.includes('%') ? (
                            <>
                              {displayName.split('%')[0]}
                              <span style={{ color: '#959595' }}>%</span>
                              {displayName.split('%')[1]}
                            </>
                          ) : displayName;
                        })()}
                        <Edit2 className="w-3 h-3 ml-1 text-gray-400 cursor-pointer" 
                            onClick={() => handleRenameGuest(originalIndex, guest.name)} />
                      </span>
                    )}

                    {guest.count > 1 && (
                      <span className="text-sm text-gray-700 font-medium mt-1">
                        Party size: {guest.count} {guest.count === 1 ? 'person' : 'people'}
                      </span>
                    )}
                    <div className="flex space-x-2 mt-3">
                      <button
                        className="danstyle1c-btn danstyle1c-remove btn-small"
                        onClick={() => handleRemoveGuest(originalIndex)}
                      >
                        <Trash2 className="w-3 h-3 mr-1" />
                        Remove
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {showUpgradePrompt && (
              <div className="mt-4 p-4 bg-indigo-50 rounded-lg">
                <p className="text-[#586D78]">
                  You're approaching the 80 guest limit. Upgrade to Premium for unlimited guests!
                </p>
                <div className="mt-2">
                  <button
                    onClick={handleUpgrade}
                    className="danstyle1c-btn"
                  >
                    Upgrade to Premium
                  </button>
                </div>
              </div>
            )}

            <div className="mt-4 flex justify-end">
              <button
                className="danstyle1c-btn danstyle1c-remove"
                onClick={handleClearGuestList}
              >
                <Trash2 className="w-4 h-4 mr-2" />
                Clear Guest List
              </button>
            </div>
          </>
        )}
      </Card>

      {/* Last Name Sorting Note */}
      <div className="bg-blue-50 border border-indigo-200 rounded-md p-4 flex items-start">
        <Info className="text-[#586D78] mr-2 mt-1 flex-shrink-0" />
        <div>
          <p className="text-gray-700">
            <strong>NOTE:</strong> For names with 3 or more words (e.g., "Tatiana Sokolov Boyko", "Jan Tomasz Kowalski Nowak", "Angel Alba Salavador Costa Almeida"), if you want one of those surnames (other than the "last" word of the last name) to be the alphabetical sorting word "By Last Name" then put a percentage symbol (<span style={{ color: '#959595' }}>%</span>) before that name.
          </p>
          <p className="text-gray-700 mt-1">
            Examples: "Tatiana <span style={{ color: '#959595' }}>%</span>Sokolov Boyko", "Jan Tomasz <span style={{ color: '#959595' }}>%</span>Kowalski Nowak", "Angel Alba Salavador <span style={{ color: '#959595' }}>%</span>Costa Almeida"
          </p>
        </div>
      </div>

      {/* Favorite Sites Box */}
      <div className="w-full mt-10 bg-[#fff4cd] border-2 border-[#586D78] rounded-xl p-6">
        <h2 className="text-lg font-bold text-[#586D78] mb-4">
          Seatyr's Favorite Sites — August 2025:
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm text-gray-800 list-disc list-inside">
          <ul>
            <li><a href="https://Zingermans.com" target="_blank" rel="noopener noreferrer">https://Zingermans.com</a></li>
            <li><a href="https://Zabars.com" target="_blank" rel="noopener noreferrer">https://Zabars.com</a></li>
          </ul>
          <ul>
            <li><a href="https://BigBobGibson.com" target="_blank" rel="noopener noreferrer">https://BigBobGibson.com</a></li>
            <li><a href="https://linktr.ee/immortalitybytes" target="_blank" rel="noopener noreferrer">https://linktr.ee/immortalitybytes</a></li>
          </ul>
          <ul>
            <li><a href="https://MadGreens.com" target="_blank" rel="noopener noreferrer">https://MadGreens.com</a></li>
            <li><a href="https://HubermanLab.com" target="_blank" rel="noopener noreferrer">https://HubermanLab.com</a></li>
          </ul>
        </div>
      </div>

      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Confirm Clear Guest List</h3>
            <p className="text-gray-700 mb-6">
              This will remove all guests and reset all constraints, assignments, and seating plans. This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={() => setShowClearConfirm(false)}
              >
                Cancel
              </button>
              <button
                className="danstyle1c-btn danstyle1c-remove"
                onClick={confirmClearGuestList}
              >
                Clear All Data
              </button>
            </div>
          </div>
        </div>
      )}

      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}

      {showLimitWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Guest Limit Reached</h3>
            <p className="text-gray-700 mb-6">
              You've reached the guest limit for free accounts. Upgrade to Premium for unlimited guests.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={() => setShowLimitWarning(false)}
              >
                Cancel
              </button>
              <button
                className="danstyle1c-btn"
                onClick={handleUpgrade}
              >
                Upgrade to Premium
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Add CSS animation for the pulsing arrow
if (typeof window !== 'undefined') {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes pulseAndColor {
      0% { 
        transform: scale(1); 
        filter: hue-rotate(0deg) saturate(1) brightness(1);
      }
      25% { 
        transform: scale(1.2); 
        filter: hue-rotate(90deg) saturate(1.5) brightness(1.2);
      }
      50% { 
        transform: scale(1.4); 
        filter: hue-rotate(180deg) saturate(2) brightness(1.4);
      }
      75% { 
        transform: scale(1.2); 
        filter: hue-rotate(270deg) saturate(1.5) brightness(1.2);
      }
      100% { 
        transform: scale(1); 
        filter: hue-rotate(360deg) saturate(1) brightness(1);
      }
    }
  `;
  if (!document.querySelector('#pulsing-arrow-styles')) {
    style.id = 'pulsing-arrow-styles';
    document.head.appendChild(style);
  }
}

export default GuestManager;