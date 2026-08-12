# Weaving In — e2e Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cover the Weaving In feature (FabricDesign master + the FRC- fabric-receipt transaction) with Playwright specs against the real fabtraq-be/fabtraq-fe stack, proving the full physical/ledger chain — dispatch → receive → cancel-reversal → re-receive → beam close → dispatch-cancel-now-blocked — the way `weaving-dispatch.spec.ts` proved the dispatch half.

**Architecture:** Two new spec files (`tests/masters/fabric-designs.spec.ts`, `tests/flows/weaving-in.spec.ts`) plus small additions to two existing smoke/guard specs. One new tiny support module (`support/api.ts`) for the CSRF-token extraction already duplicated once in `weaving-dispatch.spec.ts` — a second caller makes it worth sharing.

**Tech Stack:** Playwright + TypeScript, the existing `fixtures/test.ts` (`db` fixture), `fixtures/db.ts` (`Db.ledgerBalance`/`queryOne`/`queryMany`), `fixtures/codes.ts`, `support/forms.ts`, `support/nav.ts`, `support/assert.ts`. No new dependencies.

## Global Constraints

- **Branch:** `feat/s6-consolidated-e2e`, already checked out. Do not switch branches. Commit per task; do not push.
- **Serial suite, own data:** every test creates its own rows with unique codes (`codes.unique(prefix)` / `codes.designCode()`-style helpers); never assume a clean DB.
- **Ledger assertions are DELTAS, never absolutes** — read `db.ledgerBalance(key)` before and after, assert the difference.
- **Minted document numbers are asserted by FORMAT (regex), never by value** — `captureDocNo` / inline regex only.
- **Radix `alertdialog` confirms** are scoped to the dialog (`page.getByRole('alertdialog')`), and the confirming click is always raced against `page.waitForResponse` via `Promise.all` — a bare click races the server-side write.
- **Selectors:** `getByRole`/`getByLabel`/`aria-label` locators only — this app has ~no `data-testid` outside a few documented exceptions (`sku-swatch`, `shade-colour-gate`). New FE aria-labels introduced by this plan (fabric-design form fields, the weaving-in grid, the beam-attribution popover, the beam-detail "Remaining Meters" field, the beam close button) are the **FE build contract** for this workstream — `plan-fe` implements to these exact strings. If the live-run task (Task 4) finds a real mismatch, fix the spec (or, if the mismatch is a genuine FE naming improvement, fix the FE to match this contract — coordinate via the lead) and note the correction in the commit.
- **DB reset rules (README):** `npm run e2e` (full suite) always runs `db:reset && db:seed` against `fabtraq_dev` first — never run it against a DB whose contents matter. A **single-spec** run (`npx playwright test <path> --project=authed`) does **not** reseed, but the suite owns ports `:4000`/`:5173` (`reuseExistingServer:false`) — any already-running `npm run dev` in `fabtraq-be`/`fabtraq-fe` must be stopped first (kill the `tsx watch` **parent**, not just the child, or it respawns) or the run fails with `EADDRINUSE`.
- **Coverage of the design spec's own e2e bullet (§5):** dispatch beams+weft → weaving-in (2 taka on 1 beam + 1 taka on 2 beams) → beam remaining + weft `stillAtJw` in UI → cancel → full reversal → re-receive → close beam → dispatch cancel now blocked. This plan's Task 2 is that exact chain, live-verified in Task 4.

---

### Task 1: FabricDesign master spec

**Files:**
- Create: `e2e/tests/masters/fabric-designs.spec.ts`

**Interfaces:**
- Consumes: `fixtures/test.ts` (`test`, `expect`, `db`), `fixtures/codes.ts` (`codes.unique`, `codes.qualityName` not needed here — reuse `codes.unique('FABD')` for the design's business code), `support/nav.ts` (`gotoAndExpect`), `support/forms.ts` (`fillByLabel`, `selectByAriaLabel`, `clickButton`), `support/assert.ts` (`expectToast`).
- Produces: nothing consumed by later tasks (standalone master spec, mirrors `tests/masters/job-workers.spec.ts`'s create→list→edit→persist shape). Establishes the FE contract for `/fabric-designs`, `/fabric-designs/new`, `/fabric-designs/:id/edit`: labels `'Code'`, `'Name'`, `'Weft quality'` (select, option text `${code} – ${name}`), `'Expected GLM'`; submit buttons `'Create'` / `'Update'`; toasts `'Fabric design created'` / `'Fabric design updated'` (job-worker-anatomy wording, per the design spec's "job-worker anatomy" note).

- [ ] **Step 1: Write the spec**

```typescript
// e2e/tests/masters/fabric-designs.spec.ts
import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { gotoAndExpect } from '../../support/nav';
import { fillByLabel, selectByAriaLabel, clickButton } from '../../support/forms';
import { expectToast } from '../../support/assert';

// FabricDesign (2026-08-12 weaving-in spec §2/§4) is a standard master —
// "job-worker anatomy": CRUD with a real edit route, unlike beam Design
// (create -> read-only detail, no edit — designs.spec.ts). `code` is a
// user-typed business code ("TATA" in the spec's own example — the weaver's
// paper "Design No"), NOT server-minted like DSN-/JW- codes, so it's a plain
// required text field on the form, same treatment as HSN Code on
// quality-form.page.tsx.
test('create → list → edit → persist a fabric design', async ({ page, db }) => {
  const quality = await db.queryOne<{ id: string; code: string; name: string }>(
    `SELECT id, code, name FROM yarn_qualities WHERE status = 'active' ORDER BY code LIMIT 1`,
  );
  expect(quality, 'seed must provide at least one active yarn quality').not.toBeNull();

  const code = codes.unique('FABD');
  const name = `E2E Fabric Design ${code}`;

  // CREATE
  await gotoAndExpect(page, '/fabric-designs/new');
  await fillByLabel(page, 'Code', code);
  await fillByLabel(page, 'Name', name);
  // weftQualityId is the only other required field on createFabricDesignSchema
  // (spec §2) — expectedGlm/jobRatePerMeter/weftSkuId/beamDesigns are all
  // optional, left untouched for the happy-path create.
  await selectByAriaLabel(page, 'Weft quality', `${quality!.code} – ${quality!.name}`);
  await clickButton(page, 'Create');
  await expectToast(page, 'Fabric design created');

  // LIST — new fabric design appears
  await gotoAndExpect(page, '/fabric-designs');
  await expect(page.getByRole('cell', { name })).toBeVisible();

  // EDIT — same row/link shape as job-workers.spec.ts / qualities.spec.ts
  // (Edit is a react-router Link, not a plain button).
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/fabric-designs\/[^/]+\/edit/);
  await fillByLabel(page, 'Expected GLM', '250');
  await clickButton(page, 'Update');
  await expectToast(page, 'Fabric design updated');

  // PERSIST — reopen via a fresh navigation, verify the edited field.
  await gotoAndExpect(page, '/fabric-designs');
  await page.getByRole('row', { name }).getByRole('link', { name: 'Edit' }).click();
  await expect(page).toHaveURL(/\/fabric-designs\/[^/]+\/edit/);
  await expect(page.getByLabel('Expected GLM')).toHaveValue('250');
});
```

- [ ] **Step 2: Typecheck** (BE/FE don't exist yet, so this cannot run live — typecheck is the available fast-feedback signal; behavior is proven in Task 4)

Run: `cd e2e && npm run typecheck`
Expected: no new errors from `tests/masters/fabric-designs.spec.ts`.

- [ ] **Step 3: Commit**

```bash
cd e2e
git add tests/masters/fabric-designs.spec.ts
git commit -m "test(e2e): fabric designs master create/list/edit spec"
```

---

### Task 2: Weaving In flow spec (dispatch → receive → cancel → re-receive → close → dispatch-cancel-blocked)

**Files:**
- Create: `e2e/support/api.ts`
- Create: `e2e/tests/flows/weaving-in.spec.ts`

**Interfaces:**
- Consumes: same fixtures/support as Task 1, plus `fixtures/db.ts` (`LedgerKey`, `Db.ledgerBalance`), `fixtures/env.ts` (`env.API_URL`). Reuses the `weaving-dispatch.spec.ts` UI-drive pattern for `/weaving-dispatches/new` (labels `'Job worker'`, `'Show beams for all weavers'`, `'Search beams'`, `` `Select beam ${beamNumber}` ``, `` `Gross weight for beam ${beamNumber}` ``, `` `Pipe weight for beam ${beamNumber}` ``, `'Beam Value of Goods'`, `'Quality for weft line 1'`, `'Select SKU'`, `'Source lot for weft line 1'`, `'Net weight for weft line 1'`, `'Add placement'`, `'Select floor and location'`, `'placement quantity 1'`, `'Weft Value of Goods'`, `'Save dispatch'`) and its `'Cancel dispatch'` alertdialog-confirm shape — these are pre-existing, shipped selectors, not new contract.
- Produces: `support/api.ts` exports `getCsrfToken(page: Page): Promise<string>` — extracted from the identical inline snippet `weaving-dispatch.spec.ts` already has at lines 34-37 (that file is left untouched; only this new spec uses the export, per DRY-on-second-use). Establishes the FE contract for `/weaving-ins/new` and `/beams/:id`: header labels `'Job worker'` (native select, reused), `'Paper challan no'`; challan-level beam picker reuses `BeamPickerTable` conventions with `status:'issued_to_weaver'` (`'Show beams for all weavers'`, `` `Select beam ${beamNumber}` ``); taka grid rows keyed `takas.N` (beam-receipt/`BeamItemsGrid` precedent) with labels `` `paper serial, takas.${n}` ``, `` `fabric design, takas.${n}` `` (select), `` `meters, takas.${n}` ``, `` `weight, takas.${n}` ``, computed GLM cell at `[data-cell="glm"][data-row="${n}"]`; per-row beam-attribution popover (WI-L4) opened via `` `Set beam allocation, takas.${n}` `` button, inputs `` `attributed meters for beam ${beamNumber}, takas.${n}` ``, closed via `` `Done, takas.${n}` ``; weft panel `'Derived weft kg'` (read-only, `[aria-label="derived weft kg"]`) and `'Entered weft kg'` (editable); submit `'Save receipt'`, success toast `/^Saved /`, detail URL `/weaving-ins/:id`, challan-no format `/\bFRC-\d{4}-\d{2}-\d{3,}\b/`; cancel action `'Cancel receipt'` (alertdialog, same pattern as `'Cancel dispatch'`). Beam detail (`/beams/:id`) gains a `'Remaining Meters'` labeled field (Field component, label+value siblings — same shape as the existing `'Set Length'`/`'Net Weight'` fields on `beam-detail.page.tsx`) and, once `status='issued_to_weaver'`, a `'Close beam'` button (no confirm dialog — forward-only, non-reversing transition).

- [ ] **Step 1: Extract the shared CSRF helper**

```typescript
// e2e/support/api.ts
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
```

- [ ] **Step 2: Typecheck the new helper**

Run: `cd e2e && npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Write the flow spec**

```typescript
// e2e/tests/flows/weaving-in.spec.ts
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
import { getCsrfToken } from '../../support/api';
import type { Db, LedgerKey } from '../../fixtures/db';
import type { Page } from '@playwright/test';

// Beam seed — same shape as weaving-dispatch.spec.ts's createReceivedBeam,
// extended with setLength: WeavingDispatchBeam.beamTotalMeters "prefilled
// from setLength at issue" (WI-L6, spec §2 line 87) — setting it here at
// beam-receipt time means dispatch prefills beamTotalMeters automatically,
// sidestepping the weaving-in form's inline backfill prompt (that affordance
// is covered by BE/FE integration tests per spec §5, not required here).
async function createReceivedBeam(
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

// FabricDesign seed via direct API (this spec's job is the weaving-in
// transaction, not re-proving FabricDesign create — that's
// fabric-designs.spec.ts's job, DRY). expectedGlm=250 matches every taka
// below exactly (weightKg = meters * 0.25), so no GLM-mismatch flag fires
// and this test stays a clean happy path.
async function createFabricDesign(
  page: Page,
  db: Db,
  weftQualityId: string,
): Promise<{ id: string; code: string }> {
  const csrfToken = await getCsrfToken(page);
  const code = codes.unique('FABD-WVI');
  const res = await page.request.post(`${env.API_URL}/fabric-designs`, {
    headers: { 'X-CSRF-Token': csrfToken },
    data: { code, name: `E2E ${code}`, weftQualityId, expectedGlm: 250 },
  });
  if (res.status() !== 201) throw new Error(`fabric design create failed: ${await res.text()}`);
  const design = await db.queryOne<{ id: string }>(`SELECT id FROM fabric_designs WHERE code = $1`, [
    code,
  ]);
  if (!design) throw new Error('the fabric design create must register a fabric_designs row');
  return { id: design.id, code };
}

// Cancel affordances (weaving-in receipt AND weaving dispatch) share the
// AlertDialog-with-matching-accessible-names shape documented in
// weaving-dispatch.spec.ts's cancelDispatch — the trigger and the dialog's
// own confirm button both read e.g. "Cancel receipt", so the confirm click
// must be scoped to the dialog to avoid a Playwright strict-mode ambiguity.
// Returns the mutation's response so callers can assert success OR failure
// (the dispatch-cancel-blocked case at the bottom of this file needs the
// latter).
async function clickConfirmAndWait(
  page: Page,
  triggerLabel: string,
  responseUrlPattern: RegExp,
): Promise<import('@playwright/test').APIResponse> {
  await clickButton(page, triggerLabel);
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

test(
  'weaving-in receives fabric against multiple beams with weft reconciliation, cancel fully reverses, and receipt history blocks dispatch cancel',
  async ({ page, db }) => {
    const jobWorker = await db.queryOne<{ id: string; code: string; name: string }>(
      `SELECT id, code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide an active job worker').not.toBeNull();

    // Weft source — same derivation as weaving-dispatch.spec.ts's src query
    // (any non-beam-track floor lot, active masters, enough balance). Q_WEFT
    // (15) comfortably covers the 9.0kg derivedWeftKg this test's taka/beam
    // numbers produce (see the comment block above the taka fills below),
    // leaving a non-zero 6kg stillAtJw remainder — proving partial
    // consumption, not just full drain.
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
      floor_id: string;
    }>(
      `SELECT s.lot_number, s.sku_id, s.quality_id,
              q.code AS quality_code, q.name AS quality_name,
              sku.name AS sku_name, sku.shade_number AS sku_shade_number,
              l.name AS loc_name, f.name AS floor_name, f.id AS floor_id
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
                sku.name, sku.shade_number, l.name, f.name, f.id
       HAVING SUM(s.in_quantity - s.out_quantity) >= $1
       ORDER BY s.lot_number
       LIMIT 1`,
      [Q_WEFT],
    );
    expect(src, 'seed must provide a lot with >= Q_WEFT balance on an active floor').not.toBeNull();

    const fabricDesign = await createFabricDesign(page, db, src!.quality_id);

    // Two beams: beam1 100m/15kg warp, beam2 80m/12kg warp (both 0.15kg
    // warp/meter — an arbitrary but consistent rate so the derived-weft math
    // below is easy to hand-verify). setLength prefills beamTotalMeters at
    // dispatch (WI-L6).
    const beam1 = await createReceivedBeam(page, db, { netWeight: 15, setLength: 100 });
    const beam2 = await createReceivedBeam(page, db, { netWeight: 12, setLength: 80 });

    // DISPATCH both beams + weft to the weaver, reusing weaving-dispatch
    // .spec.ts's proven UI-drive (its own selectors, not new contract).
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
    const dispatchId = page.url().split('/').pop() as string;

    // At-JW weft position key — jobWorkerId set, floor/location NULL
    // (applyChallanInBeamLedger convention, same shape weaving-dispatch.spec
    // .ts's atJwKey uses).
    const atJwKey: LedgerKey = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      lotNumber: src!.lot_number,
      jobWorkerId: jobWorker!.id,
      floorId: null,
      locationId: null,
    };
    const atJwAfterDispatch = await db.ledgerBalance(atJwKey);
    expect(atJwAfterDispatch).toBeCloseTo(Q_WEFT, 3);

    // RECEIVE — 2 taka fully on beam1, 1 taka split across beam1+beam2.
    // Math (warp rate 0.15kg/m both beams, taka weightKg = meters * 0.25 —
    // GLM 250 exactly, matching fabricDesign.expectedGlm, so no red-flag):
    //   taka1: 30m/7.5kg all on beam1        -> warp 15*(30/100)=4.5
    //   taka2: 40m/10kg all on beam1         -> warp 15*(40/100)=6.0
    //   taka3: 20m/5kg, beam1=10m + beam2=10m -> warp 15*(10/100)+12*(10/80)=1.5+1.5=3.0
    //   Σ weightKg=22.5, Σ warp=13.5 -> derivedWeftKg = 22.5-13.5 = 9.0
    //   beam1 total attributed = 30+40+10=80 (of 100, remaining 20)
    //   beam2 total attributed = 10 (of 80, remaining 70)
    await gotoAndExpect(page, '/weaving-ins/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await fillByLabel(page, 'Paper challan no', '149');
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    await page.getByLabel(`Select beam ${beam2.beamNumber}`).check();

    const fillTaka = async (
      n: number,
      opts: { meters: number; weightKg: number; attribution: Array<{ beamNumber: string; meters: number }> },
    ) => {
      if (n > 0) await clickButton(page, 'Add taka');
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
      // GLM computed cell — beam-receipt grid precedent's data-cell/data-row
      // attrs (BeamItemsGrid.tsx), read-only, always 250 for this test's
      // deliberately-exact weightKg/meters ratio.
      await expect(page.locator(`[data-cell="glm"][data-row="${n}"]`)).toContainText(/250(\.0+)?/);
    };

    await fillTaka(0, { meters: 30, weightKg: 7.5, attribution: [{ beamNumber: beam1.beamNumber, meters: 30 }] });
    await fillTaka(1, { meters: 40, weightKg: 10, attribution: [{ beamNumber: beam1.beamNumber, meters: 40 }] });
    await fillTaka(2, {
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

    // ASSERT — weft stillAtJw delta (BE-computed derivedWeftKg drained the
    // at-JW position by exactly 9.0kg, leaving 6.0kg).
    const atJwAfterReceipt = await db.ledgerBalance(atJwKey);
    expect(atJwAfterReceipt - atJwAfterDispatch).toBeCloseTo(-9, 3);
    expect(atJwAfterReceipt).toBeCloseTo(Q_WEFT - 9, 3);

    // ASSERT — beam remaining meters in the UI (beam-detail's "Remaining
    // Meters" Field: beamTotalMeters - metersWoven over non-cancelled
    // receipts, resolution #7). Field renders label+value as sibling <span>s
    // with no dedicated aria-label (same shape as the existing Set
    // Length/Net Weight fields) — locate by the label text's parent.
    await gotoAndExpect(page, `/beams/${beam1.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('20');
    await gotoAndExpect(page, `/beams/${beam2.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('70');

    // CANCEL receipt 1 — full reversal: weft position and beam remaining
    // meters both return exactly to their pre-receipt values.
    await gotoAndExpect(page, `/weaving-ins/${receiptId}`);
    const cancelRes = await clickConfirmAndWait(page, 'Cancel receipt', /\/weaving-ins\/[^/]+\/cancel$/);
    expect(cancelRes.status()).toBe(200);
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

    const atJwAfterCancel = await db.ledgerBalance(atJwKey);
    expect(atJwAfterCancel).toBeCloseTo(atJwAfterDispatch, 3);

    await gotoAndExpect(page, `/beams/${beam1.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('100');
    await gotoAndExpect(page, `/beams/${beam2.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('80');

    // RE-RECEIVE — a second, independent weaving-in against beam1 only (no
    // beam-attribution popover needed: a single challan-level beam makes the
    // per-taka attribution unambiguous). Its role is purely to produce a
    // second NON-cancelled receipt + WeavingInTakaBeam link, so the guard
    // checks below (beam close, dispatch-cancel-blocked) have something real
    // to trip on.
    await gotoAndExpect(page, '/weaving-ins/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    await selectByAriaLabel(page, 'fabric design, takas.0', fabricDesign.code);
    await fillByLabel(page, 'meters, takas.0', '10');
    await fillByLabel(page, 'weight, takas.0', '2.5');
    await fillByLabel(page, 'Entered weft kg', '1');
    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-ins\/[^/]+$/);

    // CLOSE beam1 — issued_to_weaver -> fabric_received (spec §3.4). No
    // confirm dialog: a forward, non-reversing transition, unlike Cancel.
    await gotoAndExpect(page, `/beams/${beam1.id}`);
    await clickButton(page, 'Close beam');
    await expectToast(page, /closed|Fabric Received/i);
    await expect(page.getByText('Fabric Received', { exact: true })).toBeVisible();

    const beam1AfterClose = await db.queryOne<{ status: string }>(
      `SELECT status FROM beams WHERE id = $1`,
      [beam1.id],
    );
    expect(beam1AfterClose!.status).toBe('fabric_received');

    // DISPATCH CANCEL NOW BLOCKED — WI-L14: countActiveReceipts' third UNION
    // branch (weaving_ins/weaving_in_weft_sources) refuses once a
    // non-cancelled receipt exists against the dispatch's weft challan-out
    // item, and/or WeavingDispatch.cancel independently rejects once any
    // linked beam has taka links at all (beam1 does, from both receipts).
    // Asserted by response status + DB invariance, not by the BE's exact
    // rejection wording (not fixed by the spec/locked-resolutions — same
    // "don't pin an unfixed string" rule this suite already applies to
    // minted doc numbers).
    await gotoAndExpect(page, `/weaving-dispatches/${dispatchId}`);
    const blockedRes = await clickConfirmAndWait(page, 'Cancel dispatch', /\/weaving-dispatches\/[^/]+\/cancel$/);
    expect(
      blockedRes.status(),
      'the WI-L14 guard must reject this cancel once a non-cancelled weaving-in receipt / taka link exists',
    ).toBeGreaterThanOrEqual(400);

    const dispatchAfterBlockedCancel = await db.queryOne<{ status: string }>(
      `SELECT status FROM weaving_dispatches WHERE id = $1`,
      [dispatchId],
    );
    expect(dispatchAfterBlockedCancel!.status).not.toBe('cancelled');

    const beam1AfterBlockedCancel = await db.queryOne<{ status: string }>(
      `SELECT status FROM beams WHERE id = $1`,
      [beam1.id],
    );
    expect(beam1AfterBlockedCancel!.status).toBe('fabric_received');
  },
);
```

- [ ] **Step 4: Typecheck**

Run: `cd e2e && npm run typecheck`
Expected: no errors from `tests/flows/weaving-in.spec.ts` or `support/api.ts`.

- [ ] **Step 5: Commit**

```bash
cd e2e
git add support/api.ts tests/flows/weaving-in.spec.ts
git commit -m "test(e2e): weaving-in full-chain spec (dispatch, receive, cancel-reversal, re-receive, beam close, dispatch-cancel-blocked)"
```

---

### Task 3: Route smoke + role guards

**Files:**
- Modify: `e2e/tests/smoke/routes.spec.ts`
- Modify: `e2e/tests/guards/role-guards.spec.ts`

**Interfaces:**
- Consumes: existing `ROUTES` arrays in both files (append-only edits, no restructuring).
- Produces: nothing — leaf task.

- [ ] **Step 1: Append the two new routes to the smoke list**

```typescript
// e2e/tests/smoke/routes.spec.ts — add to ROUTES, after '/weaving-dispatches'
  '/weaving-dispatches',
  '/fabric-designs',
  '/weaving-ins',
] as const;
```

- [ ] **Step 2: Append the two new guarded create-routes**

```typescript
// e2e/tests/guards/role-guards.spec.ts — add to ROUTES, after the
// weaving-dispatches entry. Same roles as weaving-dispatches
// ('owner'/'storekeeper' — spec §3.6/locked resolution 3).
  {
    path: '/weaving-ins/new',
    heading: 'New Weaving In',
    allowedRoles: ['owner', 'storekeeper'],
  },
  {
    path: '/fabric-designs/new',
    heading: 'New Fabric Design',
    allowedRoles: ['owner', 'storekeeper'],
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
git commit -m "test(e2e): route smoke + role guards for fabric-designs and weaving-ins"
```

---

### Task 4: Live run against the real stack

**Files:** none (verification only — may touch any file from Tasks 1-3 if a live mismatch needs fixing).

**Interfaces:**
- Consumes: the full set of files from Tasks 1-3, plus the real `fabtraq-be`/`fabtraq-fe`/`fabtraq-shared` implementations landed by the sibling BE/FE/shared plans for this same workstream.
- Produces: a green single-run for each new/modified spec, then one green full-suite run.

This task cannot run until `plan-shared`/`plan-be`/`plan-fe`'s work for Weaving In has actually landed on `feat/s6-consolidated-shared|be|fe` (shared 1.15.0 tarball installed per locked resolution 10) — it is the live-verification gate for everything above, not a parallel task.

- [ ] **Step 1: Free the ports**

Check nothing is already bound to `:4000`/`:5173` before Playwright tries to boot its own servers (`reuseExistingServer:false` will fail loudly with `EADDRINUSE` otherwise, and single-spec runs do not reseed the DB so a stray server pointed at a different checkout is also a correctness risk, not just a port conflict).

```bash
lsof -ti :4000 :5173 || true
```

If either port is occupied by this project's own dev servers, kill the `npm run dev` / `tsx watch` **parent** process (killing only the child lets `tsx watch` respawn it — a documented gotcha in this project). If a shell you don't control owns the port, ask before killing it.

- [ ] **Step 2: Run each new/modified spec individually (no reseed)**

```bash
cd e2e
npx playwright test tests/masters/fabric-designs.spec.ts --project=authed
npx playwright test tests/flows/weaving-in.spec.ts --project=authed
npx playwright test tests/smoke/routes.spec.ts --project=authed
npx playwright test tests/guards/role-guards.spec.ts --project=authed
```

Expected: all pass. If a selector doesn't match the real FE (labels/aria-labels chosen in Tasks 1-2 are this plan's best-effort FE contract, not guaranteed pixel-for-pixel), fix the **spec** to match the shipped FE unless the shipped FE's naming is clearly the worse choice — in that case coordinate the FE-side fix with the lead rather than silently diverging from the contract other tasks may also rely on. Re-run the affected spec after each fix until green.

- [ ] **Step 3: Full-suite regression run (RESEEDS `fabtraq_dev` — do not run against a DB you care about)**

```bash
cd e2e
npm run e2e
```

Expected: full suite green, including the pre-existing `weaving-dispatch.spec.ts` (unmodified except for the WI-L14 cancel-guard behavior change already called out as BE's own test-update responsibility in spec §5's "WD regression" bullet — a same-repo failure there is a real regression to investigate, not noise).

- [ ] **Step 4: Re-seed warning**

Per `feedback_integration_tests_wipe_dev_db` — `npm run e2e` truncates and reseeds the shared dev database any other session's manual dev work might be using. After Step 3, tell the user/lead the dev DB was reset so anyone doing manual FE/BE dev work against it isn't confused by their data disappearing.

- [ ] **Step 5: Commit any live-run fixes**

```bash
cd e2e
git add -A
git commit -m "test(e2e): live-verification fixes for weaving-in selectors"
```

(Skip this commit if Step 2/3 needed no fixes.)

---

## Self-review against spec §5

- "dispatch beams+weft via API or UI (reuse the weaving-dispatch spec's beam-seed helper pattern)" → Task 2, `createReceivedBeam` (API, adapted from the precedent) + UI-driven dispatch (reusing the precedent's exact selectors). ✅
- "create weaving-in with 2 taka on 1 beam + 1 taka on 2 beams" → Task 2, `fillTaka(0)`/`fillTaka(1)` both fully on beam1, `fillTaka(2)` split beam1/beam2. ✅
- "assert beam remaining meters in UI" → Task 2, `/beams/:id` "Remaining Meters" field, both beams, both before and after cancel. ✅
- "weft `stillAtJw` DELTA via `db.ledgerBalance` (jobWorkerId key, location IS NULL)" → Task 2, `atJwKey` with `jobWorkerId` set and `floorId`/`locationId` both `null`, delta asserted at dispatch, at receipt, and at cancel. ✅
- "cancel receipt → assert full reversal delta" → Task 2, `atJwAfterCancel` vs `atJwAfterDispatch`, plus both beams' remaining meters restored. ✅
- "re-receive, close beam → verify dispatch cancel now blocked (error toast/message)" → Task 2, second receipt, `Close beam`, then `Cancel dispatch` asserted via response status ≥ 400 + DB invariance (see the inline comment on why status/DB rather than exact wording). ✅
- FabricDesign master (create/list/edit) → Task 1. ✅
- Route smoke (`/fabric-designs`, `/weaving-ins`) → Task 3. ✅
- Guards (owner/storekeeper allowed, accountant denied via the existing table-driven loop in `role-guards.spec.ts`) → Task 3 (new entries plug into the existing per-role describe blocks automatically — no loop changes needed). ✅
- Live run as its own final task, DB-reset choreography documented → Task 4. ✅
