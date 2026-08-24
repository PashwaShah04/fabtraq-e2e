# Direct Raw-Yarn → Sizing — fabtraq-fe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Confirm — by reading the code and by a live visual check, not by assumption — that the FE needs no change, and mirror the docs.

**Architecture:** No production code change, and none is wanted. Two facts make this a no-op repo:

- `src/shared/components/SourceLotPicker.tsx:55` filters with
  `filterLot={(lot) => isValidInputState(lot.processedTypes, jobWorkTypes)}` —
  it consumes the shared primitive and holds no copy of the rule. Relaxing the
  primitive widens the picker automatically.
- `src/shared/components/JobWorkTypeMultiSelect.tsx:9` already offers `sizing`
  as an independently selectable checkbox (only `weaving` is excluded, per the
  Weaving Dispatch spec).

Spec §6 explicitly rules out adding any affordance that *encourages* raw→sizing
— no chain preset, no warning banner, no "direct sizing" toggle. The picker
simply stops excluding lots.

**Global Constraints:**
- **Shared resolution:** spec §4 / D3 defers the version bump, so the published
  `1.21.0` still carries the old predicate. Install the local tarball for the
  live check, and `rm -rf node_modules/.vite` afterwards — the Vite dep cache
  otherwise serves the stale bundled schema.
- Commit locally. **Do NOT push.**
- Worktree: `/home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-fe`, branch `feat/raw-yarn-sizing-fe`, based on `main`.

---

## Verify commands

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-fe
npm run lint && npx tsc --noEmit && npm run test && npm run build
```

---

## Task 1: Prove the no-op

**Files:** none modified.

**Step 1: Read the two call sites**

Confirm `SourceLotPicker.tsx` and `JobWorkTypeMultiSelect.tsx` still match the
descriptions above. If either has grown its own copy of the eligibility rule,
**stop** — spec §1.2 asserts the primitive is the only gate, and a divergence
means the spec is wrong and needs amending before any code is written.

**Step 2: Grep for a second copy of the rule**

```bash
grep -rn "warping" --include=*.ts --include=*.tsx src | grep -v "\.test\."
```

Expected: no hit that gates sizing eligibility. Anything else → stop and report.

**Step 3: Run the existing suite unchanged**

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run build
```

All green — this is the regression proof that widening the primitive breaks
nothing on the FE. Record the test count in the commit message.

---

## Task 2: Live visual check (mandatory — green tests prove nothing about looks)

**Step 1: Install the unpublished shared build and clear the Vite cache**

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-shared
npm run build && npm pack
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-fe
npm install --no-save ../raw-yarn-sizing-shared/pashwashah04-fabtraq-shared-1.21.0.tgz
rm -rf node_modules/.vite
```

**Step 2: Boot BE + FE and drive the form**

Navigate to New JW Challan Out. Tick **Sizing** only. Open the source-lot
picker.

**Assert visually, with a screenshot:**
- Raw lots (no processing badge) now appear in the list.
- Already-sized and woven lots do **not** appear.
- The lot labels render correctly for raw lots in this picker — raw lots have
  never been shown here before, so verify the label composition
  (`lib/lot-labels.ts` vocabulary, lot number as leading token) does not
  degrade with an empty `processedTypes`. This is the one genuinely new visual
  surface in this change.

**Step 3: Clean up**

Confirm `git status` shows no `package.json`/lockfile change from the
`--no-save` install.

---

## Task 3: Mirror docs

Copy the spec, the four plans and the amended
`docs/brainstorms/2026-05-19-jw-domain-redesign.md` byte-for-byte from the
repo-root `docs/` tree into `fabtraq-fe/docs/`. Prettier ignores `*.md` here on
purpose — do not reformat.

```bash
git add docs
git commit -m "docs: raw-yarn-sizing design spec + plans, amend L18 sizing predicate row

FE needs no code change: SourceLotPicker consumes isValidInputState directly
and JobWorkTypeMultiSelect already offers sizing (spec 2026-08-24 §1.2, §6).
Full suite re-run green as the regression proof."
```

---

## Self-review against spec

- [ ] `src/` is untouched — `git diff main --stat -- src` is empty.
- [ ] No chain preset, banner, or toggle added (spec §6).
- [ ] Empty-`processedTypes` lot labels verified visually in the picker, screenshot taken.
- [ ] `node_modules/.vite` cleared after the tarball install.
- [ ] `package.json` / lockfile unchanged.
