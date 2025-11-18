# Known Issues - Version Nov18at1am

This document lists issues identified in version Nov18at1am that should be addressed in future versions.

## Issue 1: AbortError Message
**Problem**: There is an "AbortError: The operation was aborted." error message that seems incorrect.

**Details**: This error appears in the application but may be a false positive or incorrectly displayed error. Needs investigation to determine:
- Where the error originates
- Whether it's a real error or a benign abort (e.g., from cancelled network requests)
- If it's a real error, what operation is being aborted and why

**Priority**: Medium
**Status**: To be investigated

---

## Issue 2: Save Current Settings with Same Name
**Problem**: The user should be able to make changes to the current settings and save it with those same settings (not enter a new name).

**Details**: Currently, when a user loads a saved setting and makes changes, they cannot save it back to the same name. They must create a new name. The expected behavior is:
- If a setting is already loaded and modified, allow saving with the same name (update existing)
- Provide clear indication that this will overwrite the existing setting
- Optionally, ask for confirmation before overwriting

**Priority**: High
**Status**: To be implemented

---

## Issue 3: Tables Page Pagination UX
**Problem**: The pagination on the Tables page doesn't feel right. The user shouldn't have to scroll and flip pages. It should be one or the other.

**Details**: Current implementation shows pagination controls but users may still need to scroll. The solution should be one of:
- **Option A**: Show all guests with vertical scrolling (no pagination)
- **Option B**: Show only the number of guestunits concurrently visible in the browser at its current height and width (without scrolling) for page-flipping

**Recommendation**: Option B - Calculate viewport height and show only guests that fit without scrolling, then paginate through them.

**Priority**: High
**Status**: To be redesigned

---

## Issue 4: Seating Page "+1" Display Format
**Problem**: On the Seating page, in the seating plan grid, a guestunit with a plus 1 (e.g., "Martha Williams+1") does not need "(of 0)" appended to it. Whereas, a "plus N" (where N>1) does need the "(of Y)" after the ordinal number.

**Current Behavior**: 
- "+1" cases may incorrectly show "(of 0)" or similar
- "+N" cases (N>1) should show "(of Y)" but may not be formatted correctly

**Expected Behavior**:

For a guestunit "Gary Greison+1" (party of 2):
- Seat #1: "*Gary Grieson* + 1" (name bolded, +1 normal)
- Seat #2: "Gary Grieson +*1*" (name normal, +1 bolded)
- **No "(of X)" suffix**

For a guestunit "Hugh Hester+2" (party of 3):
- Seat #1: "*Hugh Hester* + 2" (name bolded, +2 normal)
- Seat #2: "Hugh Hester + *1st* (of 2)" (name normal, +1st bolded with ordinal, "(of 2)" suffix)
- Seat #3: "Hugh Hester + *2nd* (of 2)" (name normal, +2nd bolded with ordinal, "(of 2)" suffix)

**Priority**: Medium
**Status**: To be fixed

---

## Version Information
- **Tag**: Nov18at1am
- **Date**: November 18, 2024, 1:00 AM
- **Major Changes in This Version**:
  - Added pagination to TableManager for large guest lists (135+ guests)
  - Cleaned up unused pagination code in SeatingPlanViewer
  - Fixed special character support in saved configuration names (spaces, apostrophes, quotes, dashes, etc.)

