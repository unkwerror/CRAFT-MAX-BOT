import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  expect: {
    timeout: 5_000,
  },
  fullyParallel: true,
  projects: [
    {
      name: 'mobile-320',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { height: 700, width: 320 },
      },
    },
    {
      name: 'mobile-ios-viewport',
      use: {
        ...devices['iPhone 13'],
        browserName: 'chromium',
        channel: 'chrome',
      },
    },
    {
      name: 'desktop',
      use: {
        ...devices['Desktop Chrome'],
        channel: 'chrome',
        viewport: { height: 900, width: 1280 },
      },
    },
  ],
  reporter: [['list']],
  testDir: './e2e',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'corepack pnpm exec vite preview --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
