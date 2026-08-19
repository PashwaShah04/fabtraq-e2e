import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel,
  selectByAriaLabel,
  selectNativeByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { confirmDialogAndWait } from '../../support/api';
import { createFabricDesign, createReceivedBeam } from '../../support/weaving-in-fixtures';
import type { LedgerKey } from '../../fixtures/db';

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

    // At-JW weft position key — jobWorkerId set, floor/location NULL
    // (applyChallanInBeamLedger convention, same shape weaving-dispatch.spec
    // .ts's atJwKey uses). Baseline captured BEFORE the dispatch: this suite
    // asserts ledger DELTAS, never absolutes (e2e/README.md:77), so repeat
    // runs against an unreseeded DB stay green.
    const atJwKey: LedgerKey = {
      qualityId: src!.quality_id,
      skuId: src!.sku_id,
      lotNumber: src!.lot_number,
      jobWorkerId: jobWorker!.id,
      floorId: null,
      locationId: null,
    };
    const atJwBefore = await db.ledgerBalance(atJwKey);

    await clickButton(page, 'Save dispatch');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-dispatches\/[^/]+$/);
    const dispatchId = page.url().split('/').pop() as string;

    const atJwAfterDispatch = await db.ledgerBalance(atJwKey);
    expect(atJwAfterDispatch - atJwBefore).toBeCloseTo(Q_WEFT, 3);

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

    // Flipped true before the RE-RECEIVE phase below, which selects one beam
    // only — the header beam count decides whether the per-taka attribution
    // popover renders at all.
    let singleHeaderBeam = false;
    const fillTaka = async (
      n: number,
      opts: { meters: number; weightKg: number; attribution: Array<{ beamNumber: string; meters: number }> },
    ) => {
      if (n > 0) await clickButton(page, 'Add taka');
      await selectByAriaLabel(page, `fabric design, takas.${n}`, fabricDesign.code);
      await fillByLabel(page, `meters, takas.${n}`, String(opts.meters));
      await fillByLabel(page, `weight, takas.${n}`, String(opts.weightKg));
      if (opts.attribution.length === 1 && singleHeaderBeam) {
        // Single selected header beam: BeamOverridePopover renders a static
        // beam-number label instead of the "Split across beams" trigger
        // (BeamOverridePopover.tsx:29-34), and `effectiveBeamLinks`
        // attributes the taka's full meters to it implicitly
        // (map-form-to-input.ts:79-82). Assert that label rather than
        // driving a popover the UI deliberately does not render.
        const takaRow = page
          .locator('tr')
          .filter({ has: page.locator(`[data-cell="glm"][data-row="${n}"]`) });
        await expect(takaRow).toContainText(opts.attribution[0]!.beamNumber);
      } else {
        await clickButton(page, `Set beam allocation, takas.${n}`);
        for (const alloc of opts.attribution) {
          await fillByLabel(
            page,
            `attributed meters for beam ${alloc.beamNumber}, takas.${n}`,
            String(alloc.meters),
          );
        }
        await clickButton(page, `Done, takas.${n}`);
      }
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

    // CEILING GATE — an allocation above the weaver's still-at-JW balance
    // must disable Save, not just colour the row. Before this the button
    // stayed live and the BE refused the POST (WEFT_SOURCE_OVER_CEILING),
    // which reads to an operator as "the app lost my challan".
    const saveReceipt = page.getByRole('button', { name: 'Save receipt' });
    const consumeCell = page.getByLabel(`consume from ${src!.lot_number}`);
    await consumeCell.fill(String(Q_WEFT + 1));
    await expect(page.getByText('Exceeds still-at-JW balance')).toBeVisible();
    await expect(saveReceipt).toBeDisabled();

    // Back within the ceiling: the warning and the block clear together.
    await consumeCell.fill('9');
    await expect(page.getByText('Exceeds still-at-JW balance')).toBeHidden();
    await expect(saveReceipt).toBeEnabled();

    await clickButton(page, 'Save receipt');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/weaving-ins\/[^/]+$/);
    const receiptId = page.url().split('/').pop() as string;
    const frcNo = await captureDocNo(page.getByRole('main'), /\bFRC-\d{4}-\d{2}-\d{3,}\b/);
    expect(frcNo).toMatch(/^FRC-\d{4}-\d{2}-\d{3,}$/);

    // PRINT BLOCK — the sheet that has to match job-work-weaving-in.jpeg.
    // It carries Tailwind `hidden` and only lifts under `@media print`, so a
    // screen-media assertion would pass vacuously. The page's own
    // `header { display: none !important }` print rule once outranked the
    // reveal and shipped a challan with no title/challan-no/weaver; this
    // asserts that regression stays fixed.
    await page.emulateMedia({ media: 'print' });
    const printArea = page.locator('.print-area');
    await expect(printArea.getByRole('heading', { name: 'Grey Fabric Receipt' })).toBeVisible();
    await expect(printArea).toContainText(frcNo);
    await expect(printArea).toContainText(jobWorker!.name);
    await expect(printArea).toContainText('Receiver signature');
    await page.emulateMedia({ media: 'screen' });

    // ASSERT — weft stillAtJw delta (BE-computed derivedWeftKg drained the
    // at-JW position by exactly 9.0kg, leaving 6.0kg).
    const atJwAfterReceipt = await db.ledgerBalance(atJwKey);
    expect(atJwAfterReceipt - atJwAfterDispatch).toBeCloseTo(-9, 3);
    expect(atJwAfterReceipt - atJwBefore).toBeCloseTo(Q_WEFT - 9, 3);

    // ASSERT — beam remaining meters in the UI (beam-detail's "Remaining
    // Meters" Field: beamTotalMeters - metersWoven over non-cancelled
    // receipts, resolution #7). Field renders label+value as sibling <span>s
    // with no dedicated aria-label (same shape as the existing Set
    // Length/Net Weight fields) — locate by the label text's parent.
    // CAUTION (verify live, Task 4): if `Field`'s sibling-span container also
    // happens to sit next to a "Set Length"/total-meters value that shares a
    // substring with the expected remaining figure (worst case here: beam1's
    // total IS 100, same as its own post-cancel remaining), a `toContainText`
    // match through an over-wide parent locator could pass for the wrong
    // reason. If the live run shows `.locator('..')` isn't tightly scoped to
    // just this Field's two spans, replace these four assertions with a DB
    // oracle instead: `SELECT COALESCE(SUM(metersAttributed),0) FROM
    // weaving_in_taka_beams wtb JOIN weaving_ins wi ON wi.id = wtb.weaving_in_id
    // WHERE wtb.beam_id = $1 AND wi.status != 'cancelled'` and assert
    // `beamTotalMeters - that sum` directly — same "assert the underlying
    // state, not a wording pattern" rule this suite already applies to
    // ledger deltas and doc numbers.
    await gotoAndExpect(page, `/beams/${beam1.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('20');
    await gotoAndExpect(page, `/beams/${beam2.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('70');

    // CANCEL receipt 1 — full reversal: weft position and beam remaining
    // meters both return exactly to their pre-receipt values.
    await gotoAndExpect(page, `/weaving-ins/${receiptId}`);
    const cancelRes = await confirmDialogAndWait(page, 'Cancel receipt', /\/weaving-ins\/[^/]+\/cancel$/);
    expect(cancelRes.status()).toBe(200);
    await expect(page.getByText('Cancelled', { exact: true })).toBeVisible();

    const atJwAfterCancel = await db.ledgerBalance(atJwKey);
    expect(atJwAfterCancel).toBeCloseTo(atJwAfterDispatch, 3);

    await gotoAndExpect(page, `/beams/${beam1.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('100');
    await gotoAndExpect(page, `/beams/${beam2.id}`);
    await expect(page.getByText('Remaining Meters', { exact: true }).locator('..')).toContainText('80');

    // RE-RECEIVE — a second, independent weaving-in against beam1 only. Its
    // role is purely to produce a second NON-cancelled receipt +
    // WeavingInTakaBeam link, so the guard checks below (beam close,
    // dispatch-cancel-blocked) have something real to trip on. Beam
    // allocation here is IMPLICIT, not driven through the popover: with one
    // header beam the UI renders a static beam-number label instead of the
    // split trigger, and `effectiveBeamLinks` attributes the taka's full
    // meters to that beam on submit. §3.2 validation #1 (`Σ metersAttributed
    // per taka = taka.meters`) is enforced against the WeavingInTakaBeam rows
    // actually written, so the beam-remaining assertions below prove the
    // implicit path really persisted the link.
    await gotoAndExpect(page, '/weaving-ins/new');
    await selectNativeByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    await page.getByLabel(`Select beam ${beam1.beamNumber}`).check();
    singleHeaderBeam = true;
    await fillTaka(0, { meters: 10, weightKg: 2.5, attribution: [{ beamNumber: beam1.beamNumber, meters: 10 }] });
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
    const blockedRes = await confirmDialogAndWait(page, 'Cancel dispatch', /\/weaving-dispatches\/[^/]+\/cancel$/);
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
