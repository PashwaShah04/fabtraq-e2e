import { defineConfig } from '@playwright/test';

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const API_URL = process.env.E2E_API_URL ?? 'http://localhost:4000';

// Derived so a non-default E2E_BASE_URL/E2E_API_URL (e.g. a parallel worktree
// stack on alternate ports) actually moves the webServer ports too — without
// this, only the test client's baseURL would move while both dev servers
// kept booting on 5173/4000 underneath, unset FE_PORT/API_PORT collide with
// the main checkout's suite. Defaults reproduce the previous
// hardcoded 5173/4000 byte-for-byte.
const fePort = Number(new URL(BASE_URL).port || '5173');
const apiPort = Number(new URL(API_URL).port || '4000');

// Lets a worktree checkout point the suite at its own companion repos
// (`../fabtraq-be`/`../fabtraq-fe` only resolve correctly from the default
// checkout layout) without touching this file. Defaults match prior
// behavior.
const BE_DIR = process.env.E2E_BE_DIR ?? '../fabtraq-be';
const FE_DIR = process.env.E2E_FE_DIR ?? '../fabtraq-fe';

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
      command: `npm --prefix ${BE_DIR} run dev`,
      url: `${API_URL}/health`,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      // The default /auth/* limit (100 req/15min, see fabtraq-be's
      // rate-limit.ts) is a production security setting, not a test budget:
      // this suite's 69+ serial tests each re-check auth via GET /auth/me on
      // every gotoAndExpect navigation, which blows through 100 well before a
      // full run finishes and bounces later tests to /login with a 429
      // masquerading as unauthenticated (see README gotcha). Generous
      // headroom for suite growth — tsx (fabtraq-be's dev runner) loads
      // `.env` itself but never overrides a var already in process.env, so
      // this always wins over whatever `.env` has. PORT is set the same way,
      // for the same reason: the BE worktree may have no `.env` at all, so
      // the port must be able to arrive purely via the environment.
      env: { RATE_LIMIT_AUTH_MAX: '2000', PORT: String(apiPort) },
    },
    {
      // `--strictPort` closes a latent bug: without it, Vite silently
      // bumps to the next free port when `fePort` is already taken, and the
      // suite would then run against whatever unrelated app already
      // occupies that port instead of failing loudly.
      command: `npm --prefix ${FE_DIR} run dev -- --port ${fePort} --strictPort`,
      url: BASE_URL,
      timeout: 120_000,
      reuseExistingServer: false,
      stdout: 'pipe',
    },
  ],
});
