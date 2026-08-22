import { test, expect } from '../../fixtures/test';
import { gotoAndExpect } from '../../support/nav';

// Beam Register (`/beams`) is READ-ONLY — list + detail, no create/edit. Beams are
// registered as a side effect of the beam-receipt flow (see beam-receipt.spec.ts,
// Task 16): tx.beam.create runs per item with status: 'received'
// (BeamReceiptService.createInHouse, beam-receipt.service.ts). There is no
// `/beams/new` route — do not drive one.
//
// Precondition — a received beam. The seed (prisma/seed.ts, "Scenario 4 — beam
// register") reliably creates one on every fresh reseed: a sizing_jw BeamReceipt
// whose item registers `beams` row { beamNumber: 'BEAM-2026-001', status:
// 'received' }. That satisfies this spec's precondition without needing to drive
// the beam-receipt flow inline (Task 16 already covers that path end-to-end), so
// this spec queries the DB to confirm ≥1 received beam exists and reads its real
// beamNumber/id back — it does not hardcode the seed's literal value, so it stays
// correct if the seed data changes, and does not assert a minted document number
// (beamNumber here is a fixed seed fixture, not an FY sequence counter).
test('beam register lists a received beam and its detail renders', async ({ page, db }) => {
  const seededBeam = await db.queryOne<{
    id: string;
    beam_number: string;
    status: string;
    receipt_entry_no: string;
  }>(
    `SELECT b.id, b.beam_number, b.status, br.entry_no AS receipt_entry_no
     FROM beams b
     JOIN beam_receipt_items bri ON bri.id = b.beam_receipt_item_id
     JOIN beam_receipts br ON br.id = bri.beam_receipt_id
     WHERE b.status = 'received'
     ORDER BY b.created_at ASC
     LIMIT 1`,
  );
  expect(seededBeam, 'seed must provide at least one received beam (Scenario 4)').not.toBeNull();

  // LIST — filter the status Select to "Received" (beam-list.page.tsx:
  // SelectTrigger aria-label="Filter by status", option label "Received" for the
  // 'received' BeamStatus value). The generic selectByAriaLabel helper does a
  // substring option match, which is ambiguous here ("Received" also matches the
  // "Fabric Received" option) — select with an exact option-name match instead.
  await gotoAndExpect(page, '/beams');
  await page.locator('[aria-label="Filter by status"]').click();
  await page.getByRole('option', { name: 'Received', exact: true }).click();

  const row = page.getByRole('row', { name: seededBeam!.beam_number });
  await expect(row).toBeVisible();
  // Status badge cell renders the human label (columns.tsx STATUS_LABEL.received).
  await expect(row.getByText('Received')).toBeVisible();

  // DETAIL — the whole row is clickable (spec 2026-07-30); the per-row View
  // link/button was removed — DataTable's onRowClick is the only affordance.
  await row.getByText(seededBeam!.beam_number, { exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/beams/${seededBeam!.id}$`));

  // Detail page renders the beam's key fields (beam-detail.page.tsx): heading
  // "Beam <beamNumber>", the Beam No field, and the Received status badge.
  await expect(
    page.getByRole('heading', { name: `Beam ${seededBeam!.beam_number}` }),
  ).toBeVisible();
  await expect(page.getByText(seededBeam!.beam_number, { exact: true })).toBeVisible();
  await expect(page.getByText('Received', { exact: true })).toBeVisible();

  // Provenance section (spec 2026-07-30): the receipt entry-no renders as a
  // link to the receipt page — present for every beam (FK is required).
  await expect(page.getByText('Provenance')).toBeVisible();
  await expect(
    page.getByRole('link', { name: seededBeam!.receipt_entry_no }),
  ).toBeVisible();
});
