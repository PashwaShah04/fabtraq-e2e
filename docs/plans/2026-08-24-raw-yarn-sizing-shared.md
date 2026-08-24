# Direct Raw-Yarn → Sizing — fabtraq-shared Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Relax the `sizing` case of `isValidInputState` so any pre-beam lot state — raw included — is a valid sizing input, per spec §3.

**Architecture:** Pure primitive change. One boolean expression, its doc-comment table row, and the tests that pin it. No schema, no registry, no endpoint, no exported signature change.

**Tech Stack:** TypeScript, Vitest, tsup.

**Global Constraints:**
- No `.js` extensions in relative imports.
- Node 22.
- Strict TypeScript — no `any`.
- **Do NOT bump `package.json` version and do NOT add a CHANGELOG release section.** Spec §4 / D3: the bump is a separate, later decision. `1.21.0` stays as-is.
- Commit locally after every task. **Do NOT push.**
- Worktree: `/home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-shared`, branch `feat/raw-yarn-sizing-shared`, based on `main`.

---

## Verify commands (every task)

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-shared
npx vitest run tests/primitives/job-work.test.ts   # fast loop
npm run verify                                      # lint --max-warnings 0 && tsc --noEmit && vitest run && tsup
```

---

## Task 1: Relax the `sizing` predicate (spec §3)

**Files:**
- Modify: `src/primitives/job-work.ts`
- Test: `tests/primitives/job-work.test.ts` (Group E, and one addition to Group G)

**Interfaces:**
- Consumes: nothing new — `P` is already in scope.
- Produces: `isValidInputState` (signature unchanged) now returns `true` for `['sizing']` against any `processedTypes` not containing `sizing` or `weaving`.

**Step 1: Write the failing tests**

Replace the whole "Group E — sizing target" describe block with:

```typescript
// ─── Group E — sizing target (spec 2026-08-24 §3: any pre-beam lot is valid) ──

describe('isValidInputState — sizing target', () => {
  it('P=[] → true (raw yarn goes straight to sizing — spec §3, D1)', () => {
    expect(isValidInputState([], ['sizing'])).toBe(true);
  });

  it('P=["twisting"] → true (twisted yarn is a valid sizing input)', () => {
    expect(isValidInputState(['twisting'], ['sizing'])).toBe(true);
  });

  it('P=["dyeing"] → true (dyed yarn is a valid sizing input)', () => {
    expect(isValidInputState(['dyeing'], ['sizing'])).toBe(true);
  });

  it('P=["twisting","gassing"] → true (compound pre-beam processing is still valid)', () => {
    expect(isValidInputState(['twisting', 'gassing'], ['sizing'])).toBe(true);
  });

  it('P=["warping"] → true (the classic warped-lot chain, unchanged)', () => {
    expect(isValidInputState(['warping'], ['sizing'])).toBe(true);
  });

  it('P=["sizing"] → false (cannot size twice)', () => {
    expect(isValidInputState(['sizing'], ['sizing'])).toBe(false);
  });

  it('P=["warping","sizing"] → false (cannot size twice)', () => {
    expect(isValidInputState(['warping', 'sizing'], ['sizing'])).toBe(false);
  });

  it('P=["weaving"] → false (cannot size after weaving)', () => {
    expect(isValidInputState(['weaving'], ['sizing'])).toBe(false);
  });

  it('P=["warping","weaving"] → false (cannot size after weaving)', () => {
    expect(isValidInputState(['warping', 'weaving'], ['sizing'])).toBe(false);
  });
});
```

Append to the existing "Group G — compound jobWorkTypes" describe block:

```typescript
  it('jobWorkTypes=["warping","sizing"], P=[] → true (single warp+size trip is now expressible — spec §3.3)', () => {
    expect(isValidInputState([], ['warping', 'sizing'])).toBe(true);
  });

  it('jobWorkTypes=["warping","sizing"], P=["warping"] → false (warping half already done)', () => {
    expect(isValidInputState(['warping'], ['warping', 'sizing'])).toBe(false);
  });
```

**Step 2: Run to see it fail**

`npx vitest run tests/primitives/job-work.test.ts -t "sizing target"`

Expected FAIL: `P=[]`, `P=["twisting"]`, `P=["dyeing"]`, `P=["twisting","gassing"]` currently return `false` where `true` is expected (the old predicate demands `P.has('warping')`). The Group G `["warping","sizing"]` on `P=[]` case also currently returns `false`.

**Step 3: Implement**

In `src/primitives/job-work.ts`, update the doc-comment table row for `sizing` and the case body:

```typescript
 * - sizing   : !P.includes('sizing') && !P.includes('weaving')
 *              (spec 2026-08-24 §3 — amends L18: raw yarn may go straight to
 *              sizing; the warping leg is not a precondition)
```

```typescript
      case 'sizing':
        return !P.has('sizing') && !P.has('weaving');
```

**Step 4: Run to see it pass**

`npx vitest run tests/primitives/job-work.test.ts` → all groups green, 0 failures.

Then `npm run verify` → lint, tsc, full vitest, tsup all green.

**Step 5: Commit**

```bash
git add src/primitives/job-work.ts tests/primitives/job-work.test.ts
git commit -m "feat(job-work): relax sizing predicate — raw yarn is a valid sizing input (spec 2026-08-24 §3)"
```

---

## Task 2: Mirror the spec + L18 amendment into `docs/`

**Files:**
- Add: `docs/superpowers/specs/2026-08-24-raw-yarn-sizing-design.md`
- Add: `docs/plans/2026-08-24-raw-yarn-sizing-{shared,be,fe,e2e}.md`
- Modify: `docs/brainstorms/2026-05-19-jw-domain-redesign.md` (L18 section)

Copy byte-for-byte from the repo-root `docs/` tree (prettier ignores `*.md` in
all three repos on purpose — do not reformat).

The L18 amendment: change the `sizing` row of the predicate table to
`!P.has('sizing') && !P.has('weaving')` and append an amendment note under the
table recording that the row is superseded by the 2026-08-24 spec, alongside
the existing WD-L3 amendment of the `weaving` row.

**Verify:** `diff` each mirrored file against the root copy — must be identical.

**Commit:**

```bash
git add docs
git commit -m "docs: raw-yarn-sizing design spec + plans, amend L18 sizing predicate row"
```

---

## Self-review against spec

- [ ] `package.json` still reads `"version": "1.21.0"` — no bump (D3).
- [ ] No CHANGELOG release section added.
- [ ] `isValidInputState` export signature byte-identical to before.
- [ ] Every other predicate row (`twisting`/`gassing`/`dyeing`/`warping`/`weaving`) untouched.
- [ ] `npm run verify` green.
