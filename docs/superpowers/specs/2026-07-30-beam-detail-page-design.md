# Beam detail from the register — design (2026-07-30)

**Status: approved-in-conversation (session 798ddc0d, 2026-07-30); written for review.**
**Scope decided by user (multi-select): clickable rows + full beam attributes + receipt provenance.**

## Problem

The Beam Register (`/beams`) links to `/beams/:id` only via a small per-row
"View" button, and the detail page shows just 10 header fields. `BeamResponse`
already carries beam-spec attributes, design linkage, storage location, and
wastage that are never displayed, and the beam's receipt provenance
(composition sources, colourway, source challan) is unreachable because the
response holds only the receipt-*item* FK (`beamReceiptItemId`), not the
receipt id.

Route note: the requested `/beam/:beamId` does not exist; the existing
`/beams/:id` route is kept — no second spelling of the same page.

## Design

### 1. Clickable register rows (FE-only)

`DataTable` already supports `onRowClick` (pointer cursor included).
`BeamListPage` passes `onRowClick={(b) => navigate(`/beams/${b.id}`)}`.
The per-row "View" button **stays** (keyboard/a11y path).

### 2. Shared 1.13.0 — additive display fields on `beamResponseSchema`

All required-nullable unless noted, following the read-model convention
(`aggregatedInventoryLotRowSchema`) and the JW-In eligible-items precedent
(1.11.0/1.12.0):

| Field | Type | Why |
|---|---|---|
| `beamReceiptId` | required (every beam has a receipt) | lets the FE call the existing `GET /beam-receipts/:id` |
| `beamReceiptEntryNo` | required string | link text without a second fetch |
| `locationName` | nullable string | B-014: never render `locationId` raw |
| `floorName` | nullable string | B-014: never render `floorId` raw |
| `weaverName` | nullable string | B-014: never render `weaverId` raw |

Response-only, additive — no query/create changes, no breaking wire change.
Publish 1.13.0; be/fe pins + lockfiles follow the established flow.

### 3. BE — populate the fields

The beams read joins `beam_receipt_items` → `beam_receipts` (id, entryNo),
`locations`/`location_floors` (names), `job_workers` (weaver name). Same
mapper, no new endpoint.

### 4. FE — detail page sections + provenance

`BeamDetailPage` reorganised into sections (existing `Field` helper reused):

- **Identity**: beam no, quality, origin badge (purchase / in-house /
  sizing-JW), status, design name
- **Specs**: ends, ends/dent, reed, width, set length, yarn count, cut
- **Weights**: net weight, signed wastage (`wastage` only — `wastagePct` lives
  on the receipt item, shown in the provenance section if present)
- **Movement**: storage location · floor, issued date + challan no, sizing
  worker, weaver
- **Provenance**: fetched via existing `useBeamReceipt(beam.beamReceiptId)`;
  find this beam's item by `beamReceiptItemId`; render receipt entry-no as a
  link to `/beam-receipts/:id`, colourway name, source challan no (sizing-JW),
  and the composition-sources table (in-house beams) rendering the same
  fields per source that the beam-receipt detail page already shows for
  `composition[]` rows. Loading/error states: section-local ("Could not load
  receipt"), never blocks the rest of the page.

Null rendering: `—` for absent values (house convention).

### Alternative considered

A dedicated `GET /beams/:id/provenance` endpoint — rejected (YAGNI): the
receipt response already contains everything; one denormalised id reaches it.

## Testing

- shared: schema tests for the five new fields (required vs required-nullable).
- be: integration assertions on the beams list/detail responses (names + receipt
  id/entryNo populated; nulls where absent).
- fe: unit/integration — row click navigates; each section renders; provenance
  section shows composition for an in-house beam and challan link for
  sizing-JW; error state for a failing receipt fetch.
- e2e (lockstep rule): beam-register spec — click a row (not the View button),
  assert URL + a provenance detail renders; run live.
- Visual: live screenshot of the detail page (verify-UI-visually rule).

## Addendum (2026-07-30, user request)

The same row-click pattern applied to the **Beam Receipts** register:
`BeamReceiptListPage` rows navigate to the existing `/beam-receipts/:id`
detail page (View button kept). FE-only — no schema/BE change. Covered by an
integration test (list → click row → detail heading) and a live e2e test in
`beam-receipt.spec.ts`.

## Out of scope

- Beam drain/ledger history on this page (B-005/B-010 ledger area) — separate
  workstream if wanted.
- Editing anything from the detail page.
