const { test, expect } = require('@playwright/test');
const { signUp, assertNoOwnerData } = require('./helpers/setup');

test('New contractor can sign up and sees clean account', async ({ page }) => {

  await signUp(page);

  await expect(page.locator('text=Projects')).toBeVisible();

  await assertNoOwnerData(page);

  await expect(page.locator('text=Ready to go')).toBeVisible();

});
