# Party Lot on JW-Out Challan — Shared Plan (the contract)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `partyLotNo: string | null` (required-nullable) on `jwChallanOutItemResponseSchema` as `@pashwashah04/fabtraq-shared@1.28.0`.

**Architecture:** One additive field on one response schema; no new exported schema, no registry change (the registry references `jwChallanOutResponseSchema` by identity, so OpenAPI picks it up on re-emit). The BE and FE plans consume this file's exact names.

**Tech Stack:** zod, vitest, tsup; GitHub Packages registry (scoped `@pashwashah04`).

**Spec:** `docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md` §3.1, §6.

## Global Constraints
- Node 22, strict TS, no `any`, no `.js` import extensions.
- Field is `partyLotNo: z.string().nullable()` — NOT optional, NOT `partyLotNoSchema` (spec §3.1).
- Version `1.28.0`. Registry is at `1.27.0` — `npm view` is the authority.
- Publish ONLY after the BE mapper is green against a local `npm pack` tarball (spec §6 step 1) — i.e. after BE plan Task 1. **Task 2 of this plan is executed inside BE Wave 2, not before.**
- One test run at a time (`npm test` already takes the lock).

## Contract (what be / fe / e2e consume)

```ts
// @pashwashah04/fabtraq-shared — JwChallanOutItemResponse gains:
partyLotNo: string | null;   // sits between sourceLotNumber and bagCount
```
Type name unchanged: `JwChallanOutItemResponse`, `JwChallanOutResponse`. Producers: BE `mapJwChallanOutRow`. Consumers: FE `api.ts` parseOrThrow, MSW handlers (jsonValidated), `yarnDeliveryDocument`, two detail pages, FE smoke `jw-challans-out.smoke.ts`.

## Waves
- **W1 (this plan, Task 1):** commit the contract. Independent of everything.
- **W2 (BE plan) contains this plan's Task 2 (publish)** as its last step, after BE Task 1 is green against the tarball.

---

### Task 1: Commit the contract change (already on disk)

**Files:**
- Modify: `fabtraq-shared/src/schemas/transaction/jw-challan-out.ts:208-224` (doc comment only — code line already correct)
- Test: `fabtraq-shared/tests/schemas/transaction/jw-challan-out.test.ts:747-787` (already written, 5 cases)
- Modify: `fabtraq-shared/package.json` (`1.28.0`, already), `package-lock.json` (rider, already)

**Interfaces:**
- Produces: `JwChallanOutItemResponse.partyLotNo: string | null`.

- [ ] **Step 1: Confirm the working tree is exactly the blessed diff**

Run: `cd fabtraq-shared && git status --short && git diff --numstat`
Expected: 4 files — `package.json` 1/1, `package-lock.json` 2/2, `src/schemas/transaction/jw-challan-out.ts` 17/0, `tests/schemas/transaction/jw-challan-out.test.ts` 44/0. Anything else → stop, report.

- [ ] **Step 2: Replace the "(owner decision 2026-09-01)" clause in the doc comment so the spec is the record**

In `src/schemas/transaction/jw-challan-out.ts`, change the second paragraph of the comment above `partyLotNo` to:
```ts
   * `null` when the origin recorded no party lot; the printed challan then
   * leaves the Lot No. cell blank rather than falling back to the minted lot
   * (spec docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md
   * L2). Internal detail screens show BOTH numbers — staff trace stock by the
   * minted one (L6).
```

- [ ] **Step 3: Run the schema tests and confirm the 5 new cases pass**

Run: `npm test -- tests/schemas/transaction/jw-challan-out.test.ts > /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/shared-t1.txt 2>&1; tail -5 $_`
Expected: `describe('jwChallanOutResponseSchema — item partyLotNo')` 5 passed; file green.

- [ ] **Step 4: Full verify**

Run: `npm run verify > .../shared-verify.txt 2>&1; tail -3 $_`
Expected: format, lint, typecheck, test, build all exit 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json src/schemas/transaction/jw-challan-out.ts tests/schemas/transaction/jw-challan-out.test.ts
git commit -m "feat(jw-challan-out): partyLotNo required-nullable on item response (1.28.0)

Spec: docs/superpowers/specs/2026-09-02-party-lot-on-jw-out-challan-design.md §3.1

Co-Authored-By: RuFlo <ruv@ruv.net>
Claude-Session: https://claude.ai/code/session_012xMTnRBvnsjM3xw1bp2vyv"
```

- [ ] **Step 6: Pack a tarball for BE Wave 2**

Run: `npm run build && npm pack --pack-destination /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/`
Expected: `pashwashah04-fabtraq-shared-1.28.0.tgz` in the scratchpad. Report the absolute path — BE Task 1 installs it `--no-save`.

---

### Task 2: Publish 1.28.0 (runs as the LAST step of BE Wave 2)

**Precondition:** BE Task 1 unit tests green with the tarball from Task 1 Step 6 installed.

- [ ] **Step 1: Registry check**

Run (from `fabtraq-fe/`, whose `.npmrc` maps the scope + token): `npm view @pashwashah04/fabtraq-shared version`
Expected: `1.27.0`. If `1.28.0` already → stop, report (someone published).

- [ ] **Step 2: Export-diff against the published tarball**

```bash
cd fabtraq-shared && git status --short   # must be empty
npm run build
npm pack @pashwashah04/fabtraq-shared@1.27.0 --pack-destination /tmp/claude-1001/-home-pashwas-Desktop-Pathshala-gosrani-software/337ff821-853d-43bc-a7f7-566b2e67cbb4/scratchpad/pub/
tar -xzf /tmp/claude-1001/.../scratchpad/pub/pashwashah04-fabtraq-shared-1.27.0.tgz -C /tmp/claude-1001/.../scratchpad/pub/
diff <(grep -oE 'export (declare )?(const|function|type|interface|class) [A-Za-z0-9_]+' /tmp/claude-1001/.../scratchpad/pub/package/dist/index.d.ts | sort -u) \
     <(grep -oE 'export (declare )?(const|function|type|interface|class) [A-Za-z0-9_]+' dist/index.d.ts | sort -u)
```
Expected: **0 lines removed** (`<`). Any `<` line = an export you are about to delete → stop.

- [ ] **Step 3: Publish**

Run: `npm publish` (from `fabtraq-shared/`, clean tree, on `feat/inventory-rewoven`; the memory `feedback_shared_publish_base` says publish from main — this branch IS ahead of main by exactly this workstream and main has no newer shared, verified `git rev-list --count HEAD..origin/main` = 0 in Stage 0).
Expected: `+ @pashwashah04/fabtraq-shared@1.28.0`.

- [ ] **Step 4: Verify**

Run: `npm view @pashwashah04/fabtraq-shared version` → `1.28.0`.

- [ ] **Step 5: Hand back to BE Task 1's follow-up**: real `npm install @pashwashah04/fabtraq-shared@1.28.0` in `fabtraq-be` (moves the lockfile), then FE bump + `rm -rf fabtraq-fe/node_modules/.vite`.
