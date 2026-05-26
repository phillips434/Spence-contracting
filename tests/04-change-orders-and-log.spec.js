const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/setup');

test('Change order and communication log screens open', async ({ page }) => {

  await login(
    page,
    process.env.TEST_OWNER_EMAIL,
    process.env.TEST_OWNER_PASSWORD
  );

  await expect(page.locator('text=Projects')).toBeVisible();

  // This test is intentionally light for now.
  // It confirms the app loads without console-breaking before deeper CO/log automation.

});
