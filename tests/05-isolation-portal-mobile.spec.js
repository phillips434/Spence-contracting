const { test, expect } = require('@playwright/test');
const { signUp, assertNoOwnerData } = require('./helpers/setup');

test('New contractor account stays isolated from owner data', async ({ page }) => {

  await signUp(page);

  await expect(page.locator('text=Projects')).toBeVisible();

  await assertNoOwnerData(page);

});

test('Mobile layout loads without crashing', async ({ page }) => {

  await page.goto('/');

  await expect(page.locator('body')).toBeVisible();

});
