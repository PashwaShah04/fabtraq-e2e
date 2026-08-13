import type { Page } from '@playwright/test';

// Extracted from weaving-dispatch.spec.ts's inline createReceivedBeam helper
// (lines 34-37) now that a second spec (weaving-in.spec.ts) needs the exact
// same "read the browser's own authenticated session's CSRF cookie" snippet
// to drive API-seeded fixtures the FE has no direct entry point for.
export async function getCsrfToken(page: Page): Promise<string> {
  const cookies = await page.context().cookies();
  const csrfCookie = cookies.find((c) => c.name === 'fabtraq_csrf');
  if (!csrfCookie) throw new Error('fabtraq_csrf cookie must be present for an authenticated session');
  return decodeURIComponent(csrfCookie.value).split('|')[0] ?? '';
}
