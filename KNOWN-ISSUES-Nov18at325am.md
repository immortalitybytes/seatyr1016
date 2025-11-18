# Known Issues - Version Nov18at325am

This document lists issues identified in version Nov18at325am that should be addressed in future versions.

## Issue 1: Table Pagination Visual Cut-off
**Problem**: The table pagination on the Tables page appears cut off visually. The guest list container or pagination controls may be partially hidden or not displaying correctly.

**Details**: After implementing viewport-aware pagination, there may be a visual issue where:
- The guest list container is cut off at the bottom
- Pagination controls are not fully visible
- The maxHeight calculation may need adjustment
- Container overflow settings may need refinement

**Priority**: High
**Status**: To be fixed

---

## Version Information
- **Tag**: Nov18at325am
- **Date**: November 18, 2024, 3:25 AM
- **Major Changes in This Version**:
  - **Issue 1 Fixed**: AbortError handling - Created `isAbortLikeError()` helper utility to robustly detect and silently handle aborted operations in `SavedSettingsAccordion.tsx` and `SavedSettings.tsx`. Prevents user-facing error messages for expected cancellations.
  - **Issue 2 Fixed**: Save with same name - Implemented ID-based tracking (`seatyr_current_setting_id`) to allow users to edit and save settings with the same name. Added pre-fill modal functionality and UPDATE logic in both `SavedSettingsAccordion.tsx` and `SavedSettings.tsx`.
  - **Issue 3 Fixed**: Tables pagination UX - Implemented viewport-aware dynamic pagination in `TableManager.tsx`. Calculates `rowsPerPage` based on viewport height (3-15 rows), eliminates dual interaction (scrolling + pagination), and makes guest list container non-scrolling when paginated.
  - **Issue 4 Fixed**: +1 formatting - Added robust parsing with fallback logic in `SeatingPlanViewer.tsx` `formatGuestNameForSeat()`. Prevents "(of 0)" display, ensures +1 cases never show "(of X)", and adds defensive bounds checking for `seatIndex` and `ordinalNumber`.

### Files Modified:
- `src/utils/errorUtils.ts` (new file)
- `src/components/SavedSettingsAccordion.tsx`
- `src/pages/SavedSettings.tsx`
- `src/pages/TableManager.tsx`
- `src/pages/SeatingPlanViewer.tsx`
- `src/components/Header.tsx`

### Technical Improvements:
- Centralized error handling for abort operations
- ID-based state tracking for better data integrity
- Viewport-responsive pagination calculation
- Defensive programming with fallback parsing and bounds checking

