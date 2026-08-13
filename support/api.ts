import { expect, type Page, type Response } from '@playwright/test';

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

// Radix alertdialog confirms share this shape across the suite: the trigger
// button AND the dialog's own confirm action have the SAME accessible name
// (e.g. "Cancel receipt"), so the confirm click must be scoped to the dialog
// to avoid a Playwright strict-mode ambiguity, and raced against the
// mutation's own response — the confirm click resolves synchronously in
// Playwright, but the server-side write happens async inside the POST.
// Extracted from weaving-in.spec.ts's local clickConfirmAndWait now that
// fabric-taka-register.spec.ts needs the identical "Cancel receipt" flow.
// Returns the response so callers can assert either success or failure (the
// blocked-cancel case in weaving-in.spec.ts needs the latter).
export async function confirmDialogAndWait(
  page: Page,
  triggerLabel: string,
  responseUrlPattern: RegExp,
): Promise<Response> {
  await page.getByRole('button', { name: triggerLabel, exact: false }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toBeVisible();
  const [res] = await Promise.all([
    page.waitForResponse(
      (r) => r.request().method() === 'POST' && responseUrlPattern.test(new URL(r.url()).pathname),
    ),
    dialog.getByRole('button', { name: triggerLabel }).click(),
  ]);
  return res;
}
