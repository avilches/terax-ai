# Phase 4 - Drag & Drop UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drag & drop visual para workspaces (reorder en sidebar) y panels (5 zonas de drop sobre cada pane).

**Architecture:** Dos sistemas de drag independientes. (1) `WorkspaceSidebar` tiene su propio `DndContext` local para reordenar iconos de workspace. (2) `WorkspaceView` tiene un `DndContext` que coordina el drag de panel tabs: al arrastrar un tab sobre cualquier pane aparece un overlay con 5 zonas (top/bottom/left/right/center); center = añadir como tab, direccional = dividir el pane y colocar el panel en la nueva mitad. Si el pane origen queda vacío tras el move, se colapsa automáticamente. Los splits creados por teclado también auto-crean un terminal en el nuevo pane.

**Tech Stack:** `@dnd-kit/core@6.3.1`, `@dnd-kit/sortable@10.0.0`, `@dnd-kit/utilities@3.2.2` (ya instalados).

**Invariantes del modelo:**
- Un pane nunca queda vacío: si se cierra el último panel, el pane desaparece (ya implementado en `closePanel`).
- Un split nunca crea un pane vacío: siempre se abre un terminal en el nuevo pane.
- Si el panel arrastrado era el último de su pane origen, ese pane desaparece y el espacio se redistribuye.
- Cross-window transfer queda para Phase 5.

---

## File Map

| Archivo | Acción | Responsabilidad |
|---------|--------|-----------------|
| `src/modules/workspaces/lib/splitNode.ts` | Modificar | Añadir `newPanePosition` param a `splitPaneInTree`; nueva `movePanelBetweenPanes` con auto-close |
| `src/modules/workspaces/lib/splitNode.test.ts` | Modificar | Tests para los cambios anteriores |
| `src/modules/workspaces/lib/useWorkspaces.ts` | Modificar | Añadir `reorderWorkspaces`, `movePanel`, `splitPaneAndPlace` |
| `src/app/App.tsx` | Modificar | Fix split shortcuts para auto-abrir terminal; pasar nuevas props a WorkspaceView y WorkspaceSidebar |
| `src/app/components/WorkspaceSidebar.tsx` | Modificar | Sortable con `@dnd-kit/sortable` |
| `src/modules/workspaces/PaneView.tsx` | Modificar | Overlay 5 zonas con `useDroppable` + `useDndMonitor` |
| `src/modules/workspaces/WorkspaceView.tsx` | Modificar | `DndContext` para panel drags + `DragOverlay` + `onDragEnd` orchestration |
| `src/modules/workspaces/SplitNodeView.tsx` | No cambia | |
| `src/modules/workspaces/PaneTabBar.tsx` | Modificar mínimo | Tabs con `cursor-grab`, sin sortable (las 5 zonas son el modelo de drag) |

---

## Task 1: Modificar `splitPaneInTree` y añadir `movePanelBetweenPanes`

Dos cambios en `splitNode.ts`:
1. `splitPaneInTree` acepta `newPanePosition: "first" | "second" = "second"` para que los drops direccionales (left/top) puedan colocar el nuevo pane ANTES del target.
2. Nueva `movePanelBetweenPanes` que mueve un panel entre panes y colapsa el pane origen si queda vacío.

**Files:**
- Modify: `src/modules/workspaces/lib/splitNode.ts`
- Modify: `src/modules/workspaces/lib/splitNode.test.ts`

- [ ] **Step 1: Añadir tests (fallarán)**

En `splitNode.test.ts`, añadir al final:

```typescript
describe("splitPaneInTree with newPanePosition", () => {
  test("places new pane as first when newPanePosition='first'", () => {
    const tree = makePane("p1");
    const result = splitPaneInTree(tree, "p1", "s1", "p2", "horizontal", "first");
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      expect(result.first).toEqual(makePane("p2"));
      expect(result.second).toEqual(tree);
    }
  });

  test("places new pane as second by default (backward compat)", () => {
    const tree = makePane("p1");
    const result = splitPaneInTree(tree, "p1", "s1", "p2", "horizontal");
    if (result.kind === "split") {
      expect(result.first).toEqual(tree);
      expect(result.second).toEqual(makePane("p2"));
    }
  });
});

describe("movePanelBetweenPanes", () => {
  test("moves panel from source pane to target pane", () => {
    const panel1 = { id: "panel1", kind: "terminal" as const };
    const panel2 = { id: "panel2", kind: "terminal" as const };
    const pane1: PaneNode = { kind: "pane", id: "p1", panels: [panel1], activePanelId: "panel1" };
    const pane2: PaneNode = { kind: "pane", id: "p2", panels: [panel2], activePanelId: "panel2" };
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: pane1, second: pane2, dividerPosition: 0.5 };

    const result = movePanelBetweenPanes(tree, "panel1", "p2");
    // Source pane (p1) had only 1 panel — it should be collapsed
    expect(result.kind).toBe("pane");
    if (result.kind === "pane") {
      expect(result.id).toBe("p2");
      expect(result.panels).toHaveLength(2);
      expect(result.panels[1]?.id).toBe("panel1");
      expect(result.activePanelId).toBe("panel1");
    }
  });

  test("source pane stays when it has remaining panels", () => {
    const panel1 = { id: "panel1", kind: "terminal" as const };
    const panel2 = { id: "panel2", kind: "terminal" as const };
    const panel3 = { id: "panel3", kind: "terminal" as const };
    const pane1: PaneNode = { kind: "pane", id: "p1", panels: [panel1, panel2], activePanelId: "panel1" };
    const pane2: PaneNode = { kind: "pane", id: "p2", panels: [panel3], activePanelId: "panel3" };
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: pane1, second: pane2, dividerPosition: 0.5 };

    const result = movePanelBetweenPanes(tree, "panel2", "p2");
    expect(result.kind).toBe("split");
    if (result.kind === "split") {
      const newP1 = result.first as PaneNode;
      const newP2 = result.second as PaneNode;
      expect(newP1.panels).toHaveLength(1);
      expect(newP2.panels).toHaveLength(2);
    }
  });

  test("inserts at specified index", () => {
    const panel1 = { id: "panel1", kind: "terminal" as const };
    const panel2 = { id: "panel2", kind: "terminal" as const };
    const panel3 = { id: "panel3", kind: "terminal" as const };
    const pane1: PaneNode = { kind: "pane", id: "p1", panels: [panel1, panel2], activePanelId: "panel1" };
    const pane2: PaneNode = { kind: "pane", id: "p2", panels: [panel3], activePanelId: "panel3" };
    const tree: SplitNode = { kind: "split", id: "s0", orientation: "horizontal", first: pane1, second: pane2, dividerPosition: 0.5 };

    const result = movePanelBetweenPanes(tree, "panel1", "p2", 0);
    if (result.kind === "split") {
      const newP2 = result.second as PaneNode;
      expect(newP2.panels[0]?.id).toBe("panel1");
    }
  });

  test("returns same tree if source and target pane are the same", () => {
    const panel1 = { id: "panel1", kind: "terminal" as const };
    const pane: PaneNode = { kind: "pane", id: "p1", panels: [panel1], activePanelId: "panel1" };
    expect(movePanelBetweenPanes(pane, "panel1", "p1")).toBe(pane);
  });

  test("returns same tree if panel not found", () => {
    const pane: PaneNode = { kind: "pane", id: "p1", panels: [], activePanelId: null };
    expect(movePanelBetweenPanes(pane, "unknown", "p1")).toBe(pane);
  });
});
```

Actualizar también el import en el test (añadir `movePanelBetweenPanes`):

```typescript
import {
  allPaneIds,
  findPane,
  findPanelPane,
  firstPaneId,
  movePanelBetweenPanes,
  removePaneFromTree,
  siblingPane,
  splitPaneInTree,
  updateDivider,
  updatePane,
} from "./splitNode";
```

- [ ] **Step 2: Verificar que los tests fallan**

```bash
pnpm test src/modules/workspaces/lib/splitNode.test.ts
```

Esperado: FAIL con "movePanelBetweenPanes is not a function".

- [ ] **Step 3: Modificar `splitPaneInTree` en splitNode.ts**

Reemplazar la función actual por:

```typescript
export function splitPaneInTree(
  tree: SplitNode,
  targetPaneId: string,
  newSplitId: string,
  newPaneId: string,
  orientation: "horizontal" | "vertical",
  newPanePosition: "first" | "second" = "second",
): SplitNode {
  if (tree.kind === "pane") {
    if (tree.id !== targetPaneId) return tree;
    const newPane: PaneNode = { kind: "pane", id: newPaneId, panels: [], activePanelId: null };
    const [first, second] = newPanePosition === "first" ? [newPane, tree] : [tree, newPane];
    return { kind: "split", id: newSplitId, orientation, first, second, dividerPosition: 0.5 };
  }
  const first = splitPaneInTree(tree.first, targetPaneId, newSplitId, newPaneId, orientation, newPanePosition);
  const second = splitPaneInTree(tree.second, targetPaneId, newSplitId, newPaneId, orientation, newPanePosition);
  if (first === tree.first && second === tree.second) return tree;
  return { ...tree, first, second };
}
```

- [ ] **Step 4: Añadir `movePanelBetweenPanes` al final de splitNode.ts**

```typescript
export function movePanelBetweenPanes(
  tree: SplitNode,
  panelId: string,
  targetPaneId: string,
  targetIndex?: number,
): SplitNode {
  const sourceResult = findPanelPane(tree, panelId);
  if (!sourceResult) return tree;
  if (sourceResult.pane.id === targetPaneId) return tree;

  const { pane: sourcePane, panel } = sourceResult;

  // Remove from source pane
  let result = updatePane(tree, sourcePane.id, (p) => {
    const remaining = p.panels.filter((x) => x.id !== panelId);
    const newActive =
      p.activePanelId === panelId
        ? (remaining[remaining.length - 1]?.id ?? null)
        : p.activePanelId;
    return { ...p, panels: remaining, activePanelId: newActive };
  });

  // Insert into target pane
  result = updatePane(result, targetPaneId, (p) => {
    const idx = targetIndex !== undefined ? Math.min(targetIndex, p.panels.length) : p.panels.length;
    const newPanels = [...p.panels];
    newPanels.splice(idx, 0, panel);
    return { ...p, panels: newPanels, activePanelId: panel.id };
  });

  // Auto-collapse source pane if now empty (never removes the last pane)
  const updatedSource = findPane(result, sourcePane.id);
  if (updatedSource && updatedSource.panels.length === 0) {
    const collapsed = removePaneFromTree(result, sourcePane.id);
    if (collapsed) return collapsed;
  }

  return result;
}
```

- [ ] **Step 5: Verificar que los tests pasan**

```bash
pnpm test src/modules/workspaces/lib/splitNode.test.ts
```

Esperado: todos verdes.

- [ ] **Step 6: Commit**

```bash
git add src/modules/workspaces/lib/splitNode.ts src/modules/workspaces/lib/splitNode.test.ts
git commit -m "feat: splitPaneInTree newPanePosition param + movePanelBetweenPanes with auto-collapse"
```

---

## Task 2: Nuevas acciones en `useWorkspaces`

Añadir `reorderWorkspaces`, `movePanel` y `splitPaneAndPlace`.

**Files:**
- Modify: `src/modules/workspaces/lib/useWorkspaces.ts`

- [ ] **Step 1: Añadir imports**

Al inicio de `useWorkspaces.ts`, actualizar los imports de `./splitNode`:

```typescript
import {
  allPaneIds,
  allPanes,
  findPane,
  findPanelPane,
  firstPaneId,
  movePanelBetweenPanes,
  removePaneFromTree,
  siblingPane,
  splitPaneInTree,
  updateDivider,
  updatePane,
} from "./splitNode";
```

Añadir import de `arrayMove`:

```typescript
import { arrayMove } from "@dnd-kit/sortable";
```

- [ ] **Step 2: Añadir `reorderWorkspaces`**

Después de `closeWorkspace`:

```typescript
const reorderWorkspaces = useCallback((fromId: string, toId: string) => {
  setWorkspaces((prev) => {
    const from = prev.findIndex((w) => w.id === fromId);
    const to = prev.findIndex((w) => w.id === toId);
    if (from === -1 || to === -1 || from === to) return prev;
    return arrayMove(prev, from, to);
  });
}, []);
```

- [ ] **Step 3: Añadir `movePanel`**

Después de `setPaneDivider`:

```typescript
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
```

- [ ] **Step 4: Añadir `splitPaneAndPlace`**

Después de `movePanel`:

```typescript
const splitPaneAndPlace = useCallback((
  workspaceId: string,
  targetPaneId: string,
  direction: "left" | "right" | "top" | "bottom",
  panelId: string,
) => {
  setWorkspaces((prev) =>
    prev.map((w) => {
      if (w.id !== workspaceId) return w;
      const orientation = direction === "left" || direction === "right" ? "horizontal" : "vertical";
      const newPanePosition: "first" | "second" = direction === "left" || direction === "top" ? "first" : "second";
      const newPaneId = crypto.randomUUID();
      const newSplitId = crypto.randomUUID();
      const treeAfterSplit = splitPaneInTree(
        w.paneTree,
        targetPaneId,
        newSplitId,
        newPaneId,
        orientation,
        newPanePosition,
      );
      const treeAfterMove = movePanelBetweenPanes(treeAfterSplit, panelId, newPaneId);
      if (treeAfterMove === w.paneTree) return w;
      return { ...w, paneTree: treeAfterMove, activePaneId: newPaneId };
    }),
  );
}, []);
```

- [ ] **Step 5: Añadir al return del hook**

```typescript
return {
  workspaces,
  activeWorkspaceId,
  setActiveWorkspaceId,
  activeWorkspace,
  addWorkspace,
  closeWorkspace,
  reorderWorkspaces,
  splitPane,
  closePane,
  focusPane,
  setPaneDivider,
  movePanel,
  splitPaneAndPlace,
  openPanel,
  activatePanel,
  closePanel,
  updatePanelData,
  setTerminalPanelCwd,
  findPanelGlobal,
  findPaneGlobal,
  resetWorkspaces,
  allPaneIds,
};
```

- [ ] **Step 6: Verificar tipos**

```bash
pnpm check-types
```

Esperado: 0 errores.

- [ ] **Step 7: Commit**

```bash
git add src/modules/workspaces/lib/useWorkspaces.ts
git commit -m "feat: add reorderWorkspaces, movePanel, splitPaneAndPlace to useWorkspaces"
```

---

## Task 3: Fix split shortcuts para no crear panes vacíos

Los atajos de teclado para dividir pane (Cmd+\ y Cmd+D, o los que estén configurados como `pane.splitRight` y `pane.splitDown`) actualmente crean un pane vacío. Deben crear un terminal en el nuevo pane inmediatamente.

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Localizar los handlers de split en App.tsx**

Buscar en `App.tsx` las líneas con `pane.splitRight` y `pane.splitDown` (aproximadamente línea 691):

```typescript
"pane.splitRight": () => {
  if (activeWorkspace) splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "horizontal");
},
"pane.splitDown": () => {
  if (activeWorkspace) splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "vertical");
},
```

- [ ] **Step 2: Actualizar los handlers para abrir un terminal en el nuevo pane**

Reemplazar ambos handlers:

```typescript
"pane.splitRight": () => {
  if (!activeWorkspace) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "horizontal");
  openPanel(activeWorkspace.id, newPaneId, {
    id: crypto.randomUUID(),
    kind: "terminal",
    cwd: activeWorkspace.cwd,
  });
},
"pane.splitDown": () => {
  if (!activeWorkspace) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "vertical");
  openPanel(activeWorkspace.id, newPaneId, {
    id: crypto.randomUUID(),
    kind: "terminal",
    cwd: activeWorkspace.cwd,
  });
},
```

También hacer lo mismo en `commandPaletteItems` (busca `splitPaneRight` y `splitPaneDown` más abajo en el mismo archivo):

```typescript
splitPaneRight: () => {
  if (!activeWorkspace) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "horizontal");
  openPanel(activeWorkspace.id, newPaneId, {
    id: crypto.randomUUID(),
    kind: "terminal",
    cwd: activeWorkspace.cwd,
  });
},
splitPaneDown: () => {
  if (!activeWorkspace) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "vertical");
  openPanel(activeWorkspace.id, newPaneId, {
    id: crypto.randomUUID(),
    kind: "terminal",
    cwd: activeWorkspace.cwd,
  });
},
```

- [ ] **Step 3: Verificar tipos y tests**

```bash
pnpm check-types && pnpm test
```

- [ ] **Step 4: Commit**

```bash
git add src/app/App.tsx
git commit -m "fix: split shortcuts auto-open terminal in new pane instead of leaving it empty"
```

---

## Task 4: WorkspaceSidebar sortable

Iconos de workspace reordenables arrastrando.

**Files:**
- Modify: `src/app/components/WorkspaceSidebar.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Reescribir WorkspaceSidebar.tsx**

```typescript
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

type WorkspaceItem = { id: string; title: string; kind: string };

export type WorkspaceSidebarProps = {
  workspaces: WorkspaceItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onReorder: (fromId: string, toId: string) => void;
};

function abbrev(title: string, kind: string): string {
  const text = title.trim() || kind;
  const words = text.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

function idHue(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return (h >>> 0) % 360;
}

function SortableWorkspaceItem({
  ws,
  active,
  onSelect,
}: {
  ws: WorkspaceItem;
  active: boolean;
  onSelect: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: ws.id });
  const hue = idHue(ws.id);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={ws.title || ws.kind}
      aria-pressed={active}
      onClick={() => onSelect(ws.id)}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-semibold transition-all select-none cursor-grab active:cursor-grabbing",
        active
          ? "text-white"
          : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
      )}
      style={
        active
          ? {
              ...style,
              backgroundColor: `hsl(${hue} 55% 42%)`,
              boxShadow: `0 0 0 2px hsl(var(--card) / 1), 0 0 0 4px hsl(${hue} 55% 55%)`,
            }
          : style
      }
      {...attributes}
      {...listeners}
    >
      {abbrev(ws.title, ws.kind)}
    </button>
  );
}

export function WorkspaceSidebar({ workspaces, activeId, onSelect, onNew, onReorder }: WorkspaceSidebarProps) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      onReorder(String(active.id), String(over.id));
    }
  }

  return (
    <nav
      aria-label="Workspaces"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-border/60 bg-card/60 py-2"
    >
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={workspaces.map((w) => w.id)} strategy={verticalListSortingStrategy}>
          {workspaces.map((ws) => (
            <SortableWorkspaceItem
              key={ws.id}
              ws={ws}
              active={ws.id === activeId}
              onSelect={onSelect}
            />
          ))}
        </SortableContext>
      </DndContext>
      <div className="flex-1" />
      <button
        type="button"
        title="New workspace (⌘N)"
        onClick={onNew}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-border/60 text-lg text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        +
      </button>
    </nav>
  );
}
```

- [ ] **Step 2: Actualizar App.tsx**

Añadir `reorderWorkspaces` al destructuring del hook (línea ~96):

```typescript
const {
  workspaces,
  activeWorkspaceId,
  setActiveWorkspaceId,
  activeWorkspace,
  addWorkspace,
  closeWorkspace,
  reorderWorkspaces,   // NUEVO
  splitPane,
  ...
} = useWorkspaces(initialOpts);
```

Pasar la prop en el render de `WorkspaceSidebar` (línea ~874):

```tsx
<WorkspaceSidebar
  workspaces={workspaces.map((w) => ({ id: w.id, title: w.title, kind: "terminal" }))}
  activeId={activeWorkspaceId}
  onSelect={setActiveWorkspaceId}
  onNew={() => addWorkspace(inheritedCwd())}
  onReorder={reorderWorkspaces}
/>
```

- [ ] **Step 3: Verificar tipos**

```bash
pnpm check-types && pnpm lint
```

- [ ] **Step 4: Commit**

```bash
git add src/app/components/WorkspaceSidebar.tsx src/app/App.tsx
git commit -m "feat: sortable workspace sidebar with drag to reorder"
```

---

## Task 5: PaneTabBar — tabs con cursor-grab

Los tabs solo necesitan `cursor-grab` para indicar que son arrastrables. El drag real lo gestiona el `DndContext` de `WorkspaceView` (Task 6). No se usa `useSortable` aquí.

**Files:**
- Modify: `src/modules/workspaces/PaneTabBar.tsx`

- [ ] **Step 1: Añadir `panelId` como data attribute en cada tab y `cursor-grab`**

Reemplazar el componente completo:

```typescript
import { cn } from "@/lib/utils";
import { useDraggable } from "@dnd-kit/core";
import { panelIcon, panelTitle } from "./lib/panelTitle";
import type { Panel } from "./lib/types";

type Props = {
  panels: Panel[];
  activePanelId: string | null;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  onNewTerminal: () => void;
};

function DraggableTab({
  panel,
  activePanelId,
  onActivate,
  onClose,
}: {
  panel: Panel;
  activePanelId: string | null;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({ id: panel.id });
  const active = panel.id === activePanelId;

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(
        "group flex h-5 min-w-0 max-w-[140px] shrink-0 cursor-grab active:cursor-grabbing select-none items-center gap-1 rounded px-1.5 text-[11px] transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        isDragging && "opacity-40",
      )}
      onClick={() => onActivate(panel.id)}
    >
      <span className="shrink-0 text-[10px] opacity-70">{panelIcon(panel)}</span>
      <span className="truncate">{panelTitle(panel)}</span>
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

export function PaneTabBar({ panels, activePanelId, onActivate, onClose, onNewTerminal }: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-card/60 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {panels.map((p) => (
        <DraggableTab
          key={p.id}
          panel={p}
          activePanelId={activePanelId}
          onActivate={onActivate}
          onClose={onClose}
        />
      ))}
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

- [ ] **Step 2: Verificar tipos**

```bash
pnpm check-types
```

Esperado: 0 errores. (Los tabs son draggables pero no hacen nada aún porque el `DndContext` padre se añade en Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/workspaces/PaneTabBar.tsx
git commit -m "feat: panel tabs as draggable items (DndContext in WorkspaceView pending)"
```

---

## Task 6: Overlay de 5 zonas en `PaneView`

Cuando hay un drag activo, cada pane muestra un overlay con 5 zonas droppables. El overlay usa `useDndMonitor` para detectar el estado de drag sin necesitar props adicionales.

**Files:**
- Modify: `src/modules/workspaces/PaneView.tsx`

- [ ] **Step 1: Reescribir PaneView.tsx**

```typescript
import { useDroppable, useDndMonitor } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { useCallback, useState } from "react";
import { PaneTabBar } from "./PaneTabBar";
import { PanelContent } from "./PanelContent";
import type { PanelCallbacks } from "./PanelContent";
import type { PaneNode } from "./lib/types";

type Props = {
  pane: PaneNode;
  workspaceId: string;
  workspaceCwd?: string;
  focused: boolean;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  callbacks: PanelCallbacks;
};

function DropZone({
  id,
  className,
}: {
  id: string;
  className: string;
}) {
  const { setNodeRef, isOver } = useDroppable({ id });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "absolute transition-colors",
        className,
        isOver ? "bg-primary/25 ring-1 ring-inset ring-primary/60" : "bg-transparent",
      )}
    />
  );
}

export function PaneView({
  pane,
  workspaceId,
  workspaceCwd: _workspaceCwd,
  focused,
  onActivatePanel,
  onClosePanel,
  onFocusPane,
  onNewTerminal,
  callbacks,
}: Props) {
  const [isDragging, setIsDragging] = useState(false);

  useDndMonitor({
    onDragStart: () => setIsDragging(true),
    onDragEnd: () => setIsDragging(false),
    onDragCancel: () => setIsDragging(false),
  });

  const handleFocus = useCallback(() => {
    if (!focused) onFocusPane(workspaceId, pane.id);
  }, [focused, workspaceId, pane.id, onFocusPane]);

  return (
    <div
      className="relative flex h-full flex-col"
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
        {pane.panels.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Empty pane — click + to add a terminal
          </div>
        )}

        {/* 5-zone drop overlay — only visible during an active panel drag */}
        {isDragging && (
          <div className="pointer-events-none absolute inset-0 z-40">
            {/* pointer-events-auto on each zone individually so only zones receive events */}
            <DropZone
              id={`zone:${pane.id}:top`}
              className="pointer-events-auto left-0 right-0 top-0 h-1/4"
            />
            <DropZone
              id={`zone:${pane.id}:bottom`}
              className="pointer-events-auto bottom-0 left-0 right-0 h-1/4"
            />
            <DropZone
              id={`zone:${pane.id}:left`}
              className="pointer-events-auto bottom-1/4 left-0 top-1/4 w-1/4"
            />
            <DropZone
              id={`zone:${pane.id}:right`}
              className="pointer-events-auto bottom-1/4 right-0 top-1/4 w-1/4"
            />
            <DropZone
              id={`zone:${pane.id}:center`}
              className="pointer-events-auto bottom-1/4 left-1/4 right-1/4 top-1/4"
            />
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

```bash
pnpm check-types
```

Esperado: 0 errores. (Las zonas droppables existen pero el DndContext padre aún no está, se añade en Task 6.)

- [ ] **Step 3: Commit**

```bash
git add src/modules/workspaces/PaneView.tsx
git commit -m "feat: 5-zone drop overlay in PaneView (top/bottom/left/right/center)"
```

---

## Task 7: DndContext en `WorkspaceView` + `DragOverlay`

El `DndContext` de nivel superior que recibe los eventos `DragEnd` y ejecuta `movePanel` o `splitPaneAndPlace` según en qué zona cayó el panel.

**Files:**
- Modify: `src/modules/workspaces/WorkspaceView.tsx`
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Reescribir WorkspaceView.tsx**

```typescript
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { useState } from "react";
import { panelIcon, panelTitle } from "./lib/panelTitle";
import { allPanes, findPanelPane } from "./lib/splitNode";
import type { Panel, Workspace } from "./lib/types";
import type { UseWorkspacesReturn } from "./lib/useWorkspaces";
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
  onMovePanel: UseWorkspacesReturn["movePanel"];
  onSplitPaneAndPlace: UseWorkspacesReturn["splitPaneAndPlace"];
  callbacks: PanelCallbacks;
};

export function WorkspaceView({
  workspaces,
  activeWorkspaceId,
  onMovePanel,
  onSplitPaneAndPlace,
  ...rest
}: Props) {
  const [draggingPanel, setDraggingPanel] = useState<Panel | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    const panelId = String(event.active.id);
    for (const ws of workspaces) {
      const result = findPanelPane(ws.paneTree, panelId);
      if (result) { setDraggingPanel(result.panel); break; }
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    setDraggingPanel(null);
    const { active, over } = event;
    if (!over) return;

    const panelId = String(active.id);
    const overId = String(over.id);

    // Only handle zone drops (zone:<paneId>:<direction>)
    if (!overId.startsWith("zone:")) return;

    const parts = overId.split(":");
    const targetPaneId = parts[1]!;
    const zone = parts[2] as "top" | "bottom" | "left" | "right" | "center";

    // Find source workspace
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

    if (zone === "center") {
      // Don't move if dropping center on the same pane
      if (sourcePaneId === targetPaneId) return;
      onMovePanel(sourceWorkspaceId, panelId, targetPaneId);
    } else {
      onSplitPaneAndPlace(sourceWorkspaceId, targetPaneId, zone, panelId);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
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
      <DragOverlay dropAnimation={null}>
        {draggingPanel && (
          <div className="flex h-5 items-center gap-1 rounded bg-muted px-1.5 text-[11px] text-foreground shadow-lg ring-1 ring-primary/40 opacity-90 pointer-events-none">
            <span className="shrink-0 text-[10px] opacity-70">{panelIcon(draggingPanel)}</span>
            <span className="truncate max-w-[120px]">{panelTitle(draggingPanel)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
```

- [ ] **Step 2: Actualizar App.tsx para pasar las nuevas props**

Añadir `movePanel` y `splitPaneAndPlace` al destructuring del hook (~línea 96):

```typescript
const {
  workspaces,
  activeWorkspaceId,
  setActiveWorkspaceId,
  activeWorkspace,
  addWorkspace,
  closeWorkspace,
  reorderWorkspaces,
  splitPane,
  closePane,
  focusPane,
  setPaneDivider,
  movePanel,           // NUEVO
  splitPaneAndPlace,   // NUEVO
  openPanel,
  activatePanel,
  closePanel,
  updatePanelData,
  setTerminalPanelCwd,
  findPanelGlobal,
  findPaneGlobal,
  resetWorkspaces,
} = useWorkspaces(initialOpts);
```

Actualizar el render de `WorkspaceView` (~línea 929):

```tsx
<WorkspaceView
  workspaces={workspaces}
  activeWorkspaceId={activeWorkspaceId}
  onActivatePanel={(wsId, panelId) => activatePanel(wsId, panelId)}
  onClosePanel={(wsId, panelId) => {
    const found = findPanelGlobal(panelId);
    if (found?.panel.kind === "terminal") disposeSession(panelId);
    closePanel(wsId, panelId);
  }}
  onFocusPane={(wsId, paneId) => focusPane(wsId, paneId)}
  onNewTerminal={(wsId, paneId) => {
    const ws = workspaces.find((w) => w.id === wsId);
    openPanel(wsId, paneId, {
      id: crypto.randomUUID(),
      kind: "terminal",
      cwd: ws?.cwd,
    });
  }}
  onDividerChange={(wsId, splitId, pos) => setPaneDivider(wsId, splitId, pos)}
  onMovePanel={movePanel}
  onSplitPaneAndPlace={splitPaneAndPlace}
  callbacks={panelCallbacks}
/>
```

- [ ] **Step 3: Verificar tipos, lint y tests**

```bash
pnpm check-types && pnpm lint && pnpm test
```

Esperado: 0 errores.

- [ ] **Step 4: Commit**

```bash
git add src/modules/workspaces/WorkspaceView.tsx src/app/App.tsx
git commit -m "feat: DndContext in WorkspaceView with 5-zone panel drag (split + move)"
```

---

## Task 8: Verificación visual manual

- [ ] **Step 1: Lanzar la app**

```bash
pnpm tauri dev
```

- [ ] **Step 2: Verificar workspace sidebar drag**

1. Crear 3+ workspaces con el `+`
2. Arrastrar el icono del workspace 1 por debajo del workspace 3
3. El orden cambia. El workspace activo sigue activo.

- [ ] **Step 3: Verificar split con terminal auto-creado**

1. Dividir con el shortcut de teclado (`pane.splitRight` / `pane.splitDown`)
2. El nuevo pane tiene un terminal. No está vacío.

- [ ] **Step 4: Verificar 5 zonas — center**

1. Tener dos panes (dividir con el shortcut)
2. Arrastrar un tab del pane A sobre el pane B (zona center)
3. El tab pasa al pane B como tab adicional
4. El pane A sigue existiendo (tenía más de 1 panel)

- [ ] **Step 5: Verificar 5 zonas — direccional, pane origen con varios paneles**

1. En el pane A, abrir varios terminales (con `+`)
2. Arrastrar un tab al lado derecho (zona `right`) del pane B
3. El pane B se divide y el panel arrastrado queda en la nueva mitad derecha
4. El pane A sigue existiendo y perdió ese tab

- [ ] **Step 6: Verificar auto-close de pane vacío**

1. Tener un pane con un solo tab
2. Arrastrar ese tab a la zona center de otro pane
3. El pane origen desaparece y el espacio se redistribuye

- [ ] **Step 7: Verificar DragOverlay**

Al arrastrar un tab, aparece una miniatura del tab bajo el cursor.

- [ ] **Step 8: Verificar close último tab**

1. En un pane con un solo tab, cerrar ese tab (botón ×)
2. El pane desaparece (comportamiento ya existente — verificar que sigue funcionando)

---

## Self-Review

### Spec coverage

| Requerimiento | Task |
|---|---|
| Reordenar workspaces arrastrando sidebar | Task 4 |
| Drag de panel tab con 5 zonas (top/bottom/left/right/center) | Tasks 5 + 6 + 7 |
| Center = mover como tab al pane destino | Task 7 (`onMovePanel`) |
| Direccional = dividir pane y colocar panel | Task 7 (`onSplitPaneAndPlace`) |
| Pane vacío tras drag se auto-cierra | Task 1 (`movePanelBetweenPanes` auto-collapse) |
| Split por teclado auto-crea terminal | Task 3 |
| Close último tab = close pane | YA implementado en `closePanel` (Phase 2) |
| Cross-window IPC `terax:workspace-transfer` | Phase 5 |

### Consistencia de tipos

- `splitPaneInTree` mantiene compatibilidad hacia atrás (el parámetro `newPanePosition` es opcional con default `"second"`) — todos los callers existentes siguen funcionando ✓
- `UseWorkspacesReturn["movePanel"]` y `["splitPaneAndPlace"]` tipan correctamente las props de `WorkspaceView` ✓
- Zone IDs siguen el formato `zone:${paneId}:${direction}` — parseados de forma consistente en `handleDragEnd` ✓

### Notas para el executor

1. `useDndMonitor` en `PaneView` (Task 6) requiere que el componente esté dentro de un `DndContext` antecesor. Como `DndContext` se añade en Task 7 (en `WorkspaceView`), los tests visuales de las zonas solo funcionan después de completar la Task 7. Las Tasks 5 y 6 son pasos intermedios que compilan sin errores pero el drag no hace nada visualmente hasta Task 7.

2. `PointerSensor` con `activationConstraint: { distance: 6 }` — 6px de movimiento antes de que se active el drag. Esto es deliberado: evita que un click normal sobre un tab se interprete como inicio de drag.

3. El `DragOverlay` con `dropAnimation={null}` evita la animación de retorno cuando el panel no se suelta en una zona válida. El tab simplemente desaparece del overlay sin animación.

4. Las zonas droppables cubren el content area del pane (debajo del tab bar). El tab bar sigue teniendo `pointer-events` normales para click/hover. Las zonas del overlay tienen `pointer-events-none` en el contenedor padre y `pointer-events-auto` individualmente en cada zona div.

5. Cuando se hace `splitPaneAndPlace` con el panel que era el único del pane origen, `movePanelBetweenPanes` colapsa ese pane. El resultado es que el split que acabas de crear en el target tiene solo el panel que arrastraste, y el pane origen desaparece — net effect: el workspace tiene el mismo número de panes que antes, pero reorganizados.
