const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/setup');

test('Owner can login successfully', async ({ page }) => {

  await login(
    page,
    process.env.TEST_OWNER_EMAIL,
    process.env.TEST_OWNER_PASSWORD
  );

  await expect(
    page.locator('text=Projects')
  ).toBeVisible();

});
