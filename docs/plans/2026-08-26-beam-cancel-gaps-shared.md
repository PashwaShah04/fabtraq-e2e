# Plan — beam cancellation gaps (fabtraq-shared)

**Spec:** `docs/brainstorms/2026-08-26-beam-cancel-gaps.md`
**Branch:** `fix/beam-cancel-gaps-shared`, based on the currently-published `1.21.0` line.

Read the spec first — §B-038 explains why the field is derived from the beam register and not
from the stock ledger. Getting that backwards makes purchase-origin receipts permanently
"not cancelled".

---

## Ground rules

- One task per sub-agent. Each task ends with `lint` + `typecheck` + `test` + `build` green.
- TDD: test first, demonstrated red, then implementation.
- Commit per task locally. Push at the end, on the user's go. **Never merge to main — raise a PR.**

---

## S1 — `cancelled` on the beam-receipt response

`schemas/transaction/beam-receipt.ts` → `beamReceiptResponseSchema` gains:

```ts
/** True once the receipt has been cancelled. Derived from the linked Beam
 *  register rows (all `cancelled`) — the ledger is not a usable signal here
 *  because purchase-origin receipts never write ledger rows. */
cancelled: z.boolean(),
```

Required, not optional: BE always populates it and every consumer wants a definite answer.
The doc comment is load-bearing — it is the only place the purchase-origin trap is recorded
next to the field itself.

**Done:** schema test asserts a payload without `cancelled` is rejected and one with it parses.

## S2 — Version + publish

- Minor bump `1.21.0` → **`1.22.0`**, per this repo's convention for a schema addition. Note it
  is *not* strictly non-breaking: a new **required** field on a response schema breaks anything
  that constructs a `BeamReceiptResponse` — the MSW handlers do exactly this, which is why F1
  exists. Consumers that only read the type are unaffected.
- `npm run build && npm test && npm publish`.
- Then in BE and FE: install `1.22.0`, commit **both** lockfiles, and
  `rm -rf fabtraq-fe/node_modules/.vite` — the Vite dep cache otherwise serves the stale schema
  and the FE schema-validation gate fails for reasons that look nothing like a version skew.

**Done:** `npm view @pashwashah04/fabtraq-shared version` reports `1.22.0`; both lockfiles updated.

**Downstream, not optional:** BE plan **B7** — `npm run openapi:emit` + commit
`fabtraq-be/docs/openapi.json`. The B-004 drift gate (`ci.yml:108-113`) regenerates that file and
fails on any diff, and a new required response field changes it. Same commit as the install.

---

## Explicitly NOT in this repo

The intra-payload duplicate-beam-number check (spec §B-037, job 2) is **not** a `superRefine`
here. `createBeamReceiptSchema` is a `ZodDiscriminatedUnion` that
`shared/openapi/sanitize.ts:23,142-146` special-cases by branch; wrapping it in `ZodEffects`
risks the OpenAPI generation and the B-004 drift gate for no gain. The check lives in the BE
service alongside the cross-receipt check — one helper, one error shape. See BE plan B2.
