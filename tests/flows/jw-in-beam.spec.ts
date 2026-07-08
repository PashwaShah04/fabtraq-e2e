import { test, expect } from '../../fixtures/test';

// The "beam" job-work-in path is not a distinct form: the router redirects
// /jw-challans-in/new/beam to /beam-receipts/new (fabtraq-fe router.tsx), because
// beams coming back from a job worker are recorded as Beam Receipts. The actual
// beam-return receipt flow is covered by jw-in / beam-receipt specs; this spec only
// pins the redirect contract so a future router change can't silently break the link.
test('jw-challan-in beam path redirects to beam-receipts/new', async ({ page }) => {
  await page.goto('/jw-challans-in/new/beam');
  // Owner (default storageState) is allowed on /beam-receipts/new, so the redirect
  // lands on the real form rather than bouncing to /login or a forbidden page.
  await expect(page).toHaveURL(/\/beam-receipts\/new$/);
});
