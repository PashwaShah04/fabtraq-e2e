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
