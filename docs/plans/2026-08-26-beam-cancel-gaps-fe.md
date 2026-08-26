# Plan — beam cancellation gaps (fabtraq-fe)

**Spec:** `docs/brainstorms/2026-08-26-beam-cancel-gaps.md`
**Branch:** `fix/beam-cancel-gaps-fe`, stacked on `fix/out-item-conservation-fe` (`3d07637`).
**Depends on:** shared `1.22.0` installed, and `rm -rf node_modules/.vite` after installing it.

---

## Ground rules

- One task per sub-agent; each ends with `lint` + `typecheck` + `test` + `build` + coverage green.
- TDD, red first.
- Any role-gated element ships with **both** branches tested (shown-for-allowed and
  hidden-for-disallowed) in the same change.
- UI changes are verified with live Playwright screenshots, read as a first-time user. Green
  tests prove nothing about how it looks.
- Commit per task. Push at the end, on the user's go. **Never merge to main — raise a PR.**

---

## F1 — MSW must carry `cancelled`

`tests/msw/handlers/beam-receipts.ts`: every beam-receipt response gains `cancelled`. Without
this the schema-validation gate goes red — and, worse, MSW mocking a shape the backend does not
send is exactly how the S5 live-404s (B-006) slipped past green tests.

Add at least one fixture with `cancelled: true` so F2/F3 have something to render.

**Done:** unit suite green; no schema-validation warnings.

## F2 — Cancelled badge + guarded action on the detail page

`beam-receipt-detail.page.tsx`:
- Badge row (currently origin + "Beam receipt") gains a **Cancelled** badge when
  `receipt.cancelled`. Reuse whatever `jw-challans-out` renders for `status === 'cancelled'` —
  do not invent a new one.
- `canCancel && !receipt.cancelled` gates the "Cancel receipt" button.

Query invalidation is already correct (`hooks.ts:43-53`) — do not add more.

**Tests:** cancelled receipt → badge shown, button absent. Active receipt → no badge, button
shown (role permitting). Plus the existing role-gate pair.

**Done:** both tests green; screenshot of a cancelled receipt reviewed.

## F3 — Cancelled column on the list page

`columns.tsx` — the reporter's words were "today I am not aware if beam receipt is cancelled or
not", and they were looking at the register, not one receipt. A badge only on the detail page
does not close this.

Add a status cell rendering **Cancelled** / **Active** (or blank for active, matching whatever
the JW-challans-out list already does — consistency beats a new convention).

**Done:** list test asserts the cancelled row renders the badge.

## F4 — Transporter picker on the beam-receipt form

`beam-receipt-form.page.tsx:368-379`:
- `Input` → `TransporterSelect` (`@/shared/components/TransporterSelect`), mirroring
  `weaving-dispatch-form.page.tsx:189-200`.
- Label "Transporter ID" → **"Transporter"**.
- Widen the `w-40` wrapper — a combobox in 10rem reads as broken.

Root-cause check before declaring it fixed: confirm `coerceOptStr('')`
(`map-form-to-input.ts:171`) yields `undefined`, and that the form's `defaultValues` for
`transporterId` is not `''`. If `''` reaches the wire, clearing the picker reproduces
`valid uuid is required` even with the combobox in place.

**Test:** selecting a transporter puts its id on the submitted input; clearing it omits the
field entirely (not `''`).

**Scope flag, not acted on:** the field stays gated to `beamOrigin === 'sizing_jw'`. Raise
separately if purchase/in-house receipts should carry a transporter too.

**Done:** tests green; live screenshot of the sizing_jw form with the picker open.
