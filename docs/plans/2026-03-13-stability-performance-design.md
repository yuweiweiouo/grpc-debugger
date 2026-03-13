# Stability and Performance Optimization Design

**Project:** `grpc-debugger`

**Date:** 2026-03-13

## Goal

Improve runtime stability and reduce avoidable CPU and memory cost in the DevTools extension without changing the user-visible debugging workflow.

## Scope

This design focuses on four concrete hotspots:

1. `src/stores/network.js` reprocess behavior after new schema registration
2. `src/stores/network.js` filtering and decode orchestration cost
3. `src/extension/devtools.ts` polling and queue draining overhead
4. `src/extension/fetch-interceptor.ts` request body Base64 conversion cost

The work also includes low-risk cleanup tied directly to this optimization pass:

- remove current build warnings
- align README commands with actual scripts

## Non-Goals

- full rewrite of extension messaging architecture
- broad TypeScript strict-mode migration
- major UI redesign
- replacing the existing HAR plus interceptor matching strategy

## Current Problems

### 1. Reprocessing is too expensive

When a new schema is discovered, `reprocessAllLogs()` re-runs decode work for every stored entry. This does not scale well as session size grows and wastes work on entries that were already decoded successfully.

### 2. Store responsibilities are too mixed

`network.js` currently combines ingestion, source gating, reflection triggering, decode orchestration, dedupe, and filtering. This increases the chance of regressions and makes targeted optimization harder.

### 3. DevTools polling is always on

`devtools.ts` uses a fixed polling loop with `inspectedWindow.eval()` and JSON serialization even when traffic is idle. This creates avoidable steady-state overhead.

### 4. Request body conversion is hot-path inefficient

`fetch-interceptor.ts` builds large binary strings with repeated concatenation before calling `btoa()`. This is expensive for bigger payloads and runs inside page interception logic.

## Proposed Approach

### A. Make log reprocessing selective

Track whether a log entry actually needs schema-based retry. Instead of reprocessing every entry, only retry entries that meet all of the following:

- non-interceptor source
- raw payload still available
- previous decode is missing or contains a schema-related failure state

This keeps behavior intact while reducing unnecessary decode work.

### B. Separate orchestration decisions from decode mechanics

Keep the public store API stable, but internally split the logic into smaller helper functions responsible for:

- entry normalization
- source eligibility checks
- retry eligibility checks
- decode execution
- merge/update behavior

This is a structural cleanup, not a broad architecture rewrite.

### C. Reduce idle polling cost in DevTools

Keep the existing queue-based capture model, but make draining cheaper. Preferred direction:

- avoid aggressive polling when the panel is not actively consuming events
- reduce unnecessary parse work when the queue is empty
- preserve current ordering guarantees and matching behavior

The implementation should remain compatible with the current injected listener.

### D. Replace string-concatenation Base64 conversion

Use a chunked conversion strategy for `ArrayBuffer -> Base64` to avoid quadratic-ish string growth patterns on large payloads.

This should be implemented as a drop-in internal improvement with no protocol changes.

### E. Clear adjacent warnings and friction

Since this pass touches build health and developer feedback loops, also:

- fix the a11y warning in `src/App.svelte`
- remove the unused selector warning in `src/components/Toolbar.svelte`
- correct README development commands

## Data and Control Flow Changes

### Network store

Before:

- add entry
- maybe auto-reflect
- decode
- merge into list
- if new schema, decode all logs again

After:

- add entry
- normalize and gate source
- maybe auto-reflect
- decode once
- annotate retry state if decode lacked schema support
- merge into list
- if new schema, retry only eligible entries

### DevTools polling

Before:

- fixed `setInterval`
- `eval()` returns stringified queue payload
- parse every non-empty result

After:

- same capture mechanism
- cheaper empty-path handling
- less work during idle periods
- no change to event ordering assumptions

## Risk Management

### Main risks

1. Breaking delayed schema recovery for old logs
2. Regressing HAR plus interceptor matching order
3. Accidentally changing displayed decoded payloads

### Mitigations

- add targeted tests for retry eligibility and selective reprocessing
- keep matching logic unchanged in this pass
- verify existing test suite and production build after each change set

## Testing Strategy

1. Add focused tests for selective reprocessing behavior
2. Add tests for any extracted helper logic where practical
3. Run `npm test`
4. Run `npm run build`
5. Confirm build warnings are reduced from current baseline

## Expected Outcome

- lower CPU spikes after schema discovery
- less unnecessary decode work for long sessions
- lower idle overhead in DevTools
- better maintainability in `network.js`
- cleaner build output and onboarding docs
