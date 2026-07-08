import { Pool, type QueryResultRow } from 'pg';
import { env } from './env';

export type LedgerKey = {
  qualityId?: string;
  skuId?: string | null;
  lotNumber?: string | null;
  locationId?: string | null;
  floorId?: string | null;
  // At-job-worker position rows (challan-out credit leg / challan-in debit leg)
  // carry a non-null job_worker_id with floorId/locationId = null. undefined =
  // no filter (matches jw and non-jw rows alike); null = IS NULL (floor rows only).
  jobWorkerId?: string | null;
};

// Build a WHERE clause honoring: undefined = no filter, null = IS NULL, value = equality.
function whereFor(key: LedgerKey): { sql: string; params: unknown[] } {
  const cols: Record<string, unknown> = {
    quality_id: key.qualityId,
    sku_id: key.skuId,
    lot_number: key.lotNumber,
    location_id: key.locationId,
    floor_id: key.floorId,
    job_worker_id: key.jobWorkerId,
  };
  const clauses: string[] = [];
  const params: unknown[] = [];
  for (const [col, val] of Object.entries(cols)) {
    if (val === undefined) continue;
    if (val === null) {
      clauses.push(`${col} IS NULL`);
    } else {
      params.push(val);
      clauses.push(`${col} = $${params.length}`);
    }
  }
  return { sql: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', params };
}

export class Db {
  private pool = new Pool({ connectionString: env.DATABASE_URL });

  async ledgerBalance(key: LedgerKey): Promise<number> {
    const { sql, params } = whereFor(key);
    const res = await this.pool.query<{ bal: string | null }>(
      `SELECT COALESCE(SUM(in_quantity - out_quantity), 0) AS bal FROM stock_ledger ${sql}`,
      params,
    );
    return Number(res.rows[0]?.bal ?? 0);
  }

  async ledgerRowExists(key: LedgerKey): Promise<boolean> {
    const { sql, params } = whereFor(key);
    const res = await this.pool.query<{ n: string }>(
      `SELECT COUNT(*)::text AS n FROM stock_ledger ${sql}`,
      params,
    );
    return Number(res.rows[0]?.n ?? '0') > 0;
  }

  async ledgerDelta(
    key: LedgerKey,
    fn: () => Promise<void>,
  ): Promise<{ before: number; after: number; delta: number }> {
    const before = await this.ledgerBalance(key);
    await fn();
    const after = await this.ledgerBalance(key);
    return { before, after, delta: after - before };
  }

  async queryOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
    const res = await this.pool.query<T>(sql, params);
    return res.rows[0] ?? null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
