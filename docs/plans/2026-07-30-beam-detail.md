# Beam detail from the register — implementation plan (2026-07-30)

Spec: `docs/superpowers/specs/2026-07-30-beam-detail-page-design.md`
Pattern precedent: JW-In eligible-items display fields (shared 1.11.0/1.12.0, 2026-07-29).

Execution: inline, task by task, full done-bar per task. Branches: the four
`feat/s6-consolidated-*` lines (same as tonight's work).

## T1 — shared 1.13.0

- `beamResponseSchema` += `beamReceiptId` (required), `beamReceiptEntryNo`
  (required string), `locationName` / `floorName` / `weaverName`
  (required-nullable strings).
- Tests: beam.test.ts fixture + required-vs-nullable assertions.
- CHANGELOG, `npm version 1.13.0`, build, commit, **publish**.

Done bar: 973+/973+ tests, build green.

## T2 — be

- `BEAM_SELECT`: nest `beamReceiptItem.beamReceiptId` +
  `beamReceipt { entryNo }`; add `location { name }`, `floor { name }`,
  `weaver { name }` selects (confirm Prisma relation names from schema.prisma).
- `BeamRow` interface + `beam.mapper.ts` map the five new fields.
- Integration test (beams routes spec): assert new fields populated / null.
- Pin ^1.13.0 + lockfile. Commit.

Done bar: typecheck 0, unit green, beams integration spec green.

## T3 — fe

- `BeamListPage`: `onRowClick` → navigate to `/beams/:id` (View button stays).
- `BeamDetailPage`: sections Identity / Specs / Weights / Movement /
  Provenance per spec; provenance via existing `useBeamReceipt(beamReceiptId)`,
  item matched by `beamReceiptItemId`; composition table reuses the fields the
  beam-receipt detail page shows; section-local loading/error.
- Tests: row-click navigation; sections render; provenance for in-house
  (composition) and sizing-JW (challan link); receipt-fetch error state.
  MSW beam fixtures gain the new fields (schema-validated).
- Pin ^1.13.0 + lockfile. Commit.

Done bar: typecheck 0, full suite green, lint 0, build green.

## T4 — e2e (lockstep)

- Beam-register spec: click a ROW (not the View button) → URL `/beams/:id`,
  assert an attribute + a provenance detail render.
- Live run of the touched spec(s) (dev servers stopped; snapshot/restore
  around any DB-wiping step).

## T5 — finish

- Live screenshot of the detail page (visual rule).
- Mirror spec+plan into the four repos' docs/ with the implementation commits.
- Memory update; batch push all four branches.
