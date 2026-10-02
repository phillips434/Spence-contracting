const { defineConfig } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/*.spec.js',
  use: { headless: true },
});
