# Handoff: Phase 1 spec completion review

**Date:** 2026-06-09
**Branch:** main
**Session focus:** Auditar qué queda por hacer de la Phase 1 spec y cerrar Phase 2.

---

## Estado general

La sesión anterior completó Phase 2 en su totalidad. Este handoff recoge el estado de ambas fases.

### Phase 1 - Shell Layout Design

**Spec:** `docs/superpowers/specs/2026-06-08-phase1-shell-layout-design.md`
**Plan:** `docs/superpowers/plans/2026-06-08-phase1-shell-layout.md`
**Estado: COMPLETO (código)**

Commits de Phase 1: `b8a66d9` a `477e99d`.

| Item spec | Estado |
|-----------|--------|
| `rightPanelOpen/Width/ActiveTab/Side` preference keys | DONE |
| `WorkspaceSidebar` (52px, lista de workspaces) | DONE |
| `RightPanel` (Explorer/Git/History tabs, resizable) | DONE |
| `open_main_window` Tauri command | DONE |
| `Header` sin TabBar | DONE |
| Shortcuts: `rightPanel.toggle`, `window.new`, `workspace.prev/next` | DONE |
| `SidebarRail` y `useSidebarPanel` eliminados | DONE |
| `Tab.id` UUID string | SUPERSEDED (módulo tabs eliminado en Phase 2) |
| `@dnd-kit/*` instalado como dependencia | DONE |
| `App.tsx` layout 3 columnas | DONE |

### Phase 2 - Workspace/Pane/Panel Architecture

**Spec:** `docs/superpowers/specs/2026-06-09-phase2-workspace-pane-model-design.md`
**Plan:** `docs/superpowers/plans/2026-06-09-phase2-workspace-pane-model.md`
**Estado: COMPLETO**

Commits: `b8f3d8f` a `a8b34e0`.

Highlights de lo implementado:
- `Workspace -> SplitNode (árbol binario) -> PaneNode -> Panel[]`
- `useWorkspaces` (reemplaza `useTabs`)
- `WorkspaceView -> SplitNodeView -> PaneView -> PanelContent`
- `PanelCallbacks` interface tipada, propagada por todo el árbol
- Lazy loading con `React.lazy()` para todos los paneles pesados (EditorPane, GitDiffPane, MarkdownPreviewPane, PreviewPane, GitHistoryPane)
- `workspaceState.ts` con `LazyStore` para persistir cwds entre sesiones
- Módulo `src/modules/tabs/` eliminado completamente
- Stack files muertos eliminados (EditorStack, GitDiffStack, MarkdownStack, etc.)
- Tests pasando: `pnpm test`, `pnpm lint`, `pnpm check-types`

---

## Lo que queda por hacer

### 1. Testing manual (Phase 1 + 2)

El checklist de la spec requiere ejecutar la app. Ninguno de estos puntos ha sido verificado en runtime:

- [ ] Terminal tabs abren y PTYs funcionan normalmente
- [ ] Explorer sigue el cwd del terminal activo (OSC 7)
- [ ] Panel de source control muestra git status
- [ ] Git history pane renderiza el commit graph
- [ ] Right panel redimensiona y colapsa correctamente
- [ ] Estado del right panel (width, tab, open) persiste entre reinicios
- [ ] WorkspaceSidebar muestra todos los workspaces, click cambia correctamente
- [ ] `+` en workspace sidebar crea nuevo terminal workspace
- [ ] `Cmd+Shift+N` abre nueva ventana con workspace list independiente
- [ ] Notificacion bell visible en header
- [ ] Window controls sin cambios (macOS traffic lights)
- [ ] `pnpm check-types`, `pnpm lint`, `pnpm test` en clean checkout

### 2. Limpieza menor

`src/modules/sidebar/` solo tiene `index.ts` + `types.ts`, exportando `SidebarViewId`. Está activo porque `useSourceControlContext.ts` lo importa. No es deuda -- es un módulo de tipo ligítimo. Sin acción requerida.

### 3. Phase 3 - tmux daemon (out of scope hasta ahora)

La spec Phase 1 excluye explícitamente la persistencia de contenido de sesión de terminal (scrollback, procesos en curso). Eso va en Phase 3.

### 4. Phase 4 - Drag & Drop UI

`@dnd-kit/*` está instalado (prerequisito cumplido en Phase 1). La UI de drag no existe aún. Phase 4 entregará:
- Reordenar workspaces arrastrando en `WorkspaceSidebar`
- Mover paneles entre panes arrastrando `PaneTabBar`
- Protocolo IPC cross-window con evento `terax:workspace-transfer`

---

## Archivos clave modificados esta sesión (Phase 2)

```
src/app/App.tsx                             reescrito completo
src/main.tsx                                +initWorkspaceState()
src/modules/workspaces/PanelContent.tsx     lazy loading paneles pesados
src/modules/workspaces/lib/useWorkspaces.ts acepta initial opts, useRef init
src/modules/workspaces/lib/workspaceState.ts NUEVO - persistencia con LazyStore
src/modules/editor/useEditorFileSync.ts     tipo local EditorItem[]
src/modules/theme/useThemeFileEditing.ts    tipo local PanelItem[]
src/modules/source-control/useSourceControlContext.ts tipo local PanelItem[]
src/modules/agents/components/AgentNotificationsBridge.tsx .at(-1) fix
src/modules/terminal/index.ts               eliminadas exports Stack/panes
src/modules/editor/index.ts                 eliminadas exports Stack
src/modules/git-history/index.ts            eliminada export Stack
src/modules/markdown/index.ts               export MarkdownPreviewPane directo
src/modules/preview/index.ts                eliminada export Stack
```

Archivos eliminados: módulo `src/modules/tabs/` completo, `panes.ts`, `PaneTreeView.tsx`, `TerminalStack.tsx`, `WorkspaceSurface.tsx`, todos los `*Stack.tsx`, `AiDiffPane.tsx`.

---

## Lecciones aprendidas

**`Array.prototype.at(-1)` no está en la lib TS del proyecto** -- usar `arr[arr.length - 1]`.

**Lazy loading necesario para pasar el bundle budget test** -- `src/app/eager-budget.test.ts` verifica que `@codemirror`, `@uiw` y `streamdown` no están en el grafo eager desde `main.tsx`. Como `PanelContent` es importado estáticamente por la cadena `WorkspaceView -> App.tsx -> main.tsx`, todos los paneles pesados deben ser lazy dentro de `PanelContent`.

**Dos `useState` lazy initializers no pueden compartir estado** -- si ambos necesitan el mismo UUID generado una sola vez (para que `activeWorkspaceId` apunte a un workspace real), hay que pre-computar en un `useRef` null-check antes de los `useState`.

**`LazyStore` options**: requiere el campo `defaults: {}` aunque sea vacío; `{ autoSave: false }` solo da error TS.

---

## Suggested skills

Para el próximo trabajo:

- `superpowers:executing-plans` -- si hay un plan de Phase 3 o Phase 4 listo para ejecutar
- `superpowers:writing-plans` -- si hay que diseñar Phase 3 (tmux daemon) primero
- `handoff` -- al terminar una sesión larga para continuidad
