import { expect, type Locator, type Page } from '@playwright/test';

// Toasts render their title text; match on visible text anywhere in the toast region.
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.getByText(text).first()).toBeVisible();
}

// Capture a minted document number, scoped to a specific region (toast/detail) so
// a broad regex can't grab sidebar/heading text. `scope` is a Locator (e.g. the
// toast region or a detail <dl>); `regex` MUST be anchored to the real doc prefix
// (confirm the prefix from the feature's create hook before trusting the pattern).
export async function captureDocNo(scope: Locator, regex: RegExp): Promise<string> {
  const el = scope.getByText(regex).first();
  await expect(el).toBeVisible();
  const txt = (await el.textContent()) ?? '';
  const m = txt.match(regex);
  if (!m) throw new Error(`No doc number matching ${regex} found in "${txt}"`);
  return m[0];
}
