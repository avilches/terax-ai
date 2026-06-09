# Phase 2 — Workspace + Pane Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat Tab model with `Workspace → SplitNode → Panel`, adding per-pane tab bars where any content type can be a tab inside a pane.

**Architecture:** Clean replacement — `useTabs` is deleted, `useWorkspaces` replaces it. PTY session keys migrate from `leafId: number` to `panelId: string`. New `src/modules/workspaces/` module owns all workspace/pane/panel logic and rendering. App.tsx is rewired to `useWorkspaces`. Old files (tabs module, panes.ts, TerminalStack, WorkspaceSurface) are deleted after all consumers are migrated.

**Tech Stack:** React 19, TypeScript, `react-resizable-panels` (already installed), `tauri-plugin-store` for persistence, vitest for unit tests.

---

## File map

| Action | Path |
|---|---|
| Create | `src/modules/workspaces/lib/types.ts` |
| Create | `src/modules/workspaces/lib/splitNode.ts` |
| Create | `src/modules/workspaces/lib/splitNode.test.ts` |
| Create | `src/modules/workspaces/lib/panelTitle.ts` |
| Create | `src/modules/workspaces/lib/useWorkspaces.ts` |
| Create | `src/modules/workspaces/index.ts` |
| Create | `src/modules/workspaces/WorkspaceView.tsx` |
| Create | `src/modules/workspaces/SplitNodeView.tsx` |
| Create | `src/modules/workspaces/PaneView.tsx` |
| Create | `src/modules/workspaces/PaneTabBar.tsx` |
| Create | `src/modules/workspaces/PanelContent.tsx` |
| Modify | `src/modules/terminal/lib/rendererPool.ts` |
| Modify | `src/modules/terminal/lib/useTerminalSession.ts` |
| Modify | `src/modules/terminal/TerminalPane.tsx` |
| Modify | `src/app/App.tsx` |
| Delete | `src/modules/tabs/` (entire directory) |
| Delete | `src/modules/terminal/lib/panes.ts` |
| Delete | `src/modules/terminal/TerminalStack.tsx` |
| Delete | `src/modules/terminal/PaneTreeView.tsx` |
| Delete | `src/app/components/WorkspaceSurface.tsx` |

---

## Task 1: Define Workspace/SplitNode/Panel types and splitNode tree operations

**Files:**
- Create: `src/modules/workspaces/lib/types.ts`
- Create: `src/modules/workspaces/lib/splitNode.ts`
- Create: `src/modules/workspaces/lib/splitNode.test.ts`
- Create: `src/modules/workspaces/lib/panelTitle.ts`

- [ ] **Step 1: Create `src/modules/workspaces/lib/types.ts`**

```typescript
// src/modules/workspaces/lib/types.ts

export type Panel =
  | { id: string; kind: "terminal";        cwd?: string;  title: string }
  | { id: string; kind: "editor";          path: string;  title: string; dirty: boolean; preview: boolean }
  | { id: string; kind: "preview";         url: string;   title: string }
  | { id: string; kind: "markdown";        path: string;  title: string }
  | { id: string; kind: "git-diff";        path: string;  repoRoot: string; mode: "-" | "+"; originalPath: string | null; title: string }
  | { id: string; kind: "git-history";     repoRoot: string; title: string }
  | { id: string; kind: "git-commit-file"; repoRoot: string; sha: string; path: string; originalPath: string | null; title: string };

export type PaneNode = {
  kind: "pane";
  id: string;
  panels: Panel[];
  activePanelId: string | null;
};

export type SplitNode =
  | PaneNode
  | {
      kind: "split";
      id: string;
      orientation: "horizontal" | "vertical";
      first: SplitNode;
      second: SplitNode;
      /** 0.0–1.0: fraction of space given to `first`. Persisted. */
      dividerPosition: number;
    };

export type Workspace = {
  id: string;
  title: string;
  cwd?: string;
  paneTree: SplitNode;
  activePaneId: string;
};
```

- [ ] **Step 2: Create `src/modules/workspaces/lib/splitNode.ts`**

```typescript
// src/modules/workspaces/lib/splitNode.ts
import type { Panel, PaneNode, SplitNode } from "./types";

// ── Queries ────────────────────────────────────────────────────────────────

export function allPanes(tree: SplitNode): PaneNode[] {
  if (tree.kind === "pane") return [tree];
  return [...allPanes(tree.first), ...allPanes(tree.second)];
}

export function allPaneIds(tree: SplitNode): string[] {
  return allPanes(tree).map((p) => p.id);
}

export function findPane(tree: SplitNode, paneId: string): PaneNode | null {
  if (tree.kind === "pane") return tree.id === paneId ? tree : null;
  return findPane(tree.first, paneId) ?? findPane(tree.second, paneId);
}

export function findPanelPane(
  tree: SplitNode,
  panelId: string,
): { pane: PaneNode; panel: Panel } | null {
  if (tree.kind === "pane") {
    const panel = tree.panels.find((p) => p.id === panelId);
    return panel ? { pane: tree, panel } : null;
  }
  return findPanelPane(tree.first, panelId) ?? findPanelPane(tree.second, panelId);
}

export function firstPaneId(tree: SplitNode): string {
  if (tree.kind === "pane") return tree.id;
  return firstPaneId(tree.first);
}

// Closest sibling pane of `paneId` — prefer second, fall back to first.
// Returns null when the pane is the only one in the tree.
export function siblingPane(tree: SplitNode, paneId: string): PaneNode | null {
  if (tree.kind === "pane") return null;
  if (tree.first.kind === "pane" && tree.first.id === paneId)
    return allPanes(tree.second)[0] ?? null;
  if (tree.second.kind === "pane" && tree.second.id === paneId)
    return allPanes(tree.first).at(-1) ?? null;
  return (
    siblingPane(tree.first, paneId) ?? siblingPane(tree.second, paneId)
  );
}

// ── Mutations (all return new tree — immutable) ────────────────────────────

/** Replace a pane with a split containing the original + an empty new pane. */
export function splitPaneInTree(
  tree: SplitNode,
  targetPaneId: string,
  newSplitId: string,
  newPaneId: string,
  orientation: "horizontal" | "vertical",
): SplitNode {
  if (tree.kind === "pane") {
    if (tree.id !== targetPaneId) return tree;
    const newPane: PaneNode = { kind: "pane", id: newPaneId, panels: [], activePanelId: null };
    return {
      kind: "split",
      id: newSplitId,
      orientation,
      first: tree,
      second: newPane,
      dividerPosition: 0.5,
    };
  }
  const first = splitPaneInTree(tree.first, targetPaneId, newSplitId, newPaneId, orientation);
  const second = splitPaneInTree(tree.second, targetPaneId, newSplitId, newPaneId, orientation);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}

/** Remove a pane. Collapses single-child splits. Returns null if tree is now empty. */
export function removePaneFromTree(
  tree: SplitNode,
  paneId: string,
): SplitNode | null {
  if (tree.kind === "pane") return tree.id === paneId ? null : tree;
  const first = removePaneFromTree(tree.first, paneId);
  const second = removePaneFromTree(tree.second, paneId);
  if (first === null && second === null) return null;
  if (first === null) return second;
  if (second === null) return first;
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}

/** Update a pane in-place. Returns the same tree reference if pane not found. */
export function updatePane(
  tree: SplitNode,
  paneId: string,
  updater: (p: PaneNode) => PaneNode,
): SplitNode {
  if (tree.kind === "pane") {
    if (tree.id !== paneId) return tree;
    const next = updater(tree);
    return next === tree ? tree : next;
  }
  const first = updatePane(tree.first, paneId, updater);
  const second = updatePane(tree.second, paneId, updater);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}

/** Update divider position for a specific split node. */
export function updateDivider(
  tree: SplitNode,
  splitId: string,
  position: number,
): SplitNode {
  if (tree.kind === "pane") return tree;
  if (tree.id === splitId) return { ...tree, dividerPosition: Math.min(0.9, Math.max(0.1, position)) };
  const first = updateDivider(tree.first, splitId, position);
  const second = updateDivider(tree.second, splitId, position);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}
```

- [ ] **Step 3: Create `src/modules/workspaces/lib/splitNode.test.ts`**

```typescript
// src/modules/workspaces/lib/splitNode.test.ts
import { describe, expect, test } from "vitest";
import {
  allPaneIds,
  findPane,
  findPanelPane,
  firstPaneId,
  removePaneFromTree,
  siblingPane,
  splitPaneInTree,
  updatePane,
} from "./splitNode";
import type { PaneNode, SplitNode } from "./types";

function makePane(id: string): PaneNode {
  return { kind: "pane", id, panels: [], activePanelId: null };
}

describe("splitPaneInTree", () => {
  test("wraps single pane in a split", () => {
    const tree = makePane("p1");
    const result = splitPaneInTree(tree, "p1", "s1", "p2", "horizontal");
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      expect(result.orientation).toBe("horizontal");
      expect(result.first).toEqual(tree);
      expect(result.second).toEqual(makePane("p2"));
      expect(result.dividerPosition).toBe(0.5);
    }
  });

  test("returns same tree if target pane not found", () => {
    const tree = makePane("p1");
    const result = splitPaneInTree(tree, "unknown", "s1", "p2", "horizontal");
    expect(result).toBe(tree);
  });

  test("splits a nested pane correctly", () => {
    const p1 = makePane("p1");
    const p2 = makePane("p2");
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: p1, second: p2, dividerPosition: 0.5 };
    const result = splitPaneInTree(tree, "p2", "s1", "p3", "vertical");
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      expect(result.first).toBe(p1);
      expect(result.second.kind).toBe("split");
    }
  });
});

describe("removePaneFromTree", () => {
  test("returns null for single-pane tree", () => {
    expect(removePaneFromTree(makePane("p1"), "p1")).toBeNull();
  });

  test("collapses split when one child removed", () => {
    const p1 = makePane("p1");
    const p2 = makePane("p2");
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: p1, second: p2, dividerPosition: 0.5 };
    const result = removePaneFromTree(tree, "p1");
    expect(result).toEqual(p2);
  });

  test("returns same tree if pane not found", () => {
    const tree = makePane("p1");
    expect(removePaneFromTree(tree, "unknown")).toBe(tree);
  });
});

describe("findPane", () => {
  test("finds pane in flat tree", () => {
    const p = makePane("p1");
    expect(findPane(p, "p1")).toBe(p);
  });

  test("returns null for unknown id", () => {
    expect(findPane(makePane("p1"), "unknown")).toBeNull();
  });
});

describe("findPanelPane", () => {
  test("finds panel in a pane", () => {
    const panel = { id: "panel1", kind: "terminal" as const, title: "shell" };
    const pane: PaneNode = { kind: "pane", id: "p1", panels: [panel], activePanelId: "panel1" };
    const result = findPanelPane(pane, "panel1");
    expect(result?.panel).toBe(panel);
    expect(result?.pane).toBe(pane);
  });

  test("returns null for unknown panel id", () => {
    expect(findPanelPane(makePane("p1"), "unknown")).toBeNull();
  });
});

describe("siblingPane", () => {
  test("returns sibling pane", () => {
    const p1 = makePane("p1");
    const p2 = makePane("p2");
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: p1, second: p2, dividerPosition: 0.5 };
    expect(siblingPane(tree, "p1")?.id).toBe("p2");
    expect(siblingPane(tree, "p2")?.id).toBe("p1");
  });

  test("returns null for single pane tree", () => {
    expect(siblingPane(makePane("p1"), "p1")).toBeNull();
  });
});

describe("allPaneIds", () => {
  test("returns all pane ids in a split tree", () => {
    const p1 = makePane("p1");
    const p2 = makePane("p2");
    const p3 = makePane("p3");
    const inner: SplitNode = { kind: "split", id: "s1", orientation: "vertical", first: p2, second: p3, dividerPosition: 0.5 };
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: p1, second: inner, dividerPosition: 0.5 };
    expect(allPaneIds(tree).sort()).toEqual(["p1", "p2", "p3"]);
  });
});

describe("updatePane", () => {
  test("updates target pane", () => {
    const panel = { id: "panel1", kind: "terminal" as const, title: "shell" };
    const pane: PaneNode = { kind: "pane", id: "p1", panels: [], activePanelId: null };
    const result = updatePane(pane, "p1", (p) => ({ ...p, panels: [panel] }));
    if (result.kind === "pane") {
      expect(result.panels).toEqual([panel]);
    }
  });

  test("returns same reference if pane not found", () => {
    const tree = makePane("p1");
    expect(updatePane(tree, "unknown", (p) => p)).toBe(tree);
  });
});
```

- [ ] **Step 4: Create `src/modules/workspaces/lib/panelTitle.ts`**

```typescript
// src/modules/workspaces/lib/panelTitle.ts
import type { Panel } from "./types";

function basename(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

export function panelTitle(panel: Panel): string {
  if (panel.title) return panel.title;
  switch (panel.kind) {
    case "terminal":   return panel.cwd ? basename(panel.cwd) : "shell";
    case "editor":     return basename(panel.path);
    case "preview":    return panel.url || "Preview";
    case "markdown":   return basename(panel.path);
    case "git-diff":   return basename(panel.path);
    case "git-history": return "Git History";
    case "git-commit-file": return basename(panel.path);
  }
}

export function panelIcon(panel: Panel): string {
  switch (panel.kind) {
    case "terminal":        return "▶";
    case "editor":          return "📄";
    case "preview":         return "🌐";
    case "markdown":        return "📝";
    case "git-diff":        return "±";
    case "git-history":     return "⏱";
    case "git-commit-file": return "±";
  }
}
```

- [ ] **Step 5: Run tests**

```bash
pnpm test 2>&1 | tail -8
```

Expected: all pass including the new splitNode tests.

- [ ] **Step 6: Type check**

```bash
pnpm check-types 2>&1 | head -5
```

Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/modules/workspaces/
git commit -m "feat: add Workspace/SplitNode/Panel types and splitNode tree operations"
```

---

## Task 2: `useWorkspaces` hook

**Files:**
- Create: `src/modules/workspaces/lib/useWorkspaces.ts`
- Create: `src/modules/workspaces/index.ts`

- [ ] **Step 1: Create `src/modules/workspaces/lib/useWorkspaces.ts`**

```typescript
// src/modules/workspaces/lib/useWorkspaces.ts
import { useCallback, useEffect, useRef, useState } from "react";
import {
  allPaneIds,
  findPane,
  findPanelPane,
  firstPaneId,
  removePaneFromTree,
  siblingPane,
  splitPaneInTree,
  updateDivider,
  updatePane,
} from "./splitNode";
import type { Panel, PaneNode, SplitNode, Workspace } from "./types";

function newPaneNode(cwd?: string): PaneNode {
  const panelId = crypto.randomUUID();
  return {
    kind: "pane",
    id: crypto.randomUUID(),
    panels: [{ id: panelId, kind: "terminal", cwd, title: "shell" }],
    activePanelId: panelId,
  };
}

function newWorkspace(cwd?: string): Workspace {
  const pane = newPaneNode(cwd);
  return {
    id: crypto.randomUUID(),
    title: cwd ? cwd.split(/[\\/]/).filter(Boolean).at(-1) ?? "shell" : "shell",
    cwd,
    paneTree: pane,
    activePaneId: pane.id,
  };
}

export function useWorkspaces(initial?: { cwd?: string }) {
  const initialWorkspace = useRef(newWorkspace(initial?.cwd));

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [initialWorkspace.current]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(initialWorkspace.current.id);

  const workspacesRef = useRef(workspaces);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);

  // ── Workspace operations ──────────────────────────────────────────────────

  const addWorkspace = useCallback((cwd?: string): string => {
    const ws = newWorkspace(cwd);
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspaceId(ws.id);
    return ws.id;
  }, []);

  const closeWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      if (prev.length <= 1) return prev; // never close last workspace
      return prev.filter((w) => w.id !== id);
    });
    setActiveWorkspaceId((prev) => {
      if (prev !== id) return prev;
      const remaining = workspacesRef.current.filter((w) => w.id !== id);
      return remaining.at(-1)?.id ?? prev;
    });
  }, []);

  // ── Pane operations ───────────────────────────────────────────────────────

  const splitPane = useCallback((workspaceId: string, paneId: string, orientation: "horizontal" | "vertical"): string => {
    const newPaneId = crypto.randomUUID();
    const newSplitId = crypto.randomUUID();
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          paneTree: splitPaneInTree(w.paneTree, paneId, newSplitId, newPaneId, orientation),
          activePaneId: newPaneId,
        };
      }),
    );
    return newPaneId;
  }, []);

  const closePane = useCallback((workspaceId: string, paneId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const newTree = removePaneFromTree(w.paneTree, paneId);
        if (!newTree) return w; // never remove last pane
        const sibling = siblingPane(w.paneTree, paneId);
        const newActiveId =
          w.activePaneId === paneId
            ? (sibling?.id ?? firstPaneId(newTree))
            : w.activePaneId;
        return { ...w, paneTree: newTree, activePaneId: newActiveId };
      }),
    );
  }, []);

  const focusPane = useCallback((workspaceId: string, paneId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => w.id !== workspaceId ? w : { ...w, activePaneId: paneId }),
    );
  }, []);

  const setPaneDivider = useCallback((workspaceId: string, splitId: string, position: number) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        return { ...w, paneTree: updateDivider(w.paneTree, splitId, position) };
      }),
    );
  }, []);

  // ── Panel operations ──────────────────────────────────────────────────────

  const openPanel = useCallback((workspaceId: string, paneId: string, panel: Panel) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          paneTree: updatePane(w.paneTree, paneId, (p) => ({
            ...p,
            panels: [...p.panels, panel],
            activePanelId: panel.id,
          })),
        };
      }),
    );
  }, []);

  const activatePanel = useCallback((workspaceId: string, panelId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const result = findPanelPane(w.paneTree, panelId);
        if (!result) return w;
        return {
          ...w,
          activePaneId: result.pane.id,
          paneTree: updatePane(w.paneTree, result.pane.id, (p) => ({
            ...p,
            activePanelId: panelId,
          })),
        };
      }),
    );
  }, []);

  const closePanel = useCallback((workspaceId: string, panelId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const result = findPanelPane(w.paneTree, panelId);
        if (!result) return w;
        const { pane } = result;
        const remaining = pane.panels.filter((p) => p.id !== panelId);
        if (remaining.length === 0) {
          // Last panel in pane — close the pane
          const newTree = removePaneFromTree(w.paneTree, pane.id);
          if (!newTree) return w; // never remove last pane of last workspace
          const sibling = siblingPane(w.paneTree, pane.id);
          return {
            ...w,
            paneTree: newTree,
            activePaneId: w.activePaneId === pane.id ? (sibling?.id ?? firstPaneId(newTree)) : w.activePaneId,
          };
        }
        const newActiveId =
          pane.activePanelId === panelId
            ? (remaining.at(-1)?.id ?? null)
            : pane.activePanelId;
        return {
          ...w,
          paneTree: updatePane(w.paneTree, pane.id, (p) => ({
            ...p,
            panels: remaining,
            activePanelId: newActiveId,
          })),
        };
      }),
    );
  }, []);

  const updatePanelData = useCallback((workspaceId: string, panelId: string, updater: (p: Panel) => Panel) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const result = findPanelPane(w.paneTree, panelId);
        if (!result) return w;
        return {
          ...w,
          paneTree: updatePane(w.paneTree, result.pane.id, (p) => ({
            ...p,
            panels: p.panels.map((panel) => panel.id === panelId ? updater(panel) : panel),
          })),
        };
      }),
    );
  }, []);

  const setTerminalPanelCwd = useCallback((workspaceId: string, panelId: string, cwd: string) => {
    updatePanelData(workspaceId, panelId, (p) => p.kind === "terminal" ? { ...p, cwd } : p);
  }, [updatePanelData]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const findPanelGlobal = useCallback((panelId: string) => {
    for (const w of workspacesRef.current) {
      const result = findPanelPane(w.paneTree, panelId);
      if (result) return { workspace: w, ...result };
    }
    return null;
  }, []);

  const findPaneGlobal = useCallback((paneId: string) => {
    for (const w of workspacesRef.current) {
      const pane = findPane(w.paneTree, paneId);
      if (pane) return { workspace: w, pane };
    }
    return null;
  }, []);

  return {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    addWorkspace,
    closeWorkspace,
    splitPane,
    closePane,
    focusPane,
    setPaneDivider,
    openPanel,
    activatePanel,
    closePanel,
    updatePanelData,
    setTerminalPanelCwd,
    findPanelGlobal,
    findPaneGlobal,
    allPaneIds,
  };
}

export type UseWorkspacesReturn = ReturnType<typeof useWorkspaces>;
```

- [ ] **Step 2: Create `src/modules/workspaces/index.ts`**

```typescript
// src/modules/workspaces/index.ts
export type { Panel, PaneNode, SplitNode, Workspace } from "./lib/types";
export { useWorkspaces, type UseWorkspacesReturn } from "./lib/useWorkspaces";
export { panelTitle, panelIcon } from "./lib/panelTitle";
export {
  allPaneIds,
  findPane,
  findPanelPane,
  firstPaneId,
  siblingPane,
  splitPaneInTree,
  removePaneFromTree,
  updatePane,
  updateDivider,
} from "./lib/splitNode";
```

- [ ] **Step 3: Type check**

```bash
pnpm check-types 2>&1 | head -5
```

Expected: no output.

- [ ] **Step 4: Run tests**

```bash
pnpm test 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/lib/useWorkspaces.ts src/modules/workspaces/index.ts
git commit -m "feat: add useWorkspaces hook"
```

---

## Task 3: Migrate PTY session key from `number` to `string`

**Files:**
- Modify: `src/modules/terminal/lib/rendererPool.ts`
- Modify: `src/modules/terminal/lib/useTerminalSession.ts`
- Modify: `src/modules/terminal/TerminalPane.tsx`

The change is mechanical: every `number` used as a leaf/panel ID becomes `string`. The `PtySession.id` (which is a Rust PTY handle number) stays as `number` — do not change it.

- [ ] **Step 1: Update `rendererPool.ts` — change leaf ID type from `number` to `string`**

In `src/modules/terminal/lib/rendererPool.ts`:

1. Change `SlotAdapter` interface:
```typescript
// Before:
export type SlotAdapter = {
  resolveLeaf(leafId: number): LeafBridge | null;
  evictLeaf(leafId: number): void;
  isLeafFocused(leafId: number): boolean;
  isLeafBlocks(leafId: number): boolean;
};

// After:
export type SlotAdapter = {
  resolveLeaf(leafId: string): LeafBridge | null;
  evictLeaf(leafId: string): void;
  isLeafFocused(leafId: string): boolean;
  isLeafBlocks(leafId: string): boolean;
};
```

2. Change `Slot.currentLeafId` type:
```typescript
// Before:
currentLeafId: number | null;

// After:
currentLeafId: string | null;
```

3. Find all exported/public functions that take `leafId: number` and change them to `string`. Run `grep -n "leafId: number" src/modules/terminal/lib/rendererPool.ts` to find them. Change each occurrence.

4. Find `params.leafId` type annotations (in `acquireSlot`, `parkLeafSlot`, `disposeLeafSlot`, `releaseSlot`, etc.) and change their parameter types from `number` to `string`.

- [ ] **Step 2: Update `useTerminalSession.ts` — change all session Map keys from `number` to `string`**

In `src/modules/terminal/lib/useTerminalSession.ts`:

1. Change the module-scoped Maps and Sets:
```typescript
// Before:
const sessions = new Map<number, Session>();
const blockViewportListeners = new Map<number, Set<() => void>>();
const readyLeaves = new Set<number>();
const readyWaiters = new Map<number, { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]>();

// After:
const sessions = new Map<string, Session>();
const blockViewportListeners = new Map<string, Set<() => void>>();
const readyLeaves = new Set<string>();
const readyWaiters = new Map<string, { resolve: () => void; timer: ReturnType<typeof setTimeout> }[]>();
```

2. Change all exported function signatures that accept `leafId: number` to `leafId: string`. Run:
```bash
grep -n "leafId: number\|leafId:number" src/modules/terminal/lib/useTerminalSession.ts
```
and change each one.

3. The `useTerminalSession` hook's parameter `leafId` must change from `number` to `string`. Find the hook's `Props`/parameter type definition and change it.

4. The `SlotAdapter` implementation inside `useTerminalSession` (the object passed to `configureRendererPool`) must match the updated `SlotAdapter` interface — its methods now receive `string` leaf IDs.

- [ ] **Step 3: Update `TerminalPane.tsx` — rename `leafId` to `panelId`, type `string`**

In `src/modules/terminal/TerminalPane.tsx`, replace all occurrences of `leafId` with `panelId` and change the type from `number` to `string`:

```typescript
// Before:
type Props = {
  leafId: number;
  // ...
  onSearchReady?: (leafId: number, addon: SearchAddon) => void;
  onExit?: (leafId: number, code: number) => void;
  onCwd?: (leafId: number, cwd: string) => void;
};

// After:
type Props = {
  panelId: string;
  // ...
  onSearchReady?: (panelId: string, addon: SearchAddon) => void;
  onExit?: (panelId: string, code: number) => void;
  onCwd?: (panelId: string, cwd: string) => void;
};
```

Inside the component body, rename `leafId` to `panelId` throughout and update the `useTerminalSession` call:
```typescript
const session = useTerminalSession({
  leafId: panelId,   // ← pass panelId as the leafId parameter
  // ...
  onSearchReady: (a) => onSearchReady?.(panelId, a),
  onExit: (c) => onExit?.(panelId, c),
  onCwd: (c) => onCwd?.(panelId, c),
});
```

Note: keep the parameter name `leafId` inside `useTerminalSession` for now (the hook still uses it internally) — we're only renaming the external prop.

- [ ] **Step 4: Fix all type errors**

```bash
pnpm check-types 2>&1 | head -30
```

For each error, follow the type chain. Most will be callers of the changed functions that passed `number` — change them to pass `string`. The main callers are in `useTerminalSession.ts` itself and in the now-deleted (later) `TerminalStack.tsx` and `PaneTreeView.tsx` — those errors will disappear when those files are deleted in Task 7. For now, if there are errors in those files, add `// @ts-ignore` temporarily.

- [ ] **Step 5: Run tests**

```bash
pnpm test 2>&1 | tail -8
```

Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/modules/terminal/lib/rendererPool.ts src/modules/terminal/lib/useTerminalSession.ts src/modules/terminal/TerminalPane.tsx
git commit -m "refactor: migrate PTY session key from leafId:number to panelId:string"
```

---

## Task 4: PaneTabBar, PanelContent, PaneView

**Files:**
- Create: `src/modules/workspaces/PaneTabBar.tsx`
- Create: `src/modules/workspaces/PanelContent.tsx`
- Create: `src/modules/workspaces/PaneView.tsx`

- [ ] **Step 1: Create `src/modules/workspaces/PaneTabBar.tsx`**

```typescript
// src/modules/workspaces/PaneTabBar.tsx
import { cn } from "@/lib/utils";
import type { Panel } from "./lib/types";
import { panelIcon, panelTitle } from "./lib/panelTitle";

type Props = {
  panels: Panel[];
  activePanelId: string | null;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  onNewTerminal: () => void;
};

export function PaneTabBar({ panels, activePanelId, onActivate, onClose, onNewTerminal }: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 border-b border-border/60 bg-card/60 px-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {panels.map((p) => {
        const active = p.id === activePanelId;
        return (
          <div
            key={p.id}
            className={cn(
              "group flex h-5 max-w-[140px] min-w-0 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] cursor-pointer select-none transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => onActivate(p.id)}
          >
            <span className="shrink-0 text-[10px] opacity-70">{panelIcon(p)}</span>
            <span className="truncate">{panelTitle(p)}</span>
            {p.kind === "editor" && p.dirty && (
              <span className="shrink-0 text-[8px] text-primary">●</span>
            )}
            <button
              type="button"
              className="ml-0.5 shrink-0 opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
              onClick={(e) => { e.stopPropagation(); onClose(p.id); }}
              title="Close panel"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewTerminal}
        className="ml-1 shrink-0 text-muted-foreground hover:text-foreground text-sm px-1 transition-colors"
        title="New terminal in this pane"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Create `src/modules/workspaces/PanelContent.tsx`**

Read what props `EditorPane`, `PreviewPane`, `GitHistoryPane`, `GitDiffPane` etc. actually accept in their current modules. Then write `PanelContent` to forward the right props to each:

```typescript
// src/modules/workspaces/PanelContent.tsx
import { cn } from "@/lib/utils";
import { EditorPane } from "@/modules/editor";
import { TerminalPane, type TerminalPaneHandle } from "@/modules/terminal";
// ... other panel imports
import type { Panel } from "./lib/types";
import type { SearchAddon } from "@xterm/addon-search";

// Callbacks forwarded from App.tsx through WorkspaceView → SplitNodeView → PaneView → PanelContent
export type PanelCallbacks = {
  // Terminal
  onTerminalSearchReady?: (panelId: string, addon: SearchAddon) => void;
  onTerminalExit?: (panelId: string, code: number) => void;
  onTerminalCwd?: (panelId: string, cwd: string) => void;
  registerTerminalHandle?: (panelId: string, h: TerminalPaneHandle | null) => void;
  // Editor
  onOpenFile?: (path: string, preview?: boolean) => void;
  onEditorDirtyChange?: (panelId: string, dirty: boolean) => void;
  onEditorClose?: (panelId: string) => void;
  // Preview
  onPreviewUrlChange?: (panelId: string, url: string) => void;
  // Git
  onOpenCommitFile?: (params: { repoRoot: string; sha: string; path: string; originalPath: string | null; title?: string }) => void;
  onGitHistorySearchHandle?: (h: import("@/modules/git-history").GitHistorySearchHandle | null) => void;
};

type Props = {
  panel: Panel;
  visible: boolean;
  focused: boolean;
  callbacks: PanelCallbacks;
};

export function PanelContent({ panel, visible, focused, callbacks }: Props) {
  switch (panel.kind) {
    case "terminal":
      return (
        <TerminalPane
          ref={(h) => callbacks.registerTerminalHandle?.(panel.id, h)}
          panelId={panel.id}
          visible={visible}
          focused={focused}
          initialCwd={panel.cwd}
          onSearchReady={callbacks.onTerminalSearchReady}
          onExit={callbacks.onTerminalExit}
          onCwd={callbacks.onTerminalCwd}
        />
      );
    case "editor":
      return (
        <EditorPane
          path={panel.path}
          visible={visible}
          onDirtyChange={(dirty) => callbacks.onEditorDirtyChange?.(panel.id, dirty)}
          onCloseTab={() => callbacks.onEditorClose?.(panel.id)}
        />
      );
    // Add remaining panel kinds: preview, markdown, git-diff, git-history, git-commit-file
    // by reading the actual prop interfaces of each component
    default:
      return (
        <div className="flex h-full items-center justify-center text-muted-foreground text-sm">
          {(panel as Panel).kind}
        </div>
      );
  }
}
```

**After creating the file, read the actual prop interfaces of `EditorPane`, `PreviewPane`, etc. and complete the switch arms.** Use `grep -n "type Props\|Props = {" src/modules/editor/EditorPane.tsx` and similar to find the actual prop types.

- [ ] **Step 3: Create `src/modules/workspaces/PaneView.tsx`**

```typescript
// src/modules/workspaces/PaneView.tsx
import { useCallback } from "react";
import type { PaneNode } from "./lib/types";
import { PaneTabBar } from "./PaneTabBar";
import { PanelContent, type PanelCallbacks } from "./PanelContent";
import { cn } from "@/lib/utils";

type Props = {
  pane: PaneNode;
  workspaceId: string;
  workspaceCwd?: string;
  focused: boolean;                             // this pane has workspace focus
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  callbacks: PanelCallbacks;
};

export function PaneView({
  pane,
  workspaceId,
  workspaceCwd,
  focused,
  onActivatePanel,
  onClosePanel,
  onFocusPane,
  onNewTerminal,
  callbacks,
}: Props) {
  const handleFocus = useCallback(() => {
    if (!focused) onFocusPane(workspaceId, pane.id);
  }, [focused, workspaceId, pane.id, onFocusPane]);

  return (
    <div
      className="flex h-full flex-col"
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
    >
      <PaneTabBar
        panels={pane.panels}
        activePanelId={pane.activePanelId}
        onActivate={(panelId) => onActivatePanel(workspaceId, panelId)}
        onClose={(panelId) => onClosePanel(workspaceId, panelId)}
        onNewTerminal={() => onNewTerminal(workspaceId, pane.id)}
      />
      <div className="relative min-h-0 flex-1">
        {pane.panels.map((panel) => (
          <div
            key={panel.id}
            className={cn(
              "absolute inset-0",
              panel.id !== pane.activePanelId && "invisible pointer-events-none",
            )}
          >
            <PanelContent
              panel={panel}
              visible={panel.id === pane.activePanelId}
              focused={focused && panel.id === pane.activePanelId}
              callbacks={callbacks}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Type check**

```bash
pnpm check-types 2>&1 | head -20
```

Fix any prop type mismatches by reading the actual component prop types. The most likely issues are in `PanelContent.tsx` where you need to match the exact prop names of `EditorPane`, `PreviewPane`, etc.

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/PaneTabBar.tsx src/modules/workspaces/PanelContent.tsx src/modules/workspaces/PaneView.tsx
git commit -m "feat: add PaneTabBar, PanelContent, PaneView components"
```

---

## Task 5: SplitNodeView and WorkspaceView

**Files:**
- Create: `src/modules/workspaces/SplitNodeView.tsx`
- Create: `src/modules/workspaces/WorkspaceView.tsx`

- [ ] **Step 1: Create `src/modules/workspaces/SplitNodeView.tsx`**

```typescript
// src/modules/workspaces/SplitNodeView.tsx
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { useCallback } from "react";
import type { SplitNode } from "./lib/types";
import { PaneView } from "./PaneView";
import type { PanelCallbacks } from "./PanelContent";

type Props = {
  node: SplitNode;
  workspaceId: string;
  workspaceCwd?: string;
  activePaneId: string;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  onDividerChange?: (workspaceId: string, splitId: string, position: number) => void;
  callbacks: PanelCallbacks;
};

export function SplitNodeView({ node, activePaneId, ...rest }: Props) {
  if (node.kind === "pane") {
    return (
      <PaneView
        pane={node}
        workspaceId={rest.workspaceId}
        workspaceCwd={rest.workspaceCwd}
        focused={node.id === activePaneId}
        onActivatePanel={rest.onActivatePanel}
        onClosePanel={rest.onClosePanel}
        onFocusPane={rest.onFocusPane}
        onNewTerminal={rest.onNewTerminal}
        callbacks={rest.callbacks}
      />
    );
  }

  // NOTE: verify the exact prop name and callback signature for ResizablePanelGroup
  // in the project's react-resizable-panels version by checking src/components/ui/resizable.tsx.
  // In v4.x the prop may be `onLayout` receiving an array of sizes in percentages.
  const handleResize = useCallback(
    (sizes: number[]) => {
      // sizes[0] is the percentage (0-100) of the first panel
      if (sizes[0] !== undefined) {
        rest.onDividerChange?.(rest.workspaceId, node.id, sizes[0] / 100);
      }
    },
    [node.id, rest.workspaceId, rest.onDividerChange],
  );

  return (
    <ResizablePanelGroup
      orientation={node.orientation === "horizontal" ? "horizontal" : "vertical"}
      className="h-full w-full"
      onLayout={handleResize}
    >
      <ResizablePanel
        id={`split-${node.id}-first`}
        defaultSize={`${node.dividerPosition * 100}%`}
        minSize="10%"
      >
        <SplitNodeView node={node.first} activePaneId={activePaneId} {...rest} />
      </ResizablePanel>
      <ResizableHandle withHandle />
      <ResizablePanel
        id={`split-${node.id}-second`}
        defaultSize={`${(1 - node.dividerPosition) * 100}%`}
        minSize="10%"
      >
        <SplitNodeView node={node.second} activePaneId={activePaneId} {...rest} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
```

- [ ] **Step 2: Create `src/modules/workspaces/WorkspaceView.tsx`**

```typescript
// src/modules/workspaces/WorkspaceView.tsx
import { cn } from "@/lib/utils";
import type { Workspace } from "./lib/types";
import { SplitNodeView } from "./SplitNodeView";
import type { PanelCallbacks } from "./PanelContent";

type Props = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  onDividerChange?: (workspaceId: string, splitId: string, position: number) => void;
  callbacks: PanelCallbacks;
};

export function WorkspaceView({
  workspaces,
  activeWorkspaceId,
  ...rest
}: Props) {
  return (
    <div className="relative h-full w-full">
      {workspaces.map((ws) => (
        <div
          key={ws.id}
          className={cn(
            "absolute inset-0",
            ws.id !== activeWorkspaceId && "invisible pointer-events-none",
          )}
        >
          <SplitNodeView
            node={ws.paneTree}
            workspaceId={ws.id}
            workspaceCwd={ws.cwd}
            activePaneId={ws.activePaneId}
            onActivatePanel={rest.onActivatePanel}
            onClosePanel={rest.onClosePanel}
            onFocusPane={rest.onFocusPane}
            onNewTerminal={rest.onNewTerminal}
            onDividerChange={rest.onDividerChange}
            callbacks={rest.callbacks}
          />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Export from index.ts**

Add to `src/modules/workspaces/index.ts`:

```typescript
export { WorkspaceView } from "./WorkspaceView";
export { SplitNodeView } from "./SplitNodeView";
export { PaneView } from "./PaneView";
export { PaneTabBar } from "./PaneTabBar";
export { PanelContent, type PanelCallbacks } from "./PanelContent";
```

- [ ] **Step 4: Type check**

```bash
pnpm check-types 2>&1 | head -10
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/SplitNodeView.tsx src/modules/workspaces/WorkspaceView.tsx src/modules/workspaces/index.ts
git commit -m "feat: add SplitNodeView and WorkspaceView rendering components"
```

---

## Task 6: App.tsx migration — replace useTabs with useWorkspaces

This is the largest task. The goal: `App.tsx` uses `useWorkspaces` instead of `useTabs`, renders `WorkspaceView` instead of `WorkspaceSurface`, and all callbacks are rewired.

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Read the full current App.tsx**

```bash
wc -l /Users/avilches/Work/Proy/Repos/terax-ai/src/app/App.tsx
cat /Users/avilches/Work/Proy/Repos/terax-ai/src/app/App.tsx
```

Understand the complete current structure before making any changes.

- [ ] **Step 2: Replace the `useTabs` import with `useWorkspaces`**

```typescript
// Remove:
import { useTabs, useWindowTitle, useWorkspaceCwd } from "@/modules/tabs";

// Add:
import { useWorkspaces, type Workspace, type Panel } from "@/modules/workspaces";
import { WorkspaceView, type PanelCallbacks } from "@/modules/workspaces";
import { useWindowTitle } from "@/modules/tabs"; // keep if still needed, or move logic inline
```

- [ ] **Step 3: Replace `useTabs()` call with `useWorkspaces()`**

```typescript
// Remove the useTabs destructuring and replace with:
const {
  workspaces,
  activeWorkspaceId,
  setActiveWorkspaceId,
  activeWorkspace,
  addWorkspace,
  closeWorkspace,
  splitPane,
  closePane,
  focusPane,
  setPaneDivider,
  openPanel,
  activatePanel,
  closePanel,
  updatePanelData,
  setTerminalPanelCwd,
  findPanelGlobal,
  findPaneGlobal,
} = useWorkspaces({ cwd: launchCwd ?? undefined });
```

- [ ] **Step 4: Update `WorkspaceSidebar` call**

```tsx
// WorkspaceSidebar receives workspaces instead of tabs:
<WorkspaceSidebar
  workspaces={workspaces.map((w) => ({ id: w.id, title: w.title, kind: "terminal" as const }))}
  activeId={activeWorkspaceId}
  onSelect={setActiveWorkspaceId}
  onNew={() => addWorkspace(activeCwd ?? undefined)}
/>
```

- [ ] **Step 5: Wire PanelCallbacks and replace WorkspaceSurface with WorkspaceView**

Build the `callbacks` object that `WorkspaceView` needs:

```typescript
const terminalHandles = useRef(new Map<string, import("@/modules/terminal").TerminalPaneHandle>());
// (same pattern as current terminalRefs, but keyed by panelId string)

const panelCallbacks: PanelCallbacks = useMemo(() => ({
  registerTerminalHandle: (panelId, h) => {
    if (h) terminalHandles.current.set(panelId, h);
    else terminalHandles.current.delete(panelId);
  },
  onTerminalSearchReady: (panelId, addon) => {
    // store search addon for inline search
    searchAddons.current.set(panelId, addon);
  },
  onTerminalExit: (panelId, _code) => {
    // Find which workspace/pane this panel is in and close it
    const found = findPanelGlobal(panelId);
    if (found) closePanel(found.workspace.id, panelId);
  },
  onTerminalCwd: (panelId, cwd) => {
    const found = findPanelGlobal(panelId);
    if (found) {
      setTerminalPanelCwd(found.workspace.id, panelId, cwd);
      // Authorize the cwd for git operations
      if (!authorizedCwds.current.has(cwd)) {
        authorizedCwds.current.add(cwd);
        native.workspaceAuthorize(cwd).catch(() => authorizedCwds.current.delete(cwd));
      }
    }
  },
  onEditorDirtyChange: (panelId, dirty) => {
    const found = findPanelGlobal(panelId);
    if (found) updatePanelData(found.workspace.id, panelId, (p) => p.kind === "editor" ? { ...p, dirty } : p);
  },
  onEditorClose: (panelId) => {
    const found = findPanelGlobal(panelId);
    if (found) closePanel(found.workspace.id, panelId);
  },
  // ... other callbacks
}), [findPanelGlobal, closePanel, setTerminalPanelCwd, updatePanelData]);
```

Replace `<WorkspaceSurface ... />` with:
```tsx
<WorkspaceView
  workspaces={workspaces}
  activeWorkspaceId={activeWorkspaceId}
  onActivatePanel={(wsId, panelId) => activatePanel(wsId, panelId)}
  onClosePanel={(wsId, panelId) => closePanel(wsId, panelId)}
  onFocusPane={(wsId, paneId) => focusPane(wsId, paneId)}
  onNewTerminal={(wsId, paneId) => {
    const panelId = crypto.randomUUID();
    const ws = workspaces.find((w) => w.id === wsId);
    openPanel(wsId, paneId, { id: panelId, kind: "terminal", cwd: ws?.cwd, title: "shell" });
  }}
  onDividerChange={(wsId, splitId, pos) => setPaneDivider(wsId, splitId, pos)}
  callbacks={panelCallbacks}
/>
```

- [ ] **Step 6: Update shortcuts for workspace operations**

```typescript
// Split pane shortcuts: find active workspace's active pane and split it
"pane.splitRight": () => {
  if (activeWorkspace) {
    splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "horizontal");
  }
},
"pane.splitDown": () => {
  if (activeWorkspace) {
    splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "vertical");
  }
},
"tab.close": () => {
  if (!activeWorkspace) return;
  const pane = findPane(activeWorkspace.paneTree, activeWorkspace.activePaneId);
  if (!pane) return;
  if (pane.activePanelId) {
    // Close the active panel (closePanel handles pane removal if last panel)
    closePanel(activeWorkspace.id, pane.activePanelId);
  } else if (pane.panels.length === 0) {
    // Empty pane — close it directly
    closePane(activeWorkspace.id, pane.id);
  }
},
"workspace.prev": () => {
  const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
  if (idx > 0) setActiveWorkspaceId(workspaces[idx - 1].id);
  else if (workspaces.length > 0) setActiveWorkspaceId(workspaces.at(-1)!.id);
},
"workspace.next": () => {
  const idx = workspaces.findIndex((w) => w.id === activeWorkspaceId);
  if (idx < workspaces.length - 1) setActiveWorkspaceId(workspaces[idx + 1].id);
  else if (workspaces.length > 0) setActiveWorkspaceId(workspaces[0].id);
},
```

- [ ] **Step 7: Remove all broken references to old tab system**

After replacing the main render, there will be many references to `tabs`, `activeId`, `tab.kind`, `activeTab`, etc. Replace them with workspace equivalents:

- `tabs` → `workspaces`
- `activeId` → `activeWorkspaceId`
- `setActiveId` → `setActiveWorkspaceId`
- `activeTab` → `activeWorkspace`
- `activeTab?.kind === "terminal"` → check via `activeWorkspace?.paneTree`
- `activeLeafId` → derive from active pane's `activePanelId`

The `useWindowTitle`, `useWorkspaceCwd`, `isBlockTab`, `isTerminalTab` etc. need to be re-derived from the workspace structure.

- [ ] **Step 8: Fix all TypeScript errors iteratively**

```bash
pnpm check-types 2>&1 | head -30
```

Work through each error. This step will require multiple iterations. Do not use `@ts-ignore` except for references to files being deleted in Task 7.

- [ ] **Step 9: Run tests**

```bash
pnpm test 2>&1 | tail -8
```

Expected: all pass (the test suite doesn't test App.tsx directly).

- [ ] **Step 10: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat: migrate App.tsx from useTabs to useWorkspaces"
```

---

## Task 7: Delete old files

With `App.tsx` migrated, the old files have no consumers. Delete them.

**Files to delete:**
- `src/modules/tabs/` (entire directory: `useTabs.ts`, `useTabs.test.ts`, `TabBar.tsx`, `index.ts`, `lib/tabLabel.ts`)
- `src/modules/terminal/lib/panes.ts`
- `src/modules/terminal/PaneTreeView.tsx`
- `src/modules/terminal/TerminalStack.tsx`
- `src/app/components/WorkspaceSurface.tsx`
- Optionally: `src/modules/editor/EditorStack.tsx`, `src/modules/preview/PreviewStack.tsx`, `src/modules/markdown/MarkdownStack.tsx` if they're no longer used

- [ ] **Step 1: Delete the files**

```bash
rm -rf /Users/avilches/Work/Proy/Repos/terax-ai/src/modules/tabs/
rm /Users/avilches/Work/Proy/Repos/terax-ai/src/modules/terminal/lib/panes.ts
rm /Users/avilches/Work/Proy/Repos/terax-ai/src/modules/terminal/PaneTreeView.tsx
rm /Users/avilches/Work/Proy/Repos/terax-ai/src/modules/terminal/TerminalStack.tsx
rm /Users/avilches/Work/Proy/Repos/terax-ai/src/app/components/WorkspaceSurface.tsx
```

Check and delete the Stack components if they have no remaining consumers:
```bash
grep -r "EditorStack\|PreviewStack\|MarkdownStack" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

- [ ] **Step 2: Fix any new type errors**

```bash
pnpm check-types 2>&1 | head -20
```

Fix remaining import errors. Update `src/modules/terminal/index.ts` to remove exports of deleted files.

- [ ] **Step 3: Run tests**

```bash
pnpm test 2>&1 | tail -8
```

Expected: all pass. The `useTabs.test.ts` is gone; its coverage is replaced by `splitNode.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete useTabs, panes.ts, TerminalStack, WorkspaceSurface"
```

---

## Task 8: Workspace persistence

Add save/restore to `useWorkspaces` so layout survives restarts.

**Files:**
- Modify: `src/modules/workspaces/lib/useWorkspaces.ts`

- [ ] **Step 1: Add persistence to `useWorkspaces`**

Add to the top of the hook, after the initial state declarations:

```typescript
// Persistence: save on every change, debounced 300ms
const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
useEffect(() => {
  if (saveTimer.current) clearTimeout(saveTimer.current);
  saveTimer.current = setTimeout(async () => {
    try {
      const { LazyStore } = await import("@tauri-apps/plugin-store");
      const store = new LazyStore("terax-workspaces.json", { autoSave: false });
      await store.set("workspaces", JSON.stringify(workspaces));
      await store.set("activeWorkspaceId", activeWorkspaceId);
      await store.save();
    } catch {
      // Persistence failure is non-fatal
    }
  }, 300);
  return () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
  };
}, [workspaces, activeWorkspaceId]);
```

- [ ] **Step 2: Restore on mount**

Add a `useEffect` that runs once on mount to load saved state:

```typescript
useEffect(() => {
  let cancelled = false;
  (async () => {
    try {
      const { LazyStore } = await import("@tauri-apps/plugin-store");
      const store = new LazyStore("terax-workspaces.json", { autoSave: false });
      const raw = await store.get<string>("workspaces");
      const savedActiveId = await store.get<string>("activeWorkspaceId");
      if (!raw || cancelled) return;
      const saved: Workspace[] = JSON.parse(raw);
      if (!Array.isArray(saved) || saved.length === 0) return;
      // Restore: terminal panels get new IDs so fresh PTYs spawn for them
      // Non-terminal panels (editor, preview, etc.) restore as-is
      setWorkspaces(saved);
      if (savedActiveId && saved.some((w) => w.id === savedActiveId)) {
        setActiveWorkspaceId(savedActiveId);
      } else {
        setActiveWorkspaceId(saved[0].id);
      }
    } catch {
      // Restore failure falls back to initial state
    }
  })();
  return () => { cancelled = true; };
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

- [ ] **Step 3: Type check**

```bash
pnpm check-types 2>&1 | head -5
```

Expected: no output.

- [ ] **Step 4: Run tests**

```bash
pnpm test 2>&1 | tail -8
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/lib/useWorkspaces.ts
git commit -m "feat: add workspace layout persistence to useWorkspaces"
```

---

## Task 9: Final validation

- [ ] **Step 1: Full frontend checks**

```bash
pnpm lint && pnpm check-types && pnpm test 2>&1 | tail -10
```

Expected: all pass, 0 errors, 0 lint errors.

- [ ] **Step 2: Rust checks**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai/src-tauri
cargo clippy --all-targets -- -D warnings
cargo test
```

Expected: 0 warnings, all tests pass.

- [ ] **Step 3: Manual validation checklist**

Start with `pnpm tauri dev` and verify:

- [ ] Opening Terax shows one workspace with one terminal in one pane
- [ ] Per-pane tab bar visible at the top of each pane
- [ ] `Cmd+D` / `Ctrl+D` splits the active pane horizontally — new terminal panel appears in new pane
- [ ] `Cmd+Shift+D` / `Ctrl+Shift+D` splits vertically
- [ ] Clicking a tab in the pane tab bar switches the active panel
- [ ] Clicking `×` on a panel tab closes that panel
- [ ] Closing last panel in a pane closes the pane
- [ ] `+` button in pane tab bar creates a new terminal panel in that pane
- [ ] Opening a file from the Explorer opens it as an editor panel in the active pane
- [ ] Editor panels show dirty indicator (`●`) when unsaved
- [ ] WorkspaceSidebar shows all workspaces; clicking switches the active one
- [ ] PTY sessions keep running in background when switching panels (never-unmount)
- [ ] Restarting Terax restores workspace layout and panel arrangement
- [ ] Terminal panels restart with a fresh PTY in the saved cwd
- [ ] Non-terminal panels (editors, previews) restore correctly
- [ ] RightPanel (Explorer/Git/History) still works
- [ ] Notification bell still works

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "chore: Phase 2 workspace pane model complete"
```
