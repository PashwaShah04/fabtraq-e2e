import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// Every protected list/read route must render its app shell under auth (owner —
// default storageState — can see all of these; /stock-transfers is additionally
// role-guarded to owner/storekeeper, which owner satisfies).
//
// Landmark: gotoAndExpect (support/nav.ts) already asserts the app nav
// (AppLayout.tsx: `<nav aria-label="Primary">`, matched via
// page.getByRole('navigation')) is visible AND that the URL did not bounce to
// /login — every one of these routes is a child of the RequireAuth-wrapped
// AppLayout route (router.tsx), so the shared nav landmark covers them all. No
// route in this list renders outside AppLayout, so no per-page heading fallback
// is needed here.
const ROUTES = [
  '/vendors',
  '/qualities',
  '/job-workers',
  '/transporters',
  '/locations',
  '/designs',
  '/yarn-purchases',
  '/jw-challans-out',
  '/jw-challans-in',
  '/beam-receipts',
  '/beams',
  '/inventory',
  '/inventory/lots',
  '/inventory/positions',
  '/place-stock',
  '/stock-transfers',
  '/audit-log',
] as const;

for (const route of ROUTES) {
  test(`${route} renders under auth`, async ({ page }) => {
    await gotoAndExpect(page, route);
  });
}

// Unknown path — router.tsx catch-all `path: '*'` renders NotFoundPage directly
// (outside RequireAuth/AppLayout), so no nav landmark here; assert the page's own
// heading text instead (not-found.page.tsx: <h1>Page not found</h1>, which
// matches /not found/i).
test('unknown path renders NotFound', async ({ page }) => {
  await page.goto('/definitely-not-a-route');
  await expect(page.getByText(/not found/i)).toBeVisible();
});
