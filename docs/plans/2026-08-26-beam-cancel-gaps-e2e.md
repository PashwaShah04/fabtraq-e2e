# Plan — beam cancellation gaps (e2e)

**Spec:** `docs/brainstorms/2026-08-26-beam-cancel-gaps.md`
**Branch:** `fix/beam-cancel-gaps-e2e`, stacked on `fix/out-item-conservation-e2e` (`344a06c`).

e2e ships **in lockstep** with the BE/FE commits, not after them. The point of these specs is to
catch exactly the class of bug this ticket is made of: green unit tests over a mocked backend
that disagrees with the live one.

---

## Ground rules

- Every spec owns its own fixtures. Never reuse "the first active" weaver/lot — that is how the
  cross-spec flake was introduced.
- A single-spec run needs the dev servers stopped; a full `npm run e2e` wipes the dev DB. The
  suite boots `fabtraq-pdf-parser` itself.
- Commit per task. Push at the end, on the user's go.

---

## E1 — Beam-number reuse after cancel (the headline regression)

Extend `tests/flows/beam-receipt.spec.ts` (confirmed to exist):

1. Create a beam receipt with beam number `E2E-REUSE-<runid>`.
2. Cancel it. Assert the **Cancelled badge** appears on the detail page and the
   **"Cancel receipt" button is gone**.
3. Navigate to the register list; assert the row shows as cancelled.
4. Create a *new* receipt reusing beam number `E2E-REUSE-<runid>` → succeeds.

Steps 2–4 are the whole ticket in one flow: B-037 and both halves of B-038.

## E2 — Double-cancel is refused

Cancel a **purchase-origin** receipt, then drive the cancel endpoint again → 409. Purchase is the
origin the old ledger-based guard could never catch (spec §B-038b); a sizing_jw case would pass
even against the unfixed code and prove nothing.

## E3 — Transporter picker, end to end

**Grepped 2026-08-26: no existing spec types into the beam-receipt "Transporter ID" box.** The
only "Transporter" hit under `tests/` is `masters/transporters.spec.ts`, which is unrelated. So
there is **no interaction swap to lockstep** here — this task is purely additive, and any claim
that F4 forces e2e edits would be overstated.

In `tests/flows/beam-receipt.spec.ts`: select a transporter from the combobox on a sizing_jw
receipt and assert its **name** appears on the saved receipt's detail page — proving the picker
end to end rather than merely rendered, and covering the `''`-on-the-wire trap from F4.

---

## Done

Full `npm run e2e` green, live, with the FE and BE branches checked out — not a single-spec run.
Archive artifacts under `e2e/e2e-artifacts/` as usual.
