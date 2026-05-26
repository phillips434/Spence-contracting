const { test, expect } = require('@playwright/test');
const { login } = require('./helpers/setup');

test('Create project and estimate flow', async ({ page }) => {

  await login(
    page,
    process.env.TEST_OWNER_EMAIL,
    process.env.TEST_OWNER_PASSWORD
  );

  await page.click('text=New Project');

  await page.fill('#projectName', 'Playwright Test Project');

  await page.click('button:has-text("Save")');

  await expect(
    page.locator('text=Playwright Test Project')
  ).toBeVisible();

});
