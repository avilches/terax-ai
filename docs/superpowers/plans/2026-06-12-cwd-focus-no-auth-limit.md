# CWD por foco + sin limite de autorización en shell - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cmd+T abre el terminal en el CWD del tab activo, workspace.cwd se actualiza dinámicamente al navegar, y los shell commands del frontend pueden ejecutarse en cualquier directorio sin restricción de whitelist.

**Architecture:** Tres cambios independientes: (1) sustituir `authorize_spawn_cwd` por `authorize_user_spawn_cwd` en el backend de shell, eliminando la comprobación de whitelist; (2) añadir `setWorkspaceCwd` a `useWorkspaces` y llamarlo desde `onCwd` cuando el panel es el activo del pane activo; (3) centralizar la apertura de nuevos terminales en `openNewTerminal` que usa `activeCwd` en lugar del CWD inicial del workspace.

**Tech Stack:** Rust (Tauri commands), React 19, TypeScript, Vitest

---

## Archivos modificados

| Archivo | Cambio |
|---|---|
| `src-tauri/src/modules/shell/mod.rs` | Sustituir `authorize_spawn_cwd` por `authorize_user_spawn_cwd` en 4 sitios + actualizar import |
| `src/modules/workspaces/lib/useWorkspaces.ts` | Añadir `setWorkspaceCwd` + exportarlo en el return |
| `src/app/App.tsx` | Añadir `openNewTerminal`, actualizar `onCwd`, eliminar `authorizedCwds` y `inheritedCwd`, actualizar todos los handlers |

---

## Task 1: Backend - eliminar whitelist en shell commands

**Files:**
- Modify: `src-tauri/src/modules/shell/mod.rs:17,55,179,214,242`

- [ ] **Paso 1: Verificar que los tests actuales pasan (baseline)**

```bash
cd src-tauri && cargo test --locked 2>&1 | tail -5
```
Esperado: `test result: ok. N passed`

- [ ] **Paso 2: Actualizar el import en shell/mod.rs**

En `src-tauri/src/modules/shell/mod.rs` línea 17, cambiar:
```rust
use crate::modules::workspace::{authorize_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
```
por:
```rust
use crate::modules::workspace::{authorize_user_spawn_cwd, WorkspaceEnv, WorkspaceRegistry};
```

- [ ] **Paso 3: Sustituir `authorize_spawn_cwd` por `authorize_user_spawn_cwd` en los 4 sitios**

Línea 55 (en `shell_run_command`):
```rust
authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
```

Línea 179 (en `shell_session_open`):
```rust
authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
```

Línea 214 (en `shell_session_run`):
```rust
authorize_user_spawn_cwd(&registry, cwd.as_deref(), &effective_workspace)?;
```

Línea 242 (en `shell_bg_spawn`):
```rust
authorize_user_spawn_cwd(&registry, cwd.as_deref(), &workspace)?;
```

- [ ] **Paso 4: Verificar que compila y los tests siguen pasando**

```bash
cd src-tauri && cargo clippy 2>&1 | grep -E "^error" && cargo test --locked 2>&1 | tail -5
```
Esperado: sin errores de clippy, `test result: ok. N passed`

- [ ] **Paso 5: Commit**

```bash
git add src-tauri/src/modules/shell/mod.rs
git commit -m "refactor(shell): remove cwd whitelist restriction, allow any valid directory"
```

---

## Task 2: Frontend - añadir `setWorkspaceCwd` a `useWorkspaces`

**Files:**
- Modify: `src/modules/workspaces/lib/useWorkspaces.ts`

- [ ] **Paso 1: Añadir la función `setWorkspaceCwd` en `useWorkspaces.ts`**

Justo después de `setTerminalRunningCommand` (línea ~318), añadir:

```typescript
const setWorkspaceCwd = useCallback((workspaceId: string, cwd: string) => {
  setWorkspaces((prev) =>
    prev.map((w) => w.id === workspaceId ? { ...w, cwd } : w)
  );
}, []);
```

- [ ] **Paso 2: Exportar `setWorkspaceCwd` en el return del hook**

En el objeto `return` (alrededor de línea 348), añadir `setWorkspaceCwd` junto a `setTerminalPanelCwd`:

```typescript
return {
  // ... resto de campos existentes ...
  setTerminalPanelCwd,
  setWorkspaceCwd,      // <- añadir aquí
  setTerminalRunningCommand,
  // ...
};
```

- [ ] **Paso 3: Verificar tipos**

```bash
pnpm check-types 2>&1 | head -20
```
Esperado: sin errores

- [ ] **Paso 4: Commit**

```bash
git add src/modules/workspaces/lib/useWorkspaces.ts
git commit -m "feat(workspaces): add setWorkspaceCwd to track active terminal cwd"
```

---

## Task 3: Frontend - actualizar `onCwd` y eliminar `workspaceAuthorize`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Paso 1: Añadir `setWorkspaceCwd` a la destructuración de `useWorkspaces`**

En la destructuración del hook `useWorkspaces` (alrededor de línea 91), añadir `setWorkspaceCwd`:

```typescript
const {
  // ... todos los campos existentes ...
  setTerminalPanelCwd,
  setWorkspaceCwd,      // <- añadir aquí
  setTerminalRunningCommand,
  // ...
} = useWorkspaces(initialOpts);
```

- [ ] **Paso 2: Eliminar el ref `authorizedCwds`**

Eliminar la línea 394 completa:
```typescript
// ELIMINAR esta línea:
const authorizedCwds = useRef(new Set<string>());
```

- [ ] **Paso 3: Reemplazar el bloque `onCwd` en `panelCallbacks`**

Localizar el callback `onCwd` (líneas 406-415). Reemplazarlo por:

```typescript
onCwd: (panelId, cwd) => {
  const found = findPanelGlobal(panelId);
  if (found) {
    setTerminalPanelCwd(found.workspace.id, panelId, cwd);
    if (
      found.workspace.activePaneId === found.pane.id &&
      found.pane.activePanelId === panelId
    ) {
      setWorkspaceCwd(found.workspace.id, cwd);
    }
  }
},
```

- [ ] **Paso 4: Actualizar el array de deps de `panelCallbacks`**

En el array de dependencias del `useMemo` de `panelCallbacks` (líneas 476-485), añadir `setWorkspaceCwd`:

```typescript
[
  activePanelId,
  findPanelGlobal,
  closePanel,
  setTerminalPanelCwd,
  setWorkspaceCwd,      // <- añadir aquí
  setTerminalRunningCommand,
  updatePanelData,
  activeWorkspace,
  openPanel,
],
```

- [ ] **Paso 5: Verificar tipos y tests**

```bash
pnpm check-types 2>&1 | head -20 && pnpm test 2>&1 | tail -10
```
Esperado: sin errores de tipos, tests en verde

- [ ] **Paso 6: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): track workspace cwd from active terminal, remove workspaceAuthorize"
```

---

## Task 4: Frontend - `openNewTerminal` + limpiar `inheritedCwd`

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Paso 1: Añadir la función `openNewTerminal`**

Justo después de la definición de `inheritedCwd` (alrededor de línea 282), añadir:

```typescript
const openNewTerminal = useCallback((targetPaneId?: string) => {
  if (!activeWorkspace) return;
  openPanel(activeWorkspace.id, targetPaneId ?? activeWorkspace.activePaneId, {
    id: crypto.randomUUID(),
    kind: "terminal",
    cwd: activeCwd ?? activeWorkspace.cwd,
  });
}, [activeWorkspace, activeCwd, openPanel]);
```

- [ ] **Paso 2: Actualizar los shortcut handlers `tab.new`, `pane.splitRight`, `pane.splitDown`**

Reemplazar el handler `tab.new` (líneas 747-754):
```typescript
"tab.new": () => {
  openNewTerminal();
},
```

Reemplazar el handler `pane.splitRight` (líneas 779-787). El cuerpo queda:
```typescript
"pane.splitRight": () => {
  if (!activeWorkspace) return;
  const { paneSplitLimit, workspacePaneLimit } = usePreferencesStore.getState();
  if (allPanes(activeWorkspace.paneTree).length >= workspacePaneLimit) return;
  const el = document.querySelector<HTMLElement>(`[data-pane-id="${activeWorkspace.activePaneId}"]`);
  if (!el || el.getBoundingClientRect().width < paneSplitLimit.width) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "horizontal");
  openNewTerminal(newPaneId);
},
```

Reemplazar el handler `pane.splitDown` (líneas 788-796). El cuerpo queda:
```typescript
"pane.splitDown": () => {
  if (!activeWorkspace) return;
  const { paneSplitLimit, workspacePaneLimit } = usePreferencesStore.getState();
  if (allPanes(activeWorkspace.paneTree).length >= workspacePaneLimit) return;
  const el = document.querySelector<HTMLElement>(`[data-pane-id="${activeWorkspace.activePaneId}"]`);
  if (!el || el.getBoundingClientRect().height < paneSplitLimit.height) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "vertical");
  openNewTerminal(newPaneId);
},
```

- [ ] **Paso 3: Actualizar `workspace.new` para usar `home`**

Reemplazar el handler `workspace.new` (línea 755):
```typescript
"workspace.new": () => addWorkspace(home ?? undefined),
```

- [ ] **Paso 4: Actualizar deps de `shortcutHandlers`**

En el array de deps del `useMemo` de `shortcutHandlers` (líneas 822-843):
- Eliminar `inheritedCwd`
- Añadir `openNewTerminal`
- Añadir `activeCwd` (capturado por `openNewTerminal`)

Resultado parcial del array:
```typescript
[
  activeWorkspace,
  activeWorkspaceId,
  activePane,
  activePanelId,
  activeCwd,          // <- añadir
  workspaces,
  openCommandPalette,
  cycleWorkspace,
  activatePanel,
  handleCloseActivePanel,
  // inheritedCwd,   // <- eliminar
  openNewTerminal,   // <- añadir
  addWorkspace,
  openPanel,
  openPreviewInPanel,
  splitPane,
  focusPane,
  toggleSourceControl,
  setActiveWorkspaceId,
  // ... resto sin cambios
],
```

- [ ] **Paso 5: Actualizar los items del command palette**

Localizar los handlers en `createCommandItems` (alrededor de líneas 888-920). Reemplazar:

`openNewTab`:
```typescript
openNewTab: () => {
  openNewTerminal();
},
```

`openNewWorkspace`:
```typescript
openNewWorkspace: () => addWorkspace(home ?? undefined),
```

`openNewBlock`:
```typescript
openNewBlock: () => addWorkspace(home ?? undefined),
```

`splitPaneRight` (dentro del palette):
```typescript
splitPaneRight: () => {
  if (!activeWorkspace) return;
  const { paneSplitLimit, workspacePaneLimit } = usePreferencesStore.getState();
  if (allPanes(activeWorkspace.paneTree).length >= workspacePaneLimit) return;
  const el = document.querySelector<HTMLElement>(`[data-pane-id="${activeWorkspace.activePaneId}"]`);
  if (!el || el.getBoundingClientRect().width < paneSplitLimit.width) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "horizontal");
  openNewTerminal(newPaneId);
},
```

`splitPaneDown` (dentro del palette):
```typescript
splitPaneDown: () => {
  if (!activeWorkspace) return;
  const { paneSplitLimit, workspacePaneLimit } = usePreferencesStore.getState();
  if (allPanes(activeWorkspace.paneTree).length >= workspacePaneLimit) return;
  const el = document.querySelector<HTMLElement>(`[data-pane-id="${activeWorkspace.activePaneId}"]`);
  if (!el || el.getBoundingClientRect().height < paneSplitLimit.height) return;
  const newPaneId = splitPane(activeWorkspace.id, activeWorkspace.activePaneId, "vertical");
  openNewTerminal(newPaneId);
},
```

- [ ] **Paso 6: Actualizar deps del palette useMemo**

En el array de deps del palette `useMemo` (líneas 930-945):
- Eliminar `inheritedCwd`
- Añadir `openNewTerminal`

```typescript
[
  commandPaletteOpen,
  activeWorkspace,
  workspaces.length,
  activeWorkspaceId,
  searchTarget,
  explorerRoot,
  home,
  addWorkspace,
  openPanel,
  // inheritedCwd,    // <- eliminar
  openNewTerminal,    // <- añadir
  openPreviewInPanel,
  openGitGraphFromContext,
  toggleSourceControl,
  handleCloseActivePanel,
  splitPane,
  toggleRightPanel,
],
```

- [ ] **Paso 7: Actualizar `WorkspaceSidebar onNew`**

Localizar (línea 976):
```typescript
onNew={() => addWorkspace(inheritedCwd())}
```
Reemplazar por:
```typescript
onNew={() => addWorkspace(home ?? undefined)}
```

- [ ] **Paso 8: Eliminar `inheritedCwd`**

Eliminar la función `inheritedCwd` completa (líneas 282-284):
```typescript
// ELIMINAR estas líneas:
const inheritedCwd = useCallback((): string | undefined => {
  return activeCwd ?? lastTerminalCwdRef.current ?? home ?? undefined;
}, [activeCwd, home]);
```

`lastTerminalCwdRef` se mantiene porque lo sigue usando `explorerRoot` (línea 271).

- [ ] **Paso 9: Verificar lint, tipos y tests**

```bash
pnpm lint 2>&1 | head -20 && pnpm check-types 2>&1 | head -20 && pnpm test 2>&1 | tail -10
```
Esperado: sin errores de lint ni tipos, tests en verde

- [ ] **Paso 10: Commit**

```bash
git add src/app/App.tsx
git commit -m "feat(app): open new terminals in focused tab cwd, new workspace uses home"
```
