# Tab drag: reorder and cross-pane insertion - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow tabs to be dragged to reorder within the same pane and to insert at a specific position in another pane, using left/right half drop zones on each tab.

**Architecture:** Each tab registers two `useDroppable` zones (`tab-insert:<panelId>:before/after`) disabled when not dragging. `useDndMonitor` in `PaneTabBar` tracks the active insertion gap and renders a 2px vertical line. `WorkspaceView.handleDragEnd` handles `tab-insert:` IDs, calling either `reorderPanel` (same pane) or `movePanel` with index (cross-pane). A `tabInsertPaneId` state in `WorkspaceView` threads down to highlight the target pane's center zone during cross-pane drag.

**Tech Stack:** `@dnd-kit/core` (useDroppable, useDndMonitor, DragOverEvent), `@dnd-kit/sortable` (arrayMove — already imported), React 19, TypeScript, Tailwind v4.

---

### Task 1: Tests for `movePanelBetweenPanes` with targetIndex

**Files:**
- Modify: `src/modules/workspaces/lib/splitNode.test.ts`

- [ ] **Step 1: Add tests for positional insertion**

Open `src/modules/workspaces/lib/splitNode.test.ts` and add this describe block after the existing `movePanelBetweenPanes` tests:

```typescript
describe("movePanelBetweenPanes with targetIndex", () => {
  function makeFilledPane(id: string, panelIds: string[]): PaneNode {
    return {
      kind: "pane",
      id,
      panels: panelIds.map((pid) => ({ id: pid, kind: "terminal" as const })),
      activePanelId: panelIds[0] ?? null,
    };
  }

  test("inserts panel at index 0 (beginning of target pane)", () => {
    const p1 = makeFilledPane("p1", ["a", "b"]);
    const p2 = makeFilledPane("p2", ["c", "d"]);
    const tree: SplitNode = {
      kind: "split",
      id: "s0",
      orientation: "horizontal",
      first: p1,
      second: p2,
      dividerPosition: 0.5,
    };
    const result = movePanelBetweenPanes(tree, "a", "p2", 0);
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      const target = result.second as PaneNode;
      expect(target.panels.map((p) => p.id)).toEqual(["a", "c", "d"]);
    }
  });

  test("inserts panel at index 1 (middle of target pane)", () => {
    const p1 = makeFilledPane("p1", ["a", "b"]);
    const p2 = makeFilledPane("p2", ["c", "d"]);
    const tree: SplitNode = {
      kind: "split",
      id: "s0",
      orientation: "horizontal",
      first: p1,
      second: p2,
      dividerPosition: 0.5,
    };
    const result = movePanelBetweenPanes(tree, "a", "p2", 1);
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      const target = result.second as PaneNode;
      expect(target.panels.map((p) => p.id)).toEqual(["c", "a", "d"]);
    }
  });

  test("inserts panel at end when targetIndex equals target panel count", () => {
    const p1 = makeFilledPane("p1", ["a", "b"]);
    const p2 = makeFilledPane("p2", ["c", "d"]);
    const tree: SplitNode = {
      kind: "split",
      id: "s0",
      orientation: "horizontal",
      first: p1,
      second: p2,
      dividerPosition: 0.5,
    };
    const result = movePanelBetweenPanes(tree, "a", "p2", 2);
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      const target = result.second as PaneNode;
      expect(target.panels.map((p) => p.id)).toEqual(["c", "d", "a"]);
    }
  });

  test("activates moved panel in target pane", () => {
    const p1 = makeFilledPane("p1", ["a", "b"]);
    const p2 = makeFilledPane("p2", ["c", "d"]);
    const tree: SplitNode = {
      kind: "split",
      id: "s0",
      orientation: "horizontal",
      first: p1,
      second: p2,
      dividerPosition: 0.5,
    };
    const result = movePanelBetweenPanes(tree, "a", "p2", 1);
    if (result.kind === "split") {
      const target = result.second as PaneNode;
      expect(target.activePanelId).toBe("a");
    }
  });
});
```

- [ ] **Step 2: Run tests to confirm they pass**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm test src/modules/workspaces/lib/splitNode.test.ts
```

Expected: all tests pass (the function already supports targetIndex).

- [ ] **Step 3: Commit**

```bash
git add src/modules/workspaces/lib/splitNode.test.ts
git commit -m "test(splitNode): positional insertion tests for movePanelBetweenPanes"
```

---

### Task 2: `reorderPanel` and updated `movePanel` in useWorkspaces

**Files:**
- Modify: `src/modules/workspaces/lib/useWorkspaces.ts`

- [ ] **Step 1: Update `movePanel` to accept optional `targetIndex`**

In `src/modules/workspaces/lib/useWorkspaces.ts`, replace the `movePanel` callback:

```typescript
// BEFORE:
const movePanel = useCallback((workspaceId: string, panelId: string, targetPaneId: string) => {
  setWorkspaces((prev) =>
    prev.map((w) => {
      if (w.id !== workspaceId) return w;
      const sourceResult = findPanelPane(w.paneTree, panelId);
      if (!sourceResult || sourceResult.pane.id === targetPaneId) return w;
      const newTree = movePanelBetweenPanes(w.paneTree, panelId, targetPaneId);
      if (newTree === w.paneTree) return w;
      return { ...w, paneTree: newTree, activePaneId: targetPaneId };
    }),
  );
}, []);

// AFTER:
const movePanel = useCallback((workspaceId: string, panelId: string, targetPaneId: string, targetIndex?: number) => {
  setWorkspaces((prev) =>
    prev.map((w) => {
      if (w.id !== workspaceId) return w;
      const sourceResult = findPanelPane(w.paneTree, panelId);
      if (!sourceResult || sourceResult.pane.id === targetPaneId) return w;
      const newTree = movePanelBetweenPanes(w.paneTree, panelId, targetPaneId, targetIndex);
      if (newTree === w.paneTree) return w;
      return { ...w, paneTree: newTree, activePaneId: targetPaneId };
    }),
  );
}, []);
```

- [ ] **Step 2: Add `reorderPanel` callback after `movePanel`**

Insert the following immediately after the `movePanel` definition (before `splitPaneAndPlace`):

```typescript
const reorderPanel = useCallback((workspaceId: string, panelId: string, insertionIndex: number) => {
  setWorkspaces((prev) =>
    prev.map((w) => {
      if (w.id !== workspaceId) return w;
      const result = findPanelPane(w.paneTree, panelId);
      if (!result) return w;
      const { pane } = result;
      const from = pane.panels.findIndex((p) => p.id === panelId);
      if (from === -1) return w;
      // insertionIndex is the gap index in the original array (0 = before first tab).
      // Inserting before or after the dragged tab itself is a noop.
      if (insertionIndex === from || insertionIndex === from + 1) return w;
      // Convert gap index to arrayMove destination index (which operates after removal).
      const to = insertionIndex <= from ? insertionIndex : insertionIndex - 1;
      const newPanels = arrayMove(pane.panels, from, to);
      return { ...w, paneTree: updatePane(w.paneTree, pane.id, (p) => ({ ...p, panels: newPanels })) };
    }),
  );
}, []);
```

- [ ] **Step 3: Add `reorderPanel` to the return object**

In the `return { ... }` block at the end of `useWorkspaces`, add `reorderPanel` after `movePanel`:

```typescript
  movePanel,
  reorderPanel,     // <- add this line
  splitPaneAndPlace,
```

- [ ] **Step 4: Run tests and type check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm test && pnpm check-types
```

Expected: all tests pass, no type errors.

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/lib/useWorkspaces.ts
git commit -m "feat(workspaces): reorderPanel and movePanel with targetIndex"
```

---

### Task 3: WorkspaceView - tab-insert handling and prop threading

**Files:**
- Modify: `src/modules/workspaces/WorkspaceView.tsx`

- [ ] **Step 1: Add imports and new state**

Replace the existing import from `@dnd-kit/core` and add `tabInsertPaneId` state. The full updated imports and state section:

```typescript
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
```

In the `WorkspaceView` function body, add `tabInsertPaneId` state after `draggingWorkspaceId`:

```typescript
const [draggingPanel, setDraggingPanel] = useState<Panel | null>(null);
const [draggingWorkspaceId, setDraggingWorkspaceId] = useState<string | null>(null);
const [tabInsertPaneId, setTabInsertPaneId] = useState<string | null>(null);
```

- [ ] **Step 2: Add `onReorderPanel` to Props type**

Replace the Props type:

```typescript
type Props = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  onDividerChange?: (workspaceId: string, splitId: string, position: number) => void;
  onMovePanel: UseWorkspacesReturn["movePanel"];
  onReorderPanel: UseWorkspacesReturn["reorderPanel"];
  onSplitPaneAndPlace: UseWorkspacesReturn["splitPaneAndPlace"];
  callbacks: PanelCallbacks;
};
```

Destructure `onReorderPanel` in the function signature:

```typescript
export function WorkspaceView({
  workspaces,
  activeWorkspaceId,
  onMovePanel,
  onReorderPanel,
  onSplitPaneAndPlace,
  ...rest
}: Props) {
```

- [ ] **Step 3: Add `handleDragOver`**

Add this function after `handleDragCancel`:

```typescript
function handleDragOver(event: DragOverEvent) {
  const overId = event.over?.id ? String(event.over.id) : null;
  if (!overId?.startsWith("tab-insert:")) {
    setTabInsertPaneId(null);
    return;
  }
  const parts = overId.split(":");
  const refPanelId = parts[1];
  if (!refPanelId) { setTabInsertPaneId(null); return; }

  const draggedPanelId = String(event.active.id);

  for (const ws of workspaces) {
    const sourceResult = findPanelPane(ws.paneTree, draggedPanelId);
    if (!sourceResult) continue;
    const sourcePaneId = sourceResult.pane.id;
    for (const pane of allPanes(ws.paneTree)) {
      if (pane.panels.some((p) => p.id === refPanelId)) {
        // Only highlight the center zone when dragging to a different pane.
        setTabInsertPaneId(pane.id !== sourcePaneId ? pane.id : null);
        return;
      }
    }
    setTabInsertPaneId(null);
    return;
  }
  setTabInsertPaneId(null);
}
```

- [ ] **Step 4: Update `handleDragEnd` to clear `tabInsertPaneId` and handle `tab-insert:`**

Replace the entire `handleDragEnd` function:

```typescript
function handleDragEnd(event: DragEndEvent) {
  document.body.style.cursor = "";
  setDraggingPanel(null);
  setDraggingWorkspaceId(null);
  setTabInsertPaneId(null);
  const { active, over } = event;
  if (!over) return;

  const panelId = String(active.id);
  const overId = String(over.id);

  if (overId.startsWith("tab-insert:")) {
    const parts = overId.split(":");
    const refPanelId = parts[1];
    const side = parts[2];
    if (!refPanelId || !side) return;

    // Find source workspace and pane
    let sourceWorkspaceId: string | null = null;
    let sourcePaneId: string | null = null;
    for (const ws of workspaces) {
      for (const pane of allPanes(ws.paneTree)) {
        if (pane.panels.some((p) => p.id === panelId)) {
          sourceWorkspaceId = ws.id;
          sourcePaneId = pane.id;
          break;
        }
      }
      if (sourceWorkspaceId) break;
    }
    if (!sourceWorkspaceId || !sourcePaneId) return;

    // Find target pane (the pane that contains refPanelId), scoped to source workspace
    const sourceWs = workspaces.find((ws) => ws.id === sourceWorkspaceId);
    if (!sourceWs) return;
    let targetPaneId: string | null = null;
    let refPanelIndex = -1;
    for (const pane of allPanes(sourceWs.paneTree)) {
      const idx = pane.panels.findIndex((p) => p.id === refPanelId);
      if (idx !== -1) {
        targetPaneId = pane.id;
        refPanelIndex = idx;
        break;
      }
    }
    if (!targetPaneId || refPanelIndex === -1) return;

    const insertionIndex = refPanelIndex + (side === "after" ? 1 : 0);

    if (sourcePaneId === targetPaneId) {
      onReorderPanel(sourceWorkspaceId, panelId, insertionIndex);
    } else {
      onMovePanel(sourceWorkspaceId, panelId, targetPaneId, insertionIndex);
    }
    return;
  }

  // Only handle zone drops (zone:<paneId>:<direction>)
  if (!overId.startsWith("zone:")) return;

  const parts = overId.split(":");
  const targetPaneId = parts[1]!;
  const zone = parts[2] as "top" | "bottom" | "left" | "right" | "center";

  // Find source workspace and pane
  let sourceWorkspaceId: string | null = null;
  let sourcePaneId: string | null = null;
  for (const ws of workspaces) {
    for (const pane of allPanes(ws.paneTree)) {
      if (pane.panels.some((p) => p.id === panelId)) {
        sourceWorkspaceId = ws.id;
        sourcePaneId = pane.id;
        break;
      }
    }
    if (sourceWorkspaceId) break;
  }
  if (!sourceWorkspaceId) return;

  const targetInSourceWorkspace = workspaces.find((ws) => ws.id === sourceWorkspaceId);
  if (!targetInSourceWorkspace) return;
  const targetPaneExists = allPanes(targetInSourceWorkspace.paneTree).some(
    (p) => p.id === targetPaneId,
  );
  if (!targetPaneExists) return;

  if (zone === "center") {
    if (sourcePaneId === targetPaneId) return;
    onMovePanel(sourceWorkspaceId, panelId, targetPaneId);
  } else {
    const { workspacePaneLimit } = usePreferencesStore.getState();
    const ws = workspaces.find((w) => w.id === sourceWorkspaceId);
    if (ws && allPanes(ws.paneTree).length >= workspacePaneLimit) return;
    onSplitPaneAndPlace(sourceWorkspaceId, targetPaneId, zone, panelId);
  }
}
```

- [ ] **Step 5: Add `onDragOver` to `DndContext` and pass `tabInsertPaneId` to `SplitNodeView`**

In the JSX, update `DndContext` to include `onDragOver`:

```tsx
<DndContext
  sensors={sensors}
  collisionDetection={pointerWithin}
  onDragStart={handleDragStart}
  onDragOver={handleDragOver}
  onDragEnd={handleDragEnd}
  onDragCancel={handleDragCancel}
>
```

Update each `SplitNodeView` to receive `tabInsertPaneId`:

```tsx
<SplitNodeView
  node={ws.paneTree}
  workspaceId={ws.id}
  workspaceCwd={ws.cwd}
  activePaneId={ws.activePaneId}
  isWorkspaceActive={ws.id === activeWorkspaceId}
  tabInsertPaneId={tabInsertPaneId}
  onActivatePanel={rest.onActivatePanel}
  onClosePanel={rest.onClosePanel}
  onFocusPane={rest.onFocusPane}
  onNewTerminal={rest.onNewTerminal}
  onDividerChange={rest.onDividerChange}
  callbacks={rest.callbacks}
/>
```

- [ ] **Step 6: Run type check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm check-types 2>&1 | head -40
```

Expected: errors only in `SplitNodeView.tsx`, `PaneView.tsx`, `PaneTabBar.tsx`, and `App.tsx` (props not yet wired). No unexpected errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/workspaces/WorkspaceView.tsx
git commit -m "feat(workspaces): handle tab-insert drops and thread tabInsertPaneId"
```

---

### Task 4: SplitNodeView - forward `tabInsertPaneId`

**Files:**
- Modify: `src/modules/workspaces/SplitNodeView.tsx`

- [ ] **Step 1: Add `tabInsertPaneId` to Props and forward it**

Replace the Props type and the `SplitNodeView` function (the prop goes into `...rest` which is already forwarded to both `PaneView` and recursive `SplitNodeView` calls):

```typescript
type Props = {
  node: SplitNode;
  workspaceId: string;
  workspaceCwd?: string;
  activePaneId: string;
  isWorkspaceActive: boolean;
  tabInsertPaneId: string | null;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  onDividerChange?: (
    workspaceId: string,
    splitId: string,
    position: number,
  ) => void;
  callbacks: PanelCallbacks;
};
```

No changes to the function body are needed — `tabInsertPaneId` is in `...rest` and is already spread to both `PaneView` and recursive `SplitNodeView` via `{...rest}`.

- [ ] **Step 2: Run type check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm check-types 2>&1 | head -40
```

Expected: errors only in `PaneView.tsx`, `PaneTabBar.tsx`, `App.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/workspaces/SplitNodeView.tsx
git commit -m "feat(workspaces): forward tabInsertPaneId through SplitNodeView"
```

---

### Task 5: PaneView - center zone highlight and `isDragging` to `PaneTabBar`

**Files:**
- Modify: `src/modules/workspaces/PaneView.tsx`

- [ ] **Step 1: Add `tabInsertPaneId` to Props and update `DropZone`**

Replace the Props type:

```typescript
type Props = {
  pane: PaneNode;
  workspaceId: string;
  workspaceCwd?: string;
  focused: boolean;
  isWorkspaceActive: boolean;
  tabInsertPaneId: string | null;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  callbacks: PanelCallbacks;
};
```

Update `DropZone` to accept an optional `forceOver` prop:

```typescript
function DropZone({
  id,
  hitClassName,
  visualClassName,
  forceOver,
}: {
  id: string;
  hitClassName: string;
  visualClassName: string;
  forceOver?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  const active = isOver || (forceOver ?? false);
  return (
    <>
      <div
        ref={setNodeRef}
        className={cn("absolute cursor-grabbing", hitClassName)}
      />
      {active && (
        <div
          className={cn(
            "pointer-events-none absolute bg-primary/25 ring-2 ring-inset ring-primary/60",
            visualClassName,
          )}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: Destructure `tabInsertPaneId` and pass `isDragging` to `PaneTabBar`**

Update the function signature to destructure `tabInsertPaneId`:

```typescript
export function PaneView({
  pane,
  workspaceId,
  workspaceCwd: _workspaceCwd,
  focused,
  isWorkspaceActive,
  tabInsertPaneId,
  onActivatePanel,
  onClosePanel,
  onFocusPane,
  onNewTerminal,
  callbacks,
}: Props) {
```

Pass `isDragging` to `PaneTabBar`:

```tsx
<PaneTabBar
  panels={pane.panels}
  activePanelId={pane.activePanelId}
  paneFocused={focused}
  workspaceId={workspaceId}
  isDragging={isDragging}
  onActivate={(panelId) => onActivatePanel(workspaceId, panelId)}
  onClose={(panelId) => onClosePanel(workspaceId, panelId)}
  onNewTerminal={() => onNewTerminal(workspaceId, pane.id)}
/>
```

- [ ] **Step 3: Apply `forceOver` to the center drop zone**

Find every instance of the center zone (`zone:${pane.id}:center`) in the drop overlay JSX and add `forceOver`:

The simple center zone (tooNarrow && tooShort case):
```tsx
<DropZone
  id={`zone:${pane.id}:center`}
  hitClassName="pointer-events-auto inset-0"
  visualClassName="inset-0 rounded-md"
  forceOver={tabInsertPaneId === pane.id}
/>
```

The regular center zone (inside the `<>` branch):
```tsx
<DropZone
  id={`zone:${pane.id}:center`}
  hitClassName={cn(
    "pointer-events-auto",
    tooNarrow
      ? "inset-y-1/4 left-0 right-0"
      : tooShort
        ? "inset-x-1/4 top-0 bottom-0"
        : "bottom-1/4 left-1/4 right-1/4 top-1/4",
  )}
  visualClassName="inset-0 rounded-md"
  forceOver={tabInsertPaneId === pane.id}
/>
```

- [ ] **Step 4: Run type check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm check-types 2>&1 | head -40
```

Expected: errors only in `PaneTabBar.tsx` and `App.tsx`.

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/PaneView.tsx
git commit -m "feat(workspaces): center zone forceOver for cross-pane tab insert"
```

---

### Task 6: PaneTabBar - insertion line and droppable half-zones

**Files:**
- Modify: `src/modules/workspaces/PaneTabBar.tsx`

- [ ] **Step 1: Replace the entire file**

The new `PaneTabBar.tsx`:

```typescript
import { useDraggable, useDroppable, useDndMonitor } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { panelIcon, panelTitle } from "./lib/panelTitle";
import type { Panel } from "./lib/types";
import { usePreferencesStore } from "@/modules/settings/preferences";
import { Fragment, useRef, useState } from "react";

type Props = {
  panels: Panel[];
  activePanelId: string | null;
  paneFocused: boolean;
  workspaceId: string;
  isDragging: boolean;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  onNewTerminal: () => void;
};

function InsertionGap({ show }: { show: boolean }) {
  return (
    <div className="relative w-0 shrink-0">
      {show && (
        <div className="pointer-events-none absolute inset-y-1 -left-px z-10 w-0.5 rounded-full bg-primary" />
      )}
    </div>
  );
}

function DraggableTab({
  panel,
  activePanelId,
  paneFocused,
  workspaceId,
  isDragging,
  onActivate,
  onClose,
}: {
  panel: Panel;
  activePanelId: string | null;
  paneFocused: boolean;
  workspaceId: string;
  isDragging: boolean;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging: isThisDragging } = useDraggable({ id: panel.id });
  const { setNodeRef: setBeforeRef } = useDroppable({
    id: `tab-insert:${panel.id}:before`,
    disabled: !isDragging,
  });
  const { setNodeRef: setAfterRef } = useDroppable({
    id: `tab-insert:${panel.id}:after`,
    disabled: !isDragging,
  });
  const active = panel.id === activePanelId;
  const title = panelTitle(panel);
  const tabBarStyle = usePreferencesStore((s) => s.tabBarStyle);
  const connected = tabBarStyle === "connected";

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      data-panel-id={panel.id}
      onClick={() => onActivate(panel.id)}
      className={cn(
        "group relative flex min-w-[100px] max-w-[200px] shrink-0 cursor-grab active:cursor-grabbing select-none touch-none items-center gap-1 px-1.5 text-[11px] transition-colors",
        connected
          ? [
              "self-stretch border-r border-border/30",
              active
                ? "bg-background text-foreground"
                : "border-b border-border/60 text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ]
          : [
              "h-5 rounded",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            ],
        isThisDragging && "opacity-40",
      )}
    >
      {/* Droppable half-zones — registered but only active when a drag is in progress */}
      <div ref={setBeforeRef} className="absolute inset-y-0 left-0 w-1/2" />
      <div ref={setAfterRef} className="absolute inset-y-0 right-0 w-1/2" />

      {active && paneFocused && (
        <div className={cn("absolute inset-x-0 top-0 bg-primary", connected ? "h-[1.5px]" : "h-0.5 rounded-t")} />
      )}
      <span className="shrink-0 opacity-70">{panelIcon(panel, workspaceId)}</span>
      <span
        className={cn(
          "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap",
          panel.kind === "terminal" && panel.runningCommand && "text-center",
        )}
        style={{ direction: panel.kind === "terminal" && !panel.runningCommand ? "rtl" : "ltr" }}
        title={
          panel.kind === "terminal"
            ? panel.runningCommand
              ? `${title} · ${panel.cwd?.replace(/\/$/, "") ?? ""}`
              : (panel.cwd?.replace(/\/$/, "") ?? "shell")
            : title
        }
      >
        {title}
      </span>
      {panel.kind === "editor" && panel.dirty && (
        <span className="shrink-0 text-[8px] text-primary">●</span>
      )}
      <button
        type="button"
        className="ml-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
        onClick={(e) => {
          e.stopPropagation();
          onClose(panel.id);
        }}
        title="Close panel"
      >
        ×
      </button>
    </div>
  );
}

export function PaneTabBar({ panels, activePanelId, paneFocused, workspaceId, isDragging, onActivate, onClose, onNewTerminal }: Props) {
  const tabBarStyle = usePreferencesStore((s) => s.tabBarStyle);
  const [insertionIndex, setInsertionIndex] = useState<number | null>(null);

  useDndMonitor({
    onDragOver(event) {
      const overId = event.over?.id ? String(event.over.id) : null;
      if (!overId?.startsWith("tab-insert:")) {
        setInsertionIndex(null);
        return;
      }
      const parts = overId.split(":");
      const refPanelId = parts[1];
      const side = parts[2];
      if (!refPanelId || !side) { setInsertionIndex(null); return; }
      const idx = panels.findIndex((p) => p.id === refPanelId);
      if (idx === -1) { setInsertionIndex(null); return; }
      setInsertionIndex(side === "before" ? idx : idx + 1);
    },
    onDragEnd() { setInsertionIndex(null); },
    onDragCancel() { setInsertionIndex(null); },
  });

  // react-resizable-panels registers a document-level capture pointerdown listener
  // that calls preventDefault() when the pointer is within ~5px of a resize handle.
  // In WebKit/Tauri, preventDefault() on pointerdown suppresses the click event.
  // Tabs at the top of a bottom pane become intermittently unclickable.
  // onPointerUp is not suppressed by that preventDefault(), so we use it here as
  // a fallback. onClick on each tab still works for all other cases.
  const pointerStartRef = useRef<{ id: number; x: number; y: number } | null>(null);

  return (
    <div
      className={cn(
        "flex h-7 shrink-0 items-center overflow-x-auto bg-card/60 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        tabBarStyle === "connected"
          ? "gap-0 border-t border-border/60"
          : "gap-0.5 border-b border-border/60 px-1",
      )}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        pointerStartRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY };
      }}
      onPointerUp={(e) => {
        const start = pointerStartRef.current;
        if (!start || start.id !== e.pointerId) return;
        pointerStartRef.current = null;
        if ((e.target as HTMLElement).closest("button")) return;
        const tabEl = (e.target as HTMLElement).closest("[data-panel-id]");
        if (!tabEl) return;
        const panelId = tabEl.getAttribute("data-panel-id");
        if (!panelId) return;
        const dx = Math.abs(e.clientX - start.x);
        const dy = Math.abs(e.clientY - start.y);
        if (dx < 6 && dy < 6) onActivate(panelId);
      }}
    >
      {panels.map((p, i) => (
        <Fragment key={p.id}>
          <InsertionGap show={insertionIndex === i} />
          <DraggableTab
            panel={p}
            activePanelId={activePanelId}
            paneFocused={paneFocused}
            workspaceId={workspaceId}
            isDragging={isDragging}
            onActivate={onActivate}
            onClose={onClose}
          />
        </Fragment>
      ))}
      <InsertionGap show={insertionIndex === panels.length} />
      <button
        type="button"
        onClick={onNewTerminal}
        className="ml-1 shrink-0 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        title="New terminal in this pane"
      >
        +
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Run type check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm check-types 2>&1 | head -40
```

Expected: errors only in `App.tsx` (missing `onReorderPanel`).

- [ ] **Step 3: Commit**

```bash
git add src/modules/workspaces/PaneTabBar.tsx
git commit -m "feat(workspaces): tab insertion line and droppable half-zones"
```

---

### Task 7: App.tsx - wire `reorderPanel`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Destructure `reorderPanel` from `useWorkspaces`**

In the `useWorkspaces` destructuring block (around line 95-109), add `reorderPanel`:

```typescript
  movePanel,
  reorderPanel,
  splitPaneAndPlace,
```

- [ ] **Step 2: Pass `onReorderPanel` to `WorkspaceView`**

In the `WorkspaceView` JSX (around line 1020-1021), add the prop:

```tsx
onMovePanel={movePanel}
onReorderPanel={reorderPanel}
onSplitPaneAndPlace={splitPaneAndPlace}
```

- [ ] **Step 3: Full quality check**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm lint && pnpm check-types && pnpm test
```

Expected: all pass with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(workspaces): wire reorderPanel in App.tsx"
```

---

### Task 8: Manual smoke test

- [ ] **Step 1: Start the app**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && pnpm tauri dev
```

- [ ] **Step 2: Verify same-pane reorder**

1. Open 3 terminals in a single pane (3 tabs: A, B, C).
2. Drag tab A to the right side of tab C. Confirm order becomes B, C, A.
3. Drag tab C to the left side of tab B. Confirm order becomes B, C, A → C, B, A.
4. Confirm the insertion line (2px vertical) appears between tabs during drag.
5. Drag a tab onto itself (before or after). Confirm nothing changes.

- [ ] **Step 3: Verify cross-pane insertion**

1. Create two panes (split horizontally). Pane 1 has tabs A, B. Pane 2 has tabs C, D.
2. Drag tab A from pane 1 to between C and D in pane 2. Confirm pane 2 becomes C, A, D. Confirm pane 1 collapses (only had B after A left... wait, pane 1 had A and B, so after moving A, pane 1 still has B — it stays).
3. Confirm A is active in pane 2.
4. Confirm the center zone highlight appears on pane 2 during the drag.

- [ ] **Step 4: Verify large pane zones still work**

1. Drag a tab to the top zone of another pane. Confirm it creates a split (existing behavior).

- [ ] **Step 5: Commit if any fixes were needed**

If fixes were required, commit them with a descriptive message. If no fixes, no commit needed.
