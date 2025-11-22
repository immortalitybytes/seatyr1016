# Testing Special Characters in Setting Names

## ✅ Localhost Status
- Dev server: **Running** on http://localhost:5173
- Build: **Successful** (no compilation errors)
- Code: **All changes saved**

## 🧪 How to Test

### 1. Test Apostrophes
1. Go to http://localhost:5173
2. Navigate to "Guests" page
3. Open "Saved Settings" accordion
4. Click "Save Current Settings"
5. Enter name: `O'Brien's Wedding`
6. Click "Save Settings"
7. ✅ Should save successfully
8. ✅ Name should display as: `O'Brien's Wedding`

### 2. Test Quotes
1. Click "Save Current Settings" again
2. Enter name: `Event "Main" Hall`
3. Click "Save Settings"
4. ✅ Should save successfully
5. ✅ Name should display as: `Event "Main" Hall`

### 3. Test Both Together
1. Click "Save Current Settings" again
2. Enter name: `O'Brien's "Main" Event`
3. Click "Save Settings"
4. ✅ Should save successfully
5. ✅ Name should display correctly

### 4. Test All Special Characters
1. Enter name: `Test: Event — O'Brien's "Main" Hall; Reception`
2. Click "Save Settings"
3. ✅ Should save successfully
4. ✅ All characters should display correctly

### 5. Test Inline Rename
1. Double-click on a saved setting name
2. Edit to: `Renamed: O'Brien's "Event"`
3. Press Enter or click outside
4. ✅ Should save successfully
5. ✅ Name should update correctly

### 6. Test Duplicate
1. Click "Duplicate" on a setting with special characters
2. ✅ Should create copy with " (Copy)" appended
3. ✅ Special characters should be preserved

### 7. Test Export
1. Click "Export Settings" on a setting with special characters
2. ✅ Should download CSV file
3. ✅ Setting name should appear in CSV header correctly

### 8. Test Edge Cases
1. Try name with 200 characters (should work)
2. Try name with 201 characters (should error and truncate)
3. Try pasting text with newlines (should strip them)
4. Try name with only spaces (should error)

## ✅ Expected Results

All special characters should:
- ✅ Save to database successfully
- ✅ Display correctly in the UI
- ✅ Work in inline editing
- ✅ Work in duplicate function
- ✅ Work in CSV export
- ✅ Persist in localStorage

## 🐛 If Something Doesn't Work

1. Check browser console for errors (F12)
2. Verify you're logged in
3. Try refreshing the page
4. Check that the dev server is running: `npm run dev`

## 📝 Notes

- Newlines are automatically stripped (prevented at input)
- Names longer than 200 characters are truncated
- Empty names are rejected
- All special characters are preserved (spaces, apostrophes, quotes, dashes, em dashes, underscores, colons, semicolons)



