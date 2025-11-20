/**
 * Robust Data Persistence Utility
 * 
 * Provides multiple layers of data protection:
 * 1. localStorage (primary)
 * 2. IndexedDB (backup)
 * 3. File export/import (manual backup)
 * 4. Automatic recovery mechanisms
 */

import { AppState } from '../types';

const STORAGE_KEY = 'seatyr_app_state';
const LKG_KEY = 'seatyr_lkg'; // Last Known Good state
const STORAGE_HEALTH_CHECK_MS = 300000; // 5 minutes

/**
 * Atomic write to localStorage using .tmp pattern
 * Prevents corruption from interrupted writes
 */
function atomicLocalStorageWrite(key: string, data: any): boolean {
  try {
    const tmpKey = `${key}.tmp`;
    const serialized = JSON.stringify(data);
    
    // Step 1: Write to temp key
    localStorage.setItem(tmpKey, serialized);
    
    // Step 2: Verify temp write
    const verification = localStorage.getItem(tmpKey);
    if (verification !== serialized) {
      throw new Error('Temp write verification failed');
    }
    
    // Step 3: Atomic swap (copy temp to main)
    localStorage.setItem(key, verification);
    
    // Step 4: Cleanup temp
    localStorage.removeItem(tmpKey);
    
    return true;
  } catch (error) {
    console.error('[Persistence] Atomic write failed:', error);
    return false;
  }
}

/**
 * Recover from orphaned .tmp keys on boot (Modes Addendum Section 9)
 */
function recoverOrphanedTmpKeys(): void {
  try {
    const allKeys = Object.keys(localStorage);
    const tmpKeys = allKeys.filter(key => key.endsWith('.tmp'));
    
    tmpKeys.forEach(tmpKey => {
      const mainKey = tmpKey.slice(0, -4); // Remove '.tmp'
      const tmpData = localStorage.getItem(tmpKey);
      
      if (!tmpData) {
        localStorage.removeItem(tmpKey);
        return;
      }
      
      // Try parsing
      try {
        JSON.parse(tmpData);
        
        // Check if main key is missing or corrupt
        const mainData = localStorage.getItem(mainKey);
        if (!mainData) {
          console.log('[Persistence] Recovering from orphaned tmp key:', tmpKey);
          localStorage.setItem(mainKey, tmpData);
        }
      } catch {
        // Corrupt tmp, delete it
        console.warn('[Persistence] Deleting corrupt tmp key:', tmpKey);
      }
      
      localStorage.removeItem(tmpKey);
    });
  } catch (error) {
    console.error('[Persistence] Orphaned key recovery failed:', error);
  }
}

/**
 * Sanitize and migrate incoming app state
 * PURE FUNCTION - No app-level flags
 */
export function sanitizeAndMigrateAppState(incoming: any): Partial<AppState> {
  if (!incoming || typeof incoming !== 'object') {
    console.error('[sanitizeAndMigrateAppState] Invalid input:', incoming);
    return {};
  }

  const sanitized: Partial<AppState> = {
    guests: Array.isArray(incoming.guests)
      ? incoming.guests
          .filter((g: any) => g?.id && typeof g.name === 'string')
          .map((g: any) => ({
            id: String(g.id),
            name: String(g.name),
            count: Math.max(1, Number(g.count) || 1)
          }))
      : [],
    
    // REVISED: Coerce string seats, dedupe, stable validation
    tables: Array.isArray(incoming.tables)
      ? incoming.tables
          .map((t: any) => ({
            id: t?.id,
            seats: Number(t?.seats),
            name: typeof t?.name === 'string' ? t.name : undefined
          }))
          .filter((t: any) => t.id != null && Number.isFinite(t.seats) && t.seats > 0)
          .map((t: any) => ({
            id: String(t.id),
            seats: Math.max(1, Math.floor(t.seats)),
            name: t.name
          }))
      : [],
    
    // REVISED: Dedupe + stable sort for assignments
    assignments: typeof incoming.assignments === 'object' && incoming.assignments !== null
      ? Object.fromEntries(
          Object.entries(incoming.assignments).map(([guestId, raw]) => {
            const list = String(raw ?? '')
              .split(/[,\s]+/)
              .map(s => s.trim())
              .filter(Boolean)
              .map(String);
            const uniq = Array.from(new Set(list)).sort(); // stable, predictable
            return [String(guestId), uniq.join(',')];
          })
        )
      : {},
    
    constraints: typeof incoming.constraints === 'object' && incoming.constraints !== null
      ? Object.fromEntries(
          Object.entries(incoming.constraints).map(([g1, constraints]) => [
            String(g1),
            Object.fromEntries(
              Object.entries(constraints as any).map(([g2, value]) => [
                String(g2),
                ['must', 'cannot', ''].includes(String(value)) ? String(value) : ''
              ])
            )
          ])
        ) as any
      : {},
    
    adjacents: typeof incoming.adjacents === 'object' && incoming.adjacents !== null
      ? Object.fromEntries(
          Object.entries(incoming.adjacents).map(([g1, adj]) => [
            String(g1),
            Array.isArray(adj) ? adj.map(String) : []
          ])
        )
      : {},
    
    lockedTableAssignments: typeof incoming.lockedTableAssignments === 'object' && incoming.lockedTableAssignments !== null
      ? Object.fromEntries(
          Object.entries(incoming.lockedTableAssignments).map(([tableId, guestIds]) => [
            Number(tableId),
            Array.isArray(guestIds) ? guestIds.map(String) : []
          ])
        )
      : {},
    
    // NEW: Preserve or initialize sessionVersion
    sessionVersion: typeof incoming.sessionVersion === 'number' && incoming.sessionVersion >= 0
      ? incoming.sessionVersion
      : 0,
    
    // NEW: Preserve or default persistenceVersion
    persistenceVersion: typeof incoming.persistenceVersion === 'string'
      ? incoming.persistenceVersion
      : '1.0.0'
    
    // NO app-level flags here - let reducer set them
  };

  return sanitized;
}

/**
 * Save Last Known Good state after successful validation
 */
export function saveLKG(data: AppState): void {
  try {
    // Only save if data has guests (indicates valid session)
    if (data.guests && data.guests.length > 0) {
      localStorage.setItem(LKG_KEY, JSON.stringify({
        data,
        savedAt: new Date().toISOString(),
        sessionVersion: data.sessionVersion
      }));
      console.log('[Persistence] LKG saved, sessionVersion:', data.sessionVersion);
    }
  } catch (error) {
    console.warn('[Persistence] Failed to save LKG:', error);
  }
}

/**
 * Load Last Known Good state (Modes Addendum Section 5.1)
 */
export function loadLKG(): PersistenceResult {
  try {
    const lkgData = localStorage.getItem(LKG_KEY);
    if (!lkgData) {
      return { success: false, error: 'No LKG found' };
    }
    
    const parsed = JSON.parse(lkgData);
    console.log('[Persistence] LKG found:', {
      savedAt: parsed.savedAt,
      sessionVersion: parsed.sessionVersion,
      guests: parsed.data?.guests?.length
    });
    
    return { success: true, data: parsed.data };
  } catch (error) {
    console.error('[Persistence] LKG load failed:', error);
    return { success: false, error: String(error) };
  }
}

const BACKUP_KEY_PREFIX = 'seatyr_backup_';
const MAX_BACKUPS = 5;

// IndexedDB setup
const DB_NAME = 'SeatyrData';
const DB_VERSION = 1;
const STORE_NAME = 'appState';

interface BackupData {
  timestamp: string;
  data: AppState;
  version: string;
}

interface PersistenceResult {
  success: boolean;
  error?: string;
  data?: AppState;
}

/**
 * Initialize IndexedDB for backup storage
 */
async function initIndexedDB(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      
      request.onerror = () => {
        console.warn('[Persistence] IndexedDB not available:', request.error);
        resolve(null);
      };
      
      request.onsuccess = () => {
        resolve(request.result);
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'timestamp' });
        }
      };
    } catch (error) {
      console.warn('[Persistence] IndexedDB initialization failed:', error);
      resolve(null);
    }
  });
}

/**
 * Save data to IndexedDB as backup
 */
async function saveToIndexedDB(data: AppState): Promise<PersistenceResult> {
  try {
    const db = await initIndexedDB();
    if (!db) {
      return { success: false, error: 'IndexedDB not available' };
    }
    
    const backupData: BackupData = {
      timestamp: new Date().toISOString(),
      data,
      version: '1.0.0'
    };
    
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.put(backupData);
      
      request.onsuccess = () => {
        resolve({ success: true });
      };
      
      request.onerror = () => {
        resolve({ success: false, error: request.error?.message });
      };
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Load most recent data from IndexedDB
 */
async function loadFromIndexedDB(): Promise<PersistenceResult> {
  try {
    const db = await initIndexedDB();
    if (!db) {
      return { success: false, error: 'IndexedDB not available' };
    }
    
    return new Promise((resolve) => {
      const transaction = db.transaction([STORE_NAME], 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const request = store.getAll();
      
      request.onsuccess = () => {
        const backups = request.result as BackupData[];
        if (backups.length === 0) {
          resolve({ success: false, error: 'No backups found' });
          return;
        }
        
        // Get most recent backup
        const mostRecent = backups.sort((a, b) => 
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        )[0];
        
        resolve({ success: true, data: mostRecent.data });
      };
      
      request.onerror = () => {
        resolve({ success: false, error: request.error?.message });
      };
    });
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

/**
 * Create localStorage backup with timestamp
 */
function createLocalStorageBackup(data: AppState): void {
  try {
    const timestamp = new Date().toISOString();
    const backupKey = `${BACKUP_KEY_PREFIX}${timestamp}`;
    
    localStorage.setItem(backupKey, JSON.stringify(data));
    
    // Clean up old backups (keep only MAX_BACKUPS)
    const allKeys = Object.keys(localStorage);
    const backupKeys = allKeys
      .filter(key => key.startsWith(BACKUP_KEY_PREFIX))
      .sort()
      .reverse(); // Most recent first
    
    if (backupKeys.length > MAX_BACKUPS) {
      const keysToDelete = backupKeys.slice(MAX_BACKUPS);
      keysToDelete.forEach(key => localStorage.removeItem(key));
    }
    
    console.log('[Persistence] Created localStorage backup:', backupKey);
  } catch (error) {
    console.warn('[Persistence] Failed to create localStorage backup:', error);
  }
}

/**
 * Load from localStorage backup
 */
function loadFromLocalStorageBackup(): AppState | null {
  try {
    const allKeys = Object.keys(localStorage);
    const backupKeys = allKeys
      .filter(key => key.startsWith(BACKUP_KEY_PREFIX))
      .sort()
      .reverse(); // Most recent first
    
    if (backupKeys.length === 0) {
      return null;
    }
    
    const mostRecentKey = backupKeys[0];
    const backupData = localStorage.getItem(mostRecentKey);
    
    if (backupData) {
      console.log('[Persistence] Loading from localStorage backup:', mostRecentKey);
      return JSON.parse(backupData);
    }
    
    return null;
  } catch (error) {
    console.warn('[Persistence] Failed to load localStorage backup:', error);
    return null;
  }
}

/**
 * Comprehensive save function with multiple fallbacks
 */
export async function saveAppState(
  data: AppState, 
  options: { signal?: AbortSignal } = {}
): Promise<PersistenceResult> {
  try {
    // Check for abort early
    if (options.signal?.aborted) {
      return { success: false, error: 'Aborted' };
    }
    
    // Patch D: Replace stale-write check with integrity-safe immutable correction
    const existing = localStorage.getItem(STORAGE_KEY);
    let parsed: any = null;
    if (existing) {
      try {
        parsed = JSON.parse(existing);
      } catch (e) {
        console.warn('[Persistence] Existing data corrupt, overwriting');
      }
    }

    // Assume 'parsed' is the last saved state object, 'data' is the new state to save.
    const existingVersion = Number(parsed?.sessionVersion ?? -1);
    const incomingVersion = Number(data?.sessionVersion ?? 0);

    // Tunables (conservative and grounded)
    const EXTREME_STALE_DELTA     = 10;           // hard reject far-behind regressions
    const RELOAD_GRACE_MAX        = 5;            // edits allowed within grace while correcting version
    const RELOAD_GRACE_WINDOW_MS  = 10_000;       // ~10s after last load
    const ONE_HOUR_MS             = 3_600_000;    // 1 hour (clock-skew tolerance)
    // const ONE_DAY_MS              = 86_400_000;   // 1 day (unused, kept for documentation)
    const ONE_WEEK_MS             = 604_800_000;  // 7 days

    // Derive "last load" reference time from persisted timestamp
    const now = Date.now();
    let stateLoadedAt = parsed?.timestamp
      ? new Date(parsed.timestamp).getTime()
      : now;

    // Defensive timestamp handling:
    //
    // - If timestamp is malformed (NaN) OR more than 1h in the future (clock skew),
    //   assume fresh load and place the reference safely within the grace window.
    // - Clamp to within the last 7 days to tolerate extended sessions (laptops sleeping,
    //   long-running tabs) while still bounding the grace window to recent activity.
    //   Very old sessions (>EXTREME_STALE_DELTA behind) are still rejected by EXTREME_STALE_DELTA.
    if (Number.isNaN(stateLoadedAt) || stateLoadedAt > now + ONE_HOUR_MS) {
      stateLoadedAt = now - RELOAD_GRACE_WINDOW_MS + 1000; // safely within grace window
    }
    stateLoadedAt = Math.min(Math.max(stateLoadedAt, now - ONE_WEEK_MS), now); // clamp to [now-7d, now]

    const withinGraceWindow = (now - stateLoadedAt) < RELOAD_GRACE_WINDOW_MS;

    // Decide the version to save WITHOUT mutating 'data'
    let versionToSave = incomingVersion;

    // 1) Extreme stale: never allow regression far behind persisted
    if (existingVersion > incomingVersion + EXTREME_STALE_DELTA) {
      console.warn("[Persistence] Rejecting extremely stale write", { existing: existingVersion, incoming: incomingVersion });
      return { success: false, error: "Version too stale" };
    }

    // 2) Grace: correct the incoming version to be monotonic (immutable)
    if (existingVersion > incomingVersion) {
      if (incomingVersion <= RELOAD_GRACE_MAX && withinGraceWindow) {
        console.warn("[Persistence] Correcting sessionVersion within grace window", {
          existing: existingVersion, incoming: incomingVersion, corrected: existingVersion + 1
        });
        versionToSave = existingVersion + 1;
      } else {
        console.warn("[Persistence] Rejecting stale write (outside grace)", { existing: existingVersion, incoming: incomingVersion });
        return { success: false, error: "Storage version is newer" };
      }
    }

    // 3) Create the final immutable state to save
    const stateToSave = versionToSave !== incomingVersion
      ? { ...data, sessionVersion: versionToSave }
      : data;
    
    // Primary: Atomic write to localStorage
    const atomicSuccess = atomicLocalStorageWrite(STORAGE_KEY, stateToSave);
    if (!atomicSuccess) {
      throw new Error('Atomic write failed');
    }
    
    // Check abort before async operations
    if (options.signal?.aborted) {
      return { success: false, error: 'Aborted' };
    }
    
    // Secondary: Create timestamped backup
    createLocalStorageBackup(stateToSave);
    
    // Tertiary: Save to IndexedDB
    const indexedResult = await saveToIndexedDB(stateToSave);
    if (!indexedResult.success) {
      console.warn('[Persistence] IndexedDB backup failed:', indexedResult.error);
    }
    
    console.log('[Persistence] State saved successfully, sessionVersion:', stateToSave.sessionVersion);
    return { success: true };
  } catch (error) {
    if (options.signal?.aborted) {
      return { success: false, error: 'Aborted' };
    }
    console.error('[Persistence] Save failed:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Comprehensive load function with multiple fallbacks
 */
export async function loadAppState(
  options: { signal?: AbortSignal } = {}
): Promise<PersistenceResult> {
  // FIRST: Recover any orphaned .tmp keys
  recoverOrphanedTmpKeys();
  
  try {
    // Check for abort early
    if (options.signal?.aborted) {
      return { success: false, error: 'Aborted' };
    }
    
    // Primary: Try localStorage
    const primaryData = localStorage.getItem(STORAGE_KEY);
    if (primaryData) {
      try {
        const parsed = JSON.parse(primaryData);
        
        // Validate sessionVersion exists and is reasonable
        if (typeof parsed.sessionVersion !== 'number' || parsed.sessionVersion < 0) {
          throw new Error('Invalid sessionVersion');
        }
        
        // Validate and migrate persistenceVersion
        if (parsed.persistenceVersion !== '1.0.0') {
          console.warn('[Persistence] Schema mismatch, migrating:', parsed.persistenceVersion);
          const sanitized = sanitizeAndMigrateAppState(parsed);
          return { 
            success: true, 
            data: { ...sanitized, persistenceVersion: '1.0.0', sessionVersion: parsed.sessionVersion } as AppState
          };
        }
        
        console.log('[Persistence] Loaded from primary localStorage, sessionVersion:', parsed.sessionVersion);
        return { success: true, data: parsed };
      } catch (parseError) {
        console.error('[Persistence] Primary data corrupt, trying fallbacks:', parseError);
        const lkgResult = loadLKG();
        if (lkgResult.success) {
          const sanitized = sanitizeAndMigrateAppState(lkgResult.data);
          return { success: true, data: { ...sanitized, persistenceVersion: '1.0.0' } as AppState };
        }
      }
    }
    
    // Check abort before async operations
    if (options.signal?.aborted) {
      return { success: false, error: 'Aborted' };
    }
    
    // Secondary: Try localStorage backup
    const backupData = loadFromLocalStorageBackup();
    if (backupData) {
      const sanitized = sanitizeAndMigrateAppState(backupData);
      console.log('[Persistence] Loaded from localStorage backup');
      return { success: true, data: { ...sanitized, persistenceVersion: '1.0.0' } as AppState };
    }
    
    // Tertiary: Try IndexedDB
    const indexedResult = await loadFromIndexedDB();
    if (indexedResult.success && indexedResult.data) {
      const sanitized = sanitizeAndMigrateAppState(indexedResult.data);
      console.log('[Persistence] Loaded from IndexedDB backup');
      return { success: true, data: { ...sanitized, persistenceVersion: '1.0.0' } as AppState };
    }
    
    // Final fallback: LKG
    const lkgResult = loadLKG();
    if (lkgResult.success) {
      const sanitized = sanitizeAndMigrateAppState(lkgResult.data);
      console.log('[Persistence] Loaded from LKG fallback');
      return { success: true, data: { ...sanitized, persistenceVersion: '1.0.0' } as AppState };
    }
    
    console.log('[Persistence] No saved data found');
    return { success: false, error: 'No saved data found' };
  } catch (error) {
    if (options.signal?.aborted) {
      return { success: false, error: 'Aborted' };
    }
    console.error('[Persistence] Load failed:', error);
    return { success: false, error: String(error) };
  }
}

/**
 * Export data to downloadable file
 */
export function exportAppState(data: AppState): void {
  try {
    const exportData = {
      ...data,
      exportedAt: new Date().toISOString(),
      version: '1.0.0'
    };
    
    const blob = new Blob([JSON.stringify(exportData, null, 2)], {
      type: 'application/json'
    });
    
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `seatyr-backup-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    console.log('[Persistence] Data exported successfully');
  } catch (error) {
    console.error('[Persistence] Export failed:', error);
  }
}

/**
 * Import data from file
 */
export function importAppState(file: File): Promise<PersistenceResult> {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader();
      
      reader.onload = (e) => {
        try {
          const content = e.target?.result as string;
          const importedData = JSON.parse(content);
          
          // Validate imported data structure
          if (!importedData.guests || !Array.isArray(importedData.guests)) {
            resolve({ success: false, error: 'Invalid file format: missing guests array' });
            return;
          }
          
          if (!importedData.tables || !Array.isArray(importedData.tables)) {
            resolve({ success: false, error: 'Invalid file format: missing tables array' });
            return;
          }
          
          // Remove export metadata
          const { exportedAt, version, ...appData } = importedData;
          
          console.log('[Persistence] Data imported successfully');
          resolve({ success: true, data: appData });
        } catch (parseError) {
          resolve({ success: false, error: 'Invalid JSON file' });
        }
      };
      
      reader.onerror = () => {
        resolve({ success: false, error: 'Failed to read file' });
      };
      
      reader.readAsText(file);
    } catch (error) {
      resolve({ success: false, error: String(error) });
    }
  });
}

/**
 * Clear all saved data
 */
export function clearAllSavedData(): void {
  try {
    // Clear primary localStorage
    localStorage.removeItem(STORAGE_KEY);
    
    // Clear all backups
    const allKeys = Object.keys(localStorage);
    const backupKeys = allKeys.filter(key => key.startsWith(BACKUP_KEY_PREFIX));
    backupKeys.forEach(key => localStorage.removeItem(key));
    
    // Clear IndexedDB
    initIndexedDB().then(db => {
      if (db) {
        const transaction = db.transaction([STORE_NAME], 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        store.clear();
      }
    });
    
    console.log('[Persistence] All saved data cleared');
  } catch (error) {
    console.error('[Persistence] Failed to clear data:', error);
  }
}

/**
 * Get storage statistics
 */
export function getStorageStats(): {
  localStorage: number;
  backups: number;
  indexedDBAvailable: boolean;
} {
  try {
    const primaryData = localStorage.getItem(STORAGE_KEY);
    const allKeys = Object.keys(localStorage);
    const backupKeys = allKeys.filter(key => key.startsWith(BACKUP_KEY_PREFIX));
    
    return {
      localStorage: primaryData ? JSON.stringify(primaryData).length : 0,
      backups: backupKeys.length,
      indexedDBAvailable: typeof indexedDB !== 'undefined'
    };
  } catch (error) {
    return {
      localStorage: 0,
      backups: 0,
      indexedDBAvailable: false
    };
  }
}

/**
 * Check localStorage availability and quota
 */
export function checkStorageHealth(): { available: boolean; error?: string } {
  try {
    const testKey = 'seatyr:storage:healthcheck';
    const testValue = 'ok';
    
    localStorage.setItem(testKey, testValue);
    const result = localStorage.getItem(testKey);
    localStorage.removeItem(testKey);
    
    if (result !== testValue) {
      return { available: false, error: 'Storage write/read mismatch' };
    }
    
    return { available: true };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('[Persistence] Storage health check failed:', errorMsg);
    return { available: false, error: errorMsg };
  }
}

/**
 * Start periodic storage health monitoring
 */
export function startStorageHealthMonitoring(onFailure: (error: string) => void): () => void {
  const intervalId = setInterval(() => {
    const health = checkStorageHealth();
    if (!health.available) {
      console.error('[Persistence] Storage unhealthy:', health.error);
      
      // Show toast notification
      if (typeof window !== 'undefined') {
        import('react-toastify').then(({ toast }) => {
          toast.error(`Storage issue: ${health.error || 'Storage unavailable'}. Changes may not be saved.`, { autoClose: 7000 });
        });
      }
      
      onFailure(health.error || 'Storage unavailable');
    }
  }, STORAGE_HEALTH_CHECK_MS);
  
  // Return cleanup function
  return () => clearInterval(intervalId);
}
