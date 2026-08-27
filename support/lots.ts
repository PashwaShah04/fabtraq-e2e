/**
 * Shared fixture queries for "find me a raw lot with real balance on a floor".
 *
 * FIXTURE-BALANCE CONTRACT (see fs1-diagnosis.md). A floor position must be
 * summed the way the app's own authority sums it: `findLotLocationBalance`
 * (fabtraq-be `prisma-inventory.service.ts`) filters lotNumber + locationId +
 * floorId + unit and **no jobWorkerId**. Every copy of this query used to carry
 * `AND s.job_worker_id IS NULL`, which is:
 *
 *  - redundant for its stated purpose ("a floor position, not an at-JW
 *    position") — at-JW legs carry `floor_id IS NULL`, so `JOIN
 *    location_floors` already excludes every one of them; and
 *  - actively wrong, because it HID the floor debits that DO carry a
 *    jobWorkerId. The seed's S2/S3 chains hand-write exactly those: 50 KG on
 *    Ground Floor and 100 KG on First Floor of LOT-260324-0001.
 *
 * The balance was therefore over-reported by up to 100 KG, the query never fell
 * through as the suite drained the lot, and it kept handing tests a floor whose
 * real balance was 2 KG. The JW-Out POST then 400s
 * INSUFFICIENT_BALANCE_AT_FLOOR and no "Saved" toast ever appears.
 *
 * The ORDER BY tiebreak is the other half. LOT-260324-0001 sits on TWO floors,
 * so `ORDER BY s.lot_number LIMIT 1` left the choice to the planner's
 * group-key sort — i.e. to the random floor UUID, a 50/50 coin flip per
 * `db:seed`. Ordering by balance DESC picks the floor with the most headroom
 * and `f.id` makes an exact tie deterministic.
 *
 * Keep BOTH properties in any new copy of this shape.
 */

/** ORDER BY that every fixture pick of this shape must end with. */
export const RAW_LOT_ORDER = ' ORDER BY s.lot_number, SUM(s.in_quantity - s.out_quantity) DESC, f.id\n LIMIT 1';

/**
 * A raw (unprocessed) lot with `>= $1` balance on an active floor, projected as
 * quality/SKU display fields plus `loc_name` / `floor_name` / `floor_id`.
 *
 * Shared verbatim by `jw-in-yarn`, `jw-out`, `out-item-conservation` and
 * `beam-receipt` — those four carried byte-identical copies. Sites that need a
 * different projection or extra filters keep their own query and apply the two
 * properties above in place; do NOT parameterise this one into a
 * do-everything helper.
 */
export const RAW_FLOOR_LOT_SQL = `SELECT s.lot_number, s.sku_id, s.quality_id,
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
   AND cardinality(s.processed_types) = 0
 GROUP BY s.lot_number, s.sku_id, s.quality_id, q.code, q.name,
          sku.name, sku.shade_number, l.name, f.name, f.id
 HAVING SUM(s.in_quantity - s.out_quantity) >= $1${RAW_LOT_ORDER}`;
