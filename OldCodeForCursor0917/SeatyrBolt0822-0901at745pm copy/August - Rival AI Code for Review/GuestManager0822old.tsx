      const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
      
      const totalGuestCount = countTotalIndividuals(guestUnits);
      const currentGuestCount = state.guests.reduce((sum, g) => sum + g.count, 0);
      
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
        clearDuplicateWarnings();
      }
      
      if (uniqueGuests.length > 0) {
        saveStateForUndo();
        dispatch({ type: 'ADD_GUESTS', payload: uniqueGuests });
        purgeSeatingPlans();
      } else if (newDuplicates.length > 0) {
        setImportError('All test guests are duplicates of existing guests.');
      }
    } catch (error) {
      setImportError(`Error loading test guests: ${error.message}`);
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
  
  const handleCloseDuplicateWarning = () => {
    clearDuplicateWarnings();
  };

  const getSortedGuests = () => {
    if (sortOption === 'as-entered') {
      return [...state.guests];
    }
    
    return [...state.guests].sort((a, b) => {
      if (sortOption === 'first-name') {
        const firstNameA = a.name.split(' ')[0].toLowerCase();
        const firstNameB = b.name.split(' ')[0].toLowerCase();
        return firstNameA.localeCompare(firstNameB);
      } 
      else if (sortOption === 'last-name') {
        const getLastName = (fullName: string) => {
          const firstPersonName = fullName.split('&')[0].trim();
          return getLastNameForSorting(firstPersonName).toLowerCase();
        };
        
        const lastNameA = getLastName(a.name);
        const lastNameB = getLastName(b.name);
        
        return lastNameA.localeCompare(lastNameB);
      }
      else if (sortOption === 'current-table') {
        if (state.seatingPlans.length === 0) {
          return 0;
        }
        
        const plan = state.seatingPlans[state.currentPlanIndex];
        let tableA = Number.MAX_SAFE_INTEGER;
        let tableB = Number.MAX_SAFE_INTEGER;
        let foundA = false;
        let foundB = false;
        
        for (const table of plan.tables) {
          for (const seat of table.seats) {
            if (seat.name === a.name) {
              tableA = table.id;
              foundA = true;
            }
            if (seat.name === b.name) {
              tableB = table.id;
              foundB = true;
            }
            if (foundA && foundB) break;
          }
          if (foundA && foundB) break;
        }
        
        if (!foundA && foundB) return 1;
        if (foundA && !foundB) return -1;
        
        return tableA - tableB;
      }
      return 0;
    });
  };

  const handleRefreshSavedSettings = () => {
    fetchSavedSettings();
  };

  // Check premium status and calculations
  const isPremium = isPremiumSubscription(subscription);
  const showUpgradePrompt = !isPremium && state.guests.length >= 70;
  const sortedGuests = getSortedGuests();
  
  const maxGuestLimit = getMaxGuestLimit(subscription);
  const guestPercentage = isPremium ? 0 : Math.min(100, Math.round((state.guests.length / maxGuestLimit) * 100));
  const isApproachingLimit = !isPremium && state.guests.length >= maxGuestLimit * 0.8;

  const tableInfo = canReduceTables(state.guests, state.tables);

  const handleDismissReduceNotice = () => {
    setShowReduceTablesNotice(false);
    dispatch({ type: 'HIDE_TABLE_REDUCTION_NOTICE' });
  };

  return (
    <div className="space-y-6">
      {/* Video Section */}
      <div className="bg-white rounded-lg shadow-md overflow-hidden">
        {videoVisible ? (
          <div className="relative">
            <div className="relative w-full pt-[37.5%] overflow-hidden">
              <iframe
                ref={videoRef}
                src={`https://player.vimeo.com/video/1085961997?badge=0&autopause=0&player_id=0&app_id=58479&autoplay=${!user ? '1' : '0'}&muted=1&loop=1&dnt=1`}
                allow="autoplay; fullscreen; picture-in-picture; clipboard-write; encrypted-media"
                title="SeatyrBannerV1cVideo"
                className="absolute top-0 left-0 w-full h-full"
              />
            </div>
            <button 
              onClick={toggleVideo}
              className="danstyle1c-btn absolute top-2 right-2"
              aria-label="Hide video section"
            >
              <X className="w-4 h-4 mr-2" />
              Hide Section
            </button>
          </div>
        ) : (
          <div className="p-4 flex justify-between items-center">
            <h3 className="text-lg font-medium text-[#586D78]">Quick Overview Intro</h3>
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

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[#586D78] flex items-center">
          <Users className="mr-2" />
          Guest Manager
          {isPremium && state.user && (
            <span className="flex items-center danstyle1c-btn danstyle1c-premium ml-2">
              <Crown className="w-4 h-4 mr-1" />
              Premium
            </span>
          )}
        </h1>
        
        {/* Undo/Redo Controls */}
        <div className="flex space-x-2">
          <button
            onClick={undo}
            disabled={!canUndo}
            className={`danstyle1c-btn ${!canUndo ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Undo last action"
          >
            <Undo className="w-4 h-4 mr-1" />
            Undo
          </button>
          <button
            onClick={redo}
            disabled={!canRedo}
            className={`danstyle1c-btn ${!canRedo ? 'opacity-50 cursor-not-allowed' : ''}`}
            title="Redo last undone action"
          >
            <Redo className="w-4 h-4 mr-1" />
            Redo
          </button>
        </div>
      </div>
      
      <div className="flex items-start justify-between gap-4">
        <div className="flex-grow space-y-6">
          <Card>
            <div className="space-y-4">
              <div>
                <p className="text-gray-700 text-[17px]">Enter guest names separated by commas or line breaks.</p>
                <p className="text-gray-700 text-[17px]">Connect couples and parties with an ampersand (&).</p>
                
                {!isPremium && (
                  <div className={`mt-2 ${isApproachingLimit ? 'text-amber-600 font-medium' : 'text-sm text-[#586D78]'}`}>
                    <p>Free plan: {getGuestLimitMessage(subscription, state.guests.length)}</p>
                    {isApproachingLimit && (
                      <div className="w-full bg-gray-200 rounded-full h-2 mt-1">
                        <div 
                          className={`h-2 rounded-full ${
                            guestPercentage >= 95 ? 'bg-red-500' : 
                            guestPercentage >= 80 ? 'bg-amber-500' : 
                            'bg-green-500'
                          }`}
                          style={{ width: `${guestPercentage}%` }}
                        ></div>
                      </div>
                    )}
                  </div>
                )}
                
                {isPremium && state.user && (
                  <p className="text-sm text-green-600 mt-2">
                    Premium plan: Unlimited guests
                  </p>
                )}
              </div>
              
              {/* Over-capacity warning */}
              {overCapacityGuests.length > 0 && (
                <div className="p-3 bg-orange-50 border border-orange-200 rounded-md">
                  <div className="flex items-start">
                    <AlertCircle className="text-orange-600 mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-orange-700 font-medium">Large Guest Units Detected</p>
                      <p className="text-orange-600 text-sm">
                        The following guest units have more than 8 people and may be difficult to seat:
                      </p>
                      <ul className="text-orange-600 text-sm mt-1 list-disc pl-5">
                        {overCapacityGuests.map((name, index) => {
                          const guest = state.guests.find(g => g.name === name);
                          return (
                            <li key={index}>{name} ({guest?.count} people)</li>
                          );
                        })}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
              
              {/* Duplicate guest warning */}
              {showDuplicateWarning && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md relative">
                  <div className="flex items-start pr-8">
                    <AlertCircle className="text-amber-600 mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-amber-700 font-medium">Duplicate Guest Names Detected</p>
                      <p className="text-amber-600 text-sm">
                        The following names already exist in your guest list and were not added:
                      </p>
                      <ul className="text-amber-600 text-sm mt-1 list-disc pl-5">
                        {duplicateGuests.map((name, index) => (
                          <li key={index}>{name}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                  <button
                    className="absolute top-2 right-2 text-amber-600 hover:text-amber-800"
                    onClick={handleCloseDuplicateWarning}
                    aria-label="Close warning"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              )}
              
              {/* Input validation error */}
              {inputValidationError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-md">
                  <div className="flex items-start">
                    <AlertCircle className="text-red-600 mr-2 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-red-700 font-medium">Input Error</p>
                      <p className="text-red-600 text-sm">{inputValidationError}</p>
                    </div>
                  </div>
                </div>
              )}
              
              <div className="flex flex-col sm:flex-row space-y-2 sm:space-y-0 sm:space-x-2">
                <textarea
                  value={guestInput}
                  onChange={(e) => {
                    setGuestInput(e.target.value);
                    // Clear errors when input changes
                    if (duplicateGuests.length > 0) {
                      clearDuplicateWarnings();
                    }
                    if (inputValidationError) {
                      setInputValidationError(null);
                    }
                  }}
                  placeholder="e.g., Alice, Bob&#13;&#10;Carol & David"
                  className="flex-1 px-3 py-2 border border-[#586D78] border-[1.5px] rounded-md focus:outline-none focus:ring-2 focus:ring-[#586D78] min-h-[100px]"
                  onKeyDown={(e) => e.key === 'Enter' && e.ctrlKey && handleAddGuests()}
                />
                <button
                  onClick={handleAddGuests}
                  className="danstyle1c-btn"
                  disabled={!isPremium && state.guests.length >= maxGuestLimit}
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Add
                </button>
              </div>
              
              {importError && (
                <div className="text-red-600 text-sm mt-2">{importError}</div>
              )}
              
              <div className="flex space-x-2">
                <button
                  onClick={loadTestGuestList}
                  className={`danstyle1c-btn ${!user ? 'visitor-test-button' : ''}`}
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
                  className="danstyle1c-btn"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  Upload Guests & Settings
                </button>
              </div>
              
              {!isPremium && state.guests.length >= maxGuestLimit && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-md">
                  <p className="text-amber-700 font-medium">
                    You've reached the guest limit of {maxGuestLimit} for free accounts. 
                    Upgrade to Premium for unlimited guests.
                  </p>
                </div>
              )}
            </div>
          </Card>
        </div>
        
        {/* Table Reduction Notice */}
        {showReduceTablesNotice && (
          <div className="w-5/12 bg-amber-50 border border-amber-200 rounded-md p-4">
            <div className="flex justify-between items-start">
              <h3 className="text-amber-700 font-medium">Table Reduction Available</h3>
              <button
                onClick={handleDismissReduceNotice}
                className="danstyle1c-btn"
                aria-label="Dismiss notice"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="space-y-2 mt-2">
              <p className="text-amber-700">
                <strong>Current Number of Tables:</strong> {state.tables.length}
              </p>
              <div className="border-t border-amber-200 my-2"></div>
              <p className="text-amber-700">
                <strong>Possible Minimum Number of Tables:</strong> {tableInfo.minTablesNeeded}
              </p>
            </div>
            <div className="flex space-x-2 mt-3">
              <button
                className="danstyle1c-btn"
                onClick={() => navigate('/tables')}
              >
                Go to Table Manager
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Saved Settings Section */}
      <button
        className="danstyle1c-btn w-full flex justify-between items-center"
        onClick={() => {
          if (!showSavedSettings && user) {
            fetchSavedSettings();
          }
          setShowSavedSettings(!showSavedSettings);
        }}
      >
        <span><FolderOpen className="w-4 h-4 mr-2 inline-block" /> Saved Settings</span>
        {showSavedSettings ? (
          <ChevronUp className="w-4 h-4" />
        ) : (
          <ChevronDown className="w-4 h-4" />
        )}
      </button>

      {showSavedSettings && (
        <Card>
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-medium text-[#586D78]">Saved Configurations</h2>
            <div className="flex space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={handleRefreshSavedSettings}
                disabled={loadingSavedSettings}
              >
                {loadingSavedSettings ? <RefreshCw className="w-4 h-4 animate-spin mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                {loadingSavedSettings ? 'Refreshing...' : 'Refresh'}
              </button>
              <button
                onClick={() => setShowSavedSettings(false)}
                className="danstyle1c-btn"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

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
            <div className="space-y-4 max-h-[400px] overflow-y-auto">
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

          <div className="flex justify-end mt-4">
            <button
              className="danstyle1c-btn"
              onClick={() => setShowSavedSettings(false)}
            >
              Collapse Section
            </button>
          </div>
        </Card>
      )}
      
      {/* Guest List */}
      <Card 
        title={
          <div className="w-full flex items-center justify-between">
            <span>Guest List ({state.guests.length}{!isPremium ? '/80' : ''})</span>
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
                const isOverCapacity = guest.count > 8;
                
                return (
                  <div 
                    key={`${guest.name}-${index}`}
                    className={`border rounded-lg p-4 flex flex-col items-start bg-white shadow ${
                      isOverCapacity ? 'border-orange-300 bg-orange-50' : 'border-[#586D78] border-[0.5px]'
                    }`}
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
                        {guest.name.includes('%') ? (
                          <>
                            {guest.name.split('%')[0]}
                            <span style={{ color: '#959595' }}>%</span>
                            {guest.name.split('%')[1]}
                          </>
                        ) : guest.name}
                        <Edit2 className="w-3 h-3 ml-1 text-gray-400 cursor-pointer" 
                            onClick={() => handleRenameGuest(originalIndex, guest.name)} />
                      </span>
                    )}

                    {guest.count > 1 && (
                      <span className={`text-sm font-medium mt-1 ${
                        isOverCapacity ? 'text-orange-700' : 'text-gray-700'
                      }`}>
                        Party size: {guest.count} {guest.count === 2 ? 'people' : 'people'}
                        {isOverCapacity && (
                          <span className="text-orange-600 ml-1">(Large group)</span>
                        )}
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
          Seatyr's Favorite Sites — June 2025:
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
            <li><a href="https://HubermanLab.com" target="_blank" rel="noopener noreferrer">https://HubermanLab.com</a></li>
            <li><a href="https://MadGreens.com" target="_blank" rel="noopener noreferrer">https://MadGreens.com</a></li>
          </ul>
        </div>
      </div>

      {/* Modals */}
      
      {/* Clear Confirmation Modal */}
      {showClearConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Confirm Clear Guest List</h3>
            <p className="text-gray-700 mb-6">
              This will remove all guests and reset all constraints, assignments, and seating plans. You can undo this action if needed.
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

      {/* Upload Confirmation Modal */}
      {showUploadConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Confirm Data Upload</h3>
            <p className="text-gray-700 mb-6">
              This upload contains a complete configuration that will replace your current guest list, tables, and constraints. 
              Your current data will be saved for undo. Do you want to proceed?
            </p>
            <div className="flex justify-end space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={cancelUpload}
              >
                Cancel
              </button>
              <button
                className="danstyle1c-btn"
                onClick={confirmUpload}
              >
                Replace Current Data
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Limit Warning Modal */}
      {showLimitWarning && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 max-w-md w-full shadow-2xl">
            <h3 className="text-xl font-bold mb-4">Guest Limit Reached</h3>
            <p className="text-gray-700 mb-6">
              The guest list for free accounts cannot go beyond the 80-guest maximum limit. Upgrade to premium to arrange more than 80 guests and get to save up to 50 seating plans.
            </p>
            <div className="flex justify-end space-x-2">
              <button
                className="danstyle1c-btn"
                onClick={() => setShowLimitWarning(false)}
              >
                Cancel
              </button>
              <button
                onClick={handleUpgrade}
                className="danstyle1c-btn"
              >
                Upgrade to Premium
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Auth Modal */}
      {showAuthModal && (
        <AuthModal onClose={() => setShowAuthModal(false)} />
      )}
    </div>
  );
};

export default GuestManager;import React, { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, Edit2, Users, Upload, Crown, ArrowDownAZ, AlertCircle, ChevronDown, ChevronUp, FolderOpen, ArrowRight, X, Play, RefreshCw, Info, Undo, Redo } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import AuthModal from '../components/AuthModal';
import { useApp } from '../components/AppContext';
import { supabase } from '../lib/supabase';
import { redirectToCheckout } from '../lib/stripe';
import { isPremiumSubscription, getMaxGuestLimit, getGuestLimitMessage } from '../utils/premium';
import { clearRecentSessionSettings } from '../lib/sessionSettings';
import { getLastNameForSorting } from '../utils/formatters';
import { canReduceTables } from '../utils/tables';
import { useNavigate } from 'react-router-dom';
import { 
  parseGuest, 
  parseGuestInput, 
  validateGuestName, 
  GuestUnit, 
  formatGuestForDisplay,
  countTotalIndividuals 
} from '../utils/guestParser';

// Sort options
type SortOption = 'as-entered' | 'first-name' | 'last-name' | 'current-table';

// SSR-safe localStorage access
const safeLocalStorage = {
  getItem: (key: string): string | null => {
    if (typeof window === 'undefined') return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Silently fail if localStorage is not available
    }
  },
  removeItem: (key: string): void => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.removeItem(key);
    } catch {
      // Silently fail if localStorage is not available
    }
  }
};

const GuestManager: React.FC = () => {
  const { state, dispatch, canUndo, canRedo, undo, redo, saveStateForUndo } = useApp();
  const [guestInput, setGuestInput] = useState('');
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showUploadConfirm, setShowUploadConfirm] = useState(false);
  const [pendingUploadData, setPendingUploadData] = useState<any>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [showLimitWarning, setShowLimitWarning] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [inputValidationError, setInputValidationError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sortOption, setSortOption] = useState<SortOption>('as-entered');
  const [showReduceTablesNotice, setShowReduceTablesNotice] = useState(false);
  const navigate = useNavigate();
  const [editingGuestId, setEditingGuestId] = useState<number | null>(null);
  const [editingGuestName, setEditingGuestName] = useState('');
  
  // Duplicate guest state
  const [localDuplicateGuests, setLocalDuplicateGuests] = useState<string[]>([]);
  const duplicateGuests = state.duplicateGuests || localDuplicateGuests;
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  
  // Saved settings state
  const [showSavedSettings, setShowSavedSettings] = useState(false);
  const [savedSettings, setSavedSettings] = useState<any[]>([]);
  const [loadingSavedSettings, setLoadingSavedSettings] = useState(false);
  const [savedSettingsError, setSavedSettingsError] = useState<string | null>(null);
  const [realtimeSubscription, setRealtimeSubscription] = useState<any>(null);

  // Video section state
  const [videoVisible, setVideoVisible] = useState(true);
  const videoRef = useRef<HTMLIFrameElement>(null);
  
  // Over-capacity warning state
  const [overCapacityGuests, setOverCapacityGuests] = useState<string[]>([]);
  
  const { user, subscription } = state;
  
  // Check if tables can be reduced
  useEffect(() => {
    const tableInfo = canReduceTables(state.guests, state.tables);
    setShowReduceTablesNotice(tableInfo.canReduce && !state.hideTableReductionNotice);
  }, [state.guests, state.tables, state.hideTableReductionNotice]);
  
  // Guest limit enforcement for non-premium users
  useEffect(() => {
    if (!isPremiumSubscription(subscription)) {
      const maxGuests = getMaxGuestLimit(subscription);
      
      if (state.guests.length > maxGuests) {
        console.log(`Trimming guest list from ${state.guests.length} to ${maxGuests} (free user limit)`);
        const trimmedGuests = state.guests.slice(0, maxGuests);
        
        dispatch({ type: 'SET_GUESTS', payload: trimmedGuests });
        alert(`Your guest list has been trimmed to ${maxGuests} guests (free user limit). Upgrade to Premium for unlimited guests.`);
      }
    }
  }, [subscription, state.guests.length, dispatch]);

  // Fetch saved settings when user changes
  useEffect(() => {
    if (user) {
      fetchSavedSettings();
    } else {
      setSavedSettings([]);
    }
  }, [user]);

  // Real-time subscription for saved settings
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
  }, [user]);

  // Update duplicate warning state
  useEffect(() => {
    const hasWarnings = duplicateGuests && duplicateGuests.length > 0;
    setShowDuplicateWarning(hasWarnings);
  }, [duplicateGuests]);

  // Check for over-capacity guest units
  useEffect(() => {
    const overCapacity = state.guests.filter(guest => guest.count > 8);
    setOverCapacityGuests(overCapacity.map(g => g.name));
  }, [state.guests]);

  // Video visibility management
  useEffect(() => {
    const userIsLoggedIn = !!user;
    
    if (userIsLoggedIn) {
      setVideoVisible(false);
    } else {
      setVideoVisible(true);
      
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
    
    const savedPreference = safeLocalStorage.getItem('seatyr_video_visible');
    if (savedPreference !== null) {
      setVideoVisible(savedPreference === 'true');
    } else {
      safeLocalStorage.setItem('seatyr_video_visible', userIsLoggedIn ? 'false' : 'true');
    }
  }, [user]);

  const toggleVideo = () => {
    const newVisibility = !videoVisible;
    setVideoVisible(newVisibility);
    safeLocalStorage.setItem('seatyr_video_visible', newVisibility.toString());
    
    if (newVisibility && videoRef.current) {
      const iframe = videoRef.current;
      const currentSrc = iframe.src;
      if (currentSrc.includes('autoplay=0')) {
        iframe.src = currentSrc.replace('autoplay=0', 'autoplay=1');
      } else if (!currentSrc.includes('autoplay=1')) {
        iframe.src = currentSrc + (currentSrc.includes('?') ? '&' : '?') + 'autoplay=1';
      }
    }
  };

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

  // Enhanced file upload with confirmation prompt
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      try {
        parseFileContent(content, true); // true indicates this is a file upload
      } catch (error) {
        console.error('Error parsing file:', error);
        setImportError('Invalid file format. Please ensure it\'s a CSV file with the correct format.');
      }

      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    };

    reader.readAsText(file);
  };

  // Parse file content with upload confirmation
  const parseFileContent = (content: string, isFileUpload: boolean = false) => {
    const lines = content.split('\n');
    let configData = null;

    // Look for configuration data
    const configIndex = lines.findIndex(line => line.includes('CONFIGURATION DATA'));
    if (configIndex !== -1) {
      const configSection = lines.slice(configIndex + 1).join('\n');
      const jsonStart = configSection.indexOf('{');
      if (jsonStart !== -1) {
        configData = JSON.parse(configSection.substring(jsonStart));
      }
    }

    if (configData?.version && configData?.guests) {
      // This is a full configuration import
      if (isFileUpload && state.guests.length > 0) {
        // Show confirmation prompt for file uploads that would replace existing data
        setPendingUploadData(configData);
        setShowUploadConfirm(true);
        return;
      }
      
      processFullConfigImport(configData);
    } else {
      // Parse as guest list
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
        processGuestListImport(guests);
      } else {
        throw new Error('No valid guest data found');
      }
    }
  };

  // Process full configuration import
  const processFullConfigImport = (configData: any) => {
    // Ensure table structure is complete
    if (configData.tables) {
      configData.tables = configData.tables.map(table => {
        if (!table.hasOwnProperty('seats')) {
          return { ...table, seats: 8 };
        }
        return table;
      });
    }
    
    if (!configData.hasOwnProperty('userSetTables')) {
      configData.userSetTables = true;
    }
    
    // Check guest limit
    const totalGuests = configData.guests.length;
    const isPremium = isPremiumSubscription(subscription);
    const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
    
    if (totalGuests > maxGuestLimit && !isPremium) {
      setShowLimitWarning(true);
      return;
    }
    
    // Clear warnings and save state for undo
    clearDuplicateWarnings();
    saveStateForUndo();
    
    // Clear recent session settings
    if (isPremium && user) {
      clearRecentSessionSettings(user.id, true);
    }
    
    // Import configuration
    dispatch({ type: 'IMPORT_STATE', payload: configData });
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
    setGuestInput('');
    setImportError(null);
    purgeSeatingPlans();
  };

  // Process guest list import
  const processGuestListImport = (guests: { name: string; count: number }[]) => {
    const isPremium = isPremiumSubscription(subscription);
    const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
    
    const totalGuestCount = guests.reduce((sum, g) => sum + g.count, 0);
    const currentGuestCount = state.guests.reduce((sum, g) => sum + g.count, 0);
    
    if (currentGuestCount + totalGuestCount > maxGuestLimit && !isPremium) {
      setShowLimitWarning(true);
      return;
    }
    
    // Check for duplicates
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
      clearDuplicateWarnings();
    }
    
    if (uniqueGuests.length > 0) {
      saveStateForUndo();
      dispatch({ type: 'ADD_GUESTS', payload: uniqueGuests });
      setGuestInput('');
      setImportError(null);
      purgeSeatingPlans();
    } else if (newDuplicates.length > 0) {
      setImportError('All guests in the file are duplicates of existing guests.');
    }
  };

  // Enhanced guest input parsing with validation
  const handleAddGuests = () => {
    if (!guestInput.trim()) return;
    
    // Clear previous validation errors
    setInputValidationError(null);
    
    try {
      const guestUnits = parseGuestInput(guestInput);
      
      if (guestUnits.length === 0) {
        setInputValidationError('No valid guests found in input.');
        return;
      }
      
      // Convert to legacy format for compatibility
      const newGuests = guestUnits.map(unit => ({
        name: unit.name,
        count: unit.count,
        id: unit.id
      }));
      
      const isPremium = isPremiumSubscription(subscription);
      const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: 'active' } : null);
      
      const totalGuestCount = countTotalIndividuals(guestUnits);
      const currentGuestCount = state.guests.reduce((sum, g) => sum + g.count, 0);
      
      if (currentGuestCount + totalGuestCount > maxGuestLimit && !isPremium) {
        setShowLimitWarning(true);
        return;
      }
      
      // Check for duplicates
      const currentGuestNames = state.guests.map(g => g.name.toLowerCase());
      const newDuplicates: string[] = [];
      const uniqueGuests = [];
      const seenInNewGuests = new Set<string>();
      
      for (const guest of newGuests) {
        const lowerName = guest.name.toLowerCase();
        
        if (currentGuestNames.includes(lowerName)) {
          newDuplicates.push(guest.name);
        } else if (seenInNewGuests.has(lowerName)) {
          newDuplicates.push(guest.name);
        } else {
          uniqueGuests.push(guest);
          seenInNewGuests.add(lowerName);
        }
      }
      
      if (newDuplicates.length > 0) {
        setLocalDuplicateGuests(newDuplicates);
        dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: newDuplicates });
        setShowDuplicateWarning(true);
      } else {
        clearDuplicateWarnings();
      }
      
      if (uniqueGuests.length > 0) {
        saveStateForUndo();
        dispatch({ type: 'ADD_GUESTS', payload: uniqueGuests });
        setGuestInput('');
        setImportError(null);
        purgeSeatingPlans();
      } else if (newDuplicates.length > 0) {
        setInputValidationError('All entered guests are duplicates of existing guests.');
      }
      
    } catch (error) {
      setInputValidationError(`Invalid input: ${error.message}`);
    }
  };

  const handleLoadSetting = async (setting: any) => {
    try {
      if (!setting.data) {
        throw new Error('Saved setting data is missing or corrupted');
      }
      
      // Ensure table structure
      if (setting.data.tables) {
        setting.data.tables = setting.data.tables.map(table => {
          if (!table.hasOwnProperty('seats')) {
            return { ...table, seats: 8 };
          }
          return table;
        });
      }
      
      if (!setting.data.hasOwnProperty('userSetTables')) {
        setting.data.userSetTables = true;
      }
      
      // Save current state for undo
      saveStateForUndo();
      clearDuplicateWarnings();
      
      safeLocalStorage.setItem('seatyr_current_setting_name', setting.name);
      
      dispatch({ type: 'IMPORT_STATE', payload: setting.data });
      dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: true });
      
      setShowSavedSettings(false);
    } catch (err) {
      console.error('Error loading saved setting:', err);
      alert('Failed to load settings: ' + (err.message || 'Unknown error'));
    }
  };

  const purgeSeatingPlans = () => {
    dispatch({ type: 'SET_SEATING_PLANS', payload: [] });
    dispatch({ type: 'SET_CURRENT_PLAN_INDEX', payload: 0 });
    safeLocalStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    dispatch({ type: 'SET_LOADED_SAVED_SETTING', payload: false });
  };

  const clearDuplicateWarnings = () => {
    setLocalDuplicateGuests([]);
    dispatch({ type: 'SET_DUPLICATE_GUESTS', payload: [] });
    setShowDuplicateWarning(false);
  };

  const handleRemoveGuest = (index: number) => {
    saveStateForUndo();
    dispatch({ type: 'REMOVE_GUEST', payload: index });
    purgeSeatingPlans();
    clearDuplicateWarnings();
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
    
    // Validate the new name
    const validation = validateGuestName(editingGuestName.trim());
    if (!validation.isValid) {
      alert(`Cannot rename: ${validation.error}`);
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
    
    try {
      const parsedGuest = parseGuest(editingGuestName);
      
      saveStateForUndo();
      dispatch({
        type: 'RENAME_GUEST',
        payload: { index, name: parsedGuest.name, count: parsedGuest.count }
      });
      
      purgeSeatingPlans();
      clearDuplicateWarnings();
    } catch (error) {
      alert(`Cannot rename: ${error.message}`);
    }
    
    setEditingGuestId(null);
    setEditingGuestName('');
  };

  const handleClearGuestList = () => {
    setShowClearConfirm(true);
  };

  const confirmClearGuestList = () => {
    saveStateForUndo();
    dispatch({ type: 'CLEAR_GUESTS' });
    setShowClearConfirm(false);
    
    if (isPremiumSubscription(subscription) && user) {
      clearRecentSessionSettings(user.id, true);
    }
    
    safeLocalStorage.setItem('seatyr_current_setting_name', 'Unsaved');
    clearDuplicateWarnings();
  };

  const confirmUpload = () => {
    if (pendingUploadData) {
      processFullConfigImport(pendingUploadData);
      setPendingUploadData(null);
    }
    setShowUploadConfirm(false);
  };

  const cancelUpload = () => {
    setPendingUploadData(null);
    setShowUploadConfirm(false);
  };

  const loadTestGuestList = () => {
    const testList = "Ana, Benjamin, Chris, David, Elijah, Faith, Gabriel, Hassan, Ivan, Jordan, Kenji, Leah, Maria, Natalia, Olivia, Priya, Quinn, Reza, Sophia, Tom, Uma, Vanessa, William, Xin, Yosef, Zainab";
    
    try {
      const guestUnits = parseGuestInput(testList);
      const testGuests = guestUnits.map(unit => ({
        name: unit.name,
        count: unit.count,
        id: unit.id
      }));
      
      const isPremium = isPremiumSubscription(subscription);
      const maxGuestLimit = getMaxGuestLimit(isPremium ? { status: '