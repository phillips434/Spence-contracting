const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  use: { headless: true, launchOptions: process.env.CD_PLAYWRIGHT_CHROMIUM_PATH ? { executablePath:process.env.CD_PLAYWRIGHT_CHROMIUM_PATH,args:['--no-sandbox','--disable-dev-shm-usage'] } : {} },
});
