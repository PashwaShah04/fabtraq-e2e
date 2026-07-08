import { expect, type Page } from '@playwright/test';

// Navigate to a protected path. Returns true if the app shell rendered, false if
// the client-side RequireAuth bounced to /login. Avoids networkidle (discouraged;
// flakes when React Query keeps a request in flight) by racing two concrete
// landmarks: the app nav (authed) vs the Sign-in heading (unauth).
export async function gotoProtected(page: Page, path: string): Promise<boolean> {
  await page.goto(path);
  const nav = page.getByRole('navigation');
  const loginHeading = page.getByRole('heading', { name: 'Sign in' });
  await expect(nav.or(loginHeading).first()).toBeVisible();
  return !page.url().includes('/login');
}

export async function gotoAndExpect(page: Page, path: string): Promise<void> {
  expect(await gotoProtected(page, path)).toBe(true);
}
