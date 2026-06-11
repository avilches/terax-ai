# Workspace Focus Restore + Tab Focus Indicator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Al cambiar de workspace, restaurar el foco en el terminal activo; y mostrar una línea azul de 2px en la parte superior del tab que tiene el foco global.

**Architecture:** Feature 1 añade un `useEffect` en App.tsx que detecta cambios en `activeWorkspaceId` y llama `focus()` en el terminal activo via `terminalHandles`. Feature 2 añade un prop `paneFocused` a `PaneTabBar` y renderiza un div de 2px azul solo cuando el tab es activo y el pane tiene el foco global.

**Tech Stack:** React (useEffect, useRef), Tailwind CSS, TypeScript

---

### Task 1: Línea azul en tab con foco global

**Files:**
- Modify: `src/modules/workspaces/PaneTabBar.tsx`
- Modify: `src/modules/workspaces/PaneView.tsx`

Este cambio es puramente visual y no tiene lógica que probar con unit tests. Se verifica manualmente.

- [ ] **Step 1: Añadir prop `paneFocused` a `DraggableTab` y al indicador visual**

En `src/modules/workspaces/PaneTabBar.tsx`, modificar `DraggableTab`:

```tsx
function DraggableTab({
  panel,
  activePanelId,
  paneFocused,
  onActivate,
  onClose,
}: {
  panel: Panel;
  activePanelId: string | null;
  paneFocused: boolean;
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
        "group relative flex h-5 min-w-0 max-w-[140px] shrink-0 cursor-grab active:cursor-grabbing select-none items-center gap-1 rounded px-1.5 text-[11px] transition-colors",
        active
          ? "bg-muted text-foreground"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        isDragging && "opacity-40",
      )}
      onClick={() => onActivate(panel.id)}
    >
      {active && paneFocused && (
        <div className="absolute inset-x-0 top-0 h-0.5 rounded-t bg-primary" />
      )}
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
```

- [ ] **Step 2: Añadir prop `paneFocused` a `PaneTabBar` y pasarlo a `DraggableTab`**

En `src/modules/workspaces/PaneTabBar.tsx`, modificar el tipo `Props` y el componente `PaneTabBar`:

```tsx
type Props = {
  panels: Panel[];
  activePanelId: string | null;
  paneFocused: boolean;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  onNewTerminal: () => void;
};

export function PaneTabBar({ panels, activePanelId, paneFocused, onActivate, onClose, onNewTerminal }: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-card/60 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {panels.map((p) => (
        <DraggableTab
          key={p.id}
          panel={p}
          activePanelId={activePanelId}
          paneFocused={paneFocused}
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

- [ ] **Step 3: Pasar `paneFocused={focused}` desde `PaneView`**

En `src/modules/workspaces/PaneView.tsx`, en el JSX donde se renderiza `<PaneTabBar>`:

```tsx
<PaneTabBar
  panels={pane.panels}
  activePanelId={pane.activePanelId}
  paneFocused={focused}
  onActivate={(panelId) => onActivatePanel(workspaceId, panelId)}
  onClose={(panelId) => onClosePanel(workspaceId, panelId)}
  onNewTerminal={() => onNewTerminal(workspaceId, pane.id)}
/>
```

- [ ] **Step 4: Verificar que TypeScript compila sin errores**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && npx tsc --noEmit
```

Expected: sin errores de tipo.

- [ ] **Step 5: Commit**

```bash
git add src/modules/workspaces/PaneTabBar.tsx src/modules/workspaces/PaneView.tsx
git commit -m "feat: blue focus indicator on active tab of focused pane"
```

---

### Task 2: Foco automático al cambiar workspace

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Añadir `useEffect` en App.tsx para restaurar foco al cambiar workspace**

En `src/app/App.tsx`, añadir el siguiente efecto después del bloque de efectos existentes (por ejemplo, después del efecto de `saveWorkspaceState`, alrededor de la línea 150). Necesita importar `findPane` que ya está importado en el fichero.

```ts
useEffect(() => {
  const ws = workspacesRef.current.find((w) => w.id === activeWorkspaceId);
  if (!ws) return;
  const pane = findPane(ws.paneTree, ws.activePaneId);
  if (!pane?.activePanelId) return;
  const panelId = pane.activePanelId;
  const raf = requestAnimationFrame(() => {
    terminalHandles.current.get(panelId)?.focus();
  });
  return () => cancelAnimationFrame(raf);
}, [activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps
```

El comentario `eslint-disable-line` es necesario porque intencionalmente usamos `workspacesRef` en lugar de `workspaces` para evitar que el efecto se dispare cuando cambia el árbol de panes sin que cambie el workspace activo.

- [ ] **Step 2: Verificar que TypeScript compila sin errores**

```bash
cd /Users/avilches/Work/Proy/Repos/terax-ai && npx tsc --noEmit
```

Expected: sin errores de tipo.

- [ ] **Step 3: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat: focus active terminal when switching workspaces"
```
