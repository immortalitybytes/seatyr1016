import { test, expect } from '@playwright/test';

test('Guests page shows restored UI controls', async ({ page }) => {
  await page.goto('http://localhost:5173/#/guests', { waitUntil: 'domcontentloaded' });

  // Core sections restored by the SSOT GuestManager
  await expect(page.getByText('Watch Tutorial Video')).toBeVisible();     // accordion
  await expect(page.locator('input[type="file"]')).toBeVisible();         // CSV upload
  await expect(page.getByText(/Saved Settings/i)).toBeVisible();          // saved settings section
  await expect(page.getByText(/Seatyr's Favorite Sites/i)).toBeVisible(); // yellow box
  await expect(page.getByText(/NOTE:/)).toBeVisible();                    // % sorting note

  // Guard against prior bad link
  await expect(page.locator('a[href*="x.ai/grok"]')).toHaveCount(0);
});
