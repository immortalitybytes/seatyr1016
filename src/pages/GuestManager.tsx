import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Edit2, Info, Trash2, X, Play, Users, Crown, Upload } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import AuthModal from '../components/AuthModal';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import FormatGuestName from '../components/FormatGuestName';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { redirectToCheckout } from '../lib/stripe';
import { isPremiumSubscription, getMaxGuestLimit } from '../utils/premium';
import { clearRecentSessionSettings } from '../lib/sessionSettings';
import { getLastNameForSorting } from '../utils/formatters';
import { getDisplayName, countHeads } from '../utils/guestCount';
import { formatGuestUnitName } from '../utils/formatGuestName';

type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const normalizeName = (name: string) => name.trim().toLowerCase();

const currentTableKey = (
  guestId: string,
  plan: any,
  assigns: Record<string, string> | undefined
) => {
  if (plan?.tables) {
    for (const t of plan.tables) {
      const seats = t.seats || [];
      if (seats.some((s: any) => s.id === guestId)) return t.id;
    }
  }
  const raw = assigns?.[guestId];
  if (raw) {
    const ids = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .filter((n) => !isNaN(n));
    if (ids.length) return ids[0];
  }
  return Infinity;
};

const getGuestTableAssignment = (
  guestId: string,
  tables: Array<{ id: number; name?: string; seats?: number }> | undefined,
  plan: any,
  assigns: Record<string, string> | undefined
) => {
  tables = tables || [];
  if (plan?.tables) {
    for (const t of plan.tables) {
      const seats = t.seats || [];
      if (seats.some((s: any) => s.id === guestId)) return t.name ?? `Table ${t.id}`;
    }
  }
  const raw = assigns?.[guestId];
  if (raw) {
    const first = raw
      .split(',')
      .map((s) => parseInt(s.trim(), 10))
      .find((n) => !isNaN(n));
    if (typeof first === 'number') {
      const match = tables.find((t) => t.id === first);
      return match?.name ?? `Table ${first}`;
    }
  }
  return 'Unassigned';
};
const parseGuestLine = (line: string) => {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const count = Math.max(1, countHeads(trimmed));
  const plusOneRegex = /(?:(?:\+|&)\s*1(?!\d))|(?:\b(?:and|plus|family of)\b\s*(?:one|1|\d+)(?!\d))/gi;
  const name = trimmed.replace(plusOneRegex, (m) => {
    const hasSpace = m.trim() !== m;
    return hasSpace ? ' plus One' : 'plus One';
  });
  // Apply automatic formatting to ensure consistent spacing and connection characters
  return { name: formatGuestUnitName(name), count };
};

// Polyfill for older browsers (RFC4122 v4 compliant)
if (!crypto.randomUUID) {
  (crypto as any).randomUUID = () => {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    return Array.from(bytes)
      .map((b, i) => {
        if (i === 4 || i === 6 || i === 8 || i === 10) return '-';
        return b.toString(16).padStart(2, '0');
      })
      .join('');
  };
}

const GuestManager: React.FC = () => {
  const { state, dispatch, mode } = useApp();
  const [guestInput, setGuestInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingGuestName, setEditingGuestName] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('last-name');
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [localDuplicates, setLocalDuplicates] = useState<string[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const videoRef = useRef<HTMLIFrameElement>(null);
  const realtimeSubscriptionRef = useRef<any>(null);
  const pulsingArrowTimeout = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isPremium = mode === 'premium';
  const maxGuests = getMaxGuestLimit(state.subscription);

  // Mode-aware sorting options (SSoT)
  const allowedSortOptions: SortOption[] = mode === 'unsigned'
    ? ['first-name', 'last-name']
    : ['first-name', 'last-name', 'as-entered', 'current-table'];

  // If current sort became disallowed (e.g., downgrade), coerce safely
  useEffect(() => {
    if (!allowedSortOptions.includes(sortOption)) setSortOption('last-name');
  }, [isPremium]); // eslint-disable-line react-hooks/exhaustive-deps

  // Function to hide pulsing arrows
  const hideArrows = () => {
    const leftArrow = document.getElementById('leftArrow');
    const rightArrow = document.getElementById('rightArrow');
    if (leftArrow) leftArrow.classList.add('hidden');
    if (rightArrow) rightArrow.classList.add('hidden');
  };

  // Auto-hide arrows after 20 seconds
  useEffect(() => {
    const timer = setTimeout(() => {
      hideArrows();
    }, 20000); // 20 seconds

    return () => clearTimeout(timer);
  }, []);

  // Function to load test guest list
  const loadTestGuestList = () => {
    // Hide arrows immediately when button is clicked
    hideArrows();
    
    const testGuests = [
      { id: 'guest_test_1', name: 'Terry Ericsson', count: 1 },
      { id: 'guest_test_2', name: 'Madonna', count: 1 },
      { id: 'guest_test_3', name: 'Wei & Sara Chen', count: 2 },
      { id: 'guest_test_4', name: 'Sarah&Bobby Williams+1', count: 3 },
      { id: 'guest_test_5', name: 'Carlos Rodriguez+2', count: 3 },
      { id: 'guest_test_6', name: 'Emily Davis& 2', count: 3 },
      { id: 'guest_test_7', name: 'Raj Patel +1', count: 2 },
      { id: 'guest_test_8', name: 'Ashley Brown &1', count: 2 },
      { id: 'guest_test_9', name: 'Duane Johnson', count: 1 },
      { id: 'guest_test_10', name: 'Javier Conseco & Billy & Jessica Li', count: 3 },
      { id: 'guest_test_11', name: 'David & Vivian Lee', count: 2 },
      { id: 'guest_test_12', name: 'Michelle Terrence+ 1', count: 2 },
      { id: 'guest_test_13', name: 'Luis Hernandez', count: 1 },
      { id: 'guest_test_14', name: 'Amanda Jessica %Zeta Taylor+ 2', count: 3 },
      { id: 'guest_test_15', name: 'Priya Sharma plus 1', count: 2 },
      { id: 'guest_test_16', name: 'Michael Lee + 2', count: 3 },
      { id: 'guest_test_17', name: 'Ana Macron plus 1', count: 2 },
      { id: 'guest_test_18', name: 'Christopher Anderson + 2', count: 3 },
      { id: 'guest_test_19', name: 'Mo Rashid', count: 1 },
      { id: 'guest_test_20', name: 'Tyler Goldberg+3', count: 4 },
      { id: 'guest_test_21', name: 'Stephanie & Robert Jackson', count: 2 },
      { id: 'guest_test_22', name: 'Nicole White', count: 1 },
      { id: 'guest_test_23', name: 'Diego Thunberg', count: 1 },
      { id: 'guest_test_24', name: 'Jin Wang', count: 1 },
      { id: 'guest_test_25', name: 'Rachel Franklin', count: 1 },
      { id: 'guest_test_26', name: 'Ian Franklin+1', count: 2 },
      { id: 'guest_test_27', name: 'Zander & Victoria Lee', count: 2 },
      { id: 'guest_test_28', name: 'Sergio Gambuto', count: 1 },
      { id: 'guest_test_29', name: 'Kayla & Daveed Lopez', count: 2 },
      { id: 'guest_test_30', name: 'Ravi Berns-Krishnan+wife', count: 2 },
      { id: 'guest_test_31', name: 'Kenji Nakamura+2', count: 3 },
      { id: 'guest_test_32', name: 'Megan Kaczmarek', count: 1 }
    ];
    
    dispatch({ type: 'SET_GUESTS', payload: testGuests });
  };
  const totalGuests = useMemo(() => state.guests.reduce((sum, g) => sum + countHeads(g.name), 0), [state.guests]);

  // Mode-aware Vimeo accordion (SSoT)
  useEffect(() => {
    if (mode === 'unsigned') {
      const savedPreference = localStorage.getItem('seatyr_video_visible');
      setVideoVisible(savedPreference !== null ? JSON.parse(savedPreference) : true);
    } else {
      // Signed-in (free/premium): closed by default
      setVideoVisible(false);
    }
  }, [mode]);
  useEffect(() => {
    localStorage.setItem('seatyr_video_visible', JSON.stringify(videoVisible));
  }, [videoVisible]);
  useEffect(() => {
    if (state.user && !isPremium) {
      if (totalGuests > maxGuests) {
        const sortedGuests = [...state.guests].sort((a, b) => countHeads(a.name) - countHeads(b.name));
        let cumulativeHeads = 0;
        const trimmed = sortedGuests.filter(g => {
          const heads = countHeads(g.name);
          if (cumulativeHeads + heads <= maxGuests) {
           
            cumulativeHeads += heads;
            return true;
          }
          return false;
        });
        dispatch({ type: 'SET_GUESTS', payload: trimmed });
        setShowLimitModal(true);
      }
    }
  }, [state.user, isPremium, totalGuests, maxGuests, dispatch, state.guests]);
  useEffect(() => {
    if (!state.user) return;
    if (realtimeSubscriptionRef.current) {
      realtimeSubscriptionRef.current.unsubscribe();
    }
    const subscription = supabase
      .channel('saved_settings_changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'saved_settings',
        
          filter: `user_id=eq.${state.user.id}`
        },
        () => {
          // Accordion reloads on its own, but can trigger if needed
        }
      )
      .subscribe((status: string, err: any) => {
        if (status === 'SUBSCRIPTION_ERROR' && err) {
          console.error('Supabase subscription error:', err);
        }
      });
    realtimeSubscriptionRef.current = subscription;
    return () => {
      if (realtimeSubscriptionRef.current) {
        realtimeSubscriptionRef.current.unsubscribe();
        realtimeSubscriptionRef.current = null;
      }
    };
  }, [state.user]);

  useEffect(() => {
    setShowDuplicateWarning(localDuplicates.length > 0);
  }, [localDuplicates]);
  useEffect(() => {
    const timer = setTimeout(() => {
      const leftArrow = document.getElementById('leftArrow');
      const rightArrow = document.getElementById('rightArrow');
      if (leftArrow) leftArrow.classList.add('hidden');
      if (rightArrow) rightArrow.classList.add('hidden');
    }, 20000);
    return () => clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (pulsingArrowTimeout.current) {
      clearTimeout(pulsingArrowTimeout.current);
    }
    pulsingArrowTimeout.current = window.setTimeout(() => {
      setShowDuplicateWarning(false);
    }, 15000);
    return () => {
      if (pulsingArrowTimeout.current) {
        clearTimeout(pulsingArrowTimeout.current);
      }
    };
  }, [showDuplicateWarning]);

  // Toggle Vimeo video visibility (mode-aware localStorage)
  const toggleVideo = () => {
    const newVisible = !videoVisible;
    setVideoVisible(newVisible);
    if (mode === 'unsigned') {
      localStorage.setItem('seatyr_video_visible', JSON.stringify(newVisible));
    }
    if (newVisible && videoRef.current) {
      let src = videoRef.current.src;
      if (src.includes('autoplay=0')) {
        src = src.replace('autoplay=0', 'autoplay=1');
      } else if (!src.includes('autoplay=1')) {
        src += (src.includes('?') ? '&' : '?') + 'autoplay=1';
      }
      videoRef.current.src = src;
    }
  };

  const handleAddGuests = () => {
    const lines = guestInput.split(/[\n,]/).map(line => line.trim()).filter(line => line.length > 0);
    const seen = new Set(state.guests.map((g) => normalizeName(g.name)));
    const duplicates = [];
    for (const line of lines) {
      const parsed = parseGuestLine(line);
      if (parsed) {
        const norm = normalizeName(parsed.name);
        if (seen.has(norm)) {
          duplicates.push(parsed.name);
        } else {
          seen.add(norm);
          dispatch({ 
            type: 'ADD_GUEST', 
            payload: {
              id: crypto.randomUUID(),
              name: parsed.name,
              count: parsed.count
            }
          });
        }
      }
    }
    setLocalDuplicates(duplicates);
    setGuestInput('');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        const lines = content.split('\n').filter(line => line.trim());
        
        const guests = [];
        for (const line of lines) {
          const parsed = parseGuestLine(line.trim());
          if (parsed) {
            guests.push({
              id: crypto.randomUUID(),
              name: parsed.name,
              count: parsed.count
            });
          }
        }

        if (guests.length > 0) {
          guests.forEach(guest => {
            dispatch({ type: 'ADD_GUEST', payload: guest });
          });
          
          setImportError(null);
        } else {
          setImportError('No valid guests found in the file.');
        }
      } catch (error) {
        console.error('Error parsing file:', error);
        setImportError('Invalid file format. Please ensure it\'s a CSV file with the correct format.');
      }

      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.readAsText(file);
  };


  const beginEdit = (id: string, name: string) => {
    setEditingGuestId(id);
    setEditingGuestName(name);
  };

  const commitEdit = () => {
    if (editingGuestId && editingGuestName.trim()) {
      dispatch({
        type: 'RENAME_GUEST',
        payload: { id: editingGuestId, name: formatGuestUnitName(editingGuestName) },
      });
    }
    setEditingGuestId(null);
    setEditingGuestName('');
  };

  const cancelEdit = () => {
    setEditingGuestId(null);
    setEditingGuestName('');
  };
  const handleRemoveGuest = (id: string) => {
    dispatch({ type: 'REMOVE_GUEST', payload: id });
  };
  const handleClearAll = () => {
    setShowClearConfirm(true);
  };
  const confirmClearAll = () => {
    dispatch({ type: 'CLEAR_ALL' });
    clearRecentSessionSettings(state.user?.id);
    setShowClearConfirm(false);
  };
  const handleUpgrade = async () => {
    if (!state.user) {
      setShowAuthModal(true);
      return;
    }
    await redirectToCheckout(state.user.email);
  };

  const sortedGuests = useMemo(() => {
    const guests = [...state.guests];
      if (sortOption === 'first-name') {
      return guests.sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOption === 'last-name') {
      return guests.sort((a, b) => getLastNameForSorting(a.name).localeCompare(getLastNameForSorting(b.name)));
    } else if (sortOption === 'current-table') {
      if (state.seatingPlans.length === 0) return guests; // no-op when no plans
      return guests.sort((a, b) => {
        const keyA = currentTableKey(a.id, state.seatingPlans?.[state.currentPlanIndex], state.assignments);
        const keyB = currentTableKey(b.id, state.seatingPlans?.[state.currentPlanIndex], state.assignments);
        return keyA === keyB ? 0 : keyA < keyB ? -1 : 1;
      });
    }
    return guests;
  }, [state.guests, sortOption, state.seatingPlans, state.currentPlanIndex, state.assignments]);
  const monthYear = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  return (
    <div className="space-y-6 relative">
      <div id="leftArrow" className="absolute left-0 top-1/2 transform -translate-y-1/2 text-4xl animate-pulseAndColor"></div>
      <div id="rightArrow" className="absolute right-0 top-1/2 transform -translate-y-1/2 text-4xl animate-pulseAndColor"></div>
      
      {/* Video Section with Collapse/Expand - Full width at top */}
      <div className="w-full rounded-lg shadow-md overflow-hidden">
        {videoVisible ? (
          <div className="relative">
            {/* Hide Section button against Geyser color background - NO white bar when expanded */}
            <div className="p-2 flex justify-end bg-[#DDE1E3]">
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
          <div className="p-4 flex justify-end items-center bg-[#DDE1E3]">
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

      {mode === 'premium' ? (
        // Premium users: Only show Add Guest Names box at full width (no instructions)
        <Card title="Add Guest Names" style={{ minHeight: '280px' }}>
          <div className="flex justify-between items-center w-full mb-4">
            <span></span>
            {!isPremium && (
              <span className="text-sm text-gray-700 ml-auto text-right whitespace-normal break-words">
                Free Plan: {totalGuests}/80 guests used
              </span>
            )}
          </div>
          <div className="space-y-2 mb-2">
            <p className="text-sm text-gray-700">Enter guest names separated by commas or line breaks.</p>
            <table className="w-full invisible">
              <tbody>
                <tr>
                  <td className="text-sm text-gray-700">Connect couples and parties with an ampersand ("&").</td>
                <td className="text-right">
                  {isPremium ? (
                    <p className="text-sm text-gray-700">Premium Plan: {totalGuests} guests used</p>
                  ) : (
                    <p className="text-sm text-gray-700">Free Plan: {totalGuests}/80 guests used</p>
                  )}
                </td>
                </tr>
              </tbody>
            </table>
          </div>
          <textarea
            value={guestInput}
            onChange={(e) => setGuestInput(e.target.value)}
            placeholder=" e.g., Alice & Andrew Jones, Bob Smith+1
Conseula & Cory & Cleon Lee, Darren Winnik+4"
            className="w-full h-32 p-3 border border-gray-400 rounded-lg resize-none text-black"
            style={{ borderColor: 'rgba(0, 0, 0, 0.3)' }}
          />
          <div className="mt-4 flex w-full flex-wrap min-w-0" style={{ paddingLeft: '3rem', paddingRight: '3rem', gap: '2rem' }}>
            <Button 
              onClick={handleAddGuests} 
              disabled={!guestInput.trim()}
              className="min-w-0 w-full sm:w-[48.3%]"
              style={{ height: '70.2px' }}
            >
              Add Guests
            </Button>
            {state.user && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".csv,.txt"
                  className="hidden"
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="danstyle1c-btn inline-flex items-center justify-center min-w-0 w-full sm:w-[48.3%]"
                  style={{ height: '70.2px' }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Guests & Settings
                </button>
              </>
            )}
          </div>
          
          {/* Add spacing below buttons for alignment */}
          <div className="mt-6"></div>
          
          {showDuplicateWarning && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md flex items-start">
           
            <AlertCircle className="text-yellow-600 mr-2 mt-1 flex-shrink-0" />
              <div>
                <p className="text-yellow-700">
                  Duplicates skipped: {localDuplicates.join(', ')}
                </p>
              </div>
          
            </div>
          )}
          
          {importError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start">
              <AlertCircle className="text-red-600 mr-2 mt-1 flex-shrink-0" />
              <div>
                <p className="text-red-700">
                  {importError}
                </p>
              </div>
            </div>
          )}
        </Card>
      ) : (
        // Unsigned/Free users: Show Instructions and Add Guest Names with 35%/60% ratio
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6" style={{ gridTemplateColumns: '0.4fr 0.05fr 0.55fr' }}>
          <Card title="Instructions" className="lg:col-span-1" style={{ minHeight: '280px' }}>
            <div className="flex flex-col h-full" style={{ minHeight: '240px' }}>
              <div className="flex-1 flex items-center">
                <div className="text-sm text-[#566F9B] text-left" style={{ fontSize: 'clamp(0.8em, 1.25em, 1.25em)', lineHeight: '1.3', marginLeft: '1.25rem' }}>
                  <p style={{ marginBottom: '1.3em' }}>1.) Click "Load Test Guest List" button.</p>
                  <p style={{ marginBottom: '1.3em' }}>2.) Click "Your Rules" at the top.</p>
                  <p>3.) Pair and Prevent as you like.</p>
                </div>
              </div>
              
              {/* Pulsing Arrow Emoji - moved down 3 lines to align with Load Test Guest List button */}
              <div className="flex justify-center items-end pb-2" style={{ marginTop: '3rem' }}>
                <div
                  className="pulsing-arrow"
                  style={{ fontSize: '36pt', animation: 'pulseAndColor 2s ease-in-out infinite', animationIterationCount: 5 }}
                  aria-hidden
                >
                  ➡️
                </div>
              </div>
            </div>
          </Card>

          <Card title="Add Guest Names" className="lg:col-span-2" style={{ minHeight: '280px' }}>
            <div className="flex justify-between items-center w-full mb-4">
              <span></span>
              {!isPremium && (
                <span className="text-sm text-gray-700 ml-auto text-right whitespace-normal break-words">
                  Free Plan: {totalGuests}/80 guests used
                </span>
              )}
            </div>
          <div className="space-y-2 mb-2" style={{ paddingLeft: '0' }}>
            <p className="text-sm text-gray-700" style={{ marginLeft: '0' }}>Enter guest names separated by commas or line breaks.</p>
            <p className="text-sm text-gray-700" style={{ marginLeft: '0' }}>• Connect couples and parties with an ampersand (&), plus (+), or the word "and".</p>
            <table className="w-full invisible">
              <tbody>
                <tr>
                  <td className="text-sm text-gray-700">Connect couples and parties with an ampersand ("&").</td>
                <td className="text-right">
                  {isPremium ? (
                    <p className="text-sm text-gray-700">Premium Plan: {totalGuests} guests used</p>
                  ) : (
                    <p className="text-sm text-gray-700">Free Plan: {totalGuests}/80 guests used</p>
                  )}
                </td>
                </tr>
              </tbody>
            </table>
          </div>
          <textarea
            value={guestInput}
            onChange={(e) => setGuestInput(e.target.value)}
            placeholder=" e.g., Alice & Andrew Jones, Bob Smith+1
Conseula & Cory & Cleon Lee, Darren Winnik+4"
            className="w-full h-32 p-3 border border-gray-400 rounded-lg resize-none text-black"
            style={{ borderColor: 'rgba(0, 0, 0, 0.3)' }}
          />
          <div className="mt-4 flex w-full flex-wrap min-w-0 justify-center" style={{ paddingLeft: '1rem', paddingRight: '1rem', gap: '1rem' }}>
            {!state.user && (
              <button
                onClick={loadTestGuestList}
                className="danstyle1c-btn inline-flex items-center justify-center min-w-0 w-full sm:w-[60%]"
                style={{ height: '70.2px' }}
                id="loadTestGuestListBtn"
              >
                <span className="pulsing-arrow" id="leftArrow" style={{ animation: 'pulseAndColor 2s ease-in-out infinite', animationIterationCount: 5 }}>➡️</span>
                <span className="mx-8">Load Test Guest List</span>
                <span className="pulsing-arrow" id="rightArrow" style={{ animation: 'pulseAndColor 2s ease-in-out infinite', animationIterationCount: 5 }}>⬅️</span>
              </button>
            )}
            <Button 
              onClick={handleAddGuests} 
              disabled={!guestInput.trim()}
              className="min-w-0 w-full sm:w-[40%]"
              style={{ height: '70.2px' }}
            >
              Add Guests
            </Button>
            {state.user && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".csv,.txt"
                  className="hidden"
                />
                
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="danstyle1c-btn inline-flex items-center justify-center min-w-0 w-full sm:w-[65%]"
                  style={{ height: '70.2px' }}
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Guests & Settings
                </button>
              </>
            )}
          </div>
          
          {/* Add spacing below buttons for alignment */}
          <div className="mt-6"></div>
          
          {showDuplicateWarning && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md flex items-start">
           
            <AlertCircle className="text-yellow-600 mr-2 mt-1 flex-shrink-0" />
              <div>
                <p className="text-yellow-700">
                  Duplicates skipped: {localDuplicates.join(', ')}
                </p>
              </div>
          
            </div>
          )}
          
          {importError && (
            <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-md flex items-start">
              <AlertCircle className="text-red-600 mr-2 mt-1 flex-shrink-0" />
              <div>
                <p className="text-red-700">
                  {importError}
                </p>
              </div>
            </div>
          )}
        </Card>
        </div>
      )}

      {/* Saved Settings Accordion */}
      {state.user && <SavedSettingsAccordion />}

      <Card title="Guest List" className="relative">
        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5" />
            <span>{sortedGuests.length} Invitations ({totalGuests} Seats)</span>
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-700 font-medium">Sort by:</span>
            {allowedSortOptions.includes('first-name') && (
              <button
                onClick={() => setSortOption('first-name')}
                className={`danstyle1c-btn ${sortOption === 'first-name' ? 'selected' : ''}`}
              >
                First Name
              </button>
            )}
            {allowedSortOptions.includes('last-name') && (
              <button
                onClick={() => setSortOption('last-name')}
                className={`danstyle1c-btn ${sortOption === 'last-name' ? 'selected' : ''}`}
              >
                Last Name
              </button>
            )}
            {allowedSortOptions.includes('as-entered') && (
              <button
                onClick={() => setSortOption('as-entered')}
                className={`danstyle1c-btn ${sortOption === 'as-entered' ? 'selected' : ''}`}
              >
                As Entered
              </button>
            )}
            {allowedSortOptions.includes('current-table') && (
              <button
                onClick={() => setSortOption('current-table')}
                className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''}`}
              >
                By Table
              </button>
            )}
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedGuests.map((guest, index) => {
            const isEditing = editingGuestId === guest.id;
            const label = getGuestTableAssignment(guest.id, state.tables?.map(t => ({ id: t.id, name: t.name || undefined, seats: t.seats })), state.seatingPlans?.[state.currentPlanIndex], state.assignments);
            return (
              <div 
                key={`${guest.name}-${index}`}
                className="border border-[#586D78] border-[0.5px] rounded-lg p-4 flex flex-col items-start bg-white shadow"
                onDoubleClick={() => beginEdit(guest.id, guest.name)}
              >
                {isEditing ? (
                <input
                    type="text"
                  value={editingGuestName}
                    autoFocus
                  onChange={(e) => setEditingGuestName(e.target.value)}
                    onBlur={() => commitEdit()}
                  onKeyDown={(e) => {
                      if (e.key === "Enter") commitEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    className="guest-name-input font-medium text-[#586D78] text-xl w-full"
                    style={{ fontWeight: "bold" }}
                />
              ) : (
                  <span
                    className="font-medium text-[#586D78] text-xl flex items-center cursor-pointer"
                    onDoubleClick={() => beginEdit(guest.id, guest.name)}
                  >
                    <FormatGuestName name={guest.name} />
                    <Edit2 className="w-3 h-3 ml-1 text-gray-400 cursor-pointer" 
                        onClick={() => beginEdit(guest.id, guest.name)} />
                  </span>
                )}

                <div className="flex justify-between items-end w-full mt-auto">
                  <div className="flex flex-col">
                    {guest.count > 1 && (
                      <span className="text-sm text-gray-700 font-medium">
                        Party size: {guest.count} {guest.count === 1 ? 'person' : 'people'}
                      </span>
                    )}
                    <span className={`text-sm ${label === 'Unassigned' ? 'text-gray-400' : 'text-gray-700'}`} style={label === 'Unassigned' ? { opacity: 0.4 } : {}}>Table: {label}</span>
                  </div>
                  
                  <button
                    className="danstyle1c-btn danstyle1c-remove btn-small"
                    onClick={() => handleRemoveGuest(guest.id)}
                  >
                    <Trash2 className="w-3 h-3 mr-1" />
                    Remove
                  </button>
                </div>
              </div>
            );
          })}
            </div>
        <div className="mt-4 flex justify-end">
          <Button variant="danger" onClick={handleClearAll}>
            <Trash2 className="w-4 h-4 mr-2" />
            Clear Guest List
          </Button>
        </div>
      </Card>

      <div className="bg-blue-50 border border-indigo-200 rounded-md p-4 flex items-start">
  
        <Info className="text-[#586D78] mr-2 mt-1 flex-shrink-0" />
        <div>
          <p className="text-gray-700">
            <strong>NOTE:</strong> For names with 3 or more words (e.g., "Tatiana Sokolov Boyko", "Jan Tomasz Kowalski Nowak", "Angel Alba Salavador Costa Almeida"), if you want one of those surnames (other than the "last" word of the last name) to be the alphabetical sorting word "By Last Name," then put a percentage symbol (<span style={{ color: '#959595' }}>%</span>) before that 
            surname.
          </p>
          <p className="text-gray-700 mt-1">
            Examples: "Tatiana <span style={{ color: '#959595' }}>%</span>Sokolov Boyko", "Jan Tomasz <span style={{ color: '#959595' }}>%</span>Kowalski Nowak", "Angel Alba Salavador <span style={{ color: '#959595' }}>%</span>Costa Almeida"
          </p>
        </div>
      </div>

      <div className="w-full mt-10 bg-[#fff4cd] border-2 border-[#586D78] rounded-xl p-6">
        <h2 className="text-lg font-bold text-[#586D78] mb-4">Seatyr's Favorite 
        Sites '97 {monthYear}:</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-2 text-sm text-gray-800 list-disc list-inside">
          <ul>
            <li>
              <a href="https://zingermans.com" target="_blank" rel="noopener noreferrer">
                https://Zingerman's.com
              </a>
          
            </li>
            <li>
              <a href="https://zabars.com" target="_blank" rel="noopener noreferrer">
                https://Zabars.com
              </a>
            </li>
          </ul>
          <ul>
      
            <li>
              <a href="https://bigbobgibson.com" target="_blank" rel="noopener noreferrer">
                https://BigBobGibson.com
              </a>
            </li>
            <li>
              <a href="https://linktr.ee/immortalitybytes" target="_blank" rel="noopener noreferrer">
    
                https://linktr.ee/immortalitybytes
              </a>
            </li>
          </ul>
          <ul>
            <li>
              <a href="https://madgreens.com" target="_blank" rel="noopener noreferrer">
            
                https://MadGreens.com
              </a>
            </li>
            <li>
              <a href="https://hubermanlab.com" target="_blank" rel="noopener noreferrer">
                https://HubermanLab.com
              </a>
          
            </li>
          </ul>
        </div>
      </div>

      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4 text-[#586D78]">Confirm Clear Guest List</h3>
            <p className="text-gray-700 mb-6">
              This will remove all guests and reset all constraints, assignments, and seating plans.
            This action cannot be undone.
            </p>
            <div className="flex justify-end space-x-2">
              <Button variant="secondary" onClick={() => setShowClearConfirm(false)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={confirmClearAll}>
                
                Clear All Data
              </Button>
            </div>
          </div>
        </div>
      )}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}

      {showLimitModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white 
          rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4 flex items-center">
              <Crown className="w-5 h-5 mr-2" />
              Guest Limit Reached
            </h3>
            <p className="text-gray-700 mb-6">
              Your list has been trimmed 
            to {maxGuests} guests based on party sizes. Upgrade to Premium for unlimited guests.
            </p>
            <div className="flex justify-end space-x-2">
              <Button variant="secondary" onClick={() => setShowLimitModal(false)}>
                Cancel
              </Button>
              <Button onClick={handleUpgrade}>
                Upgrade to Premium
    
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
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