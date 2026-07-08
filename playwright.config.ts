import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    // Runs the login setup; writes .auth/*.json. testMatch is relative to testDir,
    // so auth.setup.ts MUST live under ./tests (not fixtures/) or it matches nothing.
    { name: 'setup', testMatch: /auth\.setup\.ts$/ },
    // No storageState, no dependencies: for pure/self-check specs (*.noauth.spec.ts)
    // and the throwaway boot check, which must run UNAUTHENTICATED.
    { name: 'no-auth', testMatch: /\.noauth\.spec\.ts$/ },
    // Everything else: logged-in owner. Ignores the setup + no-auth files so they
    // never double-run here.
    {
      name: 'authed',
      dependencies: ['setup'],
      use: { storageState: '.auth/owner.json' },
      testIgnore: [/auth\.setup\.ts$/, /\.noauth\.spec\.ts$/],
    },
  ],
  webServer: [
    {
      command: 'npm --prefix ../fabtraq-be run dev',
      url: `${API_URL}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'npm --prefix ../fabtraq-fe run dev',
      url: BASE_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});
