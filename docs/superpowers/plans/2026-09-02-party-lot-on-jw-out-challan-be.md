# Party Lot on JW-Out Challan — Backend Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every one of the five `JwChallanOutResponse`-producing paths carry `partyLotNo: string | null` per item, resolved once per read from `IInventoryService.findPartyLotsByLotNumbers`, and publish `@pashwashah04/fabtraq-shared@1.28.0` only after that wiring is proven green.

**Architecture:** Read-time resolution, no migration, no new column, no new DB query — `findPartyLotsByLotNumbers` already exists (`fabtraq-be/src/modules/inventory/prisma-inventory.service.ts:583-609`) and already batches. The mapper gains a required 4th positional parameter so a forgotten call site is a compile error; the service gains one private helper for the four single-row paths and one hoisted page-wide call for `list`. Compute stays in the app layer.

**Tech Stack:** Node 22, strict TypeScript, tsx/tsup, Prisma + Postgres, vitest (unit + integration), zod via `@pashwashah04/fabtraq-shared`, tsyringe DI.

**Spec:** `fabtraq-be/docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md` — §3.2, §3.5, §3.6, §6, §7, §8 are this plan's scope.

**Contract plan:** `fabtraq-be/docs/superpowers/plans/2026-09-02-party-lot-on-jw-out-challan-shared.md` — its names are consumed verbatim; **its Task 2 (publish 1.28.0) executes inside this plan's Task 4**, not before.

---

## Global Constraints

- Node 22, strict TS, **no `any`**, **no `.js` import extensions**, files under 500 lines.
- Shared field is exactly `partyLotNo: string | null` — required-nullable, **not** optional, **not** `partyLotNoSchema` (spec §3.1). It sits between `sourceLotNumber` and `bagCount` on `JwChallanOutItemResponse`.
- Shared version is `1.28.0`. The registry is at `1.27.0`; `npm view` is the authority, re-checked at publish time (spec §6 step 1).
- **Repo order is forced:** shared → be → fe → e2e. The BE bump and the mapper wiring land in the **same** commit stream: a BE on 1.28.0 whose mapper does not supply `partyLotNo` fails its own `jwChallanOutResponseSchema.parse` at `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts:136`.
- **Tasks 1–3 are deliberately NOT independently CI-green.** They run against a `--no-save` tarball while `fabtraq-be/package.json:33` still pins `1.27.0`, so a fresh `npm ci` on those three commits installs the old shared and `out.items[0]?.partyLotNo` fails typecheck. That is inherent to the spec §6 ordering — publish is irreversible, so the consumer is proven first. **Task 4 closes it in the same wave**; do not review Tasks 1–3 as if they were shippable in isolation, and do not push the branch between Task 1 and Task 4.
- Compute in the app layer — never add DB aggregation (CLAUDE.md standing rule).
- **Integration tests hit `fabtraq_test`, never `fabtraq_dev`** — always via an explicit `DATABASE_URL` override on the command line. The same override must be repeated on the `db:reset` cleanup, or the reset lands on `fabtraq_dev`.
- One test run at a time. `npm test`, `npm run test:coverage` and `npm run test:integration` already take the lock via `scripts/test-lock.mjs`; a held lock fails fast naming the PID. Redirect suite output to a file in the scratchpad and read the file.
- Every commit message ends with:
  ```
  Co-Authored-By: RuFlo <ruv@ruv.net>
  Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv
  ```
- Branch: `feat/inventory-rewoven`. No new branch. Commit locally per task; **do not push** — the owner gives the go, and the merge order is BE → shared → FE → e2e (spec §6).

### Per-task gate (CLAUDE.md Stage 4, run before the next task is dispatched)

Run from `fabtraq-be/`, output to files, one at a time:

```bash
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
TEST_DB='postgresql://fabtraq:fabtraq_dev@localhost:5432/fabtraq_test?schema=public'

npm run format:check   > "$SCRATCH/be-format.txt"   2>&1; tail -3 "$SCRATCH/be-format.txt"
npm run lint           > "$SCRATCH/be-lint.txt"     2>&1; tail -3 "$SCRATCH/be-lint.txt"
npm run typecheck      > "$SCRATCH/be-tsc.txt"      2>&1; tail -3 "$SCRATCH/be-tsc.txt"
npm test               > "$SCRATCH/be-unit.txt"     2>&1; tail -5 "$SCRATCH/be-unit.txt"
DATABASE_URL="$TEST_DB" npm run test:integration > "$SCRATCH/be-integ.txt" 2>&1; tail -5 "$SCRATCH/be-integ.txt"
DATABASE_URL="$TEST_DB" npm run db:reset         > "$SCRATCH/be-reset.txt" 2>&1; tail -2 "$SCRATCH/be-reset.txt"
npm run build          > "$SCRATCH/be-build.txt"    2>&1; tail -3 "$SCRATCH/be-build.txt"
npm run test:coverage  > "$SCRATCH/be-cov.txt"      2>&1; tail -12 "$SCRATCH/be-cov.txt"
```

Then `node .claude/helpers/check-citations.mjs` (from the repo root) on any report that cites `file:line`.

Two CLAUDE.md gate items do **not** apply here and must not be run as BE commands:
- `contract:paths` is an **FE-side** script (it checks `fabtraq-fe` `api.ts` paths and MSW handlers against the registry). It is not in `fabtraq-be/package.json`; it belongs to the FE plan's gate.
- The `pretest` lock is not a separate command — it is `scripts/test-lock.mjs`, already wrapped inside the three `npm test*` scripts above.

The BE-specific gate item CLAUDE.md does *not* list, and the one this change trips, is the **OpenAPI drift gate** (`fabtraq-be/.github/workflows/ci.yml:107-113`): CI runs `npm run openapi:emit` and fails on any `git diff` in `docs/openapi.json`. It is verified in Task 1 and committed in Task 4.

---

## Waves and e2e checkpoints

| Wave | Contents | Concurrency |
|---|---|---|
| **W1** | Shared plan Task 1 — commit the contract, pack the tarball. **Not this plan.** | — |
| **W2** | **This plan, Tasks 1 → 2 → 3 → 4, strictly sequential.** | **None.** T1 and T2 both edit `jw-challan-out.mapper.ts`/`.service.ts` and their tests; T3's integration assertions only pass once T2's service wiring exists; T4's `npm install` invalidates the tarball T1/T2/T3 ran against. No two of these tasks are independent, so no two run concurrently — this is a proof of dependence, not an omission. |
| **W3** | FE print (§3.3) ∥ FE detail pages (§3.4). **Not this plan.** | — |
| **W4** | e2e (§4). **Not this plan.** | — |

**e2e checkpoints owned by this plan:** exactly one, at the **end of Wave 2**, and it is a **wire-only check, not a Playwright run** — `curl` the live BE and confirm `partyLotNo` is present on the JW-Out detail response (Task 4, Step 9). The live e2e suite (`jw-out.spec`, `challan-pdf.spec`, both `e2e-required`) runs at the FE and e2e plan checkpoints, after FE is on 1.28.0. Running it now would prove nothing: the FE is still on `1.27.0` and zod strips the unknown key.

**Every task in this wave is `e2e-required`-adjacent but not `e2e-required` itself** — no task here touches `stock_ledger`, placements, cancel reversal, or printing. `cancel` is touched only on its *post-commit read* line (`jw-challan-out.service.ts:348-349`), never inside `cancelIn`'s transaction.

---

## File structure

| File | Responsibility | Task |
|---|---|---|
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts` | Row → DTO. Gains the required 4th parameter and the one field line. | 1 |
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts` | 10 existing call sites gain the argument; 4 new cases. | 1 |
| `fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts` | Weaving-owned mapper caller at `:100`; argument only. | 1 |
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts` | Resolution on five paths: one private helper + one hoisted page call. | 2 |
| `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts` | V6 non-empty-override assertions on all five paths + the dedup/once assertion. | 2 |
| `fabtraq-be/tests/integration/jw-challan-out.routes.test.ts` | V2 (purchase origin) and V3 (JW-In combined origin) against real rows. | 3 |
| `fabtraq-be/package.json`, `package-lock.json`, `docs/openapi.json` | Version bump + regenerated spec, committed together. | 4 |
| `.claude/agents/modules/jw-challan-out/BRIEF.md` | Six stale lines (spec §8 items 3 and 7). **Repo-root file, not tracked by `fabtraq-be` git** — see the note in each task. | 1, 2 |

`fabtraq-be/tests/helpers/inventory-service-mock.ts:18` already stubs `findPartyLotsByLotNumbers` → `new Map()`. **No edit.** That stub plus `?? null` is precisely why the unit assertions must override it with a *non-empty* map (spec §3.6, V6).

---

> **Execution amendment (2026-09-02, `session-1788324721003`):** Task 1's Step 10
> expectation ("integration passes unchanged") was wrong. With NO default on
> `partyLotMap` (spec §3.2, kept), every 3-argument service call throws at the
> mapper until Task 2 wires it, and 125 integration tests 500. Tasks 1 and 2
> therefore land as ONE commit with ONE gate run after both. The written steps
> below are otherwise executed as-is.

### Task 1: Mapper — required 4th parameter, wired against the 1.28.0 tarball

**Files:**
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts:33-50` (JSDoc + signature), `:95` (the field line's neighbourhood)
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts` — call sites at `:101`, `:109`, `:117`, `:129`, `:142`, `:157`, `:165`, `:175`, `:198`, `:209`
- Modify: `fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts:100`
- Modify (not git-tracked here): `.claude/agents/modules/jw-challan-out/BRIEF.md:61`, `:80`, `:120`
- Install (temporary, `--no-save`): `/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/pashwashah04-fabtraq-shared-1.28.0.tgz`

**Interfaces:**
- Consumes: `JwChallanOutItemResponse.partyLotNo: string | null` from shared plan Task 1; the tarball path from its Step 6.
- Produces:
  ```ts
  export const mapJwChallanOutRow: (
    row: JwChallanOutRow,
    lockMap: ReadonlyMap<string, PlacementLockInfo> | undefined,
    rollupMap: ReadonlyMap<string, OutItemRollup>,
    partyLotMap: ReadonlyMap<string, string | null>,
  ) => JwChallanOutResponse;
  ```
  Task 2 calls this with a map built by `IInventoryService.findPartyLotsByLotNumbers`, **keyed by lot number** (`item.lotNumber`), never by item id.

- [ ] **Step 1: Confirm the tarball exists and install it `--no-save`**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
ls -l "$SCRATCH/pashwashah04-fabtraq-shared-1.28.0.tgz"
npm install --no-save "$SCRATCH/pashwashah04-fabtraq-shared-1.28.0.tgz"
grep -m1 '"version"' node_modules/@pashwashah04/fabtraq-shared/package.json
```
Expected: the tarball exists (shared plan Task 1 Step 6 produced it); the last line prints `"version": "1.28.0"`.

If the tarball is missing, **stop and report** — shared Task 1 has not run. Do not hand-edit `package.json` to 1.28.0 as a substitute: the registry does not have it yet and `npm ci` would fail.

`fabtraq-be/package.json:33` **stays at `1.27.0`** for Tasks 1–3. `node_modules` is now ahead of the lockfile; that is expected and is cleaned up in Task 4.

- [ ] **Step 2: Write the four failing mapper tests**

Append inside the existing `describe('mapJwChallanOutRow', …)` block in `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts`, immediately before its closing `});` (currently `:211`):

```ts
  // -------------------------------------------------------------------------
  // partyLotNo (2026-09-02-party-lot-on-jw-out-challan §3.2)
  // -------------------------------------------------------------------------

  it('maps partyLotNo from partyLotMap keyed by the item lot number', () => {
    const row = makeJwChallanOutRow();
    const partyLotMap = new Map([['LOT-260101-0001', 'PL-441']]);

    const out = mapJwChallanOutRow(row, undefined, makeRollupMap(row), partyLotMap);

    expect(out.items[0]?.partyLotNo).toBe('PL-441');
  });

  it('passes a combined party lot through verbatim — no re-split, re-sort or truncation', () => {
    const row = makeJwChallanOutRow();
    const combined = 'PL-441 / PL-509';
    const partyLotMap = new Map([['LOT-260101-0001', combined]]);

    const out = mapJwChallanOutRow(row, undefined, makeRollupMap(row), partyLotMap);

    // combinePartyLots is the single authority and already ran BE-side at the
    // JW-In write; the mapper must not re-derive the string (spec §3.2, L3).
    expect(out.items[0]?.partyLotNo).toBe(combined);
  });

  it('maps a present-but-null map entry to null', () => {
    const row = makeJwChallanOutRow();
    const partyLotMap = new Map<string, string | null>([['LOT-260101-0001', null]]);

    const out = mapJwChallanOutRow(row, undefined, makeRollupMap(row), partyLotMap);

    expect(out.items[0]?.partyLotNo).toBeNull();
  });

  it('maps an absent map key to null rather than throwing', () => {
    const row = makeJwChallanOutRow();

    // Unlike rollup, an absent key here is NOT a missing answer: it means the
    // lot matched no yarn_purchase_item and no jw_challan_in_yarn_item, i.e.
    // the lot has no origin that ever recorded a party lot — materially the
    // same state as a NULL party_lot_no, which L2 rules must print blank.
    // The only reachable shape for a beam- or weaving-derived lot (spec §3.2).
    const out = mapJwChallanOutRow(row, undefined, makeRollupMap(row), new Map());

    expect(out.items[0]?.partyLotNo).toBeNull();
  });
```

- [ ] **Step 3: Add the 4th argument to the 10 existing mapper call sites**

In `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.test.ts`, the eight sites at `:101`, `:109`, `:117`, `:129`, `:142`, `:157`, `:165`, `:175` currently read:

```ts
    const out = mapJwChallanOutRow(row, undefined, makeRollupMap(row));
```

Each becomes:

```ts
    const out = mapJwChallanOutRow(row, undefined, makeRollupMap(row), new Map());
```

The site at `:198` reads `mapJwChallanOutRow(row, undefined, rollupMap)` → `mapJwChallanOutRow(row, undefined, rollupMap, new Map())`.

The site at `:209` reads:

```ts
    expect(() => mapJwChallanOutRow(row, undefined, new Map())).toThrow();
```

and becomes:

```ts
    expect(() => mapJwChallanOutRow(row, undefined, new Map(), new Map())).toThrow();
```

**This one stays a `.toThrow()` assertion.** It is the *rollup* missing-entry case, and the empty party-lot map is incidental to it. It is deliberately not converted into a party-lot assertion: the two fields have opposite contracts, and the new "absent map key" test in Step 2 covers the party-lot side.

- [ ] **Step 4: Add the 4th argument to the weaving-owned caller**

`fabtraq-be/src/modules/weaving-dispatch/weaving-dispatch.service.test.ts:100` currently reads:

```ts
  return mapJwChallanOutRow(weftRow, undefined, rollupMap);
```

Change it to:

```ts
  // 4th arg (2026-09-02 party-lot): the weft challan inherits partyLotNo via
  // JwChallanOutService.getById; this local double only needs a valid shape.
  return mapJwChallanOutRow(weftRow, undefined, rollupMap, new Map());
```

No other weaving change: `weavingDispatchResponseSchema.weftChallanOut` is `jwChallanOutResponseSchema.nullable()` (`fabtraq-shared/src/schemas/transaction/weaving-dispatch.ts:168`), so the whole response is embedded and inherits the field (spec §3.5). The `weaving-be-reviewer` sees this line at diff review.

- [ ] **Step 5: Run the tests to verify they fail**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
npm test -- src/modules/jw-challan-out/jw-challan-out.mapper.test.ts > "$SCRATCH/be-t1-red.txt" 2>&1; tail -20 "$SCRATCH/be-t1-red.txt"
```
Expected: FAIL. Every test in the file fails at `jwChallanOutResponseSchema.parse` with a zod issue on `items.0.partyLotNo` — `Required` / `invalid_type, expected string, received undefined` — because shared 1.28.0 now requires the field and the mapper does not emit it. `npm run typecheck` also reports "Expected 4 arguments, but got 3" only *after* Step 6 adds the parameter; before it, the extra argument is the error. Either red is the expected red; capture the actual message.

- [ ] **Step 6: Add the parameter and the field line**

In `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.mapper.ts`, extend the second JSDoc block (currently `:32-45`) by appending this paragraph before its closing `*/`:

```ts
 *
 * `partyLotMap` (2026-09-02-party-lot-on-jw-out-challan §3.2) — keyed by LOT
 * NUMBER (`item.lotNumber`), NOT by out-item id, computed by the caller via
 * IInventoryService.findPartyLotsByLotNumbers. Single hop by construction:
 * every generation stores its own already-`combinePartyLots`-joined value, so
 * nothing is re-derived here. NOT defaulted, for the same compile-time reason
 * as `rollupMap`. A missing per-item entry IS defaulted to null, and unlike
 * `rollup` that is not a fallback: an absent key means the lot matched no
 * yarn_purchase_item and no jw_challan_in_yarn_item, i.e. it has no origin
 * that ever recorded a party lot — the same state as a NULL party_lot_no,
 * which L2 rules must print blank. "How much came back" has no safe value;
 * "which party lot" does.
```

Change the signature (currently `:46-50`) to:

```ts
export const mapJwChallanOutRow = (
  row: JwChallanOutRow,
  lockMap: ReadonlyMap<string, PlacementLockInfo> = new Map(),
  rollupMap: ReadonlyMap<string, OutItemRollup>,
  partyLotMap: ReadonlyMap<string, string | null>,
): JwChallanOutResponse => {
```

In the `items: row.items.map(…)` object literal, immediately after the `sourceLotNumber` line (currently `:95`), add:

```ts
      partyLotNo: partyLotMap.get(item.lotNumber) ?? null,
```

- [ ] **Step 7: Run the tests to verify they pass**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
npm test -- src/modules/jw-challan-out/jw-challan-out.mapper.test.ts > "$SCRATCH/be-t1-green.txt" 2>&1; tail -10 "$SCRATCH/be-t1-green.txt"
```
Expected: PASS, 14 tests in the file (10 existing + 4 new).

- [ ] **Step 8: Verify the OpenAPI emit is clean *before* the irreversible publish**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
npm run openapi:emit
git diff --stat docs/openapi.json
git checkout -- docs/openapi.json
```
Expected: the diff shows `docs/openapi.json` changed (the registry references `jwChallanOutResponseSchema` by identity, so the new field appears). **Read the diff and confirm the only added property is `partyLotNo` with `type: string, nullable`** — anything else is a shape surprise and the moment to catch it, because publish is irreversible. Then revert: the regenerated file is committed in **Task 4**, after the real install, so the tree is never committed in the `--no-save` state (spec §6 step 1).

- [ ] **Step 9: Fix the three handbook lines this task makes false**

Edit `/home/pashwas/Desktop/Pathshala/gosrani-software/.claude/agents/modules/jw-challan-out/BRIEF.md` (spec §8 items 3 and 7):

- `:61` — `| primitives/party-lot.ts | — | \`combinePartyLots\` (:17) — used by the in-flight partyLotNo |` → replace "used by the in-flight partyLotNo" with "written at JW-In; JW-Out only reads the joined value back (never re-derives it) — spec 2026-09-02-party-lot-on-jw-out-challan §3.2".
- `:80` — item 11's `**No spec/plan for that change exists on disk in any doc tree.**` → `**Superseded by \`superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md\` (§3.2), which records the decision on disk.**`
- `:120` — `Stale doc: party-lot spec L7 (see §3 item 11). Missing doc: no spec/plan for the 2026-09-01 partyLotNo change.` → `Stale doc: party-lot spec L7 (see §3 item 11) — superseded by \`superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md\`.` (drop the "Missing doc" clause entirely).

**This file lives at the repo root, outside `fabtraq-be`, and is NOT tracked by `fabtraq-be`'s git.** Do not `git add` it and do not expect it in the commit below. Report the edit in the task report instead; the root tree is not a git repo, so there is nothing to commit it to.

- [ ] **Step 10: Full per-task gate**

Run the whole "Per-task gate" block from Global Constraints. Expected: all green. Integration is expected to pass unchanged at this point — `list`/`getById` still emit `partyLotNo: null` for every item (no service wiring yet), which is schema-valid. That silence is exactly the hazard Task 3 closes.

- [ ] **Step 11: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
git add src/modules/jw-challan-out/jw-challan-out.mapper.ts \
        src/modules/jw-challan-out/jw-challan-out.mapper.test.ts \
        src/modules/weaving-dispatch/weaving-dispatch.service.test.ts
git status --short   # must show nothing else staged; package.json/lock stay at 1.27.0
git commit -m "feat(jw-challan-out): mapper emits partyLotNo from a required partyLotMap

Required 4th positional parameter, no default, mirroring rollupMap: a call
site that forgets it fails at compile time. An absent key maps to null (the
lot has no origin that recorded a party lot), unlike rollup which must throw.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §3.2

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 2: Service — resolve on all five paths, hoisted once for `list`

**Files:**
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts` — `create` `:80-81`, `list` `:219-231`, `getById` `:254-256`, `updateHeader` `:291-292`, `cancel` `:348-349`, new private helper beside `fetchOutItemRollupMap` `:661-665`
- Modify: `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts` — five `describe` blocks at `:196`, `:849`, `:958`, `:1003`, `:1095`
- Modify (not git-tracked here): `.claude/agents/modules/jw-challan-out/BRIEF.md:102`, `:107`, `:123`
- **Not modified:** `fabtraq-be/tests/helpers/inventory-service-mock.ts` — `:18` already stubs `findPartyLotsByLotNumbers` → `new Map()`

**Interfaces:**
- Consumes: `mapJwChallanOutRow(row, lockMap, rollupMap, partyLotMap)` from Task 1; `IInventoryService.findPartyLotsByLotNumbers({ lotNumbers, tx? }): Promise<Map<string, string | null>>` (`fabtraq-be/src/modules/inventory/i-inventory.service.ts:524-527`).
- Produces:
  ```ts
  private fetchPartyLotMap(
    items: ReadonlyArray<{ lotNumber: string }>,
  ): Promise<ReadonlyMap<string, string | null>>;
  ```
  Used by `create`, `getById`, `updateHeader`, `cancel`. **`list` does not call it** — it builds the deduped page-wide lot set inline and calls the inventory service directly, once.

- [ ] **Step 1: Write the failing V6 assertion for `create`**

In `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.test.ts`, inside `describe('JwChallanOutService.create', …)` (opens `:196`), add:

```ts
  // -------------------------------------------------------------------------
  // partyLotNo — V6: a NON-EMPTY override must reach the response.
  // The shared double (tests/helpers/inventory-service-mock.ts:18) stubs
  // findPartyLotsByLotNumbers -> new Map(), and the mapper's `?? null` turns
  // that into a schema-valid null. So a path that never calls the resolver at
  // all still passes an "is it null?" assertion. Only a non-empty map keyed by
  // the LOT NUMBER proves the call happened AND the key is right.
  // (spec 2026-09-02-party-lot-on-jw-out-challan §3.6, V6)
  // -------------------------------------------------------------------------

  it('resolves partyLotNo onto every item of the created challan', async () => {
    const row = makeJwChallanOutRow();

    vi.mocked(repo.nextEntrySequence).mockResolvedValue(7);
    vi.mocked(repo.create).mockResolvedValue(row);
    vi.mocked(repo.findById).mockResolvedValue(row); // re-fetch after create
    vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
      new Map([[LOT_A, 'PL-441']]),
    );

    const result = await service.create(makeValidInput(), makeCtx());

    expect(result.items[0]?.partyLotNo).toBe('PL-441');
    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledWith({
      lotNumbers: [LOT_A],
    });
  });
```

`makeValidInput` is the file's existing create-payload builder (`:174`) — the same one the happy-path test at `:216` uses. Do not add a second builder. The three `repo` mocks mirror `:219-221`: `create` maps over `hydrated.items`, which comes from the `repo.findById` re-fetch, not from the input, and `makeJwChallanOutRow`'s single item carries `LOT_A` (`:68`) — which is why the expected argument is `[LOT_A]`.

- [ ] **Step 2: Write the failing V6 assertions for `getById`, `updateHeader` and `cancel`**

Inside `describe('JwChallanOutService.getById', …)` (opens `:958`):

```ts
  it('resolves partyLotNo onto every item (V6 — non-empty override)', async () => {
    const row = makeJwChallanOutRow();
    vi.mocked(repo.findById).mockResolvedValue(row);
    vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
      new Map([[LOT_A, 'PL-441']]),
    );

    const result = await service.getById(CHALLAN_ID);

    expect(result.items[0]?.partyLotNo).toBe('PL-441');
    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledWith({
      lotNumbers: [LOT_A],
    });
  });
```

Inside `describe('JwChallanOutService.updateHeader', …)` (opens `:1003`):

```ts
  it('resolves partyLotNo onto every item of the updated challan (V6)', async () => {
    const existing = makeJwChallanOutRow({ transporterId: null, vehicleNumber: null });
    const updated = makeJwChallanOutRow({ vehicleNumber: 'MH04-AB-1234' });
    vi.mocked(repo.findById).mockResolvedValue(existing);
    vi.mocked(repo.updateHeader).mockResolvedValue(updated);
    vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
      new Map([[LOT_A, 'PL-441']]),
    );

    const result = await service.updateHeader(
      CHALLAN_ID,
      updateJwChallanOutSchema.parse({ vehicleNumber: 'MH04-AB-1234' }),
      makeCtx(),
    );

    expect(result.items[0]?.partyLotNo).toBe('PL-441');
    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledWith({
      lotNumbers: [LOT_A],
    });
  });
```

Inside `describe('JwChallanOutService.cancel', …)` (opens `:1095`; its `beforeEach` already queues the two `repo.findById` results):

```ts
  it('resolves partyLotNo onto every item of the cancelled challan (V6)', async () => {
    vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
      new Map([[LOT_A, 'PL-441']]),
    );

    const result = await service.cancel(CHALLAN_ID, makeCtx());

    expect(result.items[0]?.partyLotNo).toBe('PL-441');
    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledWith({
      lotNumbers: [LOT_A],
    });
  });
```

- [ ] **Step 3: Write the failing `list` assertions — value, single call, and real dedup**

Inside `describe('JwChallanOutService.list', …)` (opens `:849`), after the existing single-call rollup test (ends `:951`):

```ts
  // -------------------------------------------------------------------------
  // partyLotNo — hoisted, ONE call per page, deduped across rows.
  // The two rows deliberately share LOT_A. The existing rollup test above uses
  // LOT_A and LOT_B, where a plain flatMap and a Set produce identical
  // arguments — that shape cannot fail if the dedup is dropped. This one can.
  // -------------------------------------------------------------------------

  it('collects and DEDUPS lot numbers across the page and calls findPartyLotsByLotNumbers exactly once', async () => {
    const row1 = makeJwChallanOutRow();
    const row2 = makeJwChallanOutRow({
      id: '60000000-0000-0000-0000-000000000002',
      items: [
        {
          id: ITEM_ID_2,
          challanOutId: '60000000-0000-0000-0000-000000000002',
          qualityId: QUALITY_ID,
          qualityName: 'Cotton 30s',
          skuId: null,
          // Same lot as row1 on purpose — proves the dedup, not just the hoist.
          lotNumber: LOT_A,
          bagCount: null,
          cones: null,
          grossWeight: null,
          netWeight: makeDecimal(80),
          unit: 'KG',
          placementStatus: 'fully_placed',
          placements: [],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    vi.mocked(repo.list).mockResolvedValue({ items: [row1, row2], total: 2 });
    vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
      new Map([[LOT_A, 'PL-441']]),
    );

    const result = await service.list({ page: 1, pageSize: 20 });

    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledOnce();
    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledWith({
      lotNumbers: [LOT_A],
    });
    expect(result.items[0]?.items[0]?.partyLotNo).toBe('PL-441');
    expect(result.items[1]?.items[0]?.partyLotNo).toBe('PL-441');
  });

  it('passes distinct lot numbers across rows in one call', async () => {
    const row1 = makeJwChallanOutRow();
    const row2 = makeJwChallanOutRow({
      id: '60000000-0000-0000-0000-000000000002',
      items: [
        {
          id: ITEM_ID_2,
          challanOutId: '60000000-0000-0000-0000-000000000002',
          qualityId: QUALITY_ID,
          qualityName: 'Cotton 30s',
          skuId: null,
          lotNumber: LOT_B,
          bagCount: null,
          cones: null,
          grossWeight: null,
          netWeight: makeDecimal(80),
          unit: 'KG',
          placementStatus: 'fully_placed',
          placements: [],
          createdAt: new Date('2026-01-01T00:00:00.000Z'),
        },
      ],
    });
    vi.mocked(repo.list).mockResolvedValue({ items: [row1, row2], total: 2 });
    vi.mocked(inventory.findPartyLotsByLotNumbers).mockResolvedValue(
      new Map([
        [LOT_A, 'PL-441'],
        [LOT_B, 'PL-509'],
      ]),
    );

    await service.list({ page: 1, pageSize: 20 });

    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledOnce();
    expect(inventory.findPartyLotsByLotNumbers).toHaveBeenCalledWith({
      lotNumbers: [LOT_A, LOT_B],
    });
  });
```

- [ ] **Step 4: Run the tests to verify they fail**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
npm test -- src/modules/jw-challan-out/jw-challan-out.service.test.ts > "$SCRATCH/be-t2-red.txt" 2>&1; tail -30 "$SCRATCH/be-t2-red.txt"
```
Expected: FAIL. The seven new tests fail two ways — `expected null to be 'PL-441'` (nothing calls the resolver) and `expected "findPartyLotsByLotNumbers" to be called once, but it was called 0 times`. Also a typecheck error at each `mapJwChallanOutRow(...)` call in the service: "Expected 4 arguments, but got 3".

- [ ] **Step 5: Add the private helper**

In `fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts`, directly after `fetchOutItemRollupMap` (ends `:665`), add:

```ts
  /**
   * Bulk lot-number → party-lot lookup for one row's items.
   *
   * Shared by create/getById/updateHeader/cancel, which each call it with a
   * single row's items. `list` does NOT call this per row — it collects lot
   * numbers across the whole page, dedups them, and calls
   * `this.inventory.findPartyLotsByLotNumbers` directly, once, hoisted above
   * its `items.map` (see `list` above for why).
   *
   * Keyed by LOT NUMBER, not out-item id — the map the mapper indexes with
   * `item.lotNumber` (2026-09-02-party-lot-on-jw-out-challan §3.2).
   *
   * No `tx`: all four are post-commit reads, exactly like getOutItemRollup on
   * the same lines.
   */
  private async fetchPartyLotMap(
    items: ReadonlyArray<{ lotNumber: string }>,
  ): Promise<ReadonlyMap<string, string | null>> {
    return this.inventory.findPartyLotsByLotNumbers({
      lotNumbers: [...new Set(items.map((item) => item.lotNumber))],
    });
  }
```

- [ ] **Step 6: Wire the four single-row paths**

`create` (`:80-81`):

```ts
    const rollupMap = await this.fetchOutItemRollupMap(hydrated.items);
    const partyLotMap = await this.fetchPartyLotMap(hydrated.items);
    return mapJwChallanOutRow(hydrated, undefined, rollupMap, partyLotMap);
```

`getById` (`:254-256`):

```ts
    const lockMap = await this.resolveLocksForOutRow(row);
    const rollupMap = await this.fetchOutItemRollupMap(row.items);
    const partyLotMap = await this.fetchPartyLotMap(row.items);
    return mapJwChallanOutRow(row, lockMap, rollupMap, partyLotMap);
```

`updateHeader` (`:291-292`):

```ts
    const rollupMap = await this.fetchOutItemRollupMap(updated.items);
    const partyLotMap = await this.fetchPartyLotMap(updated.items);
    return mapJwChallanOutRow(updated, undefined, rollupMap, partyLotMap);
```

`cancel` (`:348-349`):

```ts
    const rollupMap = await this.fetchOutItemRollupMap(cancelled.items);
    const partyLotMap = await this.fetchPartyLotMap(cancelled.items);
    return mapJwChallanOutRow(cancelled, undefined, rollupMap, partyLotMap);
```

`createIn` / `cancelIn` / `updateHeaderIn` are **untouched** — they return rows, not responses, and their weaving-dispatch callers re-hydrate through `getById` (spec §3.5).

- [ ] **Step 7: Wire `list` with the page-wide hoist**

In `list`, replace the block at `:225-231`:

```ts
    const allItemIds = items.flatMap((row) => row.items.map((item) => item.id));
    const rollupMap = await this.inventory.getOutItemRollup({ outItemIds: allItemIds });

    const mappedItems = await Promise.all(
      items.map(async (row) => {
        const lockMap = await this.resolveLocksForOutRow(row);
        return mapJwChallanOutRow(row, lockMap, rollupMap);
      }),
    );
```

with:

```ts
    const allItemIds = items.flatMap((row) => row.items.map((item) => item.id));
    const rollupMap = await this.inventory.getOutItemRollup({ outItemIds: allItemIds });

    // Same hoist as the rollup directly above, and for the same reason: ONE
    // call for the whole page, deduped, never per row. Deliberately NOT the
    // resolveLocksForOutRow shape below, which is N-per-page — the jw-challan-out
    // BRIEF §8 names copying it for new per-item data as the trap
    // (2026-09-02-party-lot-on-jw-out-challan §3.2).
    const allLotNumbers = [
      ...new Set(items.flatMap((row) => row.items.map((item) => item.lotNumber))),
    ];
    const partyLotMap = await this.inventory.findPartyLotsByLotNumbers({
      lotNumbers: allLotNumbers,
    });

    const mappedItems = await Promise.all(
      items.map(async (row) => {
        const lockMap = await this.resolveLocksForOutRow(row);
        return mapJwChallanOutRow(row, lockMap, rollupMap, partyLotMap);
      }),
    );
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
npm test -- src/modules/jw-challan-out/jw-challan-out.service.test.ts > "$SCRATCH/be-t2-green.txt" 2>&1; tail -10 "$SCRATCH/be-t2-green.txt"
```
Expected: PASS, all seven new tests plus every pre-existing one in the file.

- [ ] **Step 9: Prove the tests can actually fail (mutation check)**

Temporarily change the mapper's field line to `partyLotNo: partyLotMap.get(item.id) ?? null,` and re-run the service test file. Expected: the five V6 value assertions go red. Then revert the mapper line to `item.lotNumber` and re-run to green.

This is the wrong-key failure mode V2 exists to catch at the integration layer; doing the check here confirms the unit tests are not vacuous before Task 3 relies on them.

- [ ] **Step 10: Fix the three handbook lines this task makes false**

Edit `/home/pashwas/Desktop/Pathshala/gosrani-software/.claude/agents/modules/jw-challan-out/BRIEF.md` (spec §8 items 3 and 7):

- `:102` (I16) — drop the `**In flight 2026-09-01:**` prefix and the `**BE mapper (…) and FE do not yet**` clause. State it as shipped BE-side: the mapper takes a required `partyLotMap` 4th parameter and the service resolves it on all five paths; FE lands in Wave 3. **Correct the citation `fabtraq-be/src/modules/inventory/prisma-inventory.service.ts:583-600` to `:583-609`** — the method ends at `:609`, and a stale line is a finding.
- `:107` (§5 Outbound) — replace `` `findPartyLotsByLotNumbers` is NOT yet called here — see §6. `` with `` `findPartyLotsByLotNumbers` (`fabtraq-be/src/modules/jw-challan-out/jw-challan-out.service.ts` — `list` hoisted page-wide, and `fetchPartyLotMap` for create/getById/updateHeader/cancel). `` and re-verify the line numbers on disk after Step 7 shifted them.
- `:123` — delete the whole `unverified: findPartyLotsByLotNumbers is called from jw-challan-out.service.ts — not true yet; …` bullet. It is now true.

**Repo-root file, not tracked by `fabtraq-be`'s git.** Do not `git add` it; report the edit in the task report.

- [ ] **Step 11: Full per-task gate**

Run the whole gate block from Global Constraints. Expected: all green, coverage no worse than before.

- [ ] **Step 12: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
git add src/modules/jw-challan-out/jw-challan-out.service.ts \
        src/modules/jw-challan-out/jw-challan-out.service.test.ts
git commit -m "feat(jw-challan-out): resolve partyLotNo on all five response paths

fetchPartyLotMap for create/getById/updateHeader/cancel; list collects and
dedups every item lotNumber across the page and issues ONE
findPartyLotsByLotNumbers, hoisted above items.map — mirroring the rollup
hoist, never resolveLocksForOutRow's N-per-page shape.

Unit tests override the shared empty-map double with a NON-EMPTY map on all
five paths: with the default stub plus `?? null`, a forgotten call or a wrong
map key is invisible.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §3.2, V6

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 3: Integration — real rows, real party lots (V2 and V3)

**Files:**
- Modify: `fabtraq-be/tests/integration/jw-challan-out.routes.test.ts` — new cases in `describe('GET /jw-challans-out/:id', …)` (opens `:270`) and `describe('GET /jw-challans-out', …)` (opens `:151`)
- **Not modified:** `fabtraq-be/tests/helpers/purchase.ts` — `PurchaseFixtureOverrides.items[].partyLotNo` already exists (`:24`) and `createPurchaseFixture` forwards it through `...item` (`:54`)

**Interfaces:**
- Consumes: the Task 2 service wiring, live over HTTP through the real `PrismaInventoryService`.
- Produces: nothing consumed by later tasks — this is the proof layer for V2 and V3.

**Why these tests are mandatory, not nice-to-have (spec V2).** Every unit test in Task 2 runs against a double. The one failure mode a double cannot see is the map being keyed on the wrong column in the *real* query — and `findPartyLotsByLotNumbers` reads `yarn_purchase_item.lot_number` and `jw_challan_in_yarn_item.lot_no`, two differently-named columns joined on one key. Only a real row proves it.

- [ ] **Step 1: Write the failing V2 test — party lot from a purchase origin**

Add inside `describe('GET /jw-challans-out/:id', …)`:

```ts
  // V2 (spec 2026-09-02-party-lot-on-jw-out-challan §7): the party lot must
  // come back NON-NULL from a real yarn_purchase_item row. Unit tests use the
  // empty-map double, so this is the only test that can catch a map keyed on
  // the wrong column.
  it('returns the party lot of a purchase-origin lot on getById', async () => {
    const masters = await seedMasters();
    const session = await loginAs(app, 'storekeeper');

    const purchase = await createPurchaseFixture(
      app,
      session,
      masters.vendorId,
      masters.locationId,
      masters.floorId,
      masters.qualityId,
      {
        items: [
          {
            qualityId: masters.qualityId,
            quantity: 100,
            unit: 'KG',
            partyLotNo: 'PL-441',
          },
        ],
      },
    );

    const lotNumber = purchase.items[0]?.lotNumber;
    if (lotNumber === undefined) throw new Error('Expected purchase item lotNumber');

    const created = await createChallanOutFixture(session, masters, {
      sourceLotNumber: lotNumber,
      qualityId: masters.qualityId,
    });

    const res = await request(app)
      .get(`/jw-challans-out/${created.id}`)
      .set('Cookie', session.cookies)
      .expect(200);

    const body = jwChallanOutResponseSchema.parse(res.body);
    expect(body.items[0]?.partyLotNo).toBe('PL-441');
    // Both identities travel: the minted lot is still the internal one.
    expect(body.items[0]?.sourceLotNumber).toBe(lotNumber);
  });
```

- [ ] **Step 2: Write the failing V2 test for `list`**

Add inside `describe('GET /jw-challans-out', …)`:

```ts
  // V2 on the list path — list builds its map by a different code path
  // (hoisted, page-wide) than getById, so it needs its own real-row proof.
  it('returns the party lot of a purchase-origin lot on list', async () => {
    const masters = await seedMasters();
    const session = await loginAs(app, 'storekeeper');

    const purchase = await createPurchaseFixture(
      app,
      session,
      masters.vendorId,
      masters.locationId,
      masters.floorId,
      masters.qualityId,
      {
        items: [
          {
            qualityId: masters.qualityId,
            quantity: 100,
            unit: 'KG',
            partyLotNo: 'PL-441',
          },
        ],
      },
    );

    const lotNumber = purchase.items[0]?.lotNumber;
    if (lotNumber === undefined) throw new Error('Expected purchase item lotNumber');

    await createChallanOutFixture(session, masters, {
      sourceLotNumber: lotNumber,
      qualityId: masters.qualityId,
    });

    const res = await request(app)
      .get('/jw-challans-out')
      .set('Cookie', session.cookies)
      .expect(200);

    const body = res.body as { items: JwChallanOutResponse[] };
    expect(body.items[0]?.items[0]?.partyLotNo).toBe('PL-441');
  });
```

- [ ] **Step 3: Write the failing V3 test — combined party lot from a JW-In origin**

Add inside `describe('GET /jw-challans-out/:id', …)`:

```ts
  // V3 (spec §7, L8): a JW-In-origin lot carries an already-combined party lot
  // and it must come back VERBATIM — no re-split, re-sort or truncation.
  //
  // The jw_challan_in_yarn_item row is seeded directly rather than driven
  // through POST /jw-challans-in. Reason: the API path would need two
  // purchases, a two-item JW-Out and a two-source JW-In, which the local
  // createChallanOutFixture (one item) and createChallanInFixture (one source)
  // cannot express — and the JW-In writer's own combining is already covered
  // by jw-challan-in.service.test.ts:527. What THIS test must prove is that
  // findPartyLotsByLotNumbers reads jw_challan_in_yarn_item.lot_no (a
  // differently-named column from yarn_purchase_item.lot_number) and hands the
  // stored string through untouched. A directly-seeded real row proves exactly
  // that. Precedent for direct seeding: seedLotWithProcessedTypes below.
  it('returns a JW-In-origin combined party lot verbatim on getById and list', async () => {
    const masters = await seedMasters();
    const session = await loginAs(app, 'storekeeper');

    const jwInLotNumber = 'LOT-260301-0301';
    const combined = 'PL-441 / PL-509';

    const challanIn = await prisma.jwChallanIn.create({
      data: {
        entryNo: 'JWI-2025-26-901',
        status: 'active',
        date: new Date('2026-03-05'),
      },
    });

    await prisma.jwChallanInYarnItem.create({
      data: {
        challanInId: challanIn.id,
        qualityId: masters.qualityId,
        lotNo: jwInLotNumber,
        partyLotNo: combined,
        processedTypes: [],
        netWeight: 80,
        unit: 'KG',
        placementStatus: 'fully_placed',
      },
    });

    // processedTypes: [] keeps the lot a valid input state for the fixture's
    // jobWorkTypes: ['twisting'] (same reason as the :1304 raw-lot cases).
    await seedLotWithProcessedTypes(
      masters,
      jwInLotNumber,
      '00000000-0000-0000-0000-000000000090',
      [],
    );

    const created = await createChallanOutFixture(session, masters, {
      sourceLotNumber: jwInLotNumber,
      qualityId: masters.qualityId,
    });

    const detail = await request(app)
      .get(`/jw-challans-out/${created.id}`)
      .set('Cookie', session.cookies)
      .expect(200);

    const body = jwChallanOutResponseSchema.parse(detail.body);
    expect(body.items[0]?.partyLotNo).toBe(combined);

    const listRes = await request(app)
      .get('/jw-challans-out')
      .set('Cookie', session.cookies)
      .expect(200);

    const listBody = listRes.body as { items: JwChallanOutResponse[] };
    expect(listBody.items[0]?.items[0]?.partyLotNo).toBe(combined);
  });
```

**Hoist `seedLotWithProcessedTypes` before writing this test.** It is declared at `:1127` inside a later `describe`, so it is not in scope at the `GET /jw-challans-out/:id` block (`:270`). Move the existing declaration — unchanged — to module scope beside `createChallanOutFixture` (`:55`), and leave its later call sites (`:1195`, `:1223`, `:1247`, `:1304`, `:1322`, `:1339`, `:1357`) untouched. One definition, all call sites; do not copy it.

- [ ] **Step 4: Write the failing precedence test**

Add immediately after the V3 test:

```ts
  // Purchase wins over JW-In on a lot-number collision — the same precedence
  // inventory.mapper.ts:73 applies (prisma-inventory.service.ts:606-607 sets
  // JW-In first, then lets purchase overwrite). Documented here so a future
  // reordering of those two loops fails a test instead of silently flipping
  // which identity the job worker signs for.
  it('prefers the purchase party lot when a lot number exists in both origins', async () => {
    const masters = await seedMasters();
    const session = await loginAs(app, 'storekeeper');

    const purchase = await createPurchaseFixture(
      app,
      session,
      masters.vendorId,
      masters.locationId,
      masters.floorId,
      masters.qualityId,
      {
        items: [
          {
            qualityId: masters.qualityId,
            quantity: 100,
            unit: 'KG',
            partyLotNo: 'PL-PURCHASE',
          },
        ],
      },
    );

    const lotNumber = purchase.items[0]?.lotNumber;
    if (lotNumber === undefined) throw new Error('Expected purchase item lotNumber');

    const challanIn = await prisma.jwChallanIn.create({
      data: {
        entryNo: 'JWI-2025-26-902',
        status: 'active',
        date: new Date('2026-03-05'),
      },
    });

    await prisma.jwChallanInYarnItem.create({
      data: {
        challanInId: challanIn.id,
        qualityId: masters.qualityId,
        lotNo: lotNumber,
        partyLotNo: 'PL-JWIN',
        processedTypes: [],
        netWeight: 10,
        unit: 'KG',
        placementStatus: 'fully_placed',
      },
    });

    const created = await createChallanOutFixture(session, masters, {
      sourceLotNumber: lotNumber,
      qualityId: masters.qualityId,
    });

    const res = await request(app)
      .get(`/jw-challans-out/${created.id}`)
      .set('Cookie', session.cookies)
      .expect(200);

    const body = jwChallanOutResponseSchema.parse(res.body);
    expect(body.items[0]?.partyLotNo).toBe('PL-PURCHASE');
  });
```

- [ ] **Step 5: Run the integration file to verify the new tests pass**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
TEST_DB='postgresql://fabtraq:fabtraq_dev@localhost:5432/fabtraq_test?schema=public'
DATABASE_URL="$TEST_DB" npm run test:integration -- tests/integration/jw-challan-out.routes.test.ts > "$SCRATCH/be-t3.txt" 2>&1; tail -20 "$SCRATCH/be-t3.txt"
```
Expected: PASS. **`DATABASE_URL` is mandatory on this line** — without it the run inherits the dev `.env` and truncates `fabtraq_dev`.

These tests are written against Task 2's already-green wiring, so they should pass first time. If you want the red step, temporarily revert the `list` hoist added in Task 2 Step 7 and confirm the two `list` assertions go red, then restore it.

- [ ] **Step 6: Reset the test database**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
DATABASE_URL='postgresql://fabtraq:fabtraq_dev@localhost:5432/fabtraq_test?schema=public' npm run db:reset
```
`db:seed` does not reset; integration leftovers 500 the masters endpoints on the next run. The override is repeated here on purpose — omitting it resets `fabtraq_dev`.

- [ ] **Step 7: Full per-task gate**

Run the whole gate block from Global Constraints.

- [ ] **Step 8: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
git add tests/integration/jw-challan-out.routes.test.ts
git commit -m "test(jw-challan-out): integration proof for partyLotNo (V2, V3)

getById and list return a NON-NULL party lot from a real yarn_purchase_item
row, and a combined 'A / B' string verbatim from a real jw_challan_in_yarn_item
row. Purchase wins on a lot-number collision. Unit doubles cannot catch a map
keyed on the wrong column; these can.

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §7

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

---

### Task 4: Publish 1.28.0, move the lockfile, commit the OpenAPI snapshot

**Files:**
- Modify: `fabtraq-be/package.json:33` (`1.27.0` → `1.28.0`), `fabtraq-be/package-lock.json` (both via `npm install`, never by hand)
- Modify: `fabtraq-be/docs/openapi.json` (regenerated by `npm run openapi:emit`, **never hand-edited**)
- Executes: **shared plan Task 2, Steps 1–4** (registry check, export-diff, publish, verify)

**Interfaces:**
- Consumes: green Tasks 1–3 against the tarball — the precondition shared plan Task 2 states.
- Produces: `@pashwashah04/fabtraq-shared@1.28.0` on the registry, which the FE plan (Wave 3) installs.

**Sub-step order matters.** Spec §6 forbids committing anything while a `--no-save` install leaves `node_modules` ahead of the lockfile. So: verify the emit (done in Task 1 Step 8) → publish → real install → re-emit → commit all three files together. Never commit an inconsistent tree, and never publish before the consumer is proven.

- [ ] **Step 1: Confirm the precondition**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
git status --short
git log --oneline -3
```
Expected: a clean `fabtraq-be` tree with the three Task 1–3 commits on `feat/inventory-rewoven`. A dirty tree means an earlier task did not finish — **stop and report**. Publish is irreversible.

- [ ] **Step 2: Registry check (shared plan Task 2 Step 1)**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm view @pashwashah04/fabtraq-shared version
```
Expected: `1.27.0`. Run from `fabtraq-fe/` — its `.npmrc` maps the `@pashwashah04` scope to GitHub Packages with a token; a bare `npm view` 404s on the public registry. If it already says `1.28.0`, **stop and report** — someone published.

- [ ] **Step 3: Export-diff against the published tarball (shared plan Task 2 Step 2)**

```bash
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
mkdir -p "$SCRATCH/pub"
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-shared
git status --short          # must be empty
npm run build
npm pack @pashwashah04/fabtraq-shared@1.27.0 --pack-destination "$SCRATCH/pub/"
tar -xzf "$SCRATCH/pub/pashwashah04-fabtraq-shared-1.27.0.tgz" -C "$SCRATCH/pub/"
diff <(grep -oE 'export (declare )?(const|function|type|interface|class) [A-Za-z0-9_]+' "$SCRATCH/pub/package/dist/index.d.ts" | sort -u) \
     <(grep -oE 'export (declare )?(const|function|type|interface|class) [A-Za-z0-9_]+' dist/index.d.ts | sort -u)
```
Expected: **zero `<` lines**. Any `<` line is an export you are about to delete from the registry — **stop**. The local `package.json` lies; the built `.d.ts` against the published tarball is the check.

- [ ] **Step 4: Publish (shared plan Task 2 Step 3)**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-shared
npm publish
```
Expected: `+ @pashwashah04/fabtraq-shared@1.28.0`.

Published from `feat/inventory-rewoven` rather than `main`, against the `feedback_shared_publish_base` memory's default: this branch is ahead of main by exactly this workstream, and Stage 0 verified `git rev-list --count HEAD..origin/main` = 0 for shared. Re-run that count before publishing; a non-zero result means main has newer shared and you must rebase first.

- [ ] **Step 5: Verify the publish (shared plan Task 2 Step 4)**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-fe
npm view @pashwashah04/fabtraq-shared version
```
Expected: `1.28.0`.

- [ ] **Step 6: Replace the rehearsal tarball with a real install**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
npm install @pashwashah04/fabtraq-shared@1.28.0
grep -n '"@pashwashah04/fabtraq-shared"' package.json
grep -c '1.28.0' package-lock.json
```
Expected: `package.json:33` now reads `"@pashwashah04/fabtraq-shared": "1.28.0"` and `package-lock.json` mentions `1.28.0`. Without this, CI's `npm ci` reinstalls `1.27.0` and typecheck goes red on the very commits that just landed.

The `rm -rf node_modules/.vite` rule is **FE-only** — there is no Vite dep cache in `fabtraq-be`. Do not run it here.

- [ ] **Step 7: Regenerate and commit the OpenAPI snapshot**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
npm run openapi:emit
git diff --stat docs/openapi.json
```
Expected: `docs/openapi.json` changes, adding `partyLotNo` (`type: string`, nullable) to the JW-Out item schema and nothing else. This is the file CI's drift gate (`fabtraq-be/.github/workflows/ci.yml:107-113`) compares against a fresh emit; an uncommitted change fails every build. Precedent: commit `ed2fbdc`, the rollup change.

- [ ] **Step 8: Full per-task gate, now on the real 1.28.0**

Run the whole gate block from Global Constraints. This is the first run where `npm ci` semantics would hold, so it is the one that matters. Expected: all green.

- [ ] **Step 9: Wave-2 e2e checkpoint — wire-only, over the live HTTP boundary**

Start the BE against the **dev** database and read the field off a real response:

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
ss -ltn | grep -E ':4000|:5173' || echo 'ports free'
npm run dev   # backgrounded; the real PORT comes from .env, not the CLI
```

Then, in a second shell, with a JW-Out id that has a purchase-origin lot:

```bash
SCRATCH=/tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad
# Credentials are the deterministic seed pair in prisma/seed-constants.ts:10-11
# (owner@fabtraq.local / Fabtraq#2026). The login body is { email, password } —
# NOT { username, password }; see tests/helpers/auth.ts:74.
curl -s -c "$SCRATCH/c.txt" -X POST http://localhost:4000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"owner@fabtraq.local","password":"Fabtraq#2026"}' > "$SCRATCH/login.json"
curl -s -b "$SCRATCH/c.txt" "http://localhost:4000/jw-challans-out?pageSize=1" \
  | python3 -m json.tool | grep -n 'partyLotNo\|sourceLotNumber'
```
Expected: `partyLotNo` appears next to `sourceLotNumber` on the item. A `null` value is acceptable here if the seeded lot has no party lot — what this checkpoint proves is that the **key is on the wire**, which is what the FE's `parseOrThrow` will demand in Wave 3.

Stop the dev server by killing the `npm run dev` / `tsx watch` **parent** chain, not the child — the watcher respawns on file edits.

**This is not a Playwright run and must not be one.** `jw-out.spec` and `challan-pdf.spec` are `e2e-required` for this workstream but belong to the FE and e2e plan checkpoints: the FE is still pinned to `1.27.0`, so zod strips `partyLotNo` and a run now would prove nothing while wiping `fabtraq_dev`.

- [ ] **Step 10: Commit**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/fabtraq-be
git add package.json package-lock.json docs/openapi.json
git commit -m "chore(deps): fabtraq-shared 1.28.0 + regenerated openapi snapshot

Real install replaces the --no-save rehearsal tarball so package-lock moves
with package.json; without it CI's npm ci reinstalls 1.27.0 and typecheck goes
red. docs/openapi.json regenerated via npm run openapi:emit for the CI drift
gate (.github/workflows/ci.yml:107-113).

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §6

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

- [ ] **Step 11: Hand over to Wave 3**

Report to the team lead: 1.28.0 is published and verified on the registry; BE is on it with the lockfile moved; the four BE commits are local and **unpushed** on `feat/inventory-rewoven`. FE may now bump to 1.28.0 and **must** `rm -rf fabtraq-fe/node_modules/.vite` before its dev server or test run, or a stale Vite dep cache bundles the 1.27.0 schema and the change silently does nothing.

Repeat the merge order for the owner: **BE → shared → FE → e2e**. `fabtraq-fe/.github/workflows/contract-smoke.yml:48-62` checks out shared and BE at `main`; if shared merges first, main-BE's mapper meets a schema requiring `partyLotNo` and throws at `jw-challan-out.mapper.ts:136`, reddening contract-smoke on every FE PR. The reverse direction is safe because zod strips unknown keys.

---

## Out of scope for this plan (stated so nothing is silently dropped)

| Spec item | Owner |
|---|---|
| §3.1 shared schema commit + the tarball | Shared plan Task 1 (W1) |
| §3.3 print column widths, `challan-visual.ts`, V7 PNGs, spec §8 items 1 and 2 | FE plan (W3) |
| §3.4 both detail-page cells, V4/V5/V8 | FE plan (W3) |
| §3.6 FE MSW handlers and `yarn-delivery.test.ts` | FE plan (W3) |
| §8 item 4 — `.claude/agents/modules/challan-print/BRIEF.md` | FE plan (W3), whose deliverable makes those lines true |
| §8 item 5 — the shared doc comment | Shared plan Task 1 Step 2 |
| §4 e2e specs, `jw-out.spec` / `challan-pdf.spec` live runs | e2e plan (W4) |
| Stage 5 nine-gate release bar, push, PRs | Release, on the owner's go |

`fabtraq-be/docs/specs/2026-08-21-challan-pdf-design.md` §4:128 (spec §8 item 1) states the **old column widths**. It is a BE-tree *file* but a **print-geometry** claim: it only becomes false when the FE changes the widths, so it is folded into the FE task that does, and re-mirrored from there across be/fe/shared `docs/specs/` (it has no root copy). Flagged here so the BE reviewer does not read it as a BE omission.

---

## Self-review

**Spec coverage.**

| Spec section | Task |
|---|---|
| §3.2 mapper 4th parameter, no default, `?? null` | 1 |
| §3.2 `fetchPartyLotMap` for create/getById/updateHeader/cancel | 2 |
| §3.2 `list` hoisted, deduped, one call, not `resolveLocksForOutRow`-shaped | 2 |
| §3.2 no `tx`, post-commit reads; `*In` methods untouched | 2 (Step 6 note) |
| §3.5 `weaving-dispatch.service.test.ts:100` 4th argument; no other weaving change | 1 Step 4 |
| §3.6 mapper test call sites | 1 Step 3 |
| §3.6 `inventory-service-mock.ts` needs no edit, and why | File structure table + Task 2 Step 1 comment |
| §3.6 `docs/openapi.json` regenerated and committed | 1 Step 8 (verify) + 4 Step 7 (commit) |
| §6 tarball-first, publish after BE green, real install after publish | 1 Step 1, 4 Steps 4 and 6 |
| §6 merge order BE → shared → FE → e2e | 4 Step 11 |
| §7 per-task gate + the OpenAPI gate CLAUDE.md omits | Global Constraints |
| §7 V1 five paths | 2 (unit) + 3 (integration on two of them) |
| §7 V2 purchase origin, real row | 3 Steps 1 and 2 |
| §7 V3 JW-In combined, verbatim | 3 Step 3 |
| §7 V6 non-empty override on all five; `list` called once | 2 Steps 1–3 |
| §8 items 3 and 7 — six BRIEF lines | 1 Step 9 (`:61`, `:80`, `:120`), 2 Step 10 (`:102`, `:107`, `:123`) |
| §7 V4/V5/V7/V8/V9 | FE and e2e plans — listed in "Out of scope" |

**Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N", no "write tests for the above". Every code step carries the literal block, and no step defers a decision to the implementer. Three earlier soft spots were closed against the source: Task 2 Step 1 names the real builder `makeValidInput` (`jw-challan-out.service.test.ts:174`) with the three `repo` mocks `create` needs; Task 3 Step 3 states the `seedLotWithProcessedTypes` hoist as an action, not a condition; Task 4 Step 9 carries the real seed credentials (`prisma/seed-constants.ts:10-11`) and the correct `{ email, password }` login body (`tests/helpers/auth.ts:74`), not a bracketed placeholder.

**Type consistency.** `partyLotMap: ReadonlyMap<string, string | null>` is the parameter name in Task 1's signature, Task 1's JSDoc, Task 2's `fetchPartyLotMap` return type, and every call site in Task 2 Steps 6 and 7. The map key is `item.lotNumber` in all of them — Task 2 Step 9's mutation check exists precisely to prove no site drifted to `item.id`. The service helper is `fetchPartyLotMap` everywhere (never `fetchPartyLotsMap`), matching the existing `fetchOutItemRollupMap`. The response field is `partyLotNo` (schema name), never `partyLot`.

**Citations.** Every `file:line` in this plan was read on disk on 2026-09-02 at the state of `feat/inventory-rewoven`. Tasks 2 and 3 shift line numbers in `jw-challan-out.service.ts` and the integration file; the handbook edits in Task 2 Step 10 are instructed to re-verify after the shift rather than copy these numbers forward.
