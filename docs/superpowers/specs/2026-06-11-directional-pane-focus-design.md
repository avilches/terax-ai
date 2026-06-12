# Directional pane focus shortcuts

**Date:** 2026-06-11
**Status:** approved

## Goal

Replace the current cyclic `pane.focusNext` / `pane.focusPrev` shortcuts (Cmd+] / Cmd+[) with four directional shortcuts that move focus to the geometrically adjacent pane: up, down, left, right. If there is no pane in the requested direction, nothing happens (hard stop, no wrap-around).

## What changes

### `src/modules/shortcuts/shortcuts.ts`

- Remove `pane.focusNext` and `pane.focusPrev` from `ShortcutId` union type and from the `SHORTCUTS` array.
- Add four new IDs to `ShortcutId`: `pane.focusUp`, `pane.focusDown`, `pane.focusLeft`, `pane.focusRight`.
- Add four entries to `SHORTCUTS` (group `"Panes"`) with default keybindings:
  - Mac: `{ meta: true, ctrl: true, key: "ArrowUp/Down/Left/Right" }`
  - non-Mac: `{ ctrl: true, alt: true, key: "ArrowUp/Down/Left/Right" }`

### `src/app/App.tsx`

- Remove the `"pane.focusNext"` and `"pane.focusPrev"` handler entries.
- Add a local helper `focusPaneInDirection(dir: "up" | "down" | "left" | "right")` and wire it to the four new shortcut IDs.

## Algorithm: `focusPaneInDirection`

1. If no `activeWorkspace`, return early.
2. Read the active pane's `DOMRect` via `document.querySelector('[data-pane-id="<id>"]').getBoundingClientRect()`. If the element is not found, return early.
3. Collect all `[data-pane-id]` elements in the document. For each, check whether the `paneId` from `data-pane-id` belongs to the active workspace (using `allPanes(activeWorkspace.paneTree)`). Skip the active pane itself.
4. For each candidate, determine whether it lies in the requested direction:
   - `right`: `candidate.left >= active.right - 1`
   - `left`: `candidate.right <= active.left + 1`
   - `down`: `candidate.top >= active.bottom - 1`
   - `up`: `candidate.bottom <= active.top + 1`
   (1px tolerance absorbs sub-pixel border widths.)
5. Score each qualifying candidate with `score = distance * 10000 - overlap` where:
   - `distance` is the gap between the edges facing each other (e.g. `candidate.left - active.right` for `right`).
   - `overlap` is the perpendicular overlap length (vertical for left/right moves, horizontal for up/down moves), clamped to 0.
   - Lower score wins. Primary sort: minimize distance. Tie-break: maximize overlap (prefer panes that are more aligned).
6. If a winner was found, call `focusPane(activeWorkspace.id, winner.paneId)`. Otherwise do nothing (hard stop).

## Constraints

- No change to the `SplitNode` tree structure or `splitNode.ts`.
- No new DOM queries other than the `[data-pane-id]` selector already used in the codebase.
- Works for any tree depth and any combination of horizontal/vertical splits.
- The 1px tolerance is intentional; do not increase it or false positives may appear with non-adjacent panes.
