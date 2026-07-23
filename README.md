# fabtraq-e2e

Full-stack Playwright end-to-end suite for Fabtraq. It drives the **real** stack —
Express backend (`:4000`) + Vite frontend (`:5173`) + Postgres — through a real
browser, asserting both the UI and the underlying `stock_ledger`. This is the
FE↔BE contract test the vitest+MSW suites structurally cannot be: it has already
surfaced several real bugs that mocked tests missed (see **Bugs surfaced** below).

## Run everything

```bash
npm run e2e
```

That single command:
1. **Reseeds** Postgres — `db:reset && db:seed` in `../fabtraq-be` (see the DB warning below),
2. **Boots** its own BE + FE dev servers (Playwright `webServer`),
3. Runs the **setup** project (logs in owner/storekeeper/accountant → `.auth/*.json`),
4. Runs all specs **serially** against the live stack,
5. Tears the servers down.

Other scripts:
- `npm run e2e:ui` — Playwright UI mode (interactive).
- `npm run e2e:report` — open the last HTML report.
- `npm run typecheck` — `tsc --noEmit`.

To run a single spec: `npm run e2e -- tests/flows/stock-transfer.spec.ts`.

## Prerequisites

- **Node 22** (`.nvmrc`).
- **Docker Postgres up** at `localhost:5432` (user `fabtraq`, db `fabtraq_dev`) — the same container `../fabtraq-be` uses.
- `../fabtraq-be` and `../fabtraq-fe` dependencies installed (`npm ci` in each).
- Chromium installed once: `npx playwright install chromium`.

## ⚠️ Three things that will bite you

1. **The suite owns the ports.** `reuseExistingServer: false` — it starts its
   OWN BE/FE on `:4000`/`:5173`. If you already have `npm run dev` running in
   either repo, **stop it first**, or the run fails with `EADDRINUSE`.
2. **Every run reseeds `fabtraq_dev`.** `db:reset && db:seed` wipes the database.
   Don't run the suite against a DB whose contents you care about, and don't run
   it while doing manual dev work against the same DB.
3. **The BE's `/auth/*` rate limit needs raising for a full run.** It defaults
   to 100 req/15min (a production security setting, not a test budget), but
   this suite is 69+ serial tests and every `gotoAndExpect` navigation
   re-checks auth via `GET /auth/me` — cumulative calls blow through 100 well
   before a full run finishes, and the FE bounces to `/login` on the
   resulting 429s (looks exactly like an auth failure). `playwright.config.ts`
   already sets `RATE_LIMIT_AUTH_MAX=2000` on the BE `webServer`'s env, so
   `npm run e2e` handles this for you — only relevant if you're launching the
   BE dev server some other way for manual/partial runs.

## Companion-repo branch requirement

The suite tests whatever `../fabtraq-be` and `../fabtraq-fe` have **checked out**.
Two fixes the suite depends on currently live on their own branches (not yet on
the feature branches):

- **`fabtraq-be` → `fix/seed-design-code`** — corrects a seed fixture (`DSG-001`→`DSN-001`)
  without which `GET /designs` 400s and `masters/designs.spec.ts` fails.
- **`fabtraq-fe` → `fix/placement-fieldarray-overflow`** — the placement
  Location/Floor layout fix, without which placement-driven flows fail at the
  default 1280×720 viewport.

Check those out before running, or those specs will fail. (They are isolated fix
branches intended to be cherry-picked to `main`.)

## Design & conventions

- **Serial** (`workers: 1`, `fullyParallel: false`) — shared mutable Postgres +
  aggregate ledger assertions demand it.
- **Delta ledger assertions, never absolute.** Every transactional spec reads the
  `stock_ledger` balance for an exact key before the action and asserts the
  *difference* — order-independent, survives new specs. DB access is a thin `pg`
  client (`fixtures/db.ts`), not Prisma.
- **Each test creates its own data** with unique, schema-valid codes
  (`fixtures/codes.ts`). The seed is relied on only for the login users and a few
  read-only fixtures (e.g. the register beam).
- **Never assert minted document numbers** (TXF/challan/entry are FY sequence
  counters) — capture and assert *format*, not value.
- **Selectors** use `getByRole`/`getByLabel` (the app has ~no `data-testid`).
- **Auth** via a `setup` project → `storageState`; specs reuse it. Role-guard
  specs load the storekeeper/accountant states.

## Layout

```
fixtures/   env, db (pg + ledger helpers), codes, test (extended `test` with `db`)
support/    forms, nav, assert helpers
tests/
  auth.setup.ts          login → storageState (setup project)
  smoke/                 db/codes self-checks (*.noauth.spec), routes, redirects
  masters/               vendors, qualities, job-workers, transporters, locations, designs
  flows/                 yarn-purchase, jw-out, jw-in-{yarn,dyed,beam}, beam-receipt,
                         beams, placement, stock-transfer, inventory
  guards/                role-guards (both-branch)
  audit-log.spec.ts
```

Playwright projects: `setup` (writes storageState), `no-auth` (unauthenticated
self-checks — `*.noauth.spec.ts`), `authed` (everything else, owner storageState).

## Bugs surfaced (real, verified)

The suite found these against the live stack:
1. **Seed design code** `DSG-001` violated the `DSN-` schema → `GET /designs`
   400'd for every user. **Fixed** on `fabtraq-be fix/seed-design-code`.
2. **Placement Location/Floor selects** unclickable ≤~1366px viewports
   (`minmax(0,1fr)` collapse). **Fixed** on `fabtraq-fe fix/placement-fieldarray-overflow`.
3. **`/place-stock` never wrote `stock_ledger`** — `addPlacements`/`mintPlacements`
   updated `placements`/`placementStatus` but wrote no ledger row, even on the
   `fully_placed` transition, so queue-placed stock was invisible to inventory.
   **Fixed** (2026-07-10, see the unplaced-stock-visibility design) —
   `tests/flows/placement.spec.ts` asserts the create-time bucket credit and
   the placement move-pair directly.
4. **quality-form** Category/Default-Unit/Status selects have no accessible name
   (`FormControl` wraps the `Select` root, not `SelectTrigger`). **Open.**
5. **jw-challan-out** nested `<label>` wraps the job-work-type checkbox group,
   making non-first options' accessible names ambiguous. **Open.**
6. **inventory-balance** Quality/Location filter Selects fired two clobbering
   `setSearchParams` calls, so the filter never reached the URL. **Superseded** —
   the B-015 redesign (2026-07-22) replaced that page; the new overview has no
   location filter at all (see `tests/flows/inventory.spec.ts`).
7. **`prisma-inventory.repository.ts` position balances overstate stock that
   has since had a DEBIT transaction** (`out_quantity > 0`, e.g. `challan_out`) —
   verified live: one position summed 250 (purchase) − 80 − 60 (two
   `challan_out` rows) = 110kg in `stock_ledger`, confirmed via a direct
   Prisma query returning all three rows correctly, yet `GET /inventory`
   (and therefore `/inventory/summary` and `/inventory/positions`, which
   read the same `fetchPositions` accumulation) consistently returned 250kg
   for that same position — the debit is silently dropped somewhere in
   `fetchPositions`'s per-row `balanceGroupKey` accumulation, not in the
   Prisma fetch itself. A second case showed the same pattern across
   multiple `processedTypes` states sharing one floor (144kg overstated on
   one floor: BE reported 2645/47/41/165kg vs a 2545/3/41/165kg direct
   ledger sum for the raw/twisting/twisting+gassing/dyeing states). Predates
   and is independent of B-015 (the position-level `/inventory` endpoint
   wasn't touched by the redesign) — a real, business-critical
   stock-balance correctness bug. **Open** —
   `tests/flows/inventory.spec.ts`'s candidate selection deliberately avoids
   stock items with in-house debit history so this spec exercises
   unaffected data instead of tripping over it.
