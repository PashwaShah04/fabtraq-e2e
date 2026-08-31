import { test, expect } from '../../fixtures/test';

// The seeded ledger must have the shape the APPLICATION writes, not a
// hand-rolled approximation of it (spec 2026-08-31 §1.4 / §3.4).
//
// `applyChallanOutLedger` writes challan_out as a two-leg double entry — a
// floor debit (locationId set, jobWorkerId NULL) and a JW credit (locationId
// NULL, jobWorkerId set) — and `applyChallanInYarnLedger` mirrors it with a
// floor credit for the received lot plus one JW-debit leg per source link.
//
// Four hand-rolled seed challans (JWO-2026-27-001…004, from 7bd7fd5) wrote a
// single HYBRID row instead: floor-located AND carrying jobWorkerId, which the
// real writer explicitly sets to null on that leg, with no JW leg at all.
// Measured baseline before the fix: 5 challan_out rows, 0 JW legs, 5 hybrids;
// 3 challan_in rows, 0 JW-debit legs.
//
// Nothing rendered was wrong because of it — both legs were missing
// symmetrically, so the at-JW balance netted to 0, and getOutItemRollup reads
// relational tables rather than the ledger. It is guarded because seed data is
// the shape every future reader copies, and because nothing ever asserted it:
// that silence is how the defect survived from S5 to 2026-08-31.
//
// This guard lives in e2e rather than BE integration for two reasons: the BE
// integration setup truncates before each file (so it would assert against an
// empty DB), and `prisma/seed.ts` exports nothing re-runnable. The e2e suite
// runs `db:reset && db:seed` before Playwright, so these specs get the fresh
// seed for free.

test('no seeded challan ledger row is both floor-located and job-worker-keyed', async ({ db }) => {
  const hybrids = await db.queryMany<{
    transaction_type: string;
    lot_number: string | null;
  }>(
    `SELECT transaction_type, lot_number
       FROM stock_ledger
      WHERE transaction_type IN ('challan_out', 'challan_in')
        AND location_id IS NOT NULL
        AND job_worker_id IS NOT NULL`,
  );

  expect(
    hybrids,
    'a located row is a FLOOR position — the writers set jobWorkerId to null on that leg, ' +
      'and the JW position is carried by a separate locationId-null row',
  ).toEqual([]);
});

test('every seeded challan_out item has both a floor-debit and a JW-credit leg', async ({ db }) => {
  const unpaired = await db.queryMany<{
    challan_no: string;
    lot_number: string;
    floor_legs: string;
    jw_legs: string;
  }>(
    `SELECT co.challan_no,
            oi.lot_number,
            COUNT(*) FILTER (WHERE sl.location_id IS NOT NULL)::text AS floor_legs,
            COUNT(*) FILTER (WHERE sl.location_id IS NULL)::text     AS jw_legs
       FROM jw_challan_out_items oi
       JOIN jw_challans_out co ON co.id = oi.challan_out_id AND co.status <> 'cancelled'
       JOIN stock_ledger sl
         ON sl.transaction_type = 'challan_out'
        AND sl.transaction_item_id = oi.id
        AND sl.notes IS DISTINCT FROM 'cancellation'
      GROUP BY co.challan_no, oi.lot_number
     HAVING COUNT(*) FILTER (WHERE sl.location_id IS NOT NULL) = 0
         OR COUNT(*) FILTER (WHERE sl.location_id IS NULL) = 0`,
  );

  expect(
    unpaired,
    'a dispatch that debits a floor without crediting the job-worker position leaves the ' +
      'material in no position at all — closeOutAsLoss resolves its jobWorkerId from the ' +
      'JW-credit row and would write a null-keyed write-off',
  ).toEqual([]);
});

test('every seeded receipt with sources drains the job-worker position it consumed', async ({
  db,
}) => {
  // One JW-debit leg per source link. Keyed on the SOURCE position's identity,
  // so the assertion counts legs per received item against its source count
  // rather than assuming the received lot's own identity.
  const undrained = await db.queryMany<{
    entry_no: string;
    lot_no: string;
    sources: string;
    jw_debit_legs: string;
  }>(
    `SELECT ci.entry_no,
            yi.lot_no,
            (SELECT COUNT(*) FROM jw_challan_in_yarn_item_source s
              WHERE s.yarn_item_id = yi.id)::text AS sources,
            (SELECT COUNT(*) FROM stock_ledger sl
              WHERE sl.transaction_type = 'challan_in'
                AND sl.transaction_item_id = yi.id
                AND sl.location_id IS NULL
                AND sl.job_worker_id IS NOT NULL
                AND sl.notes IS DISTINCT FROM 'cancellation')::text AS jw_debit_legs
       FROM jw_challan_in_yarn_item yi
       JOIN jw_challans_in ci ON ci.id = yi.challan_in_id AND ci.status <> 'cancelled'
      WHERE EXISTS (SELECT 1 FROM jw_challan_in_yarn_item_source s WHERE s.yarn_item_id = yi.id)`,
  );

  const mismatched = undrained.filter((r) => r.sources !== r.jw_debit_legs);
  expect(
    mismatched,
    'a receipt that credits a floor without debiting the job-worker position it drew from ' +
      'leaves the material counted in two places at once',
  ).toEqual([]);
});
