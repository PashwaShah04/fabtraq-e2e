import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import type { Db } from '../../fixtures/db';
import { gotoAndExpect } from '../../support/nav';

// Wastage report (Inventory Rewoven Phase 3, spec §5.5/§6.5).
//
// The oracle is the three SOURCE tables the report aggregates, re-derived here
// in SQL — never the report's own endpoint. It mirrors `WastageService.getReport`
// (fabtraq-be src/modules/wastage/wastage.service.ts) bucket for bucket:
//
//   job_work      one bucket per (challanOut.jobWorkerId × yarnItem.unit);
//                 denominator = Σ consumed_qty, numerator = Σ COALESCE(wastage,0),
//                 cancelled parent challans excluded. NOTE: the job worker comes
//                 through `jw_challans_in.challan_out_id -> jw_challans_out`;
//                 `jw_challans_in` has no job_worker_id column of its own.
//   beam_receipt  one bucket per weaver, unit always KG; denominator is
//                 RECONSTRUCTED as net_weight + wastage (input = output + wastage),
//                 receipts carrying a `cancellation` ledger row excluded (R5).
//   weaving       one bucket per job worker, unit KG, read from the STORED
//                 derived/entered weft columns — never recomputed (R10).
//
// Every number is derived at test time, so the spec is indifferent to whatever
// data the specs ahead of it created; it asserts the rendered set EQUALS the
// oracle set in both directions rather than pinning a total.

const PROCESSES = ['job_work', 'beam_receipt', 'weaving'] as const;
type Process = (typeof PROCESSES)[number];

/** Mirrors `DEFAULT_WASTAGE_THRESHOLD_PCT` (@pashwashah04/fabtraq-shared). The e2e
 *  repo does not depend on shared, so the value is restated; the BE resolves the
 *  fallback server-side, which is why the report always shows a threshold. */
const DEFAULT_THRESHOLD_PCT = 5;

const PROCESS_LABEL: Record<Process, string> = {
  job_work: 'Job work',
  beam_receipt: 'Beam receipt',
  weaving: 'Weaving',
};

interface OracleRow {
  readonly process: Process;
  readonly jobWorkerId: string | null;
  readonly jobWorkerName: string | null;
  readonly unit: string;
  readonly consumed: number;
  readonly wastage: number;
}

interface RawBucket {
  job_worker_id: string | null;
  job_worker_name: string | null;
  unit: string;
  consumed: string;
  wastage: string;
}

interface WriteOffBucket {
  unit: string;
  total_qty: string;
  count: string;
}

interface ThresholdRow {
  process: string;
  threshold_pct: string;
}

/** The `data-wastage-row` hook (`rowKey` in wastage-report.page.tsx): a row is one
 *  (process × job worker × unit), so all three are in the key. */
function rowKey(row: OracleRow): string {
  return `${row.process}:${row.jobWorkerId ?? 'none'}:${row.unit}`;
}

/** `consumedQty === 0` is representable (a fully-still-at-JW hop); the service
 *  guards it the same way. */
function pctOf(row: OracleRow): number {
  return row.consumed === 0 ? 0 : (row.wastage / row.consumed) * 100;
}

const toBuckets = (process: Process, rows: RawBucket[]): OracleRow[] =>
  rows.map((r) => ({
    process,
    jobWorkerId: r.job_worker_id,
    jobWorkerName: r.job_worker_name,
    unit: r.unit,
    consumed: Number(r.consumed),
    wastage: Number(r.wastage),
  }));

async function loadOracle(db: Db): Promise<OracleRow[]> {
  const jobWork = await db.queryMany<RawBucket>(
    `SELECT co.job_worker_id::text            AS job_worker_id,
            jw.name                           AS job_worker_name,
            item.unit::text                   AS unit,
            SUM(src.consumed_qty)::text       AS consumed,
            SUM(COALESCE(src.wastage,0))::text AS wastage
       FROM jw_challan_in_yarn_item_source src
       JOIN jw_challan_in_yarn_item item ON item.id = src.yarn_item_id
       JOIN jw_challans_in ci ON ci.id = item.challan_in_id
       LEFT JOIN jw_challans_out co ON co.id = ci.challan_out_id
       LEFT JOIN job_workers jw ON jw.id = co.job_worker_id
      WHERE ci.status <> 'cancelled'
      GROUP BY co.job_worker_id, jw.name, item.unit`,
  );

  const beamReceipt = await db.queryMany<RawBucket>(
    `SELECT bri.weaver_id::text                       AS job_worker_id,
            jw.name                                   AS job_worker_name,
            'KG'                                      AS unit,
            SUM(bri.net_weight + bri.wastage)::text   AS consumed,
            SUM(bri.wastage)::text                    AS wastage
       FROM beam_receipt_items bri
       LEFT JOIN job_workers jw ON jw.id = bri.weaver_id
      WHERE bri.wastage IS NOT NULL
        AND NOT EXISTS (
              SELECT 1 FROM stock_ledger sl
               WHERE sl.transaction_type = 'beam_receipt'
                 AND sl.transaction_id = bri.beam_receipt_id
                 AND sl.notes = 'cancellation')
      GROUP BY bri.weaver_id, jw.name`,
  );

  const weaving = await db.queryMany<RawBucket>(
    `SELECT wi.job_worker_id::text                              AS job_worker_id,
            jw.name                                             AS job_worker_name,
            'KG'                                                AS unit,
            SUM(wi.entered_weft_kg)::text                       AS consumed,
            SUM(wi.entered_weft_kg - wi.derived_weft_kg)::text  AS wastage
       FROM weaving_ins wi
       JOIN job_workers jw ON jw.id = wi.job_worker_id
      WHERE wi.status <> 'cancelled'
      GROUP BY wi.job_worker_id, jw.name`,
  );

  return [
    ...toBuckets('job_work', jobWork),
    ...toBuckets('beam_receipt', beamReceipt),
    ...toBuckets('weaving', weaving),
  ];
}

/** Stored thresholds, with the server-side fallback applied — exactly what the
 *  report renders as `of N%`. */
async function loadThresholds(db: Db): Promise<Record<Process, number>> {
  const rows = await db.queryMany<ThresholdRow>(
    'SELECT process, threshold_pct::text FROM wastage_thresholds',
  );
  const stored = new Map(rows.map((r) => [r.process, Number(r.threshold_pct)]));
  return {
    job_work: stored.get('job_work') ?? DEFAULT_THRESHOLD_PCT,
    beam_receipt: stored.get('beam_receipt') ?? DEFAULT_THRESHOLD_PCT,
    weaving: stored.get('weaving') ?? DEFAULT_THRESHOLD_PCT,
  };
}

/** Every rendered `data-wastage-row` value, in DOM order. */
async function renderedKeys(scope: Page | Locator): Promise<string[]> {
  return scope
    .locator('[data-wastage-row]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-wastage-row') ?? ''));
}

/**
 * Asserts every oracle row is rendered with its own numbers and its own flag.
 * `overThreshold` is read from the DOM VERBATIM — the page renders the server's
 * boolean and never re-derives it, and `wastageQty`/`wastagePct` are signed on
 * purpose, so this compares against `pct > threshold` and never `Math.abs`.
 */
async function expectRowsRendered(
  page: Page,
  rows: readonly OracleRow[],
  thresholds: Record<Process, number>,
): Promise<void> {
  for (const row of rows) {
    const key = rowKey(row);
    const el = page.locator(`[data-wastage-row="${key}"]`);
    const threshold = thresholds[row.process];
    const pct = pctOf(row);

    await expect(el, key).toBeVisible();
    await expect(el, key).toContainText(row.jobWorkerName ?? '—');
    await expect(el, key).toContainText(`${row.consumed.toFixed(3)} ${row.unit}`);
    await expect(el, key).toContainText(`${row.wastage.toFixed(3)} ${row.unit}`);
    await expect(el, key).toContainText(`${pct.toFixed(2)}%`);
    await expect(el, key).toContainText(`of ${String(threshold)}%`);

    if (pct > threshold) {
      await expect(el, key).toHaveAttribute('data-over-threshold', 'true');
      await expect(el.getByText('Over', { exact: true }), key).toBeVisible();
    } else {
      await expect(el, key).not.toHaveAttribute('data-over-threshold', 'true');
      await expect(el.getByText('Over', { exact: true }), key).toHaveCount(0);
    }
  }
}

/**
 * Types every threshold and saves, then waits for the PUT itself.
 *
 * `current` is what the inputs already hold — awaited first, because the editor
 * repopulates its draft when the thresholds query lands and would otherwise
 * overwrite what was typed (the load-then-edit window ThresholdsEditor
 * documents). The response, not the toast, is the evidence: a save that 400s
 * would leave the report on the old thresholds and every later assertion would
 * time out somewhere unrelated.
 */
async function saveThresholds(
  page: Page,
  next: Record<Process, number>,
  current: Record<Process, number>,
): Promise<void> {
  for (const process of PROCESSES) {
    const input = page.getByLabel(`${PROCESS_LABEL[process]} threshold %`);
    await expect(input).toHaveValue(String(current[process]));
    await input.fill(String(next[process]));
  }
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) => r.url().endsWith('/inventory/wastage/thresholds') && r.request().method() === 'PUT',
    ),
    page.getByRole('button', { name: 'Save thresholds' }).click(),
  ]);
  expect(response.status(), 'PUT /inventory/wastage/thresholds').toBe(200);
}

test.describe('wastage report — owner', () => {
  test.use({ storageState: '.auth/owner.json' });

  // `wastage_thresholds` has no FK into the transactional schema, so nothing
  // else in a suite run clears it and a threshold left behind by a FAILING test
  // would silently re-flag every later reader. The in-page restore below is
  // still asserted — it is the round-trip proof — but the cleanup must not
  // depend on the test reaching its last line. Deleting the rows restores the
  // server-side default, which is the seeded state.
  test.afterEach(async ({ db }) => {
    await db.queryMany('DELETE FROM wastage_thresholds');
  });

  test('renders every wastage row its source tables hold, split by section', async ({
    page,
    db,
  }) => {
    const rows = await loadOracle(db);
    const thresholds = await loadThresholds(db);
    const writeOffs = await db.queryMany<WriteOffBucket>(
      `SELECT unit::text AS unit, SUM(out_quantity)::text AS total_qty, COUNT(*)::text AS count
         FROM stock_ledger
        WHERE transaction_type = 'write_off'
          AND (notes IS NULL OR notes <> 'cancellation')
        GROUP BY unit`,
    );

    // The fixture must be able to falsify BOTH flag branches, or the assertions
    // below are decorative. The seed ships job_work at 8.33%/6.38% (over 5) and
    // beam_receipt at 3.33% (under) — this fails loudly if that ever stops
    // being true rather than passing vacuously.
    expect(rows.length, 'source tables must hold at least one wastage bucket').toBeGreaterThan(0);
    expect(
      rows.filter((r) => pctOf(r) > thresholds[r.process]).length,
      'fixture must contain an over-threshold row',
    ).toBeGreaterThan(0);
    expect(
      rows.filter((r) => pctOf(r) <= thresholds[r.process]).length,
      'fixture must contain an under-threshold row',
    ).toBeGreaterThan(0);

    await gotoAndExpect(page, '/reports/wastage');
    await expect(page.getByRole('heading', { name: 'Wastage' })).toBeVisible();

    await expectRowsRendered(page, rows, thresholds);

    // Both directions: no phantom row either. Set equality against a live
    // oracle, not a pinned count — the specs ahead of this one add buckets.
    expect((await renderedKeys(page)).sort()).toEqual(rows.map(rowKey).sort());

    // R10: weaving variance is entered-vs-derived, not consumption wastage, and
    // never sits in the process table.
    const processTable = page.getByRole('region', { name: 'Process wastage' });
    const weavingSection = page.getByRole('region', { name: 'Weaving variance' });
    expect((await renderedKeys(processTable)).sort()).toEqual(
      rows
        .filter((r) => r.process !== 'weaving')
        .map(rowKey)
        .sort(),
    );
    expect((await renderedKeys(weavingSection)).sort()).toEqual(
      rows
        .filter((r) => r.process === 'weaving')
        .map(rowKey)
        .sort(),
    );

    // Process labels come from the row's own process, not from its position.
    for (const process of PROCESSES) {
      const first = rows.find((r) => r.process === process);
      if (first === undefined) continue;
      await expect(page.locator(`[data-wastage-row="${rowKey(first)}"]`)).toContainText(
        PROCESS_LABEL[process],
      );
    }

    // R10: write-offs are a different kind of loss and get their own card,
    // never folded into a process percentage.
    const writeOffCard = page.getByRole('region', { name: 'Write-offs' });
    await expect(writeOffCard).toBeVisible();
    expect(await renderedKeys(writeOffCard)).toEqual([]);
    if (writeOffs.length === 0) {
      await expect(writeOffCard).toContainText('No write-offs in this period.');
    } else {
      for (const writeOff of writeOffs) {
        await expect(writeOffCard).toContainText(
          `${Number(writeOff.total_qty).toFixed(3)} ${writeOff.unit} across ${writeOff.count}`,
        );
      }
    }
  });

  test('re-flags rows per process when the thresholds change', async ({ page, db }) => {
    const rows = await loadOracle(db);
    const before = await loadThresholds(db);
    // Crossing thresholds: job_work rows can no longer be over, beam_receipt
    // rows almost certainly become over. A mutant that applies ONE threshold to
    // every process cannot satisfy both halves at once.
    const after: Record<Process, number> = { job_work: 100, beam_receipt: 1, weaving: 100 };

    const flipsOff = rows.filter((r) => pctOf(r) > before[r.process] && pctOf(r) <= after[r.process]);
    const flipsOn = rows.filter((r) => pctOf(r) <= before[r.process] && pctOf(r) > after[r.process]);
    expect(flipsOff.length, 'fixture must contain a row that stops being over').toBeGreaterThan(0);
    expect(flipsOn.length, 'fixture must contain a row that starts being over').toBeGreaterThan(0);

    await gotoAndExpect(page, '/reports/wastage');
    await expectRowsRendered(page, rows, before);

    await saveThresholds(page, after, before);
    await expectRowsRendered(page, rows, after);

    // The restore is load-bearing: `wastage_thresholds` has no FK into the
    // transactional schema, so nothing else in this run clears it. Asserted
    // through the REPORT rather than the input, because the input shows the
    // typed value before the PUT resolves.
    await saveThresholds(page, before, after);
    await expectRowsRendered(page, rows, before);
  });
});

test.describe('wastage report — storekeeper', () => {
  test.use({ storageState: '.auth/storekeeper.json' });

  // canEdit is owner OR storekeeper (spec §5.5). Asserting only the owner
  // branch would leave `user.role === 'storekeeper'` deletable with the whole
  // suite green.
  test('can read the report and edit thresholds', async ({ page }) => {
    await gotoAndExpect(page, '/reports/wastage');
    await expect(page.getByRole('heading', { name: 'Wastage' })).toBeVisible();
    await expect(page.locator('[data-thresholds-editor]')).toBeVisible();
    await expect(page.getByLabel('Job work threshold %')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Save thresholds' })).toBeVisible();
  });
});

test.describe('wastage report — accountant', () => {
  test.use({ storageState: '.auth/accountant.json' });

  test('can read the report but the thresholds editor is absent, not disabled', async ({
    page,
  }) => {
    await gotoAndExpect(page, '/reports/wastage');
    await expect(page.getByRole('heading', { name: 'Wastage' })).toBeVisible();
    // UNMOUNTED, per spec §5.5 — a disabled-but-present editor would still be
    // submittable by a determined client.
    await expect(page.locator('[data-thresholds-editor]')).toHaveCount(0);
    await expect(page.getByLabel('Job work threshold %')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save thresholds' })).toHaveCount(0);
    // The report itself stays readable for every authenticated role.
    await expect(page.getByRole('region', { name: 'Write-offs' })).toBeVisible();
  });
});
