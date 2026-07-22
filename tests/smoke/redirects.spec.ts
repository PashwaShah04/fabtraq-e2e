import { test, expect } from '../../fixtures/test';

// Pin the router's redirect contracts so a future route-table change can't silently
// break these links. All three are declared as <Navigate replace> in fabtraq-fe
// router.tsx. Runs under the authed project (owner storageState) so the protected
// destinations render rather than bouncing to /login.
const REDIRECTS: ReadonlyArray<{ from: string; to: RegExp }> = [
  // index → default landing
  { from: '/', to: /\/vendors$/ },
  // dyed JW-in is not a distinct form — it reuses the yarn form
  { from: '/jw-challans-in/new/dyed', to: /\/jw-challans-in\/new$/ },
  { from: '/jw-challans-in/new/yarn', to: /\/jw-challans-in\/new$/ },
  // beam JW-in is recorded as a Beam Receipt
  { from: '/jw-challans-in/new/beam', to: /\/beam-receipts\/new$/ },
];

for (const { from, to } of REDIRECTS) {
  test(`redirect ${from} -> ${to.source}`, async ({ page }) => {
    await page.goto(from);
    await expect(page).toHaveURL(to);
  });
}
