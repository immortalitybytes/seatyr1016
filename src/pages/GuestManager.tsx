import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Edit2, Info, Trash2, X } from 'lucide-react';
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

  const toggleVideoVisible = () => {
    const next = !videoVisible;
    setVideoVisible(next);
    localStorage.setItem('seatyr_video_visible', JSON.stringify(next));
  };

  // Ensure autoplay & muted params are present when accordion opens
  useEffect(() => {
    if (videoVisible && videoRef.current) {
      const iframe = videoRef.current;
      const src = iframe.src || 'https://player.vimeo.com/video/1099357191?autoplay=1&muted=1';
      if (!/autoplay=1/.test(src)) {
        iframe.src = src + (src.includes('?') ? '&' : '?') + 'autoplay=1&muted=1';
      }
    }
  }, [videoVisible]);

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
    saveRecentSessionSettings(state);
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
    saveRecentSessionSettings(state);
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
    saveRecentSessionSettings(state);
  };

  const handleLoadTest = () => {
    const testGuests = ['Guest1 +1', 'Guest2 &3', 'Guest3 plus 2'];
    testGuests.forEach((name, index) => {
      const count = Math.max(1, countHeads(name));
      const id = `g-${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${index}`;
      dispatch({ type: 'ADD_GUEST', payload: { id, name, count } });
    });
    dispatch({ type: 'PURGE_PLANS' });
    saveRecentSessionSettings(state);
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

  const handleUpgrade = () => redirectToCheckout();

  const confirmClearAll = () => {
    dispatch({ type: 'CLEAR_GUESTS' });
    dispatch({ type: 'PURGE_PLANS' });
    clearRecentSessionSettings();
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

      {/* Video Accordion */}
      <div className="border rounded-lg overflow-hidden">
        <button onClick={toggleVideoVisible} className="w-full flex justify-between items-center p-4 bg-[#586D78] text-white font-bold">
          <span>Watch Tutorial Video</span>
          {videoVisible ? <ChevronUp /> : <ChevronDown />}
        </button>
        {videoVisible && (
          <div className="p-4">
            <iframe
              ref={videoRef}
              src="https://player.vimeo.com/video/1099357191?autoplay=1&muted=1"
              width="100%"
              height="360"
              frameBorder={0}
              allow="autoplay; fullscreen"
              allowFullScreen
            />
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
            {!state.user && <Button onClick={handleLoadTest}>Load Test Guest List</Button>}
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
                  <FormatGuestName name={getDisplayName(guest.name)} count={guest.count} />
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

export default GuestManager;
