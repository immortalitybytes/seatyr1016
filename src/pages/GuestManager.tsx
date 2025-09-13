import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Edit2, Info, Trash2, X, Play } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import AuthModal from '../components/AuthModal';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { redirectToCheckout } from '../lib/stripe';
import { isPremiumSubscription, getMaxGuestLimit } from '../utils/premium';
import { clearRecentSessionSettings, saveRecentSessionSettings } from '../lib/sessionSettings';
import { getLastNameForSorting } from '../utils/formatters';
import { getDisplayName, countHeads } from '../utils/guestCount';
import FormatGuestName from '../components/FormatGuestName';
import { calculateTotalCapacity } from '../utils/tables';

// Sort options retained for parity with existing UI/state
// (If a selector exists elsewhere, this component honors it.)
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GuestManager: React.FC = () => {
  const { state, dispatch } = useApp();

  // ----- Local UI state (layout and transient inputs only) -----
  const [guestInput, setGuestInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showSavedSettings, setShowSavedSettings] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const [savedSettingsError, setSavedSettingsError] = useState<string | null>(null);
  const [loadingSavedSettings, setLoadingSavedSettings] = useState(false);
  const [savedSettings, setSavedSettings] = useState<any[]>([]);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingGuestName, setEditingGuestName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLIFrameElement>(null);
  const realtimeSubscriptionRef = useRef<any>(null);

  // If parent state carries a sort option, honor it; otherwise default.
  const [sortOption] = useState<SortOption>('as-entered');

  const isPremium = isPremiumSubscription(state.subscription);

  // ----- Effects: UI preferences & realtime wiring -----

  // Restore persisted video accordion preference with sensible defaults
  useEffect(() => {
    const userIsLoggedIn = !!state.user;
    const savedPreference = localStorage.getItem('seatyr_video_visible');
    if (savedPreference !== null) {
      setVideoVisible(JSON.parse(savedPreference));
    } else {
      // Expanded for new users; collapsed by default for signed-in users
      setVideoVisible(!userIsLoggedIn);
      localStorage.setItem('seatyr_video_visible', JSON.stringify(!userIsLoggedIn));
    }
  }, [state.user]);


  // Auto-hide arrows after 20 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      hideArrows();
    }, 20000); // 20 seconds

    return () => clearTimeout(timer);
  }, []);

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

  const hideArrows = () => {
    const leftArrow = document.getElementById('leftArrow');
    const rightArrow = document.getElementById('rightArrow');
    if (leftArrow) leftArrow.classList.add('hidden');
    if (rightArrow) rightArrow.classList.add('hidden');
  };

  // Pull saved settings immediately on auth change
  useEffect(() => {
    if (state.user) {
      void fetchSavedSettings();
    } else {
      setSavedSettings([]);
    }
  }, [state.user]);

  // Guarded realtime subscription (no leaks)
  useEffect(() => {
    if (!state.user) return;

    // Unsubscribe any prior channel
    if (realtimeSubscriptionRef.current) {
      realtimeSubscriptionRef.current.unsubscribe();
    }

    const channel = supabase
      .channel('saved_settings_changes')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'saved_settings', filter: `user_id=eq.${state.user.id}` },
        () => fetchSavedSettings()
      )
      .subscribe();

    realtimeSubscriptionRef.current = channel;

    return () => {
      if (realtimeSubscriptionRef.current) {
        realtimeSubscriptionRef.current.unsubscribe();
        realtimeSubscriptionRef.current = null;
      }
    };
  }, [state.user]);

  // Non-destructive limit warning (no trimming)
  useEffect(() => {
    if (state.user && !isPremium) {
      const maxGuests = getMaxGuestLimit(state.subscription);
      if ((state.guests?.length || 0) >= maxGuests) {
        dispatch({
          type: 'SET_WARNING',
          payload: [`Guest limit reached (${maxGuests} for free accounts). Upgrade to Premium for unlimited guests.`],
        });
      }
    }
  }, [state.user, state.subscription, state.guests?.length, isPremium, dispatch]);

  // ----- Supabase helpers -----

  async function fetchSavedSettings() {
    setLoadingSavedSettings(true);
    setSavedSettingsError(null);
    try {
      const { data, error } = await supabase
        .from('saved_settings')
        .select('*')
        .eq('user_id', state.user!.id)
        .order('updated_at', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      setSavedSettings(data || []);
    } catch (err) {
      setSavedSettingsError('Failed to load saved settings. Please try again.');
      dispatch({ type: 'SET_WARNING', payload: ['Failed to load saved settings.'] });
    } finally {
      setLoadingSavedSettings(false);
    }
  }

  async function handleLoadSaved(row: any) {
    try {
      const payload = row?.data ?? row?.settings; // handle either JSON column name
      if (!payload) throw new Error('Saved settings data is missing.');

      const maxGuests = getMaxGuestLimit(state.subscription);
      if (!isPremium && (payload.guests?.length || 0) > maxGuests) {
        dispatch({ type: 'SET_WARNING', payload: ['Cannot load: guest count exceeds free plan limit.'] });
        return;
      }

      dispatch({ type: 'IMPORT_STATE', payload });
      dispatch({ type: 'PURGE_PLANS' });
      setShowSavedSettings(false);
    } catch (err) {
      setSavedSettingsError('Error loading saved setting. Please try again.');
      dispatch({ type: 'SET_WARNING', payload: ['Error loading saved setting.'] });
    }
  }

  // ----- Guest operations -----

  const handleAddGuest = () => {
    const raw = guestInput.trim();
    if (!raw) {
      dispatch({ type: 'SET_WARNING', payload: ['Guest name cannot be empty.'] });
      return;
    }

    const lines = raw.split(/\n|,/).map(s => s.trim()).filter(Boolean);

    // Plan limits
    const maxGuests = getMaxGuestLimit(state.subscription);
    if (!isPremium && (state.guests.length + lines.length) > maxGuests) {
      dispatch({ type: 'SET_WARNING', payload: [`Guest limit reached (${maxGuests}). Upgrade to Premium for more.`] });
      return;
    }

    const existingNames = new Set(state.guests.map(g => (g.name || '').toLowerCase().trim()));
    const duplicates: string[] = [];

    lines.forEach((name, index) => {
      const trimmed = name.trim();
      if (existingNames.has(trimmed.toLowerCase())) {
        duplicates.push(trimmed);
        return;
      }
      const count = Math.max(1, countHeads(trimmed));
      const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${index}`;
      dispatch({ type: 'ADD_GUEST', payload: { id, name: trimmed, count } });
      existingNames.add(trimmed.toLowerCase());
    });

    if (duplicates.length) {
      dispatch({ type: 'SET_WARNING', payload: [`Duplicate guests detected: ${duplicates.join(', ')}. They were not added.`] });
    }

    dispatch({ type: 'PURGE_PLANS' });
    saveRecentSessionSettings(state.user?.id, isPremium, state.tables);
    setGuestInput('');

    // Optional capacity warning if tables are user-defined
    const totalNeeded = state.guests.reduce((sum, g) => sum + Math.max(1, g.count || 1), 0);
    const totalCap = calculateTotalCapacity(state.tables);
    if (state.userSetTables && totalNeeded > totalCap) {
      dispatch({ type: 'SET_WARNING', payload: [`Capacity short (${totalCap} seats for ${totalNeeded} guests). Add tables or adjust.`] });
    }
  };

  const handleRemoveGuest = (id: string) => {
    dispatch({ type: 'REMOVE_GUEST', payload: id });
    dispatch({ type: 'PURGE_PLANS' });
    saveRecentSessionSettings(state.user?.id, isPremium, state.tables);
  };

  const beginEdit = (guest: any) => {
    setEditingGuestId(String(guest.id));
    setEditingGuestName(guest.name || '');
  };

  const commitEdit = () => {
    if (!editingGuestId) return;
    const name = editingGuestName.trim();
    if (!name) {
      dispatch({ type: 'SET_WARNING', payload: ['Guest name cannot be empty.'] });
      return;
    }
    const count = Math.max(1, countHeads(name));
    dispatch({ type: 'UPDATE_GUEST', payload: { id: editingGuestId, name, count } });
    dispatch({ type: 'PURGE_PLANS' });
    setEditingGuestId(null);
    setEditingGuestName('');
    saveRecentSessionSettings(state.user?.id, isPremium, state.tables);
  };


  const onImportCSV: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const text = String(evt.target?.result || '');
        const names = text.split(/[\n,]/).map(s => s.trim()).filter(Boolean);
        const existingNames = new Set(state.guests.map(g => (g.name || '').toLowerCase().trim()));
        const duplicates: string[] = [];

        names.forEach((name, index) => {
          const trimmed = name.trim();
          if (existingNames.has(trimmed.toLowerCase())) {
            duplicates.push(trimmed);
            return;
          }
          const count = Math.max(1, countHeads(trimmed));
          const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${index}`;
          dispatch({ type: 'ADD_GUEST', payload: { id, name: trimmed, count } });
          existingNames.add(trimmed.toLowerCase());
        });

        if (duplicates.length) {
          dispatch({ type: 'SET_WARNING', payload: [`Duplicate guests in CSV: ${duplicates.join(', ')}. They were skipped.`] });
        }

        dispatch({ type: 'PURGE_PLANS' });
      } catch (err) {
        dispatch({ type: 'SET_WARNING', payload: ['Could not read that file. Please try another CSV.'] });
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    };
    reader.onerror = () => {
      dispatch({ type: 'SET_WARNING', payload: ['Failed to read CSV file.'] });
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    reader.readAsText(file);
  };

  const loadTestGuestList = () => {
    // Hide arrows immediately when button is clicked
    hideArrows();
    
    const testGuests = [
      { id: 'guest_test_1', name: 'Maria Garcia+1', count: 2 },
      { id: 'guest_test_2', name: 'James Johnson&1', count: 2 },
      { id: 'guest_test_3', name: 'Wei & Sara Chen', count: 2 },
      { id: 'guest_test_4', name: 'Sarah&Bobby Williams+1', count: 3 },
      { id: 'guest_test_5', name: 'Carlos Rodriguez+2', count: 3 },
      { id: 'guest_test_6', name: 'Emily Davis& 2', count: 3 },
      { id: 'guest_test_7', name: 'Raj Patel +1', count: 2 },
      { id: 'guest_test_8', name: 'Ashley Brown &1', count: 2 },
      { id: 'guest_test_9', name: 'Jose Martinez & Billy & Jessica Li', count: 3 },
      { id: 'guest_test_10', name: 'David Kim + 1', count: 2 },
      { id: 'guest_test_11', name: 'Michelle Jones+ 1', count: 2 },
      { id: 'guest_test_12', name: 'Luis Hernandez', count: 1 },
      { id: 'guest_test_13', name: 'Amanda %Zeta Taylor+ 2', count: 3 },
      { id: 'guest_test_14', name: 'Priya Sharma plus 1', count: 2 },
      { id: 'guest_test_15', name: 'Michael Miller + 2', count: 3 },
      { id: 'guest_test_16', name: 'Ana Macron plus 1', count: 2 },
      { id: 'guest_test_17', name: 'Christopher Anderson + 2', count: 3 },
      { id: 'guest_test_18', name: 'Mo Rashid', count: 1 },
      { id: 'guest_test_19', name: 'Cher', count: 1 },
      { id: 'guest_test_20', name: 'Tyler Goldberg+3', count: 4 },
      { id: 'guest_test_21', name: 'Stephanie Jackson', count: 1 },
      { id: 'guest_test_22', name: 'Arjun Gupta', count: 1 },
      { id: 'guest_test_23', name: 'Nicole White', count: 1 },
      { id: 'guest_test_24', name: 'Diego Ramirez', count: 1 },
      { id: 'guest_test_25', name: 'Samantha Harris', count: 1 },
      { id: 'guest_test_26', name: 'Jin Wang', count: 1 },
      { id: 'guest_test_27', name: 'Rachel Martin &2', count: 3 },
      { id: 'guest_test_28', name: 'Sergio Gambuto', count: 1 },
      { id: 'guest_test_29', name: 'Kayla & Daveed Lopez', count: 2 },
      { id: 'guest_test_30', name: 'Ravi Berns-Krishnan+wife', count: 2 },
      { id: 'guest_test_31', name: 'Kenji Nakamura+2', count: 3 },
      { id: 'guest_test_32', name: 'Megan Kaczmarek', count: 1 }
    ];
    
    // Clear existing guests and add test list
    dispatch({ type: 'SET_GUESTS', payload: testGuests });
    
    // Clear any warnings
    dispatch({ type: 'CLEAR_WARNINGS' });
    
    // Purge seating plans since guests changed
    dispatch({ type: 'PURGE_PLANS' });
  };

  const handleUpgrade = () => redirectToCheckout(state.user?.id);

  const confirmClearAll = () => {
    dispatch({ type: 'CLEAR_GUESTS' });
    dispatch({ type: 'PURGE_PLANS' });
    clearRecentSessionSettings(state.user?.id, true);
    setShowClearConfirm(false);
  };

  // ----- Sorting helpers (layout-neutral) -----

  const currentTableKey = (guestId: string, plan: any, assigns: Record<string, string> | undefined) => {
    if (plan?.tables) {
      for (const t of plan.tables) {
        const seats = t.seats || [];
        if (seats.some((s: any) => s.id === guestId)) return t.id;
      }
    }
    const raw = assigns?.[guestId];
    if (raw) {
      const ids = raw.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !Number.isNaN(n));
      if (ids.length) return ids[0];
    }
    return Number.POSITIVE_INFINITY;
  };

  const sortedGuests = useMemo(() => {
    if (sortOption === 'as-entered') return [...state.guests];

    return [...state.guests].sort((a, b) => {
      if (sortOption === 'first-name') {
        const fa = (a.name || '').split(' ')[0].toLowerCase();
        const fb = (b.name || '').split(' ')[0].toLowerCase();
        return fa.localeCompare(fb);
      }
      if (sortOption === 'last-name') {
        const la = getLastNameForSorting(a.name).toLowerCase();
        const lb = getLastNameForSorting(b.name).toLowerCase();
        return la.localeCompare(lb);
      }
      if (sortOption === 'current-table') {
        if (!state.seatingPlans || state.seatingPlans.length === 0) return 0;
        const plan = state.seatingPlans[state.currentPlanIndex];
        const ta = currentTableKey(a.id, plan, state.assignments);
        const tb = currentTableKey(b.id, plan, state.assignments);
        return ta - tb;
      }
      return 0;
    });
  }, [sortOption, state.guests, state.seatingPlans, state.currentPlanIndex, state.assignments]);

  // ----- Render -----
  const showWarningBanner = (state.warnings && state.warnings.length > 0);

  return (
    <div className="space-y-6">
      {/* Global warnings (non-blocking) */}
      {showWarningBanner && (
        <div className="bg-red-50 text-red-800 border border-red-200 p-3 rounded flex items-start gap-2">
          <AlertCircle className="mt-0.5 h-4 w-4" />
          <div>
            <strong>Warnings:</strong>
            <ul className="list-disc pl-5">
              {state.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </div>
          <button onClick={() => dispatch({ type: 'CLEAR_WARNINGS' })} className="ml-auto" aria-label="Clear warnings">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

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
                src={`https://player.vimeo.com/video/1085961997?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=${!state.user ? '1' : '0'}&muted=1&loop=1&dnt=1`}
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

      {/* Instructions & Add Guest (two-up) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Card title="Instructions">
          <p>Enter guest names separated by commas or line breaks. Use "+1", "&1", or phrases like "plus one" for party sizes.</p>
        </Card>

        <Card title="Add Guest Names">
          <textarea
            value={guestInput}
            onChange={(e) => setGuestInput(e.target.value)}
            placeholder="Enter guests (e.g., Chris %Evans +1, Jordan %Lee & Casey)"
            className="w-full p-2 border rounded"
          />
           <div className="flex space-x-2 mt-2">
             <Button onClick={handleAddGuest}>Add Guests</Button>
             {!state.user && (
               <button
                 onClick={loadTestGuestList}
                 className="danstyle1c-btn inline-flex items-center justify-center"
                 style={{ height: '70.2px', width: '60%' }}
                 id="loadTestGuestListBtn"
               >
                 <span className="pulsing-arrow" id="leftArrow" style={{ animation: 'pulseAndColor 2s ease-in-out infinite', animationIterationCount: 5 }}>➡️</span>
                 <span className="mx-8">Load Test Guest List</span>
                 <span className="pulsing-arrow" id="rightArrow" style={{ animation: 'pulseAndColor 2s ease-in-out infinite', animationIterationCount: 5 }}>⬅️</span>
               </button>
             )}
             <Button onClick={() => fileInputRef.current?.click()}>{state.user ? 'Upload Guests' : 'Import CSV'}</Button>
                 <input ref={fileInputRef} type="file" accept=".csv" onChange={onImportCSV} className="hidden" />
           </div>
          {savedSettingsError && <p className="text-red-500 mt-2">{savedSettingsError}</p>}
        </Card>
      </div>

      {/* Saved Settings Accordion */}
      <div className="border rounded-lg overflow-hidden">
        <button onClick={() => setShowSavedSettings(!showSavedSettings)} className="w-full flex justify-between items-center p-4 bg-[#586D78] text-white font-bold">
          <span>Saved Settings</span>
          {showSavedSettings ? <ChevronUp /> : <ChevronDown />}
        </button>
        {showSavedSettings && (
          <div className="p-4 space-y-2">
            {!state.user ? (
              <p>Please sign in to access saved settings.</p>
            ) : loadingSavedSettings ? (
              <p>Loading...</p>
            ) : savedSettingsError ? (
              <p className="text-red-600">{savedSettingsError}</p>
            ) : (
              savedSettings.map((setting) => (
                <div key={setting.id} className="flex items-center justify-between gap-2">
                  <div className="truncate text-sm">
                    <span className="font-medium">{setting.name || 'Untitled'}</span>{' '}
                    <span className="text-gray-500">({new Date(setting.updated_at || setting.created_at).toLocaleString()})</span>
                  </div>
                  <div className="shrink-0">
                    <Button size="sm" onClick={() => void handleLoadSaved(setting)}>Load</Button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* Guest List (4 columns) */}
      <Card title="Guest List">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedGuests.map((guest: any) => (
            <div key={guest.id} className="p-3 border rounded bg-white flex items-center justify-between gap-2">
              {editingGuestId === String(guest.id) ? (
                <input
                  value={editingGuestName}
                  onChange={(e) => setEditingGuestName(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitEdit();
                    if (e.key === 'Escape') {
                      setEditingGuestId(null);
                      setEditingGuestName('');
                    }
                  }}
                  autoFocus
                  className="flex-1 min-w-0 border rounded px-2 py-1"
                />
              ) : (
                <div className="flex-1 min-w-0">
                  <FormatGuestName name={getDisplayName(guest.name)} />
                </div>
              )}
              <div className="flex items-center gap-1 shrink-0">
                <Button size="sm" onClick={() => beginEdit(guest)} title="Rename"><Edit2 className="w-4 h-4" /></Button>
                <Button size="sm" variant="danger" onClick={() => handleRemoveGuest(String(guest.id))} title="Remove"><Trash2 className="w-4 h-4" /></Button>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* % Sorting Note */}
      <div className="bg-blue-50 border border-indigo-200 rounded-md p-4 flex items-start gap-2">
        <Info className="text-[#586D78] mt-0.5" />
        <div className="text-gray-700">
          <p>
            <strong>NOTE:</strong> For names with 3+ words (e.g., "Tatiana Sokolov Boyko", "Jan Tomasz Kowalski Nowak"), you can choose the sorting surname by prefixing it with a percent character (<span style={{ color: '#959595' }}>%</span>). Example: <code>Tatiana <span style={{ color: '#959595' }}>%</span>Sokolov Boyko</code>.
          </p>
        </div>
      </div>

      {/* Favorites (static links; layout preserved from earlier yellow box) */}
      <div className="w-full mt-10 bg-[#fff4cd] border-2 border-[#586D78] rounded-xl p-6">
        <h2 className="text-lg font-bold text-[#586D78] mb-4">Seatyr's Favorite Sites — September 2025:</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm text-gray-800 list-disc list-inside">
          <ul>
            <li><a href="https://zingermans.com" target="_blank" rel="noopener noreferrer">https://Zingermans.com</a></li>
            <li><a href="https://zabars.com" target="_blank" rel="noopener noreferrer">https://Zabars.com</a></li>
          </ul>
          <ul>
            <li><a href="https://bigbobgibson.com" target="_blank" rel="noopener noreferrer">https://BigBobGibson.com</a></li>
            <li><a href="https://linktr.ee/immortalitybytes" target="_blank" rel="noopener noreferrer">https://linktr.ee/immortalitybytes</a></li>
          </ul>
          <ul>
            <li><a href="https://madgreens.com" target="_blank" rel="noopener noreferrer">https://MadGreens.com</a></li>
            <li><a href="https://hubermanlab.com" target="_blank" rel="noopener noreferrer">https://HubermanLab.com</a></li>
          </ul>
        </div>
      </div>

      {/* Confirm Clear Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4 text-[#586D78]">Confirm Clear Guest List</h3>
            <p className="text-gray-700 mb-6">This will remove all guests and reset all constraints, assignments, and seating plans. This action cannot be undone.</p>
            <div className="flex justify-end space-x-2">
              <Button variant="secondary" onClick={() => setShowClearConfirm(false)}>Cancel</Button>
              <Button variant="danger" onClick={confirmClearAll}>Clear All Data</Button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal passthrough (unchanged) */}
      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
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
