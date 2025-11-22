# Known Issues - Version Nov18at426am

This document lists issues identified in version Nov18at426am.

## Status: UNTESTED

**⚠️ This version has not been tested yet. All changes should be verified before use.**

---

## Version Information
- **Tag**: Nov18at426am
- **Date**: November 18, 2024, 4:26 AM
- **Status**: Untested

### Changes in This Version

**Fix: Table Pagination Cut-off Issue**
- **Problem**: Guest assignment cards on the Tables page were being cut off and made inaccessible due to restrictive container height constraints (`maxHeight: calc(100vh - 360px)`) and `overflowY: 'hidden'` preventing scrolling.
- **Solution**: Removed the `style` prop with `maxHeight` and `overflowY` constraints from the guest list container div in `TableManager.tsx`. The container now grows naturally, allowing all guest cards to render fully. Pagination logic remains unchanged.
- **Files Modified**:
  - `src/pages/TableManager.tsx` (line 701): Removed `style` prop with height/overflow constraints from container div wrapping `displayGuests.map(...)`

**Effects:**
- ✅ No more cut-off cards - all guest cards render fully
- ✅ Pagination still works - `rowsPerPage` calculation limits guests per page
- ✅ Scrolling works - users can scroll to see all cards on current page if needed
- ✅ Avoids re-introducing "internal scroll + pagination" anti-pattern

**Note**: Occasional scrolling on a page is now expected and acceptable behavior when content extends past the viewport. This is preferable to inaccessible clipped content.



