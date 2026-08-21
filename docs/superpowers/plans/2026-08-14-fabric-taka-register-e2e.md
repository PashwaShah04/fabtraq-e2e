# Fabric Taka Register — e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the Fabric Taka Register feature (§5 of the design spec) with a Playwright spec
against the real fabtraq-be/fabtraq-fe stack: receive a multi-taka weaving-in with a header
location → register lists the taka as placed → find one by the weaver's paper serial → move two to
a different floor → Fabric tab placed/unplaced split moves by the right delta → detail page shows
beam provenance → cancel the receipt → the taka's `locationId` is nulled and they leave the default
register view. Plus the two one-line house-sweep additions (`routes.spec.ts`, `role-guards.spec.ts`)
the design spec's own §5 calls for instead of bespoke smoke/guard tests.

**Spec:** `docs/superpowers/specs/2026-08-14-fabric-taka-register-design.md` (v2)
**Locked contract:** `docs/superpowers/plans/2026-08-14-fabric-taka-register-context.md`

**Architecture:** One new spec file (`tests/flows/fabric-taka-register.spec.ts`) plus small additions
to two existing smoke/guard specs. Two small extractions from `tests/flows/weaving-in.spec.ts` into
shared support modules — this is the **second caller** of its beam/design seed helpers and its
cancel-confirm helper, crossing the same "worth sharing" threshold that already justified
extracting `getCsrfToken` into `support/api.ts` for the first weaving-in workstream.

**Tech Stack:** Playwright + TypeScript, `fixtures/test.ts` (`db` fixture), `fixtures/db.ts`
(`Db.queryOne`/`queryMany`), `fixtures/codes.ts`, `support/forms.ts`, `support/nav.ts`,
`support/assert.ts`, `support/api.ts` (extended). No new dependencies.

## Global Constraints

- **Branch:** whichever branch this workstream's sibling `plan-be`/`plan-fe`/`plan-shared` land on
  (coordinate via the lead — do not invent a new branch here). Commit per task; do not push.
- **This feature writes NO `stock_ledger` rows** (design spec §3: "No `stock_ledger` access
  anywhere"). There is nothing to `db.ledgerBalance`/`db.ledgerDelta` here. The delta rule still
  applies to the one place a running total exists — **the Stock Balance Fabric tab's placed/unplaced
  counts** — read as a **before/after pair around the receive step** and assert the *difference*,
  never an absolute count. A fresh (or already-populated) `fabtraq_dev` must not matter: the register
  and Fabric tab are shared, global views that every other spec's fabric-design/taka rows also land
  in, so any absolute assertion here would be exactly the class of bug `e2e/README.md:77` already
  warns about.
- **Serial suite, own data:** every test creates its own rows with unique codes (`codes.unique(...)`
  / the shared `createFabricDesign`/`createReceivedBeam` helpers); never assume a clean DB.
- **Minted document numbers are asserted by FORMAT (regex), never by value** — `captureDocNo` only.
- **Radix `alertdialog` confirms** are scoped to the dialog and raced against `page.waitForResponse`
  via `Promise.all` (extracted below as `confirmDialogAndWait`) — a bare click races the server-side
  write. The new `PlaceTakaDialog` is a plain (non-destructive) shadcn `Dialog`, **not** an
  `alertdialog` — model its wait the same way but scope to `page.getByRole('dialog')`.
- **Selectors:** `getByRole`/`getByLabel`/`aria-label` locators only — this app has ~no
  `data-testid`. New FE aria-labels/copy introduced by this plan (the register page, `PlaceTakaDialog`,
  the detail page, and the weaving-in form's new header location field) are the **FE build contract**
  for this workstream — `plan-fe` implements to these exact strings, same rule the weaving-in e2e
  plan already established. Task 4 (the live run) is where a real mismatch gets reconciled: fix the
  spec to match the shipped FE unless the shipped FE's naming is clearly worse, in which case
  coordinate the FE-side fix with the lead.
- **DB reset rules (README):** `npm run e2e` (full suite) always runs `db:reset && db:seed` against
  `fabtraq_dev` first. A **single-spec** run (`npx playwright test <path> --project=authed`) does
  **not** reseed, but the suite owns ports `:4000`/`:5173`/`:7300` (`reuseExistingServer:false` on
  BE/FE) — stop any already-running `npm run dev` first (kill the `tsx watch` **parent**, not just
  the child, or it respawns).
- **Coverage of the design spec's own e2e bullet (§5):** "receive with a header location → register
  lists the taka as placed → find one by the weaver's paper serial → move two to another floor →
  Fabric tab placed/unplaced split moves → detail shows beam provenance → cancel the receipt →
  assert `locationId` is null and the taka leave the default view." This plan's Task 2 is that exact
  chain, live-verified in Task 4.
- **TDD-ish for e2e:** the spec is written now, before `plan-be`/`plan-fe` land, against BE/FE that
  don't exist yet — it cannot run live yet, so `typecheck` is the fast-feedback signal for Tasks
  1–3. Task 4 is the live run: it must first fail for the *right* reason (a real selector/behavior
  gap against the shipped FE, not a typo in this spec), then be fixed to green.

---

### Task 1: Extract shared beam/design seed helpers and the confirm-dialog helper

**Files:**
- Create: `e2e/support/weaving-in-fixtures.ts`
- Modify: `e2e/support/api.ts`
- Modify: `e2e/tests/flows/weaving-in.spec.ts`

**Interfaces:**
- Consumes: `fixtures/env.ts` (`env.API_URL`), `fixtures/codes.ts` (`codes.unique`), `fixtures/db.ts`
  (`Db`), `support/api.ts` (`getCsrfToken`).
- Produces: `support/weaving-in-fixtures.ts` exports `createReceivedBeam(page, db, opts)` and
  `createFabricDesign(page, db, weftQualityId, opts?)` — byte-identical logic to
  `weaving-in.spec.ts`'s current local functions, generalized only enough to take an optional code
  prefix/`expectedGlm` so `fabric-taka-register.spec.ts` doesn't collide design codes with the
  weaving-in spec's own `FABD-WVI-*` rows. `support/api.ts` gains `confirmDialogAndWait(page,
  triggerLabel, responseUrlPattern)` — `weaving-in.spec.ts`'s current local `clickConfirmAndWait`,
  moved verbatim (it already generalizes over trigger label/URL pattern, unlike
  `weaving-dispatch.spec.ts`'s narrower single-purpose `cancelDispatch`, which is left alone —
  `weaving-dispatch.spec.ts` is not touched by this plan).

- [ ] **Step 1: Create the shared fixtures module**

```typescript
// e2e/support/weaving-in-fixtures.ts
import type { Page } from '@playwright/test';

import { codes } from '../fixtures/codes';
import type { Db } from '../fixtures/db';
import { env } from '../fixtures/env';
import { getCsrfToken } from './api';

// Beam seed shared by weaving-in.spec.ts and fabric-taka-register.spec.ts —
// both need an issued-to-weaver-eligible purchase beam with a known
// setLength (WI-L6: beamTotalMeters prefills from setLength at dispatch).
// Driven via direct API: fabtraq-fe's beam-receipts form has no e2e-friendly
// way to also assert the beams row synchronously, and this is already the
// established "BE-validated request, no bespoke UI drive needed" pattern in
// this suite (weaving-dispatch.spec.ts's own createReceivedBeam precedent).
export async function createReceivedBeam(
  page: Page,
  db: Db,
  opts: { netWeight: number; setLength: number },
): Promise<{ id: string; beamNumber: string }> {
  const csrfToken = await getCsrfToken(page);
  const beamNumber = codes.unique('BM-WVI');
  const res = await page.request.post(`${env.API_URL}/beam-receipts`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: {
      date: new Date().toISOString().slice(0, 10),
      beamOrigin: 'purchase',
      items: [{ beamNumber, netWeight: opts.netWeight, setLength: opts.setLength }],
    },
  });
  if (res.status() !== 201) throw new Error(`beam receipt create failed: ${await res.text()}`);
  const beam = await db.queryOne<{ id: string }>(`SELECT id FROM beams WHERE beam_number = $1`, [
    beamNumber,
  ]);
  if (!beam) throw new Error('the purchase beam receipt must register a beams row');
  return { id: beam.id, beamNumber };
}

// FabricDesign seed via direct API — shared so neither weaving-in.spec.ts nor
// fabric-taka-register.spec.ts re-proves FabricDesign create (that's
// masters/fabric-designs.spec.ts's job, DRY). expectedGlm defaults to 250 so
// a taka filled at meters * 0.25 = weightKg (both callers' convention) never
// trips the GLM-mismatch flag. `prefix` keeps each spec's rows visually
// distinct in the DB without changing collision safety (codes.unique already
// guarantees uniqueness via its run tag + counter).
export async function createFabricDesign(
  page: Page,
  db: Db,
  weftQualityId: string,
  opts: { prefix?: string; expectedGlm?: number } = {},
): Promise<{ id: string; code: string }> {
  const csrfToken = await getCsrfToken(page);
  const code = codes.unique(opts.prefix ?? 'FABD-WVI');
  const res = await page.request.post(`${env.API_URL}/fabric-designs`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { code, name: `E2E ${code}`, weftQualityId, expectedGlm: opts.expectedGlm ?? 250 },
  });
  if (res.status() !== 201) throw new Error(`fabric design create failed: ${await res.text()}`);
  const design = await db.queryOne<{ id: string }>(
    `SELECT id FROM fabric_designs WHERE code = $1`,
    [code],
  );
  if (!design) throw new Error('the fabric design create must register a fabric_designs row');
  return { id: design.id, code };
}
```

- [ ] **Step 2: Add `confirmDialogAndWait` to `support/api.ts`**

```typescript
// e2e/support/api.ts — append below the existing getCsrfToken export
import { expect, type Page, type Response } from '@playwright/test';

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
```

- [ ] **Step 3: Rewire `weaving-in.spec.ts` to import both, delete the now-duplicate locals**

Remove the local `createReceivedBeam`, `createFabricDesign`, and `clickConfirmAndWait` function
bodies (current lines ~16–92) and the now-unused `env`/`codes` imports (both were only referenced
inside the removed functions). Replace with:

```typescript
// e2e/tests/flows/weaving-in.spec.ts — top of file
import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { confirmDialogAndWait, getCsrfToken as _getCsrfToken } from '../../support/api';
// getCsrfToken is not called directly in this file anymore (both seed
// helpers that used it now live in weaving-in-fixtures.ts) — drop the import
// entirely rather than aliasing it as unused. Kept here only to make the
// diff obvious; delete this line for real in the edit.
import { createFabricDesign, createReceivedBeam } from '../../support/weaving-in-fixtures';
```

(The commented-out alias line above is illustrative only — the actual edit imports exactly
`{ confirmDialogAndWait }` from `../../support/api` and drops the `getCsrfToken`/`env`/`codes`
imports outright, since nothing in the file calls them anymore.) Every call site of
`clickConfirmAndWait(page, ...)` in the file becomes `confirmDialogAndWait(page, ...)` (same
signature, so this is a pure rename — two call sites: the receipt cancel and the blocked dispatch
cancel).

- [ ] **Step 4: Typecheck**

Run: `cd e2e && npm run typecheck`
Expected: no errors — confirms the extraction didn't change `weaving-in.spec.ts`'s behavior and the
new modules are well-typed.

- [ ] **Step 5: Commit**

```bash
cd e2e
git add support/weaving-in-fixtures.ts support/api.ts tests/flows/weaving-in.spec.ts
git commit -m "test(e2e): extract shared weaving-in seed + confirm-dialog helpers for fabric-taka-register spec"
```

---

### Task 2: Fabric Taka Register flow spec

**Files:**
- Create: `e2e/tests/flows/fabric-taka-register.spec.ts`

**Interfaces:**
- Consumes: `fixtures/test.ts`, `fixtures/db.ts` (`Db`), `fixtures/codes.ts`, `support/nav.ts`,
  `support/forms.ts`, `support/assert.ts`, `support/api.ts` (`confirmDialogAndWait`),
  `support/weaving-in-fixtures.ts` (`createReceivedBeam`, `createFabricDesign`). Reuses
  `weaving-in.spec.ts`'s proven dispatch→receive UI-drive (same beam-count/weft-math shape:
  beam1 100m/15kg warp, beam2 80m/12kg warp, three taka totalling derivedWeftKg=9.0) so this spec's
  own math needs no new hand-verification — it is the exact chain already proven live by
  `weaving-in.spec.ts`, extended with the new header-location field and three explicit paper
  serials.
- Produces: nothing consumed elsewhere (leaf flow spec). Establishes the **FE contract** for:
  - `/weaving-ins/new` header gains an *optional* `LocationFloorSelect`
    (`shared/components/LocationFloorSelect.tsx`, existing component, existing aria-labels
    `'Select location'` / `'Select floor'` — verbatim reuse per the locked FE plan, not new markup).
  - `/fabric-takas` register page: `PageHeader` title `'Fabric Takas'`; supports
    `?weavingInId=<id>` as a URL filter (mirroring the Fabric tab's already-specified
    `?fabricDesignId=<id>` deep link — same `PARAM`/`buildQuery` machinery, one more key); uses
    `DataTable`'s existing `'Search records'` search input (no new markup); each row's selection
    cell is a native checkbox `aria-label="Select taka, paper serial ${paperSerialNo}"`; a running
    totals line matching `/^\d+ taka · [\d.]+ m · [\d.]+ kg$/`; a button
    `` `Place selected (${n})` `` that opens `PlaceTakaDialog`.
  - `PlaceTakaDialog`: a shadcn `Dialog` (`page.getByRole('dialog')`), title `'Place taka'`, embeds
    `LocationFloorSelect` (same `'Select location'`/`'Select floor'` aria-labels — no collision,
    the register page itself has no location select), submit button `'Place taka'`.
  - `/fabric-takas/:id` detail page: a `'Beams'` section (mirrors `beam-detail.page.tsx`'s
    `Section`/`Field` pattern per the locked FE plan) whose text includes every linked beam number.
  - Stock Balance Fabric tab (`/inventory?tab=fabric`, existing page/route) row text stays exactly
    `` `Placed ${n} · Unplaced ${m}` `` (existing, unmodified copy — confirmed by reading
    `inventory-balance.page.tsx` directly, not guessed).

- [ ] **Step 1: Write the spec**

```typescript
// e2e/tests/flows/fabric-taka-register.spec.ts
import { test, expect } from '../../fixtures/test';
import { env } from '../../fixtures/env';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { confirmDialogAndWait, getCsrfToken } from '../../support/api';
import { createFabricDesign, createReceivedBeam } from '../../support/weaving-in-fixtures';
import type { Page } from '@playwright/test';

// Reads the Stock Balance Fabric tab's placed/unplaced pair for one design,
// straight off the rendered table row (inventory-balance.page.tsx:224-233:
// `Placed ${n} · Unplaced ${m}`). A design with zero taka yet renders NO row
// at all (the tbody maps over fabricRows, which the aggregate query never
// returns a zero-taka design in) — treat "row absent" as {placed:0,
// unplaced:0} rather than failing, so this helper works both before AND
// after this test's own receive step creates the row.
async function readFabricTabCounts(
  page: Page,
  designCode: string,
  designName: string,
): Promise<{ placed: number; unplaced: number }> {
  await gotoAndExpect(page, '/inventory?tab=fabric');
  const row = page.getByRole('row', { name: new RegExp(`${designCode} .* ${designName}`) });
  if ((await row.count()) === 0) return { placed: 0, unplaced: 0 };
  const text = (await row.first().textContent()) ?? '';
  const m = /Placed (\d+) · Unplaced (\d+)/.exec(text);
  if (!m) throw new Error(`Fabric tab row did not match "Placed n · Unplaced m": "${text}"`);
  return { placed: Number(m[1]), unplaced: Number(m[2]) };
}

test(
  'fabric taka register: receive with a header location, find by paper serial, move floors, detail provenance, cancel clears placement',
  async ({ page, db }) => {
    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide an active job worker').not.toBeNull();

    // Two distinct active (location, floor) pairs — pair[0] is the header
    // location applied at receipt (FTR-L9), pair[1] is where two of the
    // three taka get moved to via the register. Deliberately NOT constrained
    // to share a location: the register's move action only needs the floor
    // to belong to the CHOSEN location (design spec §3.4 step 3), and
    // requiring two floors under one location would assume seed shape this
    // suite otherwise never assumes.
    const floorPairs = await db.queryMany<{
      location_id: string;
      location_code: string;
      location_name: string;
      floor_id: string;
      floor_name: string;
    }>(
      `SELECT l.id AS location_id, l.code AS location_code, l.name AS location_name,
              f.id AS floor_id, f.name AS floor_name
       FROM location_floors f
       JOIN locations l ON l.id = f.location_id
       WHERE f.status = 'active' AND l.status = 'active'
       ORDER BY f.id
       LIMIT 2`,
    );
    expect(
      floorPairs.length,
      'seed must provide at least two active (location, floor) pairs',
    ).toBeGreaterThanOrEqual(2);
    const [placeAt, moveTo] = floorPairs as [(typeof floorPairs)[0], (typeof floorPairs)[0]];

    // Weft source — same derivation as weaving-in.spec.ts (any non-beam-track
    // floor lot, active masters, >= Q_WEFT balance). Reusing the identical
    // beam/taka math (100m/15kg + 80m/12kg beams, 30/40/20m taka) means this
    // spec's derivedWeftKg is the already-hand-verified 9.0 from that spec —
    // no new arithmetic to re-derive here.
    const Q_WEFT = 15;
    const src = await db.queryOne<{
      lot_number: string;
      sku_id: string;
      quality_id: string;
      quality_code: string;
      quality_name: string;
      sku_name: string;
      sku_shade_number: string | null;
      loc_name: string;
      floor_name: string;
    }>(
      `SELECT s.lot_number, s.sku_id, s.quality_id,
              q.code AS quality_code, q.name AS quality_name,
              sku.name AS sku_name, sku.shade_number AS sku_shade_number,
              l.name AS loc_name, f.name AS floor_name
       FROM stock_ledger s
       JOIN location_floors f ON f.id = s.floor_id
       JOIN locations l ON l.id = f.location_id
       JOIN yarn_qualities q ON q.id = s.quality_id
       JOIN yarn_skus sku ON sku.id = s.sku_id
       WHERE s.lot_number IS NOT NULL
         AND s.sku_id IS NOT NULL
         AND l.status = 'active' AND f.status = 'active'
         AND q.status = 'active' AND sku.status = 'active'
       GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
                sku.name, sku.shade_number, l.name, f.name
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q_WEFT],
    );
    expect(src, 'seed must provide a lot with >= Q_WEFT balance on an active floor').not.toBeNull();

    // Distinct prefix from weaving-in.spec.ts's FABD-WVI so the two specs'
    // rows stay visually distinguishable in the DB even though codes.unique
    // already guarantees no real collision.
    const fabricDesign = await createFabricDesign(page, db, src!.quality_id, { prefix: 'FABD-FTR' });

    const beam1 = await createReceivedBeam(page, db, { netWeight: 15, setLength: 100 });
    const beam2 = await createReceivedBeam(page, db, { netWeight: 12, setLength: 80 });

    // BASELINE — Fabric tab placed/unplaced BEFORE this test's receive.
    // fabricDesign was just created with zero taka, so this is {0, 0} today,
    // but the assertion below is a DELTA regardless (e2e/README.md:77 /
    // context-doc's e2e section) — it must hold even if a future change adds
    // taka to a design before its own receive step.
    const fabricBefore = await readFabricTabCounts(page, fabricDesign.code, `E2E ${fabricDesign.code}`);

    // DISPATCH both beams + weft to the weaver — identical UI-drive to
    // weaving-in.spec.ts (its own selectors, not new contract).
    await gotoAndExpect(page, '/weaving-dispatches/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByLabel('Show beams for all weavers').check();
    await page.getByLabel('Search beams').fill(beam1.beamNumber);
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    await page.getByLabel(`Gross weight for beam ${beam1.beamNumber}`).fill('17');
    await page.getByLabel(`Pipe weight for beam ${beam1.beamNumber}`).fill('2');
    await page.getByLabel('Search beams').fill(beam2.beamNumber);
    await page.getByLabel(`Select beam ${beam2.beamNumber}`).check();
    await page.getByLabel(`Gross weight for beam ${beam2.beamNumber}`).fill('14');
    await page.getByLabel(`Pipe weight for beam ${beam2.beamNumber}`).fill('2');
    await fillByLabel(page, 'Beam Value of Goods', '5000');
    await selectByAriaLabel(page, 'Quality for weft line 1', `${src!.quality_code} – ${src!.quality_name}`);
    const skuOptionLabel =
      src!.sku_shade_number !== null && src!.sku_shade_number !== ''
        ? `${src!.sku_name} — ${src!.sku_shade_number}`
        : src!.sku_name;
    await selectByAriaLabel(page, 'Select SKU', skuOptionLabel);
    await selectByAriaLabel(page, 'Source lot for weft line 1', src!.lot_number);
    await fillByLabel(page, 'Net weight for weft line 1', String(Q_WEFT));
    await clickButton(page, 'Add placement');
    await selectByAriaLabel(page, 'Select floor and location', `${src!.loc_name} · ${src!.floor_name}`);
    await fillByLabel(page, 'placement quantity 1', String(Q_WEFT));
    await fillByLabel(page, 'Weft Value of Goods', '3000');
    await clickButton(page, 'Save dispatch');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-dispatches\/[^/]+$/);

    // RECEIVE — header gains the new, optional LocationFloorSelect (FTR-L9).
    // Three taka, each given a unique paper serial so the "find by the
    // weaver's paper serial" step has a deterministic target, and one taka
    // (S3) split across both beams so the "detail shows beam provenance"
    // step has real multi-beam data to assert.
    const s1 = codes.unique('S');
    const s2 = codes.unique('S');
    const s3 = codes.unique('S');

    await gotoAndExpect(page, '/weaving-ins/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await fillByLabel(page, 'Paper challan no', '149');
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    await page.getByLabel(`Select beam ${beam2.beamNumber}`).check();

    // New FTR-L9 header field. Optional on the schema, but this test sets it
    // — the whole point of this spec is proving the receipt-time placement
    // path, not the "still Unplaced" fallback (which is a BE/FE integration
    // test's job per design spec §5).
    await selectByAriaLabel(page, 'Select location', `${placeAt.location_code} – ${placeAt.location_name}`);
    await selectByAriaLabel(page, 'Select floor', placeAt.floor_name);

    const fillTaka = async (
      n: number,
      opts: {
        paperSerial: string;
        meters: number;
        weightKg: number;
        attribution: Array<{ beamNumber: string; meters: number }>;
      },
    ) => {
      if (n > 0) await clickButton(page, 'Add taka');
      await fillByLabel(page, `paper serial, takas.${n}`, opts.paperSerial);
      await selectByAriaLabel(page, `fabric design, takas.${n}`, fabricDesign.code);
      await fillByLabel(page, `meters, takas.${n}`, String(opts.meters));
      await fillByLabel(page, `weight, takas.${n}`, String(opts.weightKg));
      await clickButton(page, `Set beam allocation, takas.${n}`);
      for (const alloc of opts.attribution) {
        await fillByLabel(
          page,
          `attributed meters for beam ${alloc.beamNumber}, takas.${n}`,
          String(alloc.meters),
        );
      }
      await clickButton(page, `Done, takas.${n}`);
      await expect(page.locator(`[data-cell="glm"][data-row="${n}"]`)).toContainText(/250(\.0+)?/);
    };

    await fillTaka(0, {
      paperSerial: s1,
      meters: 30,
      weightKg: 7.5,
      attribution: [{ beamNumber: beam1.beamNumber, meters: 30 }],
    });
    await fillTaka(1, {
      paperSerial: s2,
      meters: 40,
      weightKg: 10,
      attribution: [{ beamNumber: beam1.beamNumber, meters: 40 }],
    });
    await fillTaka(2, {
      paperSerial: s3,
      meters: 20,
      weightKg: 5,
      attribution: [
        { beamNumber: beam1.beamNumber, meters: 10 },
        { beamNumber: beam2.beamNumber, meters: 10 },
      ],
    });

    await expect(page.locator('[aria-label="derived weft kg"]')).toContainText(/9(\.0+)?/);
    await fillByLabel(page, 'Entered weft kg', '9');

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-ins\/[^/]+$/);
    const receiptId = page.url().split('/').pop() as string;
    const frcNo = await captureDocNo(page.getByRole('main'), /\bFRC-\d{4}-\d{2}-\d{3,}\b/);
    expect(frcNo).toMatch(/^FRC-\d{4}-\d{2}-\d{3,}$/);

    // ASSERT — Fabric tab placed/unplaced DELTA around the receive. Exactly
    // 3 taka move to "placed" (header location applied to every row per
    // §3.0), zero to "unplaced". Never an absolute — see Global Constraints.
    const fabricAfterReceive = await readFabricTabCounts(
      page,
      fabricDesign.code,
      `E2E ${fabricDesign.code}`,
    );
    expect(fabricAfterReceive.placed - fabricBefore.placed).toBe(3);
    expect(fabricAfterReceive.unplaced - fabricBefore.unplaced).toBe(0);

    // ASSERT — register lists these taka as PLACED. Deep-link via
    // ?weavingInId=<id> (§3.1's weavingInId filter, exercised here through
    // the same URL-param deep-link machinery the Fabric tab already uses for
    // ?fabricDesignId=<id> — "these 13 taka" per design spec §3.1).
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    for (const serial of [s1, s2, s3]) {
      const checkbox = page.getByRole('checkbox', { name: `Select taka, paper serial ${serial}` });
      await expect(checkbox).toBeVisible();
      const row = checkbox.locator('xpath=ancestor::tr[1]');
      await expect(row).toContainText(placeAt.floor_name);
    }

    // FIND ONE BY THE WEAVER'S PAPER SERIAL — the register-wide search box
    // (DataTable's own 'Search records' input), not the weavingInId filter.
    // §3.2's parse falls back to a substring match on paperSerialNo, so the
    // full unique serial narrows to exactly this one taka across the whole
    // register, not just this receipt.
    await gotoAndExpect(page, '/fabric-takas');
    await page.getByLabel('Search records').fill(s3);
    const s3Checkbox = page.getByRole('checkbox', { name: `Select taka, paper serial ${s3}` });
    await expect(s3Checkbox).toBeVisible();
    await expect(page.getByRole('checkbox', { name: `Select taka, paper serial ${s1}` })).toHaveCount(0);
    await page.getByLabel('Search records').fill('');

    // SELECT TWO (S1, S2) AND MOVE THEM to a different floor. Back on the
    // weavingInId-scoped view so all three rows are visible together.
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    await page.getByRole('checkbox', { name: `Select taka, paper serial ${s1}` }).check();
    await page.getByRole('checkbox', { name: `Select taka, paper serial ${s2}` }).check();
    // Running totals: 30+40=70m, 7.5+10=17.5kg over the 2 selected taka.
    await expect(page.getByText(/2 taka · 70(\.0+)? m · 17\.5(\.0+)? kg/)).toBeVisible();

    await clickButton(page, 'Place selected (2)');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('combobox', { name: 'Select location' }).click();
    await page.getByRole('option', { name: `${moveTo.location_code} – ${moveTo.location_name}` }).click();
    await dialog.getByRole('combobox', { name: 'Select floor' }).click();
    await page.getByRole('option', { name: moveTo.floor_name }).click();
    const [placeRes] = await Promise.all([
      page.waitForResponse(
        (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/fabric-takas/place',
      ),
      dialog.getByRole('button', { name: 'Place taka' }).click(),
    ]);
    expect(placeRes.status()).toBe(200);
    await expect(dialog).not.toBeVisible();

    // ASSERT — the underlying state, not just on-screen text (this suite's
    // standing rule for anything a number depends on). Exactly the 2 moved
    // taka carry the new floor; S3 is untouched.
    const movedRows = await db.queryMany<{ paper_serial_no: string; floor_id: string }>(
      `SELECT paper_serial_no, floor_id FROM fabric_takas WHERE weaving_in_id = $1 ORDER BY paper_serial_no`,
      [receiptId],
    );
    const byserial = new Map(movedRows.map((r) => [r.paper_serial_no, r.floor_id] as const));
    expect(byserial.get(s1)).toBe(moveTo.floor_id);
    expect(byserial.get(s2)).toBe(moveTo.floor_id);
    expect(byserial.get(s3)).toBe(placeAt.floor_id);

    // ASSERT — Fabric tab placed/unplaced is UNCHANGED by a same-status
    // move (still all 3 placed, still 0 unplaced) — proves the register's
    // move action is a relocation, not a placement-state transition.
    const fabricAfterMove = await readFabricTabCounts(
      page,
      fabricDesign.code,
      `E2E ${fabricDesign.code}`,
    );
    expect(fabricAfterMove.placed).toBe(fabricAfterReceive.placed);
    expect(fabricAfterMove.unplaced).toBe(fabricAfterReceive.unplaced);

    // DETAIL PAGE — beam provenance. S3 is the split taka (beam1 + beam2).
    const s3Row = await db.queryOne<{ id: string }>(
      `SELECT id FROM fabric_takas WHERE weaving_in_id = $1 AND paper_serial_no = $2`,
      [receiptId, s3],
    );
    expect(s3Row, 'S3 taka must exist').not.toBeNull();
    await gotoAndExpect(page, `/fabric-takas/${s3Row!.id}`);
    const beamsSection = page.locator('section', { has: page.getByRole('heading', { name: 'Beams' }) });
    await expect(beamsSection).toContainText(beam1.beamNumber);
    await expect(beamsSection).toContainText(beam2.beamNumber);

    // CANCEL the receipt — same alertdialog-confirm shape as
    // weaving-in.spec.ts, via the shared confirmDialogAndWait helper.
    await gotoAndExpect(page, `/weaving-ins/${receiptId}`);
    const cancelRes = await confirmDialogAndWait(
      page,
      'Cancel receipt',
      /\/weaving-ins\/[^/]+\/cancel$/,
    );
    expect(cancelRes.status()).toBe(200);
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

    // ASSERT — locationId/floorId nulled for ALL THREE taka (design spec
    // §3.5), regardless of which floor each currently sits on.
    const afterCancel = await db.queryMany<{ paper_serial_no: string; location_id: string | null }>(
      `SELECT paper_serial_no, location_id FROM fabric_takas WHERE weaving_in_id = $1`,
      [receiptId],
    );
    expect(afterCancel).toHaveLength(3);
    for (const row of afterCancel) {
      expect(row.location_id, `${row.paper_serial_no} must have locationId cleared`).toBeNull();
    }

    // ASSERT — the taka leave the DEFAULT register view (status omitted ⇒
    // 'received', which now excludes this cancelled receipt's rows).
    await gotoAndExpect(page, `/fabric-takas?weavingInId=${receiptId}`);
    await expect(
      page.getByRole('checkbox', { name: `Select taka, paper serial ${s1}` }),
    ).toHaveCount(0);
    await expect(
      page.getByRole('checkbox', { name: `Select taka, paper serial ${s3}` }),
    ).toHaveCount(0);
  },
);
```

- [ ] **Step 2: Typecheck** (BE/FE don't exist yet, so this cannot run live — typecheck is the
  available fast-feedback signal; behavior is proven in Task 4)

Run: `cd e2e && npm run typecheck`
Expected: no new errors from `tests/flows/fabric-taka-register.spec.ts`.

- [ ] **Step 3: Commit**

```bash
cd e2e
git add tests/flows/fabric-taka-register.spec.ts
git commit -m "test(e2e): fabric taka register spec (receive-with-location, search, move, detail provenance, cancel)"
```

---

### Task 3: Route smoke + role guard entry

**Files:**
- Modify: `e2e/tests/smoke/routes.spec.ts`
- Modify: `e2e/tests/guards/role-guards.spec.ts`

**Interfaces:**
- Consumes: existing `ROUTES` arrays in both files (append-only edits, no restructuring).
- Produces: nothing — leaf task.

- [ ] **Step 1: Append the route to the smoke list**

```typescript
// e2e/tests/smoke/routes.spec.ts — add to ROUTES, after '/weaving-ins'
  '/weaving-ins',
  '/fabric-takas',
] as const;
```

- [ ] **Step 2: Append the register route to role-guards**

`listFabricTakas` is registered auth-only for **all three roles** (locked contract, shared
registry table) — unlike every other current entry in this file, no role is denied here. That is
still a legitimate guard-table entry: it proves the route doesn't accidentally 403 anyone, the same
shape `assertAllowed`-only entries already take for the `accountant`-allowed
`/beam-receipts/new` row.

```typescript
// e2e/tests/guards/role-guards.spec.ts — add to ROUTES, after the
// fabric-designs entry.
  {
    path: '/fabric-takas',
    heading: 'Fabric Takas',
    allowedRoles: ['owner', 'storekeeper', 'accountant'],
  },
];
```

- [ ] **Step 3: Typecheck**

Run: `cd e2e && npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd e2e
git add tests/smoke/routes.spec.ts tests/guards/role-guards.spec.ts
git commit -m "test(e2e): route smoke + role guard entry for fabric-takas"
```

---

### Task 4: Live run against the real stack

**Files:** none (verification only — may touch any file from Tasks 1–3 if a live mismatch needs
fixing).

**Interfaces:**
- Consumes: the full set of files from Tasks 1–3, plus the real `fabtraq-be`/`fabtraq-fe`/
  `fabtraq-shared` implementations landed by the sibling BE/FE/shared plans for this same
  workstream (shared → 1.16.0 tarball installed per the locked contract's repo order).
- Produces: a green single-run for each new/modified spec, then one green full-suite run.

This task cannot run until `plan-shared`/`plan-be`/`plan-fe`'s work has actually landed — it is the
live-verification gate for everything above, not a parallel task.

- [ ] **Step 1: Free the ports**

```bash
lsof -ti :4000 :5173 :7300 || true
```

If any port is occupied by this project's own dev servers, kill the `npm run dev` / `tsx watch`
**parent** process (killing only the child lets `tsx watch` respawn it). If a shell you don't
control owns the port, ask before killing it.

- [ ] **Step 2: Run each new/modified spec individually (no reseed)**

```bash
cd e2e
npx playwright test tests/flows/weaving-in.spec.ts --project=authed
npx playwright test tests/flows/fabric-taka-register.spec.ts --project=authed
npx playwright test tests/smoke/routes.spec.ts --project=authed
npx playwright test tests/guards/role-guards.spec.ts --project=authed
```

`weaving-in.spec.ts` is included first, specifically because Task 1 modified it — a regression
there from the extraction is a real bug in this plan's own work, not noise, and must be caught
before the new spec's own selectors are even in play.

Expected: all pass. If a selector doesn't match the real FE (labels/aria-labels chosen in Task 2
are this plan's best-effort FE contract, not guaranteed pixel-for-pixel — this is the "fail for the
right reason" step called out in Global Constraints), fix the **spec** to match the shipped FE
unless the shipped FE's naming is clearly the worse choice — in that case coordinate the FE-side fix
with the lead rather than silently diverging from the contract other tasks may also rely on. Re-run
the affected spec after each fix until green.

Two specific spots most likely to need a live correction, flagged in advance:

1. `readFabricTabCounts`'s `getByRole('row', { name: ... })` regex assumes the table row's
   accessible name concatenates all cell text with the design code and name both present and
   separated by whitespace — if the live DOM renders the row differently (e.g. the code/name cell
   is a single interpolated string with a different separator, per `inventory-balance.page.tsx:226`:
   `` `${row.code} – ${row.name}` ``), loosen the regex or switch to `page.locator('tr',
   { hasText: designCode })` instead of `getByRole('row', { name })`.
2. `PlaceTakaDialog`'s two `LocationFloorSelect` triggers are addressed via
   `dialog.getByRole('combobox', { name: 'Select location' })` — if the live implementation renders
   them as plain buttons (shadcn `SelectTrigger` is a `button`, but its accessible role can resolve
   to `combobox` or `button` depending on Radix version/attrs), verify live and swap to
   `dialog.locator('[aria-label="Select location"]')` (the pattern `selectByAriaLabel` already uses
   elsewhere in this suite) if `combobox` doesn't match.

- [ ] **Step 3: Full-suite regression run (RESEEDS `fabtraq_dev` — do not run against a DB you care
  about)**

```bash
cd e2e
npm run e2e
```

Expected: full suite green, including every pre-existing spec (a same-repo failure elsewhere is a
real regression to investigate, not noise).

- [ ] **Step 4: Re-seed warning**

Per `feedback_integration_tests_wipe_dev_db` — `npm run e2e` truncates and reseeds the shared dev
database any other session's manual dev work might be using. After Step 3, tell the user/lead the
dev DB was reset.

- [ ] **Step 5: Commit any live-run fixes**

```bash
cd e2e
git add -A
git commit -m "test(e2e): live-verification fixes for fabric-taka-register selectors"
```

(Skip this commit if Step 2/3 needed no fixes.)

---

## Self-review against spec §5's e2e bullet

- "receive a multi-taka weaving-in WITH a header location" → Task 2, the new
  `selectByAriaLabel(page, 'Select location'/'Select floor', ...)` calls right after the beam
  checkboxes, before `fillTaka`. ✅
- "register lists those taka as PLACED" → Task 2, the `?weavingInId=` deep-link block asserting all
  three checkboxes visible and each row containing `placeAt.floor_name`. ✅
- "find one by the weaver's paper serial" → Task 2, the `Search records` block narrowing to `s3`
  and asserting `s1` absent. ✅
- "select two and move them to a different floor" → Task 2, the two-checkbox select + running-totals
  assertion + `PlaceTakaDialog` flow + DB assertion that only `s1`/`s2` moved and `s3` didn't. ✅
- "Fabric tab placed/unplaced split moves by exactly the right DELTA" → Task 2,
  `readFabricTabCounts` before/after the RECEIVE step (delta +3 placed / +0 unplaced), plus a second
  before/after pair around the MOVE step proving it's delta-zero (a relocation, not a placement
  transition) — **no absolute count assertion anywhere in this spec**. ✅
- "detail page shows beam provenance" → Task 2, `/fabric-takas/${s3Row.id}` asserting both beam
  numbers inside the `Beams` section. ✅
- "cancel the receipt" → Task 2, `confirmDialogAndWait(page, 'Cancel receipt', ...)`, status 200. ✅
- "assert locationId IS NULL in the DB" → Task 2, the `afterCancel` query asserting all three rows'
  `location_id` is `null`. ✅
- "the taka leave the default register view" → Task 2, the final `?weavingInId=` re-check with no
  `status` param (default = `received`), asserting both checkboxes have count 0. ✅
- House-sweep additions (`routes.spec.ts`, `role-guards.spec.ts`) instead of bespoke smoke/guard
  tests → Task 3. ✅
- Live run as its own final task, DB-reset choreography documented → Task 4. ✅
- Delta-only rule verified: every count-bearing assertion in Task 2 (Fabric tab placed/unplaced) is
  a before/after difference; every other assertion (floor id after move, `location_id IS NULL` after
  cancel, row presence/absence) is a state check, not a running total, so the "never absolute"
  README rule does not apply to it and is not violated by it. ✅
- Repeat-run safety: every identifier (`fabricDesign.code` via `codes.unique`, `beamNumber` via
  `codes.unique`, `s1`/`s2`/`s3` via `codes.unique`) is unique per run; the spec never assumes a
  clean DB, only ever a `>= 2` active-floor-pair seed precondition (asserted explicitly, matching the
  suite's existing "seed must provide…" `expect(...).not.toBeNull()` convention). ✅
