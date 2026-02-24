import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e/specs',
  globalSetup: './tests/e2e/global-setup.ts',
  globalTeardown: './tests/e2e/global-teardown.ts',

  // Run all tests sequentially – they share one live server + co-signer process
  fullyParallel: false,
  workers: 1,

  // Retry once on CI to absorb timing flakes
  retries: process.env.CI ? 1 : 0,

  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report', open: 'never' }],
  ],

  use: {
    trace: 'on-first-retry',
    // Longer default for operations that wait on bifrost relay round-trips
    actionTimeout: 15_000,
  },

  projects: [
    // Pure API specs (01–07) – use request context only, no browser
    {
      name: 'api',
      testMatch: ['**/0[1-7]-*.e2e.ts'],
    },
    // Browser UI spec (08) – needs a real browser
    {
      name: 'ui',
      testMatch: ['**/08-ui.e2e.ts'],
      use: { ...devices['Desktop Chrome'], headless: true },
    },
  ],

  // Global per-test timeout – sign tests can take up to 15 s
  timeout: 30_000,
});
