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

## ⚠️ Two things that will bite you

1. **The suite owns the ports.** `reuseExistingServer: false` — it starts its
   OWN BE/FE on `:4000`/`:5173`. If you already have `npm run dev` running in
   either repo, **stop it first**, or the run fails with `EADDRINUSE`.
2. **Every run reseeds `fabtraq_dev`.** `db:reset && db:seed` wipes the database.
   Don't run the suite against a DB whose contents you care about, and don't run
   it while doing manual dev work against the same DB.

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
3. **`/place-stock` never writes `stock_ledger`** — `addPlacements`/`mintPlacements`
   update `placements`/`placementStatus` but write no ledger row, even on the
   `fully_placed` transition, so queue-placed stock is invisible to inventory.
   **Open** — `tests/flows/placement.spec.ts` documents it with a `test.fail()`
   tripwire that will flag when the BE is fixed.
4. **quality-form** Category/Default-Unit/Status selects have no accessible name
   (`FormControl` wraps the `Select` root, not `SelectTrigger`). **Open.**
5. **jw-challan-out** nested `<label>` wraps the job-work-type checkbox group,
   making non-first options' accessible names ambiguous. **Open.**
6. **inventory-balance** Quality/Location filter Selects fire two clobbering
   `setSearchParams` calls, so the filter never reaches the URL. **Open.**
