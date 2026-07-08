import { test as setup, expect } from '@playwright/test';
import { env } from '../fixtures/env';
import { fillByLabel, clickButton } from '../support/forms';

async function login(page: import('@playwright/test').Page, email: string, password: string, statePath: string) {
  // Hit a PROTECTED route first so the app redirects to /login?from=... .
  // Navigating to /login directly self-loops on `from` (known gotcha).
  await page.goto('/vendors');
  await expect(page).toHaveURL(/\/login/);
  await fillByLabel(page, 'Email', email);
  await fillByLabel(page, 'Password', password);
  await clickButton(page, 'Sign in');
  // After login the app lands on the originally-requested protected route.
  await expect(page).toHaveURL(/\/vendors/);
  await page.context().storageState({ path: statePath });
}

setup('authenticate owner', async ({ page }) => {
  await login(page, env.OWNER.email, env.OWNER.password, '.auth/owner.json');
});
setup('authenticate storekeeper', async ({ page }) => {
  await login(page, env.STOREKEEPER.email, env.STOREKEEPER.password, '.auth/storekeeper.json');
});
setup('authenticate accountant', async ({ page }) => {
  await login(page, env.ACCOUNTANT.email, env.ACCOUNTANT.password, '.auth/accountant.json');
});
