# Window Close Gotchas

This document captures hard-won lessons about the window-close flow in Terax. It exists because this area has a subtle
interaction between Tauri 2's `onCloseRequested` event, React state, and async JS, and has caused multiple regressions.

---

## Architecture overview

The close-before-flush flow lives in two places:

| Layer | File | Responsibility |
|---|---|---|
| JS entry point | `src/main.tsx` | `onCloseRequested` handler: prevents close, flushes workspace state, then calls `destroy()` |
| Workspace hook | `src/modules/workspaces/lib/useWorkspaces.ts` | Detects `workspaces.length === 0`, calls `flushWorkspaceState()` then `getCurrentWindow().destroy()` |
| State persistence | `src/modules/workspaces/lib/workspaceState.ts` | `saveWorkspaceState` (debounced 800 ms), `flushWorkspaceState` (immediate, called before close) |

The Rust side (`lib.rs` `WindowEvent::CloseRequested`) only saves window geometry — it does NOT prevent or allow the
close.

---

## Why `close()` must NOT be used to re-trigger close after flush

`getCurrentWindow().close()` dispatches a new `close-requested` IPC event. When called from INSIDE the `finally` block
of an async `onCloseRequested` handler, it creates a re-entrant close cycle:

```
close() call #1 (X button or app)
  → onCloseRequested fires
  → event.preventDefault()   ← cancels close #1
  → flushing = true
  → await flushWorkspaceState()
  → finally: close() call #2
       → IF Tauri sees close #2 while close #1 is still "in-flight", it may discard it
       → OR onCloseRequested fires for close #2, flushing=true → return without preventDefault
       → BUT the window may still not close for platform-specific reasons
```

This bug was confirmed: after a close cycle, `flushing = true` could become permanently `true`, making the native red
button a no-op (`flushing=true → return → no preventDefault → should close… but didn't`).

**Rule: never call `close()` inside `onCloseRequested`.**

## Why `destroy()` is the correct API

`Window.destroy()` (Tauri 2 JS API, available from `@tauri-apps/api/window`) forcefully destroys the window:
- Does NOT emit `close-requested` (JS or Rust side)
- DOES emit `Destroyed` (Rust side) — cleanup in `lib.rs` runs normally
- Geometry-saving via `WindowEvent::CloseRequested` (Rust) is skipped; geometry is saved by `Focused`/`Resized`
  handlers throughout the session, so the final-moment save is not critical

```typescript
// Correct pattern in main.tsx:
getCurrentWindow().onCloseRequested(async (event) => {
  if (flushing) return;
  event.preventDefault();
  flushing = true;
  try {
    await flushWorkspaceState();
  } finally {
    void getCurrentWindow().destroy(); // NOT .close()
  }
});
```

---

## React state timing: `workspacesRef` is always one render stale inside updaters

`workspacesRef.current` is updated in a `useEffect(() => { workspacesRef.current = workspaces }, [workspaces])`. This
runs AFTER the render that produced the new `workspaces` value. Consequence:

- Inside a `setState` updater (the functional form), `workspacesRef.current` still holds the value from the PREVIOUS
  render.
- This is intentional: the updater receives `prev` (the pre-update list), and `workspacesRef` matches it.
- For computing the adjacent workspace after a close, this is exactly what you want:
  `closedIdx = workspacesRef.current.findIndex(w => w.id === id)` gives the correct index in the pre-deletion list.

**Rule: rely on `prev` inside updaters for current-render data; use `workspacesRef.current` only for cross-updater
coordination when you need the value from before the current state flush.**

## React updater timing: flags set inside setState are invisible to synchronous callers

A flag (`let shouldCloseWindow = false`) set INSIDE a `setWorkspaces(prev => { ...; shouldCloseWindow = true; return ...; })`
updater is NOT visible to code that runs synchronously after the `setWorkspaces(...)` call returns. Updaters run during
React's flush (commit phase), which is asynchronous relative to the calling function.

```typescript
// THIS DOES NOT WORK:
let shouldClose = false;
setWorkspaces(prev => {
  if (prev.length === 1) shouldClose = true; // ← runs later, not now
  return prev.filter(...);
});
if (shouldClose) void getCurrentWindow().close(); // ← always false here
```

**Rule: compute whether a close should happen BEFORE calling `setWorkspaces`, using `workspacesRef.current`.**

---

## Effect execution order within a component

When `workspaces` changes to `[]`, all effects that depend on `workspaces` run in the order they were registered:

1. `useEffect(() => { workspacesRef.current = workspaces; }, [workspaces])` — from `useWorkspaces`
2. `useEffect(() => { if (workspaces.length === 0) { flush + destroy } }, [workspaces])` — from `useWorkspaces`
3. `useEffect(() => { saveWorkspaceState(workspaces, activeIdx); }, [workspaces])` — from `App.tsx`

At the moment effect #2 runs synchronously up to its first `await`, `pendingWorkspaces` still holds the last
non-empty state (set in effect #3 of the PREVIOUS render). Effect #3 of the current render has not run yet.
This means `flushWorkspaceState()` saves the last non-empty workspace state, which is the correct behavior
(restores on next launch, same as pressing the native X button).

---

## Root cause of all `destroy()` failures (resolved 2026-06-11)

`Window.destroy()` calls `invoke('plugin:window|destroy', { label })` under the hood. This IPC command is
gated by the Tauri capability system. **`core:window:allow-destroy` was missing from
`src-tauri/capabilities/default.json`**, so every call was silently rejected with a permission-denied error.
The `void` wrapper around `destroy()` suppressed the error, making the failure invisible.

The X button broke after each attempt because `flushing = true` was set in `onCloseRequested` before
`destroy()` was called, and was never reset when `destroy()` failed. With `flushing` stuck at `true`,
the next X-button press hit the early-return path and did nothing.

Fix applied:
1. Added `"core:window:allow-destroy"` to `src-tauri/capabilities/default.json`.
2. Changed `onCloseRequested` to `await destroy()` (not `void`) with a `catch` that resets
   `flushing = false` so the X button can always retry if destroy somehow fails.

---

## Attempted fixes and their outcomes

| Attempt | Mechanism | Result |
|---|---|---|
| 1 | `shouldCloseWindow` flag before `setWorkspaces`, then `close()` | Flag always `false` (updater timing) |
| 2 | Eager calc from `workspacesRef.current`, `close()` immediately | Broke X button permanently |
| 3 | `useEffect` detecting `workspaces.length === 0`, `close()` | Workspace empties, window stays open, X button broken |
| 4 | Same `useEffect`, `flushWorkspaceState()` + `markAppRequestedClose()` flag + `close()` | X button broken (`isAppRequestedClose` path still re-entrant) |
| 5 | Same `useEffect`, `flushWorkspaceState()` + `destroy()` | Workspace empties, window stays open (missing capability) |
| 6 | Same `useEffect` + add `core:window:allow-destroy` capability + `await destroy()` in `onCloseRequested` | Fixed |

Attempt 2 onwards also broke the X button for windows that had never reached 0 workspaces, suggesting that a
single failed close attempt corrupts module-level state (`flushing`) or the Tauri close-event machinery permanently
for that webview session.
