import { test, expect } from '../../fixtures/test';

// RoleGuard (fabtraq-fe/src/features/auth/role-guard.tsx) does NOT redirect a
// disallowed role to /login — it swaps in ForbiddenPage (forbidden.page.tsx) IN
// PLACE at the same URL:
//   <h1>Access denied</h1>
//   <p>You don't have permission to view this page.</p>
// gotoProtected (support/nav.ts) would report this as "reached" (URL unchanged),
// so it is NOT used here — every case below asserts the actual rendered UI.
const FORBIDDEN_HEADING = 'Access denied';
const FORBIDDEN_TEXT = "You don't have permission to view this page.";

type Role = 'owner' | 'storekeeper' | 'accountant';

interface GuardedRoute {
  readonly path: string;
  // Exact heading text confirmed against each page's <PageHeader title="…"> / <h1>.
  readonly heading: string;
  // Confirmed against fabtraq-fe/src/app/router.tsx RoleGuard allowed={[...]} for this route.
  readonly allowedRoles: readonly Role[];
}

const ROUTES: readonly GuardedRoute[] = [
  { path: '/stock-transfers', heading: 'Stock Transfers', allowedRoles: ['owner', 'storekeeper'] },
  { path: '/stock-transfers/new', heading: 'New Stock Transfer', allowedRoles: ['owner', 'storekeeper'] },
  { path: '/jw-challans-out/new', heading: 'New Job Work Challan Out', allowedRoles: ['owner', 'storekeeper'] },
  {
    path: '/jw-challans-in/new',
    heading: 'New JW Challan In — choose receive type',
    allowedRoles: ['owner', 'storekeeper'],
  },
  {
    path: '/jw-challans-in/new/yarn',
    heading: 'New Job Work Challan In (Yarn)',
    allowedRoles: ['owner', 'storekeeper'],
  },
  { path: '/designs/new', heading: 'New Design', allowedRoles: ['owner', 'storekeeper'] },
  {
    path: '/beam-receipts/new',
    heading: 'New Beam Receipt',
    allowedRoles: ['owner', 'storekeeper', 'accountant'],
  },
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function assertAllowed(page: import('@playwright/test').Page, route: GuardedRoute): Promise<void> {
  await page.goto(route.path);
  await expect(page.getByRole('heading', { name: route.heading })).toBeVisible();
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).not.toBeVisible();
}

async function assertDenied(page: import('@playwright/test').Page, route: GuardedRoute): Promise<void> {
  await page.goto(route.path);
  // Forbidden UI renders in place — same URL, no /login bounce.
  await expect(page).toHaveURL(new RegExp(`${escapeRegExp(route.path)}$`));
  await expect(page).not.toHaveURL(/\/login/);
  await expect(page.getByRole('heading', { name: FORBIDDEN_HEADING })).toBeVisible();
  await expect(page.getByText(FORBIDDEN_TEXT)).toBeVisible();
  await expect(page.getByRole('heading', { name: route.heading })).not.toBeVisible();
}

// test.use is describe/file scoped (cannot be set per loop iteration), so each
// acting role gets its own describe block; each block loops the shared ROUTES
// table and dispatches allowed/denied per that route's confirmed allow-list.

test.describe('role guards — owner', () => {
  test.use({ storageState: '.auth/owner.json' });

  for (const route of ROUTES) {
    test(`owner is allowed on ${route.path}`, async ({ page }) => {
      await assertAllowed(page, route);
    });
  }
});

test.describe('role guards — storekeeper', () => {
  test.use({ storageState: '.auth/storekeeper.json' });

  for (const route of ROUTES) {
    test(`storekeeper is allowed on ${route.path}`, async ({ page }) => {
      await assertAllowed(page, route);
    });
  }
});

test.describe('role guards — accountant', () => {
  test.use({ storageState: '.auth/accountant.json' });

  for (const route of ROUTES) {
    if (route.allowedRoles.includes('accountant')) {
      test(`accountant is allowed on ${route.path}`, async ({ page }) => {
        await assertAllowed(page, route);
      });
    } else {
      test(`accountant is denied on ${route.path} (Forbidden UI in place)`, async ({ page }) => {
        await assertDenied(page, route);
      });
    }
  }
});
