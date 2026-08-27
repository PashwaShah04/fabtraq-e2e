/**
 * Position-level accumulation over raw `stock_ledger` rows — the ORACLE that
 * mirrors `fabtraq-be`'s `fetchPositions` (prisma-inventory.repository.ts).
 *
 * Extracted from inventory.spec.ts once inventory-hub.spec.ts needed the
 * identical rollup: the hub's pipeline band and the hub's stock-item table are
 * two renderings of the same `getSummaryRows` accumulation, so two divergent
 * copies of this arithmetic would be two chances to be wrong.
 *
 * Deliberately NOT done in SQL. An earlier version of the inventory oracle
 * grouped positions with `GROUP BY sl.processed_types` and silently produced
 * wrong values — rows with an identical, EMPTY `processed_types` array were
 * sometimes treated as separate groups by Postgres, hiding real discrepancies.
 * All accumulation happens in plain JS, matching this project's
 * "compute in app, not DB" convention and the BE's own approach.
 *
 * Two invariants callers must not break:
 *
 * 1. ROW SELECTION IS THE CALLER'S. `fetchPositions` applies NO quality-status
 *    filter (`buildPositionsWhere` keys on qualityId/skuId/unit only). A spec
 *    that groups per quality may filter to active qualities safely — an
 *    inactive quality cannot contaminate an active one's group. A spec that
 *    sums ACROSS qualities (the pipeline band) must NOT filter, or its oracle
 *    silently omits stock the backend counts.
 * 2. CUSTODY NORMALIZATION runs before keying (position-custody.ts, fixed
 *    during B-015): challan-out writes its floor DEBIT leg with the
 *    destination job_worker_id stamped on as provenance while keeping the
 *    source location/floor. A located row IS a floor position (L4), so
 *    jobWorkerId is nulled before grouping — otherwise those debits split into
 *    a hybrid bucket that nets negative and is dropped by the `balance > 0`
 *    filter, overstating a 250−60−80=110 position as 250.
 */

/** One raw, UNGROUPED `stock_ledger` row plus the names the specs display. */
export interface RawLedgerRow {
  quality_id: string;
  sku_id: string | null;
  location_id: string | null;
  floor_id: string | null;
  job_worker_id: string | null;
  processed_types: string[];
  unit: string;
  quality_name: string;
  sku_name: string | null;
  location_name: string | null;
  floor_name: string | null;
  job_worker_name: string | null;
  in_quantity: string;
  out_quantity: string;
}

export interface PositionAccum {
  qualityId: string;
  qualityName: string;
  skuId: string | null;
  skuName: string | null;
  locationId: string | null;
  locationName: string | null;
  floorId: string | null;
  floorName: string | null;
  jobWorkerId: string | null;
  jobWorkerName: string | null;
  processedTypes: string[];
  unit: string;
  balance: number;
}

/**
 * The columns {@link accumulatePositions} needs. Every caller selects exactly
 * these; only the WHERE clause differs (see invariant 1 above).
 */
export const LEDGER_POSITION_COLUMNS = `SELECT sl.quality_id, sl.sku_id, sl.location_id, sl.floor_id, sl.job_worker_id,
            sl.processed_types::text[] AS processed_types, sl.unit::text AS unit,
            q.name AS quality_name, s.name AS sku_name,
            l.name AS location_name, f.name AS floor_name, jw.name AS job_worker_name,
            sl.in_quantity::text AS in_quantity, sl.out_quantity::text AS out_quantity
     FROM stock_ledger sl
     JOIN yarn_qualities q ON q.id = sl.quality_id
     LEFT JOIN yarn_skus s ON s.id = sl.sku_id
     LEFT JOIN locations l ON l.id = sl.location_id
     LEFT JOIN location_floors f ON f.id = sl.floor_id
     LEFT JOIN job_workers jw ON jw.id = sl.job_worker_id`;

/** Canonical, order-independent processedTypes — mirrors the BE helper of the same name. */
export function canonicalProcessedTypes(types: readonly string[]): string[] {
  return [...types].sort();
}

/**
 * Groups raw ledger rows on the 7-tuple `balanceGroupKey` (quality, sku,
 * location, floor, jobWorker, unit, canonical processedTypes) — summed across
 * lot numbers, since a balance aggregates every lot — and drops any position
 * whose net balance is not positive, exactly as `fetchPositions` does.
 */
export function accumulatePositions(rows: readonly RawLedgerRow[]): PositionAccum[] {
  const byKey = new Map<string, PositionAccum>();
  for (const r of rows) {
    const canonical = canonicalProcessedTypes(r.processed_types);
    const jobWorkerId = r.location_id !== null ? null : r.job_worker_id;
    const jobWorkerName = r.location_id !== null ? null : r.job_worker_name;
    const key = [
      r.quality_id,
      r.sku_id ?? '∅',
      r.location_id ?? '∅',
      r.floor_id ?? '∅',
      jobWorkerId ?? '∅',
      r.unit,
      canonical.join(','),
    ].join('\x00');
    let p = byKey.get(key);
    if (p === undefined) {
      p = {
        qualityId: r.quality_id,
        qualityName: r.quality_name,
        skuId: r.sku_id,
        skuName: r.sku_name,
        locationId: r.location_id,
        locationName: r.location_name,
        floorId: r.floor_id,
        floorName: r.floor_name,
        jobWorkerId,
        jobWorkerName,
        processedTypes: canonical,
        unit: r.unit,
        balance: 0,
      };
      byKey.set(key, p);
    }
    p.balance += Number(r.in_quantity) - Number(r.out_quantity);
  }
  return [...byKey.values()].filter((p) => p.balance > 0);
}
