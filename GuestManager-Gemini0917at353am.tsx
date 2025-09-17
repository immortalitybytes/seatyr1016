import { AlertCircle, ChevronDown, ChevronUp, Edit2, Info, Trash2, X, Play, RefreshCw, Users, FolderOpen, ArrowDownAZ, Crown, Upload, ArrowRight } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import AuthModal from '../components/AuthModal';
import SavedSettingsAccordion from '../components/SavedSettingsAccordion';
import { useApp } from '../context/AppContext';
import { supabase } from '../lib/supabase';
import { redirectToCheckout } from '../lib/stripe';
import { isPremiumSubscription, getMaxGuestLimit } from '../utils/premium';
import { clearRecentSessionSettings, saveRecentSessionSettings } from '../lib/sessionSettings';
import { getLastNameForSorting } from '../utils/formatters';
import { getDisplayName, countHeads } from '../utils/guestCount';
import FormatGuestName from '../components/FormatGuestName';
import { calculateTotalCapacity } from '../utils/tables';
import { useNavigate } from 'react-router-dom';

type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';
interface SavedSettingRec {
  id: string;
  name: string;
  created_at: string;
  user_id: string;
  settings: any;
}

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
  const plusOneRegex = /(?:(?:+|&)*1(?!))|(?:(?:and|plus|family of)*(?:one|1|+)(?!))/gi;
  const name = trimmed.replace(plusOneRegex, (m) => {
    const hasSpace = m.trim() !== m;
    return hasSpace ? ' plus One' : 'plus One';
  });
  return { name, count };
};

// Polyfill for older browsers (RFC4122 v4 compliant)
if (!crypto.randomUUID) {
  crypto.randomUUID = () => {
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
  const { state, dispatch } = useApp();
  const navigate = useNavigate();
  const [guestInput, setGuestInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [videoVisible, setVideoVisible] = useState(false);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingGuestName, setEditingGuestName] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [showLimitModal, setShowLimitModal] = useState(false);
  const [localDuplicates, setLocalDuplicates] = useState<string[]>([]);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [realtimeError, setRealtimeError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLIFrameElement>(null);
  const realtimeSubscriptionRef = useRef<any>(null);
  const pulsingArrowTimeout = useRef<number | null>(null);

  const isPremium = isPremiumSubscription(state.subscription);
  const maxGuests = getMaxGuestLimit(state.subscription);

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
      { id: 'guest_test_30', name: 'Marcus Thompson', count: 1 },
      { id: 'guest_test_31', name: 'Elena Rodriguez', count: 1 },
      { id: 'guest_test_32', name: 'Kevin Chen', count: 1 },
      { id: 'guest_test_33', name: 'Isabella Martinez', count: 1 },
      { id: 'guest_test_34', name: 'Ryan O\'Connor', count: 1 },
      { id: 'guest_test_35', name: 'Fatima Al-Zahra', count: 1 },
      { id: 'guest_test_36', name: 'Alex Johnson', count: 1 },
      { id: 'guest_test_37', name: 'Sophie Williams', count: 1 },
      { id: 'guest_test_38', name: 'Ahmed Hassan', count: 1 },
      { id: 'guest_test_39', name: 'Emma Davis', count: 1 },
      { id: 'guest_test_40', name: 'Omar Ali', count: 1 }
    ];
    
    dispatch({ type: 'SET_GUESTS', payload: testGuests });
  };
  const totalGuests = useMemo(() => state.guests.reduce((sum, g) => sum + countHeads(g.name), 0), [state.guests]);
  const totalSeats = useMemo(() => calculateTotalCapacity(state.tables), [state.tables]);

  useEffect(() => {
    const userIsLoggedIn = !!state.user;
    const savedPreference = localStorage.getItem('seatyr_video_visible');
    if (savedPreference !== null) {
      setVideoVisible(JSON.parse(savedPreference));
    } else {
      setVideoVisible(!userIsLoggedIn);
      localStorage.setItem('seatyr_video_visible', JSON.stringify(!userIsLoggedIn));
    }
  }, [state.user]);
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
    if (state.user) {
      // Fetch if needed, but accordion handles
    }
  }, [state.user]);
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
          setRealtimeError('Failed to subscribe to settings updates. Please try again.');
  
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
  const toggleVideo = () => {
    const newVisible = !videoVisible;
    setVideoVisible(newVisible);
    localStorage.setItem('seatyr_video_visible', JSON.stringify(newVisible));
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
    const lines = guestInput.split('');
    const newGuests = [];
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
          newGuests.push({
            id: crypto.randomUUID(),
            name: parsed.name,
          });
        }
      }
    }
    if (newGuests.length > 0) {
      dispatch({ type: 'ADD_GUESTS', payload: newGuests });
    }
    setLocalDuplicates(duplicates);
    setGuestInput('');
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      if (text) {
        setGuestInput(text);
      } else {
        setImportError('Failed to read file.');
      }
    };
    reader.onerror = () => setImportError('Error reading file.');
    reader.readAsText(file);
  };

  const beginEdit = (id: string, name: string) => {
    setEditingGuestId(id);
    setEditingGuestName(name);
  };

  const commitEdit = () => {
    if (editingGuestId && editingGuestName.trim()) {
      dispatch({
        type: 'UPDATE_GUEST',
        payload: { id: editingGuestId, name: editingGuestName },
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
    clearRecentSessionSettings();
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
      return guests.sort((a, b) => {
        const keyA = currentTableKey(a.id, state.seatingPlan, state.assignments);
        const keyB = currentTableKey(b.id, state.seatingPlan, state.assignments);
        return keyA === keyB ? 0 : keyA < keyB ? -1 : 1;
      });
    }
    return guests;
  }, [state.guests, sortOption, state.seatingPlan, state.assignments]);
  const monthYear = new Date().toLocaleString('default', { month: 'long', year: 'numeric' });
  return (
    <div className="space-y-6 relative">
      <div id="leftArrow" className="absolute left-0 top-1/2 transform -translate-y-1/2 text-4xl animate-pulseAndColor"></div>
      <div id="rightArrow" className="absolute right-0 top-1/2 transform -translate-y-1/2 text-4xl animate-pulseAndColor"></div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card title="Instructions" className="lg:col-span-1">
          <div className="space-y-2 text-sm text-[#566F9B]" style={{ fontSize: '1.25em', lineHeight: '1.8' }}>
            <p>1.) Click "Load Test Guest List" button.</p>
            <p>2.) Click "Your Rules" at the top.</p>
            <p>3.) Pair and Prevent as you like.</p>
          </div>
          
          {/* Pulsing Arrow Emoji for Non-signed Users - right arrow with color cycling and pulsing */}
          <div className="flex justify-end pr-4">
            <div
              className="pulsing-arrow self-end translate-y-2"
              style={{ fontSize: '36pt', animation: 'pulseAndColor 2s ease-in-out infinite', animationIterationCount: 5 }}
              aria-hidden
            >
              ➡️
            </div>
          </div>
          
          <div className="space-y-4 text-gray-700">
            <p>Enter one guest name or group per line. Examples:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>John Doe</li>
              <li>Jane Smith +1</li>
              <li>The Johnson Family (4)</li>
              <li>Alex & Taylor</li>
            </ul>
            <p className="pt-2">You can add up to {maxGuests} guests on free accounts. Upgrade for unlimited.</p>
            {importError && <p className="text-red-500">{importError}</p>}
            {realtimeError && <p className="text-red-500">{realtimeError}</p>}
            <div className="flex items-center gap-2">
              <Button onClick={() => fileInputRef.current?.click()}>
                <Upload className="w-4 h-4 mr-2" />
               
                Import List (CSV/TXT)
              </Button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleImportFile}
                accept=".csv,.txt"
     
                className="hidden"
              />
            </div>
          </div>
        </Card>

        <Card title="Add Guest Names" className="lg:col-span-2">
          <textarea
            value={guestInput}
           
            onChange={(e) => setGuestInput(e.target.value)}
            placeholder="Enter guest names, one per line..."
            className="w-full h-32 p-3 border rounded-lg resize-none"
          />
          <div className="mt-4 flex justify-between items-center">
            <div className="text-sm text-gray-600">
              Total Guests: {totalGuests} / Seats: {totalSeats}
            </div>
            <div className="flex gap-2">
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
              <Button onClick={handleAddGuests} disabled={!guestInput.trim()}>
                Add Guests
              </Button>
            </div>
          </div>
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
          {sortedGuests.length > 0 && (
            <div className="mt-6 flex justify-center">
              <Button variant="primary" onClick={() => navigate('/tables')}>
                Go to Table & Constraint Setup <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
 
            </div>
          )}
        </Card>
      </div>

      <Card title="Video Tutorial" collapsible defaultOpen={videoVisible}>
        <div className="relative">
          <iframe
            ref={videoRef}
            width="100%"
            
            height="315"
            src="https://player.vimeo.com/video/1085961997?autoplay=0"
            title="Seatyr Tutorial"
            frameBorder="0"
            allow="autoplay;
fullscreen"
            allowFullScreen
          ></iframe>
        </div>
      </Card>

      {state.user && <SavedSettingsAccordion />}

      <Card title="Your Guests" className="relative">
        <div className="flex justify-between items-center mb-4">
          <div className="flex items-center gap-2">
            <Users className="w-5 h-5" />
      
            <span>{sortedGuests.length} Guests ({totalGuests} Heads)</span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowDownAZ className="w-4 h-4" />
            <select
              value={sortOption}
              onChange={(e) => setSortOption(e.target.value as SortOption)}
         
              className="border rounded px-2 py-1"
            >
              <option value="as-entered">As Entered</option>
              <option value="first-name">By First Name</option>
              <option value="last-name">By Last Name</option>
              <option value="current-table">By Current Table</option>
            </select>
 
          </div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {sortedGuests.map((guest) => {
            const isEditing = editingGuestId === guest.id;
            const label = getGuestTableAssignment(guest.id, state.tables, state.seatingPlan, state.assignments);
            const opacity = label === 'Unassigned' ? 'opacity-50' : '';
            return (
              <div key={guest.id} className={`flex items-center justify-between p-3 border rounded-lg bg-white ${opacity}`}>
                {isEditing ? (
                  <div className="flex flex-1 items-center gap-2">
                    <input
                
                      value={editingGuestName}
                      onChange={(e) => setEditingGuestName(e.target.value)}
                      onKeyDown={(e) => (e.key === 'Enter' ? commitEdit() : e.key === 'Escape' ? cancelEdit() : null)}
                      autoFocus
            
                      className="flex-1 min-w-0 border rounded px-2 py-1"
                    />
                    <Button size="sm" onClick={commitEdit}>
                      Save
                    </Button>
 
                    <Button size="sm" variant="secondary" onClick={cancelEdit}>
                      Cancel
                    </Button>
                  </div>
                ) : 
                (
                  <div
                    className="flex-1 min-w-0 cursor-text"
                    onDoubleClick={() => beginEdit(guest.id, guest.name)}
                  >
                   
                    <FormatGuestName name={getDisplayName(guest.name)} />
                    <span className={`text-sm text-gray-600 block ${opacity}`}>Table: {label}</span>
                  </div>
                )}
                <div className="flex items-center gap-1 shrink-0">
                  
                    <Button size="sm" onClick={() => beginEdit(guest.id, guest.name)} title="Rename">
                    <Edit2 className="w-4 h-4" />
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => handleRemoveGuest(guest.id)} title="Remove">
                    <Trash2 className="w-4 h-4" />
      
                    </Button>
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

export default GuestManager;}