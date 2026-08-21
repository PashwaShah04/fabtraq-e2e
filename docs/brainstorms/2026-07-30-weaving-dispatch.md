# Weaving Dispatch (Beam Issue + Weft Delivery challans) — Brainstorm

**Date:** 2026-07-30
**Origin session:** `session-1785353483313` (goal: "after beam creation … sent for job-work weaving … two different challans — one for beam issue and one for weft purpose … no page where we can create this")
**Status:** ✅ Design finalized 2026-07-30 (user-locked decisions WD-L1…WD-L12 + advocate/critic agent debate verdict). Spec: `docs/superpowers/specs/2026-07-30-weaving-dispatch-design.md`.
**Owner:** Pashwa (decisions) + Claude (notes)
**Lineage:** This is the start of the **weaving domain** deferred at S8+ by the JW redesign (`2026-05-19-jw-domain-redesign.md` spec-phase note: "keep `Beam` table free of consumed-as-source coupling — add it cleanly when weaving lands"). Builds on Beam Register v2 (B-010) + beam detail page.

> Durable record. Append, don't delete. Read top-to-bottom before touching weaving-dispatch / beam-issue code.

---

## The problem (user's words, paraphrased)

After beams are created (beam register), they are sent to a job worker for weaving. At dispatch time TWO physical challans are written from separate books:

1. **Job Work Beam Issue** (sample photo `job-work-beam-delivery-out.jpeg`, book no. 1701) — table: SR.NO / BEAM NO. / D.NO. / ENDS / REED / CUT / GROSS WT. / PIPE WT. / NETT WT.; footer: TOTAL BEAM, total cut, total nett wt, Value of Goods, receiver signature.
2. **Job Work Delivery Weft Purpose** (sample `job-work-weft-out.jpeg`, book no. 2369) — table: Quality / Lot No. / Cone / Gr. Wt. / Net Wt.; footer: NO. OF BAGS, TOTAL, Value of Goods.

The data (beams with ends/reed/cut/net-wt via `BeamReceiptItem`, yarn lots in inventory) already exists; there is no page to create either challan. A third photo (`job-work-weaving-in.jpeg`) shows the **return leg** — fabric pieces coming back (L.No / Design / Cut / Meter / Weight / Avg Wt) — explicitly OUT OF SCOPE here.

## Codebase reality (verified 2026-07-30)

- `BeamStatus` already has `issued_to_weaver|weaving|fabric_received`, and `Beam` has unused `issuedDate`/`issuedChallanNo`/`weaverId` — **no code transitions status today**; `beam.service.ts` is read-only.
- `ends`/`reed`/`designId` live on `BeamReceiptItem` (1:1 from `Beam`); design code via `beamReceiptItem.design.code`. **Gross wt / pipe wt exist nowhere.**
- Beams are **not in stock_ledger** (beam receipt writes no beam ledger rows — deliberate B-005 deferral).
- `JwChallanOutItem` (qualityId, skuId?, lotNumber, bagCount?, cones?, grossWeight?, netWeight) matches the weft challan columns almost exactly.
- `JobWorkType.weaving` exists but: L18 predicate gates it to sized lots (a dead path — sizing output becomes a *beam*, never a sized yarn lot), and FE allow-lists exclude it. `BEAM_TRACK_TYPES=['warping','sizing','weaving']` already excludes beam-track outs from the yarn JW-In picker.
- FE print pattern = `window.print()` + print CSS (jw-challan-out-detail, yarn-purchase-detail). Value-of-goods is always a manually-typed field.

## Locked decisions (user, 2026-07-30)

| # | Decision |
|---|---|
| **WD-L1** | **Combined page, optional halves.** One create page; beam section and/or weft section may be empty; system stores two challan records (two number series, two printouts). |
| **WD-L2** | **One job worker per dispatch.** Single header (job worker, date, transporter…); both halves inherit it. |
| **WD-L3** | **Weft source = any yarn state** (raw/twisted/gassed/dyed, any floor); operator picks lots freely. |
| **WD-L4** | **System-minted FY-prefix numbering** (not manual book numbers). |
| **WD-L5** | **Gross wt / pipe wt = optional per-beam inputs at issue time**; blank prints blank. |
| **WD-L6** | **Issue overrides `beam.weaverId`** (receipt-time weaver is a plan; issue is the fact). Picker default-filters to that weaver but allows others. |
| **WD-L7** | **Return leg (fabric receipt) out of scope** — future workstream. |
| **WD-L8** | **Cancel = full reversal** (beams → `received` + prior weaver restored; weft ledger reversed). |
| **WD-L9** | **Numbering override to WD-L4:** weft half keeps the existing `JWO-` series (branded `^JWO-` schema makes a new prefix expensive); only the beam challan gets the new `JWB-` series. |
| **WD-L10** | **Weft challans list in `/jw-challans-out`** alongside yarn challans (plus linked from dispatch pages). |
| **WD-L11** | **Edit-while-sent = print fields only** (per-beam gross/pipe wt, both values-of-goods, notes). Date / job worker / beam list / weft rows frozen — cancel + recreate. |
| **WD-L12** | **Two separate print outputs** (one Print button per challan on the dispatch detail page), not one combined sheet. |

## Debate verdict (advocate vs critic agents, 2 rounds, 2026-07-30)

Process per user instruction: supporter + critic agents debated the approach until agreement.

- **Chosen: B'' — compose existing JW-Out for weft + small new beam-issue aggregate.** Self-contained module (A) was dominated: it would add a 4th `PlacementSourceType`, a new `StockTransactionType`, its own ledger writer/cancel wiring, re-earn the B-012/B-013/B-016 bug-fix history, and silently bypass `findDispatchedLotsByLotNumbers` (the guard stopping purchase edits after a lot shipped). Everything-on-JW-Out (C) violated WD-L1's two-number-series decision.
- **L18 fix:** the `weaving` predicate case is unreachable dead logic; replace with `!hasAny(['warping','sizing','weaving'])`. `warping`/`sizing` predicates untouched (a blanket beam-track guard would break the shipped sizing-JW flow — verified against `prisma-beam-receipt.repository.ts:162` + `beam-receipt.service.ts:483-487`).
- **Boundary guard:** public JW-Out `create` rejects `jobWorkTypes.includes('weaving')`; `cancel`/`updateHeader` reject dispatch-owned challans. Internal `createIn`/`cancelIn`/`updateHeaderIn` extracted for the dispatch service (Prisma transactions don't nest — split needed anyway). Closes a live FE footgun (Weaving checkbox tickable, inert only because the old predicate rejected every lot).
- **Double-issue guard:** status-guarded `updateMany(… status:'received')` + count check (house pattern; no partial unique indexes in repo).
- Full verdict + risks recorded in the spec §Risks.

## Out of scope / future

- Fabric receipt (weaving JW-In) — needs a fabric/piece domain (photo 3). Weft yarn stays at-JW (correct custody; `write_off` is the escape hatch).
- Beam ledger representation (beams remain outside stock_ledger).
- Rate-computed value of goods (stays manual everywhere).

## Next steps

1. ✅ Spec: `docs/superpowers/specs/2026-07-30-weaving-dispatch-design.md`.
2. Pashwa reviews spec → then per [[feedback_sprint_kickoff_workflow]]: per-repo plans (shared → be → fe → e2e) → execute.
3. Mirror this brainstorm + spec into the three repos' `docs/` at plan kickoff (per [[feedback_sprint_doc_immediately]]).
