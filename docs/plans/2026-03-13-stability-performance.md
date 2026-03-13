# Stability and Performance Optimization Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reduce avoidable runtime overhead in the extension while preserving the current debugging workflow and improving maintainability around log decoding.

**Architecture:** Keep the public behavior stable, but refactor the internal flow so log reprocessing is selective, DevTools idle work is reduced, and hot-path request body handling is cheaper. Avoid broad rewrites; make small, verifiable changes around the existing store and extension pipeline.

**Tech Stack:** Svelte 5, Vite 7, Vitest 4, browser extension APIs, plain JS plus TS modules.

---

### Task 1: Add selective reprocessing coverage

**Files:**
- Modify: `src/stores/network.js`
- Create: `test/network-store.test.js`

**Step 1: Write the failing test**

Add focused tests for these cases:

- only entries with schema-dependent decode failures are retried
- interceptor entries are skipped
- entries without raw payload are skipped
- successful decoded entries are not reprocessed again

**Step 2: Run test to verify it fails**

Run: `npm test -- test/network-store.test.js`

Expected: FAIL because the current store reprocesses too broadly or lacks test seams.

**Step 3: Add minimal test seams**

Expose or extract the smallest helper surface needed to test retry eligibility without changing public store behavior.

**Step 4: Run test to verify the failure is now meaningful**

Run: `npm test -- test/network-store.test.js`

Expected: FAIL on the intended assertions, not on setup problems.

### Task 2: Make network log reprocessing selective

**Files:**
- Modify: `src/stores/network.js`
- Test: `test/network-store.test.js`

**Step 1: Implement retry eligibility helpers**

Add small helpers for:

- entry normalization
- retry eligibility
- decode attempt result annotation

Keep function names explicit and local to the store module unless testability requires export.

**Step 2: Replace full-list retry behavior**

Update `reprocessAllLogs()` so it only reprocesses eligible entries and avoids `Promise.all()` across the full log list.

**Step 3: Preserve merge and UI update behavior**

Keep the current list update semantics intact so the UI still reacts after retry work completes.

**Step 4: Run focused tests**

Run: `npm test -- test/network-store.test.js`

Expected: PASS.

**Step 5: Run full test suite**

Run: `npm test`

Expected: PASS with no regressions.

### Task 3: Reduce filtering and orchestration overhead in `network.js`

**Files:**
- Modify: `src/stores/network.js`
- Test: `test/network-store.test.js`

**Step 1: Optimize hidden service lookup**

Replace repeated `some()` scans with a cheaper lookup approach, such as precomputed prefixes or a `Set`-backed structure that still supports method-prefix filtering.

**Step 2: Split internal logic into helpers**

Extract small helpers for source gating and entry processing decisions so `addLog()` becomes easier to reason about.

**Step 3: Verify behavior stays stable**

Run: `npm test`

Expected: PASS.

### Task 4: Reduce DevTools idle polling overhead

**Files:**
- Modify: `src/extension/devtools.ts`

**Step 1: Add the smallest possible internal abstraction around polling**

Make the draining path explicit so idle and non-idle behavior can be tuned without touching matching logic.

**Step 2: Reduce empty-queue cost**

Adjust polling behavior to avoid unnecessary heavy work when the injected queue is empty while preserving order and delivery.

**Step 3: Keep matching behavior unchanged**

Do not change FIFO queue consumption for captured request bodies in this task.

**Step 4: Run validation**

Run: `npm test && npm run build`

Expected: PASS, with no new warnings introduced.

### Task 5: Optimize request body Base64 conversion

**Files:**
- Modify: `src/extension/fetch-interceptor.ts`

**Step 1: Replace repeated string concatenation**

Implement a chunked conversion path for `ArrayBuffer` to Base64 that avoids building the full binary string one character at a time.

**Step 2: Preserve output compatibility**

Ensure the emitted `bodyBase64` format stays identical for downstream consumers.

**Step 3: Run validation**

Run: `npm test && npm run build`

Expected: PASS.

### Task 6: Clean adjacent warnings and docs drift

**Files:**
- Modify: `src/App.svelte`
- Modify: `src/components/Toolbar.svelte`
- Modify: `README.md`

**Step 1: Fix the resizer accessibility warning**

Add the minimum accessible semantics needed for the resize handle without changing its interaction model.

**Step 2: Remove the unused selector warning**

Align `Toolbar.svelte` styles with the actual generated markup from the icon component.

**Step 3: Correct README commands**

Update development instructions so they match current `package.json` scripts.

**Step 4: Run final verification**

Run: `npm test && npm run build`

Expected: PASS, and current build warnings should be gone or reduced with a clear explanation.

### Task 7: Final review and handoff

**Files:**
- Review: `docs/plans/2026-03-13-stability-performance-design.md`
- Review: `docs/plans/2026-03-13-stability-performance.md`

**Step 1: Review changed files**

Check the final diff for accidental behavior changes, debug leftovers, or unrelated edits.

**Step 2: Run full project verification**

Run: `npm test && npm run build`

Expected: PASS.

**Step 3: Summarize outcomes**

Document which optimizations landed, what was intentionally deferred, and any follow-up opportunities.
