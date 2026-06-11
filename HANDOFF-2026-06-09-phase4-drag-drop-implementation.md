# Handoff: Phase 4 Drag & Drop Implementation

**Date:** 2026-06-09
**Branch:** main
**Session focus:** Diseñar e implementar Phase 4 drag & drop UI completo.

---

## Estado al terminar la sesión

### Phase 4 - Drag & Drop UI

**Plan:** `docs/superpowers/plans/2026-06-09-phase4-drag-drop-ui.md`
**Estado: CÓDIGO COMPLETO, verificación visual PENDIENTE**

Todos los commits de Phase 4 están en `main` desde `b9fd3dd` hasta `79a6bc6`.

#### Modelo de interacción implementado

El drag funciona con **5 zonas de drop** sobre el content area de cada pane:

```
┌──────────────────────┐
│      TOP (25%)        │
├───┬──────────────┬───┤
│   │              │   │
│ L │   CENTER     │ R │
│   │   (50%)      │   │
├───┴──────────────┴───┤
│      BOTTOM (25%)    │
└──────────────────────┘
```

- **Center**: mueve el panel como tab al pane destino
- **Left/Right/Top/Bottom**: divide el pane destino en esa dirección y coloca el panel en la nueva mitad
- **WorkspaceSidebar**: iconos de workspace reordenables arrastrando (sistema independiente con su propio `DndContext`)

#### Invariantes del modelo (todos implementados)

- Pane vacío tras drag = auto-colapso (via `movePanelBetweenPanes` en `splitNode.ts`)
- Split por teclado (`pane.splitRight`, `pane.splitDown`) auto-crea terminal en nuevo pane
- Close del último tab = cierre del pane (ya existía en Phase 2, sigue funcionando)

#### Commits de Phase 4

| Hash | Descripción |
|------|-------------|
| `b9fd3dd` | feat: splitPaneInTree newPanePosition param + movePanelBetweenPanes with auto-collapse |
| `fd2e878` | feat: add reorderWorkspaces, movePanel, splitPaneAndPlace to useWorkspaces |
| `1dcd67c` | fix: split shortcuts auto-open terminal in new pane instead of leaving it empty |
| `c81aa8c` | feat: sortable workspace sidebar with drag to reorder |
| `bfa81ae` | feat: panel tabs as draggable items with useDraggable |
| `71b45dd` | feat: 5-zone drop overlay in PaneView (top/bottom/left/right/center) |
| `79a6bc6` | feat: DndContext in WorkspaceView with 5-zone panel drag (split + move) |

#### Tests

`pnpm check-types` y `pnpm test` pasando: **111/111 tests, 0 errores de tipos**.

---

## Verificación visual PENDIENTE (Task 8)

La app estaba corriendo cuando terminó la sesión pero el usuario no confirmó el comportamiento. Los casos a verificar:

- [ ] Arrastrar icono de workspace en sidebar reordena la lista
- [ ] Split con Cmd+\ o Cmd+D crea terminal en nuevo pane (no pane vacío)
- [ ] Al arrastrar un tab, aparecen las 5 zonas highlight en los panes
- [ ] Drop en zona `right`/`left`/`top`/`bottom` divide el pane y coloca el tab
- [ ] Drop en zona `center` de otro pane mueve el tab sin dividir
- [ ] Si el pane origen queda vacío tras el drag, desaparece automáticamente
- [ ] DragOverlay: aparece miniatura del tab bajo el cursor durante el drag
- [ ] Close del último tab de un pane cierra el pane (regresión)

Si se encuentran bugs durante la verificación, los archivos a editar son:
- Lógica de split/move: `src/modules/workspaces/lib/splitNode.ts`
- Acciones de estado: `src/modules/workspaces/lib/useWorkspaces.ts`
- Overlay visual: `src/modules/workspaces/PaneView.tsx`
- Orquestación DndContext: `src/modules/workspaces/WorkspaceView.tsx`

---

## Archivos modificados en Phase 4

```
src/modules/workspaces/lib/splitNode.ts          añadido newPanePosition param + movePanelBetweenPanes
src/modules/workspaces/lib/splitNode.test.ts     +14 tests nuevos (33 total)
src/modules/workspaces/lib/useWorkspaces.ts      +reorderWorkspaces, movePanel, splitPaneAndPlace
src/app/App.tsx                                  fix split shortcuts + nuevas props WorkspaceView + WorkspaceSidebar
src/app/components/WorkspaceSidebar.tsx          reescrito completo con DndContext + useSortable
src/modules/workspaces/PaneTabBar.tsx            reescrito con useDraggable
src/modules/workspaces/PaneView.tsx              añadido overlay 5 zonas + useDndMonitor
src/modules/workspaces/WorkspaceView.tsx         reescrito con DndContext + DragOverlay + onDragEnd handler
```

---

## Arquitectura de los dos sistemas de drag

### Sistema 1: Workspace sidebar (independiente)
```
WorkspaceSidebar
  └── DndContext (closestCenter)
       └── SortableContext (vertical)
            └── SortableWorkspaceItem (useSortable)
```
- `onDragEnd` llama `reorderWorkspaces(fromId, toId)`
- `PointerSensor` con `activationConstraint: { distance: 4 }`

### Sistema 2: Panel tabs (WorkspaceView level)
```
WorkspaceView
  └── DndContext (closestCenter)
       ├── SplitNodeView → PaneView
       │    ├── PaneTabBar → DraggableTab (useDraggable)
       │    └── 5-zone overlay (useDroppable x5, useDndMonitor)
       └── DragOverlay (ghost tab)
```
- IDs de zonas: `zone:${paneId}:top|bottom|left|right|center`
- `onDragEnd` parsea el zone ID → llama `movePanel` o `splitPaneAndPlace`
- `PointerSensor` con `activationConstraint: { distance: 6 }`

---

## Decisiones de diseño tomadas en esta sesión

1. **5 zonas sobre el content area, no sortable en tab bar.** El usuario confirmó que el modelo correcto es el de cmux: 5 zonas directionales. Sortable dentro del tab bar puede añadirse después si se pide.

2. **`movePanelBetweenPanes` colapsa el pane origen si queda vacío.** Es una función pura en `splitNode.ts` que auto-llama `removePaneFromTree`. Esto es un cambio de comportamiento respecto al plan original donde era una Task opcional.

3. **Cross-window workspace transfer (IPC `terax:workspace-transfer`) queda en Phase 5.** Requiere decisiones sobre PTY lifecycle al transferir entre ventanas.

4. **Split por teclado siempre crea terminal.** El pane nuevo del split recibe un `{ kind: "terminal", cwd: activeWorkspace.cwd }` inmediatamente. Esto corrige un bug preexistente.

---

## Lecciones aprendidas

**`aria-pressed` duplicado con `{...attributes}` de dnd-kit**: dnd-kit's `useSortable` incluye `aria-pressed` en el spread de `attributes`. Si el elemento JSX ya tiene `aria-pressed` explícito ANTES del spread, TypeScript lanza TS2783. Solución: poner `aria-pressed` DESPUÉS del spread.

**`useDndMonitor` en `PaneView`**: este hook se suscribe al `DndContext` más próximo en el árbol. Funciona correctamente siempre que `PaneView` esté descendiente del `DndContext` de `WorkspaceView`. No hace falta pasar props de `isDragging` por el árbol.

**noUnusedLocals**: si se desestructura del hook algo que no se usa aún en el mismo archivo, TypeScript falla con TS6133. Añadir los destructurings al mismo tiempo que se usan.

---

## Estado de las phases

| Phase | Estado |
|-------|--------|
| Phase 1 - Shell Layout | COMPLETO |
| Phase 2 - Workspace/Pane/Panel Architecture | COMPLETO |
| Phase 4 - Drag & Drop UI | CÓDIGO COMPLETO, verificación pendiente |
| Phase 3 - tmux daemon | No iniciado (puede hacerse independientemente) |
| Phase 5 - Cross-window IPC | No iniciado |

---

## Suggested skills

- `verify` — para ejecutar la verificación visual de Phase 4 en la app
- `superpowers:systematic-debugging` — si la verificación visual revela bugs en el drag
- `superpowers:writing-plans` — si se quiere diseñar Phase 3 (tmux daemon) o Phase 5 (cross-window IPC)
- `handoff` — al terminar la siguiente sesión
