import React, { useState, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';
import { parseGuests } from '../utils/guestParser';
import { useModal } from './ModalProvider';
import { X } from 'lucide-react';
import SavedSettingsAccordion from './SavedSettingsAccordion';

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

const GuestManager: React.FC = () => {
  const { state, dispatch } = useAppContext();
  const { openConfirm } = useModal();
  
  const [raw, setRaw] = useState('');
  const [warnings, setWarnings] = useState<string[]>([]);
  const [isVideoVisible, setIsVideoVisible] = useState(true);
  const [isNewUser, setIsNewUser] = useState(true);
  const [editingGuestId, setEditingGuestId] = useState<string | null>(null);
  const [editingGuestName, setEditingGuestName] = useState('');
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');

  // Check if user is signed in (hide video for signed-in users)
  useEffect(() => {
    if (state.user) {
      setIsNewUser(false);
      setIsVideoVisible(false);
    }
  }, [state.user]);

  const totalGuestCount = state.guests.reduce((sum, guest) => sum + guest.count, 0);

  // Function to automatically refresh seat count for a guest
  const refreshGuestSeatCount = (guestId: string, newName: string) => {
    const { guests } = parseGuests(newName);
    if (guests.length > 0) {
      const newCount = guests[0].count;
      dispatch({
        type: 'UPDATE_GUEST',
        payload: {
          id: guestId,
          updates: { count: newCount }
        }
      });
    }
  };

  // Function to handle guest name editing
  const startEditGuest = (guest: any) => {
    setEditingGuestId(guest.id);
    setEditingGuestName(guest.displayName);
  };

  const saveEditGuest = (guestId: string) => {
    if (editingGuestName.trim()) {
      dispatch({
        type: 'UPDATE_GUEST',
        payload: {
          id: guestId,
          updates: { displayName: editingGuestName.trim() }
        }
      });
      
      // Automatically refresh seat count
      refreshGuestSeatCount(guestId, editingGuestName.trim());
      
      setEditingGuestId(null);
      setEditingGuestName('');
    }
  };

  const cancelEditGuest = () => {
    setEditingGuestId(null);
    setEditingGuestName('');
  };

  const onParse = () => {
    if (!raw.trim()) return;
    
    const { guests, warnings: parseWarnings } = parseGuests(raw.trim());
    setWarnings(parseWarnings.map(w => `${w.row}: ${w.message}`));
    
    if (guests.length > 0) {
      // Check for duplications and merge with existing guests
      const existingGuests = [...state.guests];
      const newGuests = [...guests];
      
      // Merge duplicates and add new guests
      newGuests.forEach(newGuest => {
        const existingIndex = existingGuests.findIndex(existing => 
          existing.normalizedKey === newGuest.normalizedKey
        );
        
        if (existingIndex >= 0) {
          // Update existing guest with higher count
          existingGuests[existingIndex].count = Math.max(
            existingGuests[existingIndex].count, 
            newGuest.count
          );
        } else {
          // Add new guest
          existingGuests.push(newGuest);
        }
      });
      
      dispatch({ type: 'SET_GUESTS', payload: existingGuests });
      // Changing guests invalidates existing assignments-based plans and related data
      dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
      dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
      dispatch({ type: 'SET_CONSTRAINTS', payload: {} });
      dispatch({ type: 'SET_ADJACENTS', payload: {} });
      setRaw('');
      setWarnings([]);
    }
  };

  const loadSample = () => {
    const sample = `Michael & Enid Johnson, Sarah & Rachel & Billy Williams, David Chen & Jessica Brown, Christopher Davis, Ashley Miller & Plus One, Matthew Wilson & Amanda Moore, Joshua Taylor & Guest, Jennifer& Andrew &Thomas Bhasin, Elizabeth Jackson, Daniel White, Emily Harris, James Martin, Li Thompson, Robert Garcia, Nicole Martinez, John Rodriguez, Stephanie Lewis, William Lee & Rachel Walker, Thomas Hall and Lauren Allen & Kid1 & Kid2, Richard Young (+2), Samantha King, Charles Wright, Michelle Lopez, Joseph Scott, Kimberly Green, Mark Adams, Lisa Baker, Steven Gonzalez`;
    setRaw(sample);
    setWarnings([]);
  };

  const clearGuests = () => {
    if (state.guests.length > 0) {
      openConfirm(
        'Clear All Guests?',
        'This will remove all guests and clear all seating plans and constraints. Continue?',
        () => {
          dispatch({ type: 'SET_GUESTS', payload: [] });
          dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
          dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
          dispatch({ type: 'SET_CONSTRAINTS', payload: {} });
          dispatch({ type: 'SET_ADJACENTS', payload: {} });
        }
      );
    }
  };

  const exportGuests = () => {
    const dataStr = JSON.stringify(state.guests, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = 'seatyr-guests.json';
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
  };

  const importGuests = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = (e.target as HTMLInputElement).files?.[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
          try {
            const guests = JSON.parse(e.target?.result as string);
            if (Array.isArray(guests)) {
              dispatch({ type: 'SET_GUESTS', payload: guests });
              dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
              dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
              dispatch({ type: 'SET_CONSTRAINTS', payload: {} });
              dispatch({ type: 'SET_ADJACENTS', payload: {} });
            }
          } catch (error) {
            console.error('Error parsing guest file:', error);
          }
        };
        reader.readAsText(file);
      }
    };
    input.click();
  };

  const toggleVideo = () => {
    setIsVideoVisible(!isVideoVisible);
  };

  // Function to get sorted guests
  const getSortedGuests = () => {
    if (sortOption === 'as-entered') {
      return [...state.guests];
    }
    
    return [...state.guests].sort((a, b) => {
      if (sortOption === 'first-name') {
        // Sort by the first name (everything before the first space)
        const firstNameA = a.displayName.split(' ')[0].toLowerCase();
        const firstNameB = b.displayName.split(' ')[0].toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      } 
      else if (sortOption === 'last-name') {
        // For guests with ampersands, only use the part before the ampersand for sorting
        const getLastName = (fullName: string) => {
          // Extract the first person's name (before any ampersand)
          const firstPersonName = fullName.split('&')[0].trim();
          // Get the last word as the last name
          const words = firstPersonName.split(' ');
          return words[words.length - 1].toLowerCase();
        };
        
        const lastNameA = getLastName(a.displayName);
        const lastNameB = getLastName(b.displayName);
        
        return lastNameA.localeCompare(lastNameB);
      }
      else if (sortOption === 'current-table') {
        // Sort by current table assignment in the currently active plan
        if (state.seatingPlans.length === 0) {
          return 0; // No sorting if no plans
        }
        
        // Use the currently viewed plan
        const plan = state.seatingPlans[state.currentPlanIndex];
        let tableA = Number.MAX_SAFE_INTEGER;  // Default to high value for unassigned
        let tableB = Number.MAX_SAFE_INTEGER;
        let foundA = false;
        let foundB = false;
        
        // Find which table each guest is assigned to by checking assignments
        for (const [tableId, guestIds] of Object.entries(plan.assignments)) {
          if (guestIds.includes(a.id)) {
            tableA = parseInt(tableId);
            foundA = true;
          }
          if (guestIds.includes(b.id)) {
            tableB = parseInt(tableId);
            foundB = true;
          }
          // Exit early if both found
          if (foundA && foundB) break;
        }
        
        // Sort unassigned guests last
        if (!foundA && foundB) return 1;
        if (foundA && !foundB) return -1;
        
        return tableA - tableB;
      }
      return 0;
    });
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      {/* Vimeo Video Section - Only for new users */}
      {isNewUser && (
        <div className="bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg shadow-sm border border-[#88abc6] w-full">
          <div className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-[#f899c2]">Welcome to Seatyr!</h2>
              <button
                onClick={toggleVideo}
                className="text-sm text-amber-700 hover:text-amber-900 font-medium flex items-center"
              >
                {isVideoVisible ? (
                  <>
                    <X className="w-4 h-4 mr-1" />
                    Hide Section
                  </>
                ) : (
                  <>
                    Show Video
                  </>
                )}
              </button>
            </div>
            
            {isVideoVisible ? (
              <div className="space-y-4" style={{ maxHeight: '280px' }}>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  <div className="lg:col-span-1 space-y-4">
                    <div className="bg-blue-50 rounded-lg shadow-sm border border-[#586D78] p-4 h-full flex flex-col justify-center" style={{ maxHeight: '280px' }}>
                      <h3 className="text-lg font-medium text-[#586D78] mb-3">For First-Time Users: 3 Easy Steps</h3>
                      <div className="text-[#586d78] space-y-2">
                        <ol className="list-decimal list-inside space-y-2 text-sm">
                          <li>Paste and add your guest list.</li>
                          <li>Click the "Your Rules" button above.</li>
                          <li>Choose who "Must" vs. "Cannot" sit together.</li>
                        </ol>
                        <p className="text-sm font-medium">See viable seating plan options!</p>
                      </div>
                    </div>
                  </div>
                  <div className="lg:col-span-2 aspect-video bg-gray-100 rounded-lg overflow-hidden" style={{ maxHeight: '280px' }}>
                    <iframe
                      src="https://player.vimeo.com/video/1085961997?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=1&muted=1&loop=1&title=0&byline=0&portrait=0"
                      className="w-full h-full"
                      frameBorder="0"
                      allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media; web-share"
                      referrerPolicy="strict-origin-when-cross-origin"
                      title="Seatyr.com — Designed by Corpania Consulting"
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-2">
                <button
                  onClick={() => setIsVideoVisible(true)}
                  className="px-4 py-2 bg-[#75828c] text-white rounded-md hover:bg-[#75828c]/80 font-medium"
                >
                  Show Video
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Guest Input Section */}
      <div className="bg-white rounded-lg shadow-sm border border-[#586D78]">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-semibold text-[#586D78] flex items-center">
              <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
              </svg>
              Guest Manager
            </h2>
            <div className="text-sm text-[#586D78]">
              {state.guests.length > 0 && (
                <span>
                  Free plan: {totalGuestCount}/80 guests used
                </span>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="text-gray-700 mb-2">
                Enter guest names separated by commas or line breaks. Connect couples and parties with an ampersand (&).
              </p>
              <textarea
                id="guest-input"
                className="w-full h-32 border border-[#586D78] rounded-md px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                placeholder="e.g., Alice, Bob&#10;Carol & David"
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={onParse}
                disabled={!raw.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border border-[#586D78] transition-all duration-200 hover:scale-105 hover:shadow-lg hover:shadow-sky-400/50"
              >
                + Add
              </button>
              <button
                onClick={loadSample}
                className="danstyle1c-btn"
              >
                Load Test Guest List
              </button>
              <button
                onClick={importGuests}
                className="danstyle1c-btn"
              >
                <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
                Upload Guests & Settings
              </button>
              {state.guests.length > 0 && (
                <button
                  onClick={clearGuests}
                  className="danstyle1c-btn danstyle1c-remove"
                >
                  Clear All
                </button>
              )}
            </div>
          </div>

          {warnings.length > 0 && (
            <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <h3 className="font-medium text-yellow-800 mb-2">Parser Warnings</h3>
              <ul className="list-disc list-inside space-y-1 text-sm text-yellow-700">
                {warnings.map((w, i) => <li key={i}>{w}</li>)}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Current Guest List */}
      {state.guests.length > 0 ? (
        <div className="bg-white rounded-lg shadow-sm border border-[#586D78]">
          <div className="p-6">
            <h3 className="text-lg font-medium text-[#586D78] mb-4">Guest List ({state.guests.length}/80)</h3>
            <div className="mb-4">
              <span className="text-sm text-[#586D78] mr-3">Sort:</span>
              <div className="inline-flex space-x-2">
                <button 
                  onClick={() => setSortOption('as-entered')}
                  className={`danstyle1c-btn ${sortOption === 'as-entered' ? 'selected' : ''}`}
                >
                  As Entered
                </button>
                <button 
                  onClick={() => setSortOption('first-name')}
                  className={`danstyle1c-btn ${sortOption === 'first-name' ? 'selected' : ''}`}
                >
                  First Name
                </button>
                <button 
                  onClick={() => setSortOption('last-name')}
                  className={`danstyle1c-btn ${sortOption === 'last-name' ? 'selected' : ''}`}
                >
                  Last Name
                </button>
                <button 
                  onClick={() => setSortOption('current-table')}
                  className={`danstyle1c-btn ${sortOption === 'current-table' ? 'selected' : ''}`}
                >
                  Current Table
                </button>
              </div>
            </div>
            <div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {getSortedGuests().map((guest, index) => (
                  <div key={guest.id} className="p-3 bg-gray-50 rounded-md border border-[#586D78]">
                    <div className="flex items-center justify-between">
                      <div className="font-medium text-[#586D78]">
                        {editingGuestId === guest.id ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editingGuestName}
                              onChange={(e) => setEditingGuestName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  saveEditGuest(guest.id);
                                } else if (e.key === 'Escape') {
                                  cancelEditGuest();
                                }
                              }}
                              onBlur={() => saveEditGuest(guest.id)}
                              className="px-2 py-1 border border-[#586D78] rounded text-sm"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <span onClick={() => startEditGuest(guest)} className="cursor-pointer hover:text-[#586D78]/80">
                            {index + 1}. {guest.displayName}
                          </span>
                        )}
                      </div>
                      <div className="flex space-x-1">
                        <button 
                          className="p-1 text-gray-500 hover:text-gray-700 transition-all duration-200"
                          onClick={() => startEditGuest(guest)}
                          title="Click to edit guest name"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        </button>
                        <button className="p-1 text-[#cd1c17] hover:text-red-700 transition-all duration-200">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="text-sm text-gray-600">
                      {guest.count} {guest.count === 1 ? 'person' : 'people'}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-sm border border-[#586D78]">
          <div className="p-12 text-center">
            <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-[#586D78] mb-2">No guests added yet</h3>
            <p className="text-gray-600 mb-4">
              Start by entering guest names above, or load a sample to get started.
            </p>
            <button
              onClick={loadSample}
              className="danstyle1c-btn"
            >
              Load Sample Data
            </button>
          </div>
        </div>
      )}

      {/* Saved Settings Accordion - Below Guest List */}
      <SavedSettingsAccordion />

      {/* Note Section */}
      <div className="bg-blue-50 rounded-lg shadow-sm border border-blue-200">
        <div className="p-4">
          <div className="flex items-start">
            <svg className="w-5 h-5 text-[#75828b] mt-0.5 mr-2 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <div>
              <h3 className="text-sm font-medium text-[#75828b] mb-1">NOTE:</h3>
              <p className="text-sm text-[#75828b]">
                For names with 3 or more words (e.g., "Tatiana Sokolov Boyko", "Jan Tomasz Kowalski Nowak", "Angel Alba Salavador Costa Almeida"), if you want one of those surnames (other than the "last" word of the last name) to be the alphabetical sorting word "By Last Name" then put a percentage symbol (%) before that name. Examples: "Tatiana %Sokolov Boyko", "Jan Tomasz %Kowalski Nowak", "Angel Alba Salavador %Costa Almeida"
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Favorite Sites Section */}
      <div className="bg-[#fef4cd] rounded-lg shadow-sm border border-amber-200">
        <div className="p-4">
          <h3 className="text-lg font-medium text-[#586D78] mb-3">Seatyr's Favorite Sites — August 2025:</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-2">
              <a href="https://Zingermans.com" className="block text-[#586D78] hover:text-[#586D78]/80">https://Zingermans.com</a>
              <a href="https://Zabars.com" className="block text-[#586D78] hover:text-[#586D78]/80">https://Zabars.com</a>
            </div>
            <div className="space-y-2">
              <a href="https://BigBobGibson.com" className="block text-[#586D78] hover:text-[#586D78]/80">https://BigBobGibson.com</a>
              <a href="https://linktr.ee/immortalitybytes" className="block text-[#586D78] hover:text-[#586D78]/80">https://linktr.ee/immortalitybytes</a>
            </div>
            <div className="space-y-2">
              <a href="https://HubermanLab.com" className="block text-[#586D78] hover:text-[#586D78]/80">https://HubermanLab.com</a>
              <a href="https://MadGreens.com" className="block text-[#586D78] hover:text-[#586D78]/80">https://MadGreens.com</a>
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% {
            background-position: 0% 50%;
            transform: scale(1);
          }
          50% {
            background-position: 100% 50%;
            transform: scale(1.2);
          }
        }
        
        .radiating-gradient {
          position: absolute;
          inset: -50px;
          background: linear-gradient(45deg, #00CED1, #32CD32, #FFFF00, #FFA500);
          background-size: 400% 400%;
          animation: pulse 2s ease-in-out infinite;
          border-radius: 0.5rem;
          z-index: -1;
        }
      `}</style>
    </div>
  );
};

export default GuestManager;