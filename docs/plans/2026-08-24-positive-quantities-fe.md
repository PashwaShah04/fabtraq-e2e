# Positive Quantities — fabtraq-fe Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Make sure the new 400s land as inline field errors, not as a dead-end toast — and prove it live, not just with green tests.

**Architecture:** The forms already resolve the shared schemas through their resolvers, so the new rules apply client-side automatically. The risk is NOT that validation fails to fire; it is that it fires somewhere the user cannot see. A guard that blocks Save with no visible reason is a worse user experience than the bug it fixes. That is what this plan verifies.

**Global Constraints:**
- **Shared resolution:** install the local tarball, then `rm -rf node_modules/.vite` — the Vite dep cache otherwise serves the stale bundled schema.
- The FE worktree needs its own `.env` (`VITE_API_BASE_URL=http://localhost:4000`); it ships only `.env.example`.
- Commit locally. **Do NOT push.**
- Worktree: `worktrees/raw-yarn-sizing-fe`, branch `feat/raw-yarn-sizing-fe`.

---

## Verify commands

```bash
cd /home/pashwas/Desktop/Pathshala/gosrani-software/worktrees/raw-yarn-sizing-fe
npm run lint && npx tsc --noEmit && npm run test && npm run build
```

---

## Task 1: Find where the new errors surface

**Files:** read-only investigation first.

For each of the four affected forms — JW-Challan-Out, JW-Challan-In, Yarn Purchase, Fabric Taka (weaving-in) — establish:

1. Which resolver each uses, and whether it is the CREATE schema carrying the new guards (some forms use a looser form-schema and only validate on submit — if so, the error arrives as a server 400, not a client-side field error, and Task 3 is where that shows up).
2. Where a `path: ['placements']` issue renders. The netWeight guard reports on `netWeight`, which has a visible field; the new placements guard reports on `placements`, which is an ARRAY — if no error slot is bound to it, the message is swallowed and Save fails silently. **This is the single most likely regression in this change.**
3. Same question for `path: ['grossWeight']`.

Record findings in the commit message. If a path has no visible slot, that is a real defect to fix in Task 2 — not something to work around by moving the guard.

---

## Task 2: Bind any unbound error paths

**Files:** only the forms where Task 1 found a swallowed path.

Minimum change that makes the message visible next to the relevant control. Do not restructure the form, do not add a summary banner unless there is genuinely nowhere else — spec §6 rules out scope creep here.

If Task 1 found every path already bound, **make no change** and say so.

**Commit:** `fix(forms): surface placements/grossWeight validation errors inline (spec 2026-08-24 §5)` — or skip if no change needed.

---

## Task 3: Live verification (mandatory — green tests prove nothing about looks)

Boot BE + FE from the worktrees (BE needs `set -a && . ./.env && set +a` first; ports 4000/5173).

For JW-Challan-Out, drive the real form and screenshot each:

1. Quantity `0` → attempt Save. Assert a **visible** message next to the net-weight field, and that the page does not silently do nothing.
2. Positive quantity, no placement added → Save. Assert a visible placements message.
3. `netWeight 10`, `grossWeight 9` → Save. Assert a visible gross-weight message.
4. Positive control: a valid challan still saves cleanly.

Repeat 1 for JW-Challan-In and Yarn Purchase (spot-check, not exhaustive).

A blocked Save with no visible reason is a FAILURE of this task even if the API correctly returned 400.

---

## Task 4: Suite + docs

```bash
npm run lint && npx tsc --noEmit && npm run test && npm run build
```

Record the test count. Any test that breaks is a fixture using quantity 0 — fix the fixture, never the guard.

Mirror spec + four plans byte-for-byte from the repo-root `docs/`.

**Commit:** `docs: positive-quantities design spec + plans`

---

## Self-review against spec

- [ ] Every new error path has a visible slot, verified by screenshot, not by reading code.
- [ ] Positive control still saves.
- [ ] `node_modules/.vite` cleared after the tarball install.
- [ ] `package.json` / lockfile unchanged.
- [ ] No form restructuring beyond binding error slots.
