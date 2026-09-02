# Party Lot on JW-Out Challan — e2e Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove, against the live stack, that `items[].partyLotNo` reaches the JW-Out wire response and that both detail-page Lot cells show the party lot above the minted lot — including the null case (`—`, never a fallback) and the merged-lot verbatim case.

**Architecture:** One support-helper change (`sentinel-purchase.ts` learns to type a party lot on the purchase form) plus assertions in three existing specs. No new spec file, no new fixture helper for the merged-lot leg — `party-lot-carry-forward.spec.ts` already builds that round trip and gains one wire assertion at its end.

**Tech Stack:** Playwright 1.48 (`@playwright/test`), raw `pg` via `e2e/fixtures/db.ts`, TypeScript 5.6 strict, Node 22.

**Spec:** `fabtraq-be/docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md` — §4 (the amended L8 e2e clause) and §4.1 Q1/Q2, both **ACCEPTED at their recommendations**:
- **Q1 accepted** — no PDF-text assertion. Embedded PDF text is CID/Identity-H encoded and not byte-greppable (`fabtraq-fe/src/features/challan-print/render.tsx:214-216`; challan-print BRIEF §7). The wire + screen + `%PDF-` blob assertions stand in for it.
- **Q2 accepted** — L3-verbatim (merged lots print the combined string) is proven in `party-lot-carry-forward.spec.ts`, which already owns the two-purchase → merged-JW-In → JW-Out round trip. `jw-out.spec.ts` therefore owns a **2-lot** fixture (party lot present / absent), not a 3-lot one.

**Contract consumed:** `fabtraq-be/docs/superpowers/plans/2026-09-02-party-lot-on-jw-out-challan-shared.md` — `JwChallanOutItemResponse` gains `partyLotNo: string | null` (required-nullable), published as `@pashwashah04/fabtraq-shared@1.28.0`. This plan reads that field off `GET /jw-challans-out/:id`; it imports nothing from `fabtraq-shared` (I15: `e2e/fixtures/copy.ts` and the e2e suite take **no** dependency on the shared package by ruling).

---

## Global Constraints

- **Node 22, strict TS, no `any`, no `.js` import extensions.** (CLAUDE.md standing rules.)
- **The only e2e gate is `npx tsc --noEmit`** (run from `e2e/`, script `npm run typecheck`, `e2e/package.json:11`). The e2e repo has **no Prettier, no ESLint, no CI** — backlog B-028; `ls -a e2e` shows no `.github`. Do not hunt for `format:check`/`lint` here; they do not exist. `check-citations.mjs` still applies to any agent report that cites `file:line`.
- **Never import across spec files.** Every spec owns its fixtures; shared behaviour lives in `e2e/support/**` or is copied per file with a note (`party-lot-carry-forward.spec.ts:21-22` is the standing precedent).
- **One test run at a time**, output redirected to a file. Never judge by a piped exit code — `npm run e2e | tail` reports `tail`'s status (B-043 addendum, e2e-harness BRIEF §6).
- **Ledger assertions are deltas, never absolute balances** (I5, `e2e/fixtures/db.ts:61-69`). This plan adds no new ledger assertion and must not weaken the existing one at `e2e/tests/flows/jw-out.spec.ts:125-130`.
- **Never assert minted document numbers** — format only, via `captureDocNo` (I6, `e2e/support/assert.ts:8-19`).
- **Radix popovers stay mounted ~180 ms after close.** Every select must go through the click-trigger → click-option → `await expect(option).toBeHidden()` barrier (`e2e/support/forms.ts:25-30`). A locally scoped copy of that barrier is required in Task 3 (see the Findings section, item 4).
- **Wave 4 runs only after FE Wave 3 has landed and `fabtraq-fe` is on shared 1.28.0** with `rm -rf fabtraq-fe/node_modules/.vite` done (spec §6 step 3). Against 1.27.0 the FE's `parseOrThrow` rejects every live JW-Out response and every task here goes red for the wrong reason.
- **Every `file:line` in this plan is PRE-EDIT, verified on disk 2026-09-02.** Each earlier step in a
  task shifts the lines the later ones name (Task 1 Step 1 adds a line to `challan-pdf.spec.ts`;
  Task 3 Step 1 adds four to `jw-out.spec.ts`; Task 4 Step 1 adds one to
  `party-lot-carry-forward.spec.ts`). **The anchor for every edit is the quoted text, not the
  number** — find the quoted line, edit there, and treat a number that no longer matches as
  expected drift rather than a finding.
- **Every commit message ends with:**
  ```
  Co-Authored-By: RuFlo <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv
  ```

---

## Waves and e2e checkpoints

| Wave | Content | Concurrency |
|---|---|---|
| W1 | shared commit + publish 1.28.0 (other plan) | — |
| W2 | BE mapper + five paths (other plan) | — |
| W3 | FE print §3.3 ∥ FE detail pages §3.4 (other plan) | — |
| **W4** | **This plan, Tasks 1 → 2 → 3 → 4 → 5** | **Strictly serial. Tasks 2 and 3 both consume the Task 1 helper signature; Tasks 2, 3 and 4 all reseed nothing but share one `fabtraq_dev`, and the suite is `workers: 1` (`e2e/playwright.config.ts:30-31`). Never run two of these tasks' live runs concurrently, and never in a shared worktree/DB with another agent.** |

**e2e checkpoints:**
- **Per task:** Tasks 2, 3 and 4 each end with a live single-spec run of only the spec they touched. Task 1 ends at typecheck (it drives no browser on its own).
- **Task 5 (the wave checkpoint):** all three touched specs re-run live one at a time, then the full `npm run e2e` pre-release run.

**`e2e-required` tasks** (spec §6): Tasks 2 and 3. Task 4 is `e2e-required` in practice because it asserts a ledger-minted lot's identity end to end.

---

## File Structure

| File | Change | Task |
|---|---|---|
| `e2e/support/sentinel-purchase.ts` (131 LOC) | `SentinelPurchaseResult` gains `partyLotNo`; private `createPurchase` gains an options parameter that fills the purchase form's party-lot input; both public wrappers forward it | 1 |
| `e2e/tests/flows/challan-pdf.spec.ts` (159 LOC) | sentinel purchase created **with** a party lot; wire block widened; one new UI cell assertion; blob assertions untouched | 1 (call site only), 2 |
| `e2e/tests/flows/jw-out.spec.ts` (343 LOC) | one **new, appended** 4th test owning a 2-lot fixture; the three existing tests are not edited | 3 |
| `e2e/tests/flows/party-lot-carry-forward.spec.ts` (509 LOC) | one `env` import + one wire assertion inside hop 3 | 4 |

No file is created. No production code is touched by this plan.

---

## Findings from the pre-plan grep (answers a reviewer will ask for)

1. **No e2e locator matches either detail page's Lot cell by exact text.** `grep -rn "getByRole('cell'" e2e/tests` returns 16 hits; the only ones on a JW-Out detail page are `challan-pdf.spec.ts:111` (Quality column, matched by `qualityName`) and the `cellInColumn` helper in `jw-challan-visibility.spec.ts:43-51`, used only for the `Pending`, `Consumed Qty`, `Still at JW` and `Wastage` columns (`:104-105`, `:124-126`). Nothing breaks.
2. **`jw-challan-visibility.spec.ts:102-103` survives the two-line cell.** It resolves rows by `page.getByRole('row', { name: 'LOT-260324-0001' })`; Playwright's `name` option defaults to `exact: false`, i.e. a normalized case-insensitive **substring** match, so a second line of text inside the row's Lot cell only lengthens the accessible name. Verified no-op — but the full run in Task 5 is what proves it.
3. **Spec §3.4's header claim is half wrong and must not be copied into a locator.** It says the column header "stays `Lot No` / `Lot No.` on both pages". On the weaving-dispatch detail page that is right (`fabtraq-fe/src/features/weaving-dispatches/weaving-dispatch-detail.page.tsx:279` → `Lot No`), but the JW-Out detail page's header is **`Source Lot`** (`fabtraq-fe/src/features/jw-challans-out/jw-challan-out-detail.page.tsx:291`). This plan therefore never locates the cell by its header — it locates it by the minted lot number the cell contains. Report this to the FE reviewer as a spec-text defect; it does not change the FE edit, which is cell-only.
4. **`placement quantity 1`, `Add placement` and `Select floor and location` are per-line-item, not per-form.** Each `ChallanOutLineItemRow` renders its own `PlacementFieldArray` (`fabtraq-fe/src/features/jw-challans-out/components/ChallanOutLineItemRow.tsx:298-303`), and that component indexes labels within its own field array (`fabtraq-fe/src/shared/components/PlacementFieldArray.tsx:263`, `:337`). With two line items on screen, the page-wide `fillByLabelExact(page, 'placement quantity 1', …)` / `clickButton(page, 'Add placement')` / `selectByAriaLabel(page, 'Select floor and location', …)` helpers all resolve **two** elements and die on Playwright strict mode. Task 3 must scope them to the line's `<tr>`. `Quality for line N`, `Source lot for line N` and `Net weight for line N` already carry the line number and stay page-wide.
5. **The em dash is U+2014 (`—`, bytes `e2 80 94`),** confirmed by hexdump of `jw-challan-out-detail.page.tsx:318`. Not the en dash `–` (U+2013) used in the `code – name` option labels. Copy the right one.
6. **`—` alone is not a distinguishing assertion on a JW-Out detail row.** `bagCount`, `cones` and `grossWeight` each render `'—'` when null in the same row (`jw-challan-out-detail.page.tsx:317-325`), and Task 3's fixture fills only net weight. A row-level `toContainText('—')` would pass even if the Lot cell had fallen back to the minted lot — exactly the L2 violation the test exists to catch. Every `—` assertion in this plan is scoped to the single cell that contains the minted lot number.

---

### Task 1: Thread an optional party lot through the sentinel-purchase helper

**Files:**
- Modify: `e2e/support/sentinel-purchase.ts:9-17` (result type), `:29-34` (private signature), `:73-81` (form-driving block), `:100-107` (return), `:110-131` (both public wrappers)
- Modify (one line, the red): `e2e/tests/flows/challan-pdf.spec.ts:49`
- Test: none of its own — the e2e repo has no unit runner. The red/green cycle here runs through `npx tsc --noEmit`, which is this module's only gate; the behavioural proof is Task 2's live run.

**Interfaces:**
- Consumes: `fillByLabel` (`e2e/support/forms.ts:3-5`), already imported at `sentinel-purchase.ts:6`. The input is `aria-label="Party lot number for line 1"` (`fabtraq-fe/src/features/yarn-purchases/components/PurchaseLineItemRow.tsx:178`), so `getByLabel` resolves it; `fillByLabel` matches non-exactly and the string is unique on the purchase form.
- Produces, for Tasks 2 and 3:
  ```ts
  export interface SentinelPurchaseOptions {
    readonly partyLotNo?: string;
  }
  export interface SentinelPurchaseResult {
    readonly qualityId: string;
    readonly location: { readonly id: string; readonly name: string };
    readonly floor: { readonly id: string; readonly name: string };
    readonly lotNumber: string;
    readonly purchaseId: string;
    readonly skuId: string | null;
    readonly partyLotNo: string | null;
  }
  export function createSentinelPurchase(
    page: Page, db: Db, quantity: number, options?: SentinelPurchaseOptions,
  ): Promise<SentinelPurchaseResult>;
  export function createSkuPurchase(
    page: Page, db: Db, quantity: number, options?: SentinelPurchaseOptions,
  ): Promise<SentinelPurchaseResult>;
  ```
  `options` is optional and its one property is optional, so **every existing call site compiles unchanged** — `stock-transfer.spec.ts`, `inventory.spec.ts`, `beam-receipt.spec.ts`, `jw-out.spec.ts:161`, `:279`, `challan-pdf.spec.ts:49`.

- [ ] **Step 0: Confirm the branch**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e && git rev-parse --abbrev-ref HEAD
```

Expected: `feat/inventory-rewoven`. Anything else — stop and report; four commits land on this
branch across Tasks 1-4 and none of them belong anywhere else.

- [ ] **Step 1: Write the failing consumer (the red is a type error)**

In `e2e/tests/flows/challan-pdf.spec.ts`, change line 49 from:

```ts
    const sentinel = await createSentinelPurchase(page, db, Q);
```

to:

```ts
    const partyLot = codes.unique('PL');
    const sentinel = await createSentinelPurchase(page, db, Q, { partyLotNo: partyLot });
```

`codes` is already imported at `challan-pdf.spec.ts:5`; `codes.unique('PL')` yields `PL-<runTag>-<n>` (`e2e/fixtures/codes.ts:10`), unique per run and per call, so this spec can never collide with another's party lot.

- [ ] **Step 2: Run the typecheck to verify it fails**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx tsc --noEmit > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t1-red.txt 2>&1; tail -20 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t1-red.txt
```

Expected: FAIL — `error TS2554: Expected 3 arguments, but got 4.` pointing at `tests/flows/challan-pdf.spec.ts`. If it passes, the helper already takes a 4th argument and this task is already done — stop and report.

- [ ] **Step 3: Add the options type and the result field**

In `e2e/support/sentinel-purchase.ts`, replace the `SentinelPurchaseResult` block at `:9-17` with:

```ts
export interface SentinelPurchaseResult {
  readonly qualityId: string;
  readonly location: { readonly id: string; readonly name: string };
  readonly floor: { readonly id: string; readonly name: string };
  readonly lotNumber: string;
  readonly purchaseId: string;
  /** null for the sentinel ("No shade / greige") path; a real SKU id otherwise. */
  readonly skuId: string | null;
  /**
   * The vendor's own lot number, typed into "Party lot number for line 1" on
   * the purchase form — the ONLY place it is ever entered (party lot is
   * derived/read-only everywhere downstream, 2026-08-20 carry-forward spec L2).
   * `null` when the caller did not ask for one, which is every pre-existing
   * caller: the minted lot then carries `party_lot_no = NULL`.
   */
  readonly partyLotNo: string | null;
}

/** Optional extras for a driven purchase. Omitted by every pre-existing caller. */
export interface SentinelPurchaseOptions {
  readonly partyLotNo?: string;
}
```

- [ ] **Step 4: Give the private driver the parameter and fill the input**

In the same file, change the `createPurchase` signature at `:29-34` to:

```ts
async function createPurchase(
  page: Page,
  db: Db,
  quantity: number,
  sku: 'sentinel' | 'real',
  options: SentinelPurchaseOptions = {},
): Promise<SentinelPurchaseResult> {
```

Then, inside the form-driving block, insert the party-lot fill immediately after the quantity fill at `:77` (i.e. between `fillByLabel(page, 'Quantity for line 1', …)` and `clickButton(page, 'Add placement')`), so the ordering matches the private helper in `party-lot-carry-forward.spec.ts:161-162`:

```ts
  await fillByLabel(page, 'Quantity for line 1', String(quantity));
  // Party Lot No (PurchaseLineItemRow.tsx aria-label "Party lot number for
  // line N"). Left untouched when the caller asks for none, so the minted lot
  // keeps `party_lot_no = NULL` and every pre-existing caller's fixture is
  // byte-for-byte what it was.
  if (options.partyLotNo !== undefined) {
    await fillByLabel(page, 'Party lot number for line 1', options.partyLotNo);
  }
  await clickButton(page, 'Add placement');
```

- [ ] **Step 5: Return it**

Change the return block at `:100-107` to:

```ts
  return {
    qualityId: quality!.id,
    location: { id: location!.id, name: location!.name },
    floor: { id: floor!.id, name: floor!.name },
    lotNumber: row!.lot_number!,
    purchaseId,
    skuId: row!.sku_id,
    partyLotNo: options.partyLotNo ?? null,
  };
```

- [ ] **Step 6: Forward it from both public wrappers**

Replace `:110-131` (both wrappers) with:

```ts
/** SKU-less ("No shade / greige" sentinel) stock — `stock_ledger.sku_id IS NULL`. */
export async function createSentinelPurchase(
  page: Page,
  db: Db,
  quantity: number,
  options: SentinelPurchaseOptions = {},
): Promise<SentinelPurchaseResult> {
  return createPurchase(page, db, quantity, 'sentinel', options);
}

/**
 * Real-SKU stock owned by the calling spec. Exists so specs never source
 * "whichever seeded lot has enough balance" — a sibling spec running in
 * parallel can drain that lot between the DB probe and the UI submit
 * (docs/e2e: specs must own their fixtures).
 */
export async function createSkuPurchase(
  page: Page,
  db: Db,
  quantity: number,
  options: SentinelPurchaseOptions = {},
): Promise<SentinelPurchaseResult> {
  return createPurchase(page, db, quantity, 'real', options);
}
```

- [ ] **Step 7: Run the typecheck to verify it passes**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx tsc --noEmit > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t1-green.txt 2>&1; echo "exit=$?"; tail -20 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t1-green.txt
```

Expected: `exit=0`, empty output. Every other caller of both wrappers still compiles, which is the whole point of the defaulted parameter.

- [ ] **Step 8: Confirm no pre-existing caller changed**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
git diff --stat
```

Expected: exactly two files — `support/sentinel-purchase.ts` and `tests/flows/challan-pdf.spec.ts`. Any third file means a caller was edited that did not need to be; revert it.

- [ ] **Step 9: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
git add support/sentinel-purchase.ts tests/flows/challan-pdf.spec.ts
git commit -m "test(e2e): sentinel-purchase helper can type a party lot on the purchase form

Optional trailing options object, defaulted to omitted, so every existing
caller is unchanged. Returned on SentinelPurchaseResult for the JW-Out
partyLotNo assertions.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §4

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 2: `challan-pdf.spec.ts` — party lot on the wire and in the printed challan's source cell

**Files:**
- Modify: `e2e/tests/flows/challan-pdf.spec.ts:94-105` (wire block), `:107-113` (UI block)
- Unchanged: `:115-155` — the `window.open` blob capture, `%PDF-` prefix and `>10KB` assertions stay exactly as they are (Q1: no PDF-text assertion).

**Interfaces:**
- Consumes: `createSentinelPurchase(page, db, Q, { partyLotNo })` and `SentinelPurchaseResult.partyLotNo` from Task 1; the local `partyLot` const added at `:49` in Task 1 Step 1.
- Produces: nothing other tasks read.

- [ ] **Step 1: Widen the inline wire type and assert `partyLotNo` on the wire**

In `challan-pdf.spec.ts`, replace the block that begins `const wireBody = (await wireRes.json()) as {` and
ends at the closing brace of the `for (const item of wireBody.items)` loop (pre-edit `:94-105`) with:

```ts
    const wireBody = (await wireRes.json()) as {
      jobWorker: { stateName: string | null; stateCode: string | null };
      items: { qualityName: string; sourceLotNumber: string; partyLotNo: string | null }[];
    };
    expect(wireBody.jobWorker.stateName, 'jobWorker.stateName must be hydrated on the response').toBeTruthy();
    expect(wireBody.jobWorker.stateCode, 'jobWorker.stateCode must be hydrated on the response').toBeTruthy();
    expect(wireBody.items.length).toBeGreaterThan(0);
    const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const item of wireBody.items) {
      expect(item.qualityName, 'qualityName must not be blank').toBeTruthy();
      expect(item.qualityName, 'qualityName must be a name, not a raw UUID').not.toMatch(uuidPattern);
    }

    // The party lot the purchase form was given, resolved at READ time by the
    // BE from `yarn_purchase_item.party_lot_no` via
    // IInventoryService.findPartyLotsByLotNumbers (spec L4) and printed in the
    // challan's "Lot No." column instead of the minted lot (L1). Asserting the
    // exact typed string — not merely "not null" — is what catches a map keyed
    // on the item id instead of the lot number: with one item, a wrongly keyed
    // map yields null, and a right-keyed one yields exactly this value.
    expect(wireBody.items[0]!.sourceLotNumber).toBe(sentinel.lotNumber);
    expect(
      wireBody.items[0]!.partyLotNo,
      'items[].partyLotNo must carry the party lot typed on the purchase form',
    ).toBe(partyLot);
```

- [ ] **Step 2: Assert the two-line source cell on screen**

Immediately after the existing quality-cell block — the three lines beginning `const qualityCell =`
and ending `.not.toHaveText(uuidPattern);` (pre-edit `:111-113`) — append:

```ts
    // L6 — the detail page shows BOTH identities in ONE cell: the party lot on
    // top, the minted lot beneath in muted text
    // (jw-challan-out-detail.page.tsx:316). Located by the minted lot rather
    // than by the column header (the header there reads "Source Lot", :291,
    // not "Lot No") and asserted on the CELL, not the row: bags/cones/gross all
    // render '—' in the same row, so a row-level assertion would be satisfied
    // by the wrong element.
    const lotCell = page
      .getByRole('row', { name: sentinel.lotNumber })
      .getByRole('cell')
      .filter({ hasText: sentinel.lotNumber });
    await expect(lotCell).toHaveCount(1);
    await expect(lotCell).toContainText(partyLot);
    await expect(lotCell).toContainText(sentinel.lotNumber);
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx tsc --noEmit > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t2-tsc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 4: Run this spec live**

Stop any `npm run dev` in `fabtraq-be` / `fabtraq-fe` first — the suite owns `:4000`/`:5173` with `reuseExistingServer: false` (`e2e/playwright.config.ts:64`, `:98`) and will fail with `EADDRINUSE` otherwise. Kill the `npm run dev` → `tsx watch` **parent** chain, not the child, or watch respawns it. Confirm with `ss -ltn | grep -E ':(4000|5173)'` returning nothing.

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx playwright test tests/flows/challan-pdf.spec.ts --project=authed \
  > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t2-challan-pdf.txt 2>&1
echo "exit=$?"
tail -30 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t2-challan-pdf.txt
```

Expected: `exit=0`, `1 passed`. A single-spec run does **not** reseed `fabtraq_dev` — it drives the app for its own fixtures, which is exactly what this spec is built to do.

If `partyLotNo` comes back `null`: the BE is not resolving it. Check that `fabtraq-be` is on shared 1.28.0 and that its mapper passes the party-lot map — do not "fix" it in the spec.

- [ ] **Step 5: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
git add tests/flows/challan-pdf.spec.ts
git commit -m "test(e2e): challan-pdf asserts partyLotNo on the wire and in the source-lot cell

Wire: GET /jw-challans-out/:id items[0].partyLotNo equals the string typed on
the purchase form (L1/L4). Screen: the one cell holding the minted lot also
holds the party lot (L6). PDF blob assertions unchanged (spec §4 Q1 — embedded
PDF text is CID-encoded and not greppable).

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §4

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 3: `jw-out.spec.ts` — a 2-lot fixture proving present *and* absent

**Files:**
- Modify: `e2e/tests/flows/jw-out.spec.ts:1-11` (imports)
- Modify: `e2e/tests/flows/jw-out.spec.ts` — **append** a new 4th test at the very end of the file, after the last existing `test(` call closes
- Do not edit the three existing tests at `:28`, `:158`, `:274`.

**Why appended, not inserted:** the first test derives its source lot from `RAW_FLOOR_LOT_SQL` (`e2e/support/lots.ts`), ordered `balance DESC, f.id` across raw floor lots (I10). Two fresh purchases minted *earlier* in the file could outrank the seed row that test expects to find and perturb its `db.ledgerDelta` assertion at `:124-130`. Tests run in declaration order, so appending is the only safe placement.

**Interfaces:**
- Consumes: `createSentinelPurchase(page, db, Q, options?)` and `SentinelPurchaseResult.partyLotNo` (Task 1); `codes.unique` (`e2e/fixtures/codes.ts:10`); `env.API_URL` (`e2e/fixtures/env.ts:6`).
- Produces: nothing other tasks read.

- [ ] **Step 1: Add the imports this test needs**

`jw-out.spec.ts` currently imports neither `codes` nor `env`, and has no Playwright type imports. Replace `:1-11` with:

```ts
import type { Locator, Page } from '@playwright/test';

import { test, expect } from '../../fixtures/test';
import { codes } from '../../fixtures/codes';
import { env } from '../../fixtures/env';
import { gotoAndExpect } from '../../support/nav';
import {
  fillByLabel, fillByLabelExact,
  selectByAriaLabel,
  selectByLabel,
  clickButton,
} from '../../support/forms';
import { expectToast, captureDocNo } from '../../support/assert';
import { createSentinelPurchase, createSkuPurchase } from '../../support/sentinel-purchase';
import { RAW_FLOOR_LOT_SQL } from '../../support/lots';
```

- [ ] **Step 2: Write the failing test — append it verbatim at the very end of the file, after the last existing `test(` call closes**

```ts
// ── Party lot on the JW-Out response and detail page ────────────────────────
// Spec docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md
// L1/L2/L5/L6. Two line items in ONE challan so the present case and the
// absent case are proven against the same response object: a mapper that
// resolves the map but keys it wrongly (item id instead of lot number) makes
// BOTH items null, and a mapper that falls back to the minted lot makes
// neither null — one line item could not tell those apart.
//
// FIXTURE OWNERSHIP: two dedicated sentinel purchases, minted through the real
// purchase form. No "first active"/"first sufficient" lot anywhere, so this
// test cannot race or be starved by a sibling spec. The job worker is the
// seed's first active one, matching the other two tests in this file — it is
// read only and holds no balance this test asserts on.
//
// This test asserts identity, not ledger movement; the -Q ledger delta is the
// first test's job (:125-130) and is deliberately not duplicated here.

/** The `<tr>` of line item `n` on /jw-challans-out/new. */
function lineRow(page: Page, n: number): Locator {
  return page.locator('tr').filter({ has: page.locator(`[aria-label="Quality for line ${n}"]`) });
}

/**
 * Placement controls are indexed WITHIN each line item's own
 * PlacementFieldArray (ChallanOutLineItemRow.tsx:298-303 renders one per row;
 * PlacementFieldArray.tsx:263,:337 labels them "placement quantity 1" /
 * "Add placement" regardless of which line they belong to). With two lines on
 * screen the page-wide support helpers resolve two elements each and die on
 * strict mode, so this file scopes them to the line's row. The option list
 * itself is portal-rendered at page level, hence the page-level option lookup
 * plus the unmount barrier copied from support/forms.ts:25-30 (Radix popovers
 * stay mounted ~180 ms after close).
 */
async function placeWholeLine(
  page: Page,
  n: number,
  floorOptionLabel: string,
  q: number,
): Promise<void> {
  const row = lineRow(page, n);
  await row.getByRole('button', { name: 'Add placement' }).click();
  await row.locator('[aria-label="Select floor and location"]').click();
  const option = page.getByRole('option', { name: floorOptionLabel });
  await option.click();
  await expect(option).toBeHidden();
  await row.getByLabel('placement quantity 1', { exact: true }).fill(String(q));
}

test(
  'a JW challan-out carries the party lot per item, and blanks it with an em dash when the origin had none',
  async ({ page, db }) => {
    const Q = 7;
    const partyLot = codes.unique('PL');

    // Line 1's lot carries a party lot; line 2's does not. Both are SKU-less
    // sentinel lots on the same first-active quality, so one quality pick
    // drives both lines and neither needs the SKU picker (same reasoning as
    // challan-pdf.spec.ts:62-63).
    const withPl = await createSentinelPurchase(page, db, Q, { partyLotNo: partyLot });
    const withoutPl = await createSentinelPurchase(page, db, Q);
    // Documents the fixture's intent, not the app's behaviour: the helper
    // echoes its own input, so these can only go red alongside a typecheck
    // failure. Kept as the reader's statement of which lot is which.
    expect(withPl.partyLotNo).toBe(partyLot);
    expect(withoutPl.partyLotNo).toBeNull();

    const quality = await db.queryOne<{ code: string; name: string }>(
      `SELECT code, name FROM yarn_qualities WHERE id = $1`,
      [withPl.qualityId],
    );
    expect(quality, 'the sentinel purchases must reference a real quality').not.toBeNull();

    const jobWorker = await db.queryOne<{ code: string; name: string }>(
      `SELECT code, name FROM job_workers WHERE status = 'active' ORDER BY code LIMIT 1`,
    );
    expect(jobWorker, 'seed must provide at least one active job worker').not.toBeNull();

    await gotoAndExpect(page, '/jw-challans-out/new');
    await selectByLabel(page, 'Job worker', `${jobWorker!.code} – ${jobWorker!.name}`);
    // SourceLotPicker stays disabled until jobWorkTypes is non-empty.
    await page.getByLabel('Twisting').check();

    // Line 1 — the party-lot lot.
    await selectByAriaLabel(page, 'Quality for line 1', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'Source lot for line 1', withPl.lotNumber);
    await fillByLabel(page, 'Net weight for line 1', String(Q));
    await placeWholeLine(page, 1, `${withPl.location.name} · ${withPl.floor.name}`, Q);

    // Line 2 — the bare lot. "Add line" is ChallanOutLineItemTable.tsx:137.
    await clickButton(page, 'Add line');
    await selectByAriaLabel(page, 'Quality for line 2', `${quality!.code} – ${quality!.name}`);
    await selectByAriaLabel(page, 'Source lot for line 2', withoutPl.lotNumber);
    await fillByLabel(page, 'Net weight for line 2', String(Q));
    await placeWholeLine(page, 2, `${withoutPl.location.name} · ${withoutPl.floor.name}`, Q);

    await clickButton(page, 'Save challan');
    await expectToast(page, /^Saved /);
    await expect(page).toHaveURL(/\/jw-challans-out\/[^/]+$/);
    const challanNo = await captureDocNo(page.getByRole('main'), /\bJWO-\d{4}-\d{2}-\d{3,}\b/);
    const challanId = page.url().split('/').pop();
    expect(challanId, 'save must redirect to a detail URL carrying the new id').toBeTruthy();

    // ── WIRE ────────────────────────────────────────────────────────────────
    // Keyed by sourceLotNumber, never by array index: nothing in the contract
    // promises the items come back in form order.
    const wireRes = await page.request.get(`${env.API_URL}/jw-challans-out/${challanId}`);
    expect(wireRes.ok()).toBe(true);
    const wireBody = (await wireRes.json()) as {
      items: { sourceLotNumber: string; partyLotNo: string | null }[];
    };
    expect(wireBody.items).toHaveLength(2);
    const partyLotByLot = new Map(
      wireBody.items.map((item) => [item.sourceLotNumber, item.partyLotNo]),
    );
    expect(
      partyLotByLot.get(withPl.lotNumber),
      'the lot minted with a party lot must carry it verbatim (L1/L4)',
    ).toBe(partyLot);
    expect(
      partyLotByLot.get(withoutPl.lotNumber),
      'a lot whose origin recorded no party lot must be null, NOT the minted lot (L2)',
    ).toBeNull();

    // ── SCREEN ──────────────────────────────────────────────────────────────
    await gotoAndExpect(page, `/jw-challans-out/${challanId}`);
    await expect(
      page.getByRole('heading', { name: `Job Work Challan Out ${challanNo}` }),
    ).toBeVisible();

    // Scoped to the ONE cell containing each minted lot. A row-level check
    // would be vacuous for the em dash: bags, cones and gross weight all render
    // '—' in the same row (jw-challan-out-detail.page.tsx:317-325) because this
    // fixture fills only net weight.
    const lotCellFor = (lotNumber: string): Locator =>
      page.getByRole('row', { name: lotNumber }).getByRole('cell').filter({ hasText: lotNumber });

    const presentCell = lotCellFor(withPl.lotNumber);
    await expect(presentCell).toHaveCount(1);
    await expect(presentCell).toContainText(partyLot);
    await expect(presentCell).toContainText(withPl.lotNumber);

    // U+2014 EM DASH, the character jw-challan-out-detail.page.tsx uses for an
    // absent value — not the U+2013 en dash of the "code – name" option labels.
    const absentCell = lotCellFor(withoutPl.lotNumber);
    await expect(absentCell).toHaveCount(1);
    await expect(absentCell).toContainText('—');
    await expect(absentCell).toContainText(withoutPl.lotNumber);
    // L2, stated as a negative: no fallback to the OTHER line's party lot
    // either, which is what a map collapsed to a single value would produce.
    await expect(absentCell).not.toContainText(partyLot);
  },
);
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx tsc --noEmit > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t3-tsc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 4: Run the whole spec live — all four tests**

Dev servers stopped, as in Task 2 Step 4.

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx playwright test tests/flows/jw-out.spec.ts --project=authed \
  > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t3-jw-out.txt 2>&1
echo "exit=$?"
tail -40 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t3-jw-out.txt
```

Expected: `exit=0`, `4 passed`. The three pre-existing tests must still pass — in particular the first one's `expect(delta).toBeCloseTo(-Q, 3)` at `:130`. If it now fails, the new test was inserted before it instead of appended; move it to the end of the file.

If a locator resolves two elements ("strict mode violation … resolved to 2 elements"), it is one of the three per-line controls in Findings item 4 — scope it to `lineRow(page, n)`, never `.first()`.

- [ ] **Step 5: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
git add tests/flows/jw-out.spec.ts
git commit -m "test(e2e): jw-out proves partyLotNo present and absent in one challan

Own 2-lot fixture (one sentinel purchase with a party lot, one without), two
line items, one response: wire asserts the value and null respectively, screen
asserts the party lot / em dash above the minted lot in the same cell. No
fallback to the minted lot (L2). Appended after the existing three tests so the
RAW_FLOOR_LOT_SQL pick in the ledger-delta test is unperturbed.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §4 Q2

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 4: `party-lot-carry-forward.spec.ts` — L3 verbatim on the JW-Out wire

**Files:**
- Modify: `e2e/tests/flows/party-lot-carry-forward.spec.ts:1-9` (add one import)
- Modify: `e2e/tests/flows/party-lot-carry-forward.spec.ts` — immediately after the line `const outMerged = await openJwPosition(page, jobWorker!, mergedSrc, 'Dyeing', Q * 2);` inside hop 3 (pre-edit `:414`)

**Why here:** this spec already builds the whole thing — two purchases with distinct party lots (`:358-359`), a merged JW-In minting one lot whose `party_lot_no` is the `" / "`-joined `combined` string (`:389-395`), and hop 3 driving that merged lot back out through a real JW-Out (`:414`). Rebuilding that round trip inside `jw-out.spec.ts` would cost a new `e2e/support/` helper for no additional coverage (spec §4, Q2 accepted). One assertion is added and nothing else moves.

**Interfaces:**
- Consumes: the existing local `combined` (`:394`) and `outMerged` (`:414`); `env.API_URL` (`e2e/fixtures/env.ts:6`); the `db` fixture already destructured by this test.
- Produces: nothing.

- [ ] **Step 1: Add the `env` import**

This spec imports no `env` today. After the `test/expect` import at `:1`, add:

```ts
import { env } from '../../fixtures/env';
```

- [ ] **Step 2: Write the failing assertion**

Immediately after the line `const outMerged = await openJwPosition(page, jobWorker!, mergedSrc, 'Dyeing', Q * 2);`
(and BEFORE the `outARemainder` line that follows it), insert:

```ts
    // L3 (spec 2026-09-02-party-lot-on-jw-out-challan-design) — a merged lot's
    // combined party-lot string reaches the JW-Out response VERBATIM: the BE
    // resolves it in a single hop from jw_challan_in_yarn_item.party_lot_no
    // (2026-08-20 L10, denormalized per generation), never re-deriving or
    // re-joining it. Asserted here rather than in jw-out.spec because this
    // spec already owns the two-purchase → merged-receipt round trip that
    // produces a combined value; jw-out.spec keeps a 2-lot fixture.
    //
    // openJwPosition returns the minted challan NUMBER (format-only per I6);
    // the id comes from the row, not from an assertion on that number.
    const outMergedRow = await db.queryOne<{ id: string }>(
      `SELECT id FROM jw_challans_out WHERE challan_no = $1`,
      [outMerged],
    );
    expect(outMergedRow, 'the merged-lot JW-Out must resolve to a jw_challans_out row').not.toBeNull();
    const outWire = await page.request.get(`${env.API_URL}/jw-challans-out/${outMergedRow!.id}`);
    expect(outWire.ok()).toBe(true);
    const outBody = (await outWire.json()) as {
      items: { sourceLotNumber: string; partyLotNo: string | null }[];
    };
    const mergedItem = outBody.items.find((item) => item.sourceLotNumber === item1!.lot_no);
    expect(mergedItem, 'the JW-Out must carry an item for the merged lot').toBeDefined();
    expect(
      mergedItem!.partyLotNo,
      'the combined party-lot string must print verbatim, joined exactly once',
    ).toBe(combined);
```

- [ ] **Step 3: Typecheck**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx tsc --noEmit > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t4-tsc.txt 2>&1; echo "exit=$?"
```

Expected: `exit=0`.

- [ ] **Step 4: Run the spec live**

Dev servers stopped, as in Task 2 Step 4. This spec drives many form round trips; give it room.

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npx playwright test tests/flows/party-lot-carry-forward.spec.ts --project=authed \
  > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t4-party-lot.txt 2>&1
echo "exit=$?"
tail -40 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/t4-party-lot.txt
```

Expected: `exit=0`, all tests in the file pass (the carry-forward test and the beam-composition test at `:449`).

If `partyLotNo` comes back as one of the two atomic party lots rather than the joined string, the BE is re-deriving instead of reading the stored value — a BE defect (spec §3.2, single hop). Report it; do not relax the assertion.

- [ ] **Step 5: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
git add tests/flows/party-lot-carry-forward.spec.ts
git commit -m "test(e2e): merged lot's combined party lots reach the JW-Out wire verbatim

L3, asserted on the existing hop-3 JW-Out rather than by rebuilding the merged
round trip inside jw-out.spec (spec §4 Q2).

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §4

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 5: Wave-4 checkpoint — per-spec live runs, then the pre-release full suite

**Files:** none. This task changes no code; it produces evidence.

**Interfaces:**
- Consumes: Tasks 1-4, all committed.
- Produces: five log files under `/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/` that the Stage 5 done bar cites.

- [ ] **Step 1: Confirm the tree is clean and the stack is the right one**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e && git status --short
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe && node -p "require('./package.json').dependencies['@pashwashah04/fabtraq-shared']"
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be && node -p "require('./package.json').dependencies['@pashwashah04/fabtraq-shared']"
```

Expected: e2e clean; both BE and FE resolving `1.28.0`. On anything lower, stop — the runs below would be measuring the old contract.

- [ ] **Step 2: Free the ports**

```bash
ss -ltn | grep -E ':(4000|5173|7300)' || echo "ports free"
```

Expected: `ports free` for 4000 and 5173. A listener on either means a dev server is up — kill the `npm run dev` → `tsx watch` **parent** process chain, not the child, or the watcher respawns it. `:7300` (fabtraq-pdf-parser) may stay: the config reuses an existing instance (`e2e/playwright.config.ts:108`).

- [ ] **Step 3: Run the three touched specs live, ONE AT A TIME**

`npx playwright test` bypasses `scripts/test-lock.mjs` (the lock is wired into the `e2e` script only, `e2e/package.json:8`), so serialization here is manual: wait for each command to print its exit code before starting the next.

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
OUT=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e

npx playwright test tests/flows/challan-pdf.spec.ts --project=authed > "$OUT/cp-challan-pdf.txt" 2>&1; echo "challan-pdf exit=$?"
npx playwright test tests/flows/jw-out.spec.ts --project=authed > "$OUT/cp-jw-out.txt" 2>&1; echo "jw-out exit=$?"
npx playwright test tests/flows/party-lot-carry-forward.spec.ts --project=authed > "$OUT/cp-party-lot.txt" 2>&1; echo "party-lot exit=$?"
```

Expected: three `exit=0`. Counts: challan-pdf `1 passed`, jw-out `4 passed`, party-lot-carry-forward all passed. Read the tails, not just the exit codes.

- [ ] **Step 4: Pre-release full suite**

**This WIPES `fabtraq_dev`.** `npm run e2e` runs `db:reset && db:seed` in `${E2E_BE_DIR:-../fabtraq-be}` before Playwright (`e2e/package.json:8`). Anything in that database you care about must be `pg_dump`ed first; restoring it later needs zero live connections, so stop the dev servers before any restore. The run also needs `fabtraq-pdf-parser` — the config boots it from `../fabtraq-pdf-parser` on `:7300` (`e2e/playwright.config.ts:101-111`); a parser that is down turns three design-import specs red in a way that reads exactly like a product regression.

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/e2e
npm run e2e > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/full-run.txt 2>&1
echo "full exit=$?"
tail -60 /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/full-run.txt
```

Expected: `full exit=0`, the whole suite green with **one more test than the last recorded full run** (the Task 3 addition). Never pipe this into `tail` directly — you would read `tail`'s exit code, not Playwright's (B-043).

- [ ] **Step 5: Confirm the two at-risk locators actually held**

```bash
grep -n "jw-challan-visibility" /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/e2e/full-run.txt
```

Expected: its lines report passing. This is the empirical answer to Findings items 1-2 — the two-line cell was predicted not to break `jw-challan-visibility.spec.ts:102-105`, and the full run is the proof.

Under machine load a ~1-in-3 timeout flake is a known full-run condition (B-027). A timeout is re-run once and confirmed; a *failed assertion* is never re-run away.

- [ ] **Step 6: Report, no commit**

This task commits nothing. Report to the owner: the three per-spec exit codes and pass counts, the full-run pass count and its delta against the previous archived run, and the absolute paths of all five log files. Those are the e2e rows of Stage 5's 9-gate done bar.

---

## Self-Review

**1. Spec coverage (§4's substitute table plus §4.1):**

| Spec row | Task |
|---|---|
| e2e — wire: `GET /jw-challans-out/:id` returns `items[].partyLotNo` equal to the value typed on the purchase form, extending `challan-pdf.spec.ts:92-105` | Task 2 Step 1 |
| e2e — screen: the detail-page Lot cell shows the party lot **and** the minted lot, beside the `qualityName` assertion at `:111-113` | Task 2 Step 2 |
| e2e — document: unchanged (`window.open` blob, `%PDF-`, >10KB) | Untouched by design; stated in Task 2's **Files** |
| Q1 — no PDF text assertion | Honoured; recorded in the header and in Task 2's commit message |
| Q2 — L3 verbatim proven in `party-lot-carry-forward.spec`, `jw-out.spec` keeps a 2-lot fixture | Tasks 4 and 3 |
| §4's fixture gap — `sentinel-purchase.ts` never fills the party-lot input; the optional parameter belongs on the private `createPurchase` and is exposed on both wrappers, defaulted to omitted | Task 1 |
| L2 — null origin renders `—`, never the minted lot | Task 3 Step 2 (`absentCell` contains `—` and not `partyLot`), scoped to one cell so it cannot pass vacuously |
| L6 — both numbers, one cell, on the JW-Out detail page | Tasks 2 and 3 |
| Live-run discipline: one at a time, dev servers stopped, output to a file, full run wipes `fabtraq_dev`, parser required | Task 5 |

Not covered here, by design: L6 on the **weaving-dispatch** weft table. `weaving-dispatch.spec.ts` asserts the weft challan only through the DB (`:242-252`) and its section heading (`:261`) — it has no lot-cell assertion to extend, and building one would mean a new weft fixture for a cell the spec already covers with FE integration (§7 V8: `weaving-dispatch-detail` FE integration + the existing e2e dispatch flow). Adding it is a scope increase over §4's table; flagged, not silently dropped.

**2. Placeholder scan:** no TBD, no "add appropriate error handling", no "similar to Task N". Every code step carries the literal code, every run step the literal command and its expected output. Task 3's test body is reproduced in full rather than referenced from Task 2.

**3. Type consistency:** `SentinelPurchaseOptions` and `SentinelPurchaseResult.partyLotNo` are declared in Task 1's **Interfaces** and used with those exact names in Tasks 2 and 3. `partyLotNo` (camel, on the wire) and `party_lot_no` (snake, in SQL) are used in their correct domains throughout. `lineRow`/`placeWholeLine`/`lotCellFor` are declared and used only within Task 3's appended block. `combined`, `item1`, `outMerged` in Task 4 are pre-existing locals at `party-lot-carry-forward.spec.ts:394`, `:389`, `:414`, all inside the same test body as the insertion point.
