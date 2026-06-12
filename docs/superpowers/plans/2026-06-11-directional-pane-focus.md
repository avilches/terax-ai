# Directional Pane Focus Shortcuts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace cyclic pane navigation (focusNext/focusPrev) with four directional shortcuts (up/down/left/right) using spatial geometry from the DOM.

**Architecture:** Extract the neighbor-finding logic as a pure function `findPaneInDirection` in `splitNode.ts` (testable without DOM). The App.tsx handler reads the DOM rects, builds a `Map<string, Rect>`, and delegates to the pure function. Hard-stop at borders — no wrap-around.

**Tech Stack:** TypeScript, React 19, Vitest (tests), Tauri/webview frontend.

---

## File map

| File | Action | What changes |
|---|---|---|
| `src/modules/workspaces/lib/splitNode.ts` | Modify | Add `findPaneInDirection` + `Rect` type |
| `src/modules/workspaces/lib/splitNode.test.ts` | Modify | Add tests for `findPaneInDirection` |
| `src/modules/workspaces/index.ts` | Modify | Export `findPaneInDirection` |
| `src/modules/shortcuts/shortcuts.ts` | Modify | Remove focusNext/focusPrev, add 4 directional IDs and bindings |
| `src/app/App.tsx` | Modify | Remove old handlers, add `focusPaneInDirection` helper and 4 new entries |

---

## Task 1: Pure function `findPaneInDirection` with tests

**Files:**
- Modify: `src/modules/workspaces/lib/splitNode.test.ts`
- Modify: `src/modules/workspaces/lib/splitNode.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/modules/workspaces/lib/splitNode.test.ts`:

```typescript
import {
  // existing imports...
  findPaneInDirection,
  type Rect,
} from "./splitNode";

// Helper to build a Rect
function r(left: number, top: number, right: number, bottom: number): Rect {
  return { left, top, right, bottom };
}

describe("findPaneInDirection", () => {
  // Layout: p1 (left half) | p2 (right half), full height
  const sideBySide = new Map<string, Rect>([
    ["p1", r(0, 0, 500, 600)],
    ["p2", r(500, 0, 1000, 600)],
  ]);

  test("right: returns p2 from p1", () => {
    expect(findPaneInDirection("p1", "right", sideBySide)).toBe("p2");
  });
  test("left: returns p1 from p2", () => {
    expect(findPaneInDirection("p2", "left", sideBySide)).toBe("p1");
  });
  test("hard stop: right from p2 returns null", () => {
    expect(findPaneInDirection("p2", "right", sideBySide)).toBeNull();
  });
  test("hard stop: up from p1 returns null", () => {
    expect(findPaneInDirection("p1", "up", sideBySide)).toBeNull();
  });

  // Layout: p1 (top half) / p2 (bottom half), full width
  const stacked = new Map<string, Rect>([
    ["p1", r(0, 0, 1000, 300)],
    ["p2", r(0, 300, 1000, 600)],
  ]);

  test("down: returns p2 from p1", () => {
    expect(findPaneInDirection("p1", "down", stacked)).toBe("p2");
  });
  test("up: returns p1 from p2", () => {
    expect(findPaneInDirection("p2", "up", stacked)).toBe("p1");
  });
  test("hard stop: down from p2 returns null", () => {
    expect(findPaneInDirection("p2", "down", stacked)).toBeNull();
  });

  // Layout: p1 (left) | p2 (top-right) / p3 (bottom-right)
  // p2 and p3 are equidistant from p1, equal vertical overlap (300px each)
  // from p2, "left" → p1; from p3, "left" → p1
  // from p2, "down" → p3; from p3, "up" → p2
  const threePane = new Map<string, Rect>([
    ["p1", r(0, 0, 500, 600)],
    ["p2", r(500, 0, 1000, 300)],
    ["p3", r(500, 300, 1000, 600)],
  ]);

  test("three panes: right from p1 picks p2 or p3 (closest + overlap)", () => {
    const result = findPaneInDirection("p1", "right", threePane);
    expect(["p2", "p3"]).toContain(result);
  });
  test("three panes: left from p2 → p1", () => {
    expect(findPaneInDirection("p2", "left", threePane)).toBe("p1");
  });
  test("three panes: left from p3 → p1", () => {
    expect(findPaneInDirection("p3", "left", threePane)).toBe("p1");
  });
  test("three panes: down from p2 → p3", () => {
    expect(findPaneInDirection("p2", "down", threePane)).toBe("p3");
  });
  test("three panes: up from p3 → p2", () => {
    expect(findPaneInDirection("p3", "up", threePane)).toBe("p2");
  });

  // unknown pane id
  test("returns null when activePaneId not in map", () => {
    expect(findPaneInDirection("ghost", "right", sideBySide)).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm test -- splitNode
```

Expected: compile error or test failures because `findPaneInDirection` and `Rect` don't exist yet.

- [ ] **Step 3: Add `Rect` type and `findPaneInDirection` to `splitNode.ts`**

Append at the end of `src/modules/workspaces/lib/splitNode.ts`:

```typescript
export type Rect = { left: number; right: number; top: number; bottom: number };

export function findPaneInDirection(
  activePaneId: string,
  direction: "up" | "down" | "left" | "right",
  rects: Map<string, Rect>,
): string | null {
  const activeRect = rects.get(activePaneId);
  if (!activeRect) return null;

  let best: { paneId: string; score: number } | null = null;

  for (const [paneId, rect] of rects) {
    if (paneId === activePaneId) continue;

    let isInDirection: boolean;
    let distance: number;
    let overlap: number;

    switch (direction) {
      case "right":
        isInDirection = rect.left >= activeRect.right - 1;
        distance = rect.left - activeRect.right;
        overlap = Math.max(0, Math.min(activeRect.bottom, rect.bottom) - Math.max(activeRect.top, rect.top));
        break;
      case "left":
        isInDirection = rect.right <= activeRect.left + 1;
        distance = activeRect.left - rect.right;
        overlap = Math.max(0, Math.min(activeRect.bottom, rect.bottom) - Math.max(activeRect.top, rect.top));
        break;
      case "down":
        isInDirection = rect.top >= activeRect.bottom - 1;
        distance = rect.top - activeRect.bottom;
        overlap = Math.max(0, Math.min(activeRect.right, rect.right) - Math.max(activeRect.left, rect.left));
        break;
      case "up":
        isInDirection = rect.bottom <= activeRect.top + 1;
        distance = activeRect.top - rect.bottom;
        overlap = Math.max(0, Math.min(activeRect.right, rect.right) - Math.max(activeRect.left, rect.left));
        break;
    }

    if (!isInDirection || distance < 0) continue;

    // Lower score wins: minimize distance, break ties by maximizing overlap
    const score = distance * 10000 - overlap;
    if (!best || score < best.score) {
      best = { paneId, score };
    }
  }

  return best?.paneId ?? null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm test -- splitNode
```

Expected: all `findPaneInDirection` tests pass.

- [ ] **Step 5: Export from workspaces index**

In `src/modules/workspaces/index.ts`, add `findPaneInDirection` and `type Rect` to the existing `splitNode` export line:

```typescript
export {
  allPaneIds,
  allPanes,
  findPane,
  findPaneInDirection,
  findPanelPane,
  firstPaneId,
  siblingPane,
  splitPaneInTree,
  removePaneFromTree,
  type Rect,
  updatePane,
  updateDivider,
} from "./lib/splitNode";
```

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces/lib/splitNode.ts \
        src/modules/workspaces/lib/splitNode.test.ts \
        src/modules/workspaces/index.ts
git commit -m "feat(workspaces): add findPaneInDirection pure function"
```

---

## Task 2: Update shortcuts registry

**Files:**
- Modify: `src/modules/shortcuts/shortcuts.ts`

- [ ] **Step 1: Remove `pane.focusNext` and `pane.focusPrev` from `ShortcutId` type**

In `src/modules/shortcuts/shortcuts.ts`, replace:

```typescript
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusNext"
  | "pane.focusPrev"
  | "pane.source"
```

with:

```typescript
  | "pane.splitRight"
  | "pane.splitDown"
  | "pane.focusUp"
  | "pane.focusDown"
  | "pane.focusLeft"
  | "pane.focusRight"
  | "pane.source"
```

- [ ] **Step 2: Replace the two `SHORTCUTS` entries with four directional ones**

In `src/modules/shortcuts/shortcuts.ts`, replace:

```typescript
  {
    id: "pane.focusNext",
    label: "Focus next pane",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "]" }],
  },
  {
    id: "pane.focusPrev",
    label: "Focus previous pane",
    group: "Panes",
    defaultBindings: [{ [MOD_PROP]: true, key: "[" }],
  },  
```

with:

```typescript
  {
    id: "pane.focusUp",
    label: "Focus pane above",
    group: "Panes",
    defaultBindings: IS_MAC
      ? [{ meta: true, ctrl: true, key: "ArrowUp" }]
      : [{ ctrl: true, alt: true, key: "ArrowUp" }],
  },
  {
    id: "pane.focusDown",
    label: "Focus pane below",
    group: "Panes",
    defaultBindings: IS_MAC
      ? [{ meta: true, ctrl: true, key: "ArrowDown" }]
      : [{ ctrl: true, alt: true, key: "ArrowDown" }],
  },
  {
    id: "pane.focusLeft",
    label: "Focus pane to the left",
    group: "Panes",
    defaultBindings: IS_MAC
      ? [{ meta: true, ctrl: true, key: "ArrowLeft" }]
      : [{ ctrl: true, alt: true, key: "ArrowLeft" }],
  },
  {
    id: "pane.focusRight",
    label: "Focus pane to the right",
    group: "Panes",
    defaultBindings: IS_MAC
      ? [{ meta: true, ctrl: true, key: "ArrowRight" }]
      : [{ ctrl: true, alt: true, key: "ArrowRight" }],
  },
```

- [ ] **Step 3: Type-check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm check-types
```

Expected: errors in `App.tsx` because `pane.focusNext`/`pane.focusPrev` no longer exist in the type. Those will be fixed in Task 3.

- [ ] **Step 4: Commit**

```bash
git add src/modules/shortcuts/shortcuts.ts
git commit -m "feat(shortcuts): replace pane.focusNext/Prev with 4 directional shortcuts"
```

---

## Task 3: Wire handlers in App.tsx

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Add `findPaneInDirection` and `Rect` to the workspaces import**

In `src/app/App.tsx`, the existing workspaces import block (around line 49) currently has:

```typescript
import {
  allPaneIds,
  allPanes,
  findPane,
  panelTitle,
  type Panel,
  type PanelCallbacks,
  useWorkspaces,
  WorkspaceView,
} from "@/modules/workspaces";
```

Replace with:

```typescript
import {
  allPanes,
  findPane,
  findPaneInDirection,
  panelTitle,
  type Panel,
  type PanelCallbacks,
  type Rect,
  useWorkspaces,
  WorkspaceView,
} from "@/modules/workspaces";
```

(Note: `allPaneIds` is no longer needed once the old handlers are removed.)

- [ ] **Step 2: Replace the old focusNext/focusPrev handlers with 4 directional handlers**

In `src/app/App.tsx`, replace:

```typescript
      "pane.focusNext": () => {
        if (!activeWorkspace) return;
        const ids = allPaneIds(activeWorkspace.paneTree);
        const idx = ids.indexOf(activeWorkspace.activePaneId);
        const next = ids[(idx + 1) % ids.length];
        if (next) focusPane(activeWorkspace.id, next);
      },
      "pane.focusPrev": () => {
        if (!activeWorkspace) return;
        const ids = allPaneIds(activeWorkspace.paneTree);
        const idx = ids.indexOf(activeWorkspace.activePaneId);
        const prev = ids[(idx - 1 + ids.length) % ids.length];
        if (prev) focusPane(activeWorkspace.id, prev);
      },
```

with:

```typescript
      "pane.focusUp": () => focusPaneInDirection("up"),
      "pane.focusDown": () => focusPaneInDirection("down"),
      "pane.focusLeft": () => focusPaneInDirection("left"),
      "pane.focusRight": () => focusPaneInDirection("right"),
```

- [ ] **Step 3: Add the `focusPaneInDirection` helper**

This helper must be defined as a local function in the same scope as the shortcut handlers (inside the component or just before the `useGlobalShortcuts` call). Add it just before the `useGlobalShortcuts(...)` call:

```typescript
function focusPaneInDirection(dir: "up" | "down" | "left" | "right") {
  if (!activeWorkspace) return;
  const paneIds = new Set(allPanes(activeWorkspace.paneTree).map((p) => p.id));
  const rects = new Map<string, Rect>();
  for (const el of document.querySelectorAll<HTMLElement>("[data-pane-id]")) {
    const id = el.dataset.paneId;
    if (id && paneIds.has(id)) rects.set(id, el.getBoundingClientRect());
  }
  const target = findPaneInDirection(activeWorkspace.activePaneId, dir, rects);
  if (target) focusPane(activeWorkspace.id, target);
}
```

- [ ] **Step 4: Run type-check and tests**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm check-types && pnpm lint && pnpm test
```

Expected: all green. If `allPaneIds` is now unused elsewhere, the lint step will catch it — remove it from the import if so.

- [ ] **Step 5: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(shortcuts): wire directional pane focus handlers"
```

---

## Task 4: Final quality check

- [ ] **Step 1: Run all checks**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm lint && pnpm check-types && pnpm test
```

Expected: all green, no warnings.

- [ ] **Step 2: Run Rust checks (no Rust was touched, but verify nothing broke)**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai/src-tauri && cargo clippy && cargo test --locked
```

Expected: all green.
