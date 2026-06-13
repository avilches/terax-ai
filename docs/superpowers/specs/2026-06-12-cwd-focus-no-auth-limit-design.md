# Spec: CWD por foco + sin limite de autorización en shell

## Objetivo

Tres comportamientos relacionados que se cambian de una vez:

1. **Cmd+T y splits** abren el terminal en el CWD actual del tab/pane activo, no en el CWD inicial del workspace.
2. **`workspace.cwd`** se mantiene actualizado al CWD del terminal activo del pane activo.
3. **Shell commands** (git, explorer, run command) pueden ejecutarse en cualquier directorio valido, sin whitelist de paths autorizados.
4. **Nuevo workspace** abre siempre en el home del usuario, sin heredar el CWD del workspace actual.

---

## Contexto actual

### workspace.cwd - nunca se actualiza

`workspace.cwd` se fija al crear el workspace (`newWorkspace(cwd)`) y nunca cambia. El campo `panel.cwd` si se actualiza via OSC 7, pero `workspace.cwd` no.

`tab.new`, `pane.splitRight` y `pane.splitDown` usan `activeWorkspace.cwd` - el directorio inicial, ignorando donde esta el usuario ahora mismo.

### El sistema de autorización

`WorkspaceRegistry` en Rust mantiene una lista blanca de paths autorizados (`roots`):

- Al arrancar (`bootstrap_registry`): se autorizan el directorio de lanzamiento y `home`.
- Cuando un terminal navega (OSC 7 → `onCwd` → `native.workspaceAuthorize`): el CWD se añade a `roots`.
- `authorize_spawn_cwd` (usado en `shell_run_command`, sesiones shell, background procs): comprueba que el CWD este bajo algun root. Si no, devuelve error.
- `authorize_user_spawn_cwd` (usado en `pty_open`): en lugar de comprobar, auto-registra. No tiene restriccion.

En la practica la restriccion solo muerde para paths fuera de home (`/Volumes/...`, `/tmp/...`, etc.). Pero es una restriccion innecesaria para un emulador de terminal.

---

## Cambios

### Frontend - App.tsx

#### openNewTerminal - funcion unica

Se añade una funcion en `App.tsx` que centraliza la logica de abrir un terminal nuevo:

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

`activeCwd` ya existe en App.tsx: es `activePanel.cwd` cuando el panel activo es un terminal, `null` si es editor/preview/etc. El fallback a `activeWorkspace.cwd` cubre el caso en que el panel activo no es un terminal.

Los handlers que cambian:
- `tab.new`: llama `openNewTerminal()`
- `pane.splitRight`: crea el nuevo pane, luego llama `openNewTerminal(newPaneId)`
- `pane.splitDown`: idem
- Command palette `openNewTab`: llama `openNewTerminal()`
- Command palette `splitPaneRight` / `splitPaneDown`: idem con el nuevo paneId

#### workspace.cwd - actualizacion dinamica

Se añade `setWorkspaceCwd(workspaceId: string, cwd: string)` a `useWorkspaces`:

```typescript
const setWorkspaceCwd = useCallback((workspaceId: string, cwd: string) => {
  setWorkspaces((prev) =>
    prev.map((w) => w.id === workspaceId ? { ...w, cwd } : w)
  );
}, []);
```

En el callback `onCwd` de `panelCallbacks`, despues de `setTerminalPanelCwd`, se añade:

```typescript
if (
  found.workspace.activePaneId === found.pane.id &&
  found.pane.activePanelId === panelId
) {
  setWorkspaceCwd(found.workspace.id, cwd);
}
```

`found` viene de `findPanelGlobal(panelId)` que usa `workspacesRef.current`, asi que siempre tiene el estado actual aunque `panelCallbacks` este memoizado.

Esto garantiza: `workspace.cwd` = CWD del terminal activo del pane activo. Cuando el usuario cambia de pane o de tab, `workspace.cwd` se actualiza la proxima vez que ese terminal emita OSC 7 (al ejecutar cualquier comando). No se actualiza instantaneamente al cambiar de foco - esto es aceptable porque `openNewTerminal` ya usa `activeCwd` directamente.

#### Nuevo workspace - siempre home

`workspace.new` y las equivalentes del palette cambian:
- `addWorkspace(inheritedCwd())` → `addWorkspace(home ?? undefined)`

`inheritedCwd()` y `lastTerminalCwdRef` se eliminan si no tienen otros usos. Si `explorerRoot` los usa, se mantienen pero desacoplados de `addWorkspace`.

#### Eliminar workspaceAuthorize

Del callback `onCwd` se elimina:
- El `Set<string>` de deduplicacion `authorizedCwds`
- La llamada a `native.workspaceAuthorize(cwd)`

El metodo `workspaceAuthorize` en `native.ts` se puede dejar (el comando Tauri sigue existiendo) pero ya no se invoca desde el frontend.

---

### Backend - shell/mod.rs

Los cuatro sitios que llaman a `authorize_spawn_cwd` pasan a llamar a `authorize_user_spawn_cwd`:

- `shell_run_command` (linea ~55)
- `shell_session_run` (linea ~179)
- `shell_bg_spawn` (linea ~214)
- `shell_bg_run` (linea ~242)

`authorize_user_spawn_cwd` valida que el path exista y sea un directorio (devuelve error si no), pero en lugar de rechazar paths fuera de la lista blanca, los registra. Semanticamente: cualquier directorio valido del sistema de archivos funciona.

`authorize_spawn_cwd` y su test `authorize_spawn_cwd_rejects_unauthorized_path` quedan como infraestructura sin uso activo desde shell commands. Se pueden dejar o eliminar - si se eliminan hay que actualizar los tests en `workspace.rs`. Se mantienen por ahora para no romper el historial de tests.

---

## Archivos afectados

| Archivo | Cambio |
|---|---|
| `src/app/App.tsx` | Añadir `openNewTerminal`, actualizar handlers, eliminar `authorizedCwds` y `workspaceAuthorize`, cambiar `addWorkspace` en workspace.new |
| `src/modules/workspaces/lib/useWorkspaces.ts` | Añadir `setWorkspaceCwd` |
| `src-tauri/src/modules/shell/mod.rs` | Sustituir `authorize_spawn_cwd` por `authorize_user_spawn_cwd` en 4 sitios |

---

## Lo que NO cambia

- El titulo del workspace (fijado al crear, no sigue al CWD)
- `WorkspaceRegistry` y sus tests
- El comportamiento de la PTY (ya usaba `authorize_user_spawn_cwd`)
- `authorize_spawn_cwd` como funcion (se queda, solo deja de usarse en shell commands)
- `workspaceAuthorize` Tauri command (se queda en el backend, solo se deja de invocar desde el frontend)

---

## Casos limite

- **Panel activo no es terminal** (editor, preview, git-diff): `activeCwd` es null, `openNewTerminal` usa `activeWorkspace.cwd` como fallback.
- **No hay workspace activo**: `openNewTerminal` hace early return.
- **CWD del nuevo terminal invalido** (directorio borrado): el PTY lo maneja igual que siempre - `pty_open` usaba y sigue usando `authorize_user_spawn_cwd` que devolvera error si el path no existe.
- **Shell command con CWD invalido**: `authorize_user_spawn_cwd` sigue validando que el path sea un directorio real. El cambio solo quita la restriccion de whitelist, no la validacion basica.
