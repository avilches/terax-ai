# WebGL Startup Retry (Hypothesis A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conseguir que todos los terminales tengan GPU al arrancar, llamando `retryMissingWebgl()` desde `main.tsx` ~300ms despues de `showWindow`.

**Architecture:** Nueva funcion `retryMissingWebgl()` en `rendererPool.ts` que reintenta el attach de WebGL en todos los slots activos sin WebGL. Se llama desde `main.tsx` a t=350ms (show a t=50ms + 300ms de margen para la GPU surface de WKWebView). Este es el unico punto del codigo donde se sabe exactamente cuando se muestra la ventana.

**Tech Stack:** TypeScript, xterm.js WebglAddon, Tauri 2 (WKWebView / macOS)

---

## Por que fallaron los intentos anteriores

Ver `docs/WORKSPACES_GOTCHAS.md` Bug 4. Resumen:
- Los terminales llaman `bindSlot` a ~t=5ms, antes de `showWindow` a t=50ms
- `scheduleUnhide` usa doble rAF, pero los rAFs no disparan mientras la ventana esta oculta
- Todos los retries anteriores se ejecutaron, pero `attachWebgl` fallaba porque la GPU surface de WKWebView no estaba lista
- `main.tsx` es el unico lugar donde se conoce el momento exacto de visibilidad

### Lo que NO se debe hacer (ya probado, no repetir)

- Mas retries en `scheduleUnhide` o `bindSlot`
- Global backoff al importar el modulo (solo funciona para los terminales del arranque, no para nuevos)
- Depender de `windowActive`, `prefsHydrated`, o `ResizeObserver` como trigger

---

## Archivos

- **Modify:** `src/modules/terminal/lib/rendererPool.ts` -- nueva funcion `retryMissingWebgl()`
- **Modify:** `src/main.tsx` -- import + `setTimeout(retryMissingWebgl, 350)`
- **Modify:** `docs/WORKSPACES_GOTCHAS.md` -- documentar resultado

---

## Task 1: Agregar `retryMissingWebgl()` a `rendererPool.ts`

**Files:**
- Modify: `src/modules/terminal/lib/rendererPool.ts`

La funcion itera todos los slots e intenta adjuntar WebGL a los que estan activos (tienen `currentLeafId`) pero no tienen `webglAddon`. `attachWebgl` ya verifica `terminalWebglEnabled` internamente, por lo que es seguro llamar `retryMissingWebgl` sin comprobar la preferencia externamente.

- [ ] **Step 1: Agregar la funcion exportada despues de `applyWebglPreference` (linea 779)**

Insertar despues del `}` de cierre de `applyWebglPreference`:

```typescript
export function retryMissingWebgl(): void {
  if (!usePreferencesStore.getState().terminalWebglEnabled) return;
  for (const slot of slots) {
    if (slot.currentLeafId !== null && !slot.webglAddon) {
      attachWebgl(slot);
      if (slot.webglAddon) {
        try {
          slot.term.refresh(0, slot.term.rows - 1);
        } catch {}
      }
    }
  }
}
```

- [ ] **Step 2: Verificar tipos**

```bash
pnpm check-types
```

Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add src/modules/terminal/lib/rendererPool.ts
git commit -m "feat(terminal): add retryMissingWebgl() for explicit post-show GPU retry"
```

---

## Task 2: Llamar `retryMissingWebgl()` desde `main.tsx`

**Files:**
- Modify: `src/main.tsx`

- [ ] **Step 1: Agregar import**

En `src/main.tsx`, agregar al bloque de imports (despues del import de `flushWorkspaceState`):

```typescript
import { retryMissingWebgl } from "./modules/terminal/lib/rendererPool";
```

- [ ] **Step 2: Agregar la llamada despues del safety-net showWindow**

Despues de la linea `setTimeout(showWindow, 500);` (linea 54), agregar:

```typescript
// At t=350ms the window has been visible for ~300ms -- enough for WKWebView's GPU
// surface to initialize. Retries slots that missed WebGL at startup (rAFs throttled
// while the window was hidden, GPU surface not yet ready at first scheduleUnhide).
setTimeout(retryMissingWebgl, 350);
```

El bloque resultante debe quedar asi:

```typescript
setTimeout(showWindow, 50);
// Safety net: if the first show somehow fails to take effect, force again.
setTimeout(showWindow, 500);
// At t=350ms the window has been visible for ~300ms -- enough for WKWebView's GPU
// surface to initialize. Retries slots that missed WebGL at startup (rAFs throttled
// while the window was hidden, GPU surface not yet ready at first scheduleUnhide).
setTimeout(retryMissingWebgl, 350);
```

- [ ] **Step 3: Lint y tipos**

```bash
pnpm check-types && pnpm lint
```

Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add src/main.tsx
git commit -m "fix(terminal): retry WebGL 300ms after showWindow to fix missing GPU at startup"
```

---

## Task 3: Verificar en la app

El badge de debug GPU esta activo en `PaneView.tsx` (pill amarillo "GPU"). Usarlo para confirmar.

- [ ] **Step 1: Arrancar la app**

```bash
pnpm tauri dev
```

- [ ] **Step 2: Observar el badge GPU**

Inmediatamente al abrir la app, observar si aparece el pill "GPU" en el badge del pane.

- **Si funciona:** el pill "GPU" aparece ~350ms despues de abrir la app en todos los terminales visibles.
- **Si no funciona:** el pill "GPU" sigue ausente. Ir al Step 3.

- [ ] **Step 3 (solo si falla): Agregar logging en `attachWebgl` para diagnosticar**

En `src/modules/terminal/lib/rendererPool.ts`, cambiar el catch de `attachWebgl` (linea ~706):

```typescript
// Antes:
} catch (e) {
  console.warn("[terax-webgl] unavailable:", e);
}

// Despues:
} catch (e) {
  console.warn("[terax-webgl] attach failed slot", slot.id,
    "cols:", slot.term.cols, "rows:", slot.term.rows, "error:", e);
}
```

Y agregar log de exito despues de `slot.webglCanvases = added;` (linea ~705):

```typescript
slot.webglAddon = webgl;
slot.webglCanvases = added;
console.log("[terax-webgl] attached slot", slot.id);
```

Relanzar la app y revisar la consola. El error revelara si el fallo es:
- Canvas 0x0 (`slot.term.cols === 0`) -- el fix es no intentar crear el contexto con 0 cols
- GPU surface no disponible (`getContext returned null`) -- el fix es aumentar el delay

---

## Task 4: Actualizar `docs/WORKSPACES_GOTCHAS.md`

**Files:**
- Modify: `docs/WORKSPACES_GOTCHAS.md`

- [ ] **Step 1 (si funciono): Marcar Bug 4 como resuelto**

Cambiar el header de `## Bug 4 (PENDIENTE): WebGL no se adjunta al arrancar ni en terminales nuevos` a `## Bug 4 (RESUELTO PARCIALMENTE o RESUELTO): WebGL no se adjunta al arrancar`.

Agregar seccion "Fix" antes de "Hipotesis para el siguiente intento":

```markdown
### Fix (Hypothesis A -- arranque)

`rendererPool.ts`: nueva funcion `retryMissingWebgl()` que itera slots activos sin WebGL
y llama `attachWebgl` + `refresh`.

`main.tsx`: `setTimeout(retryMissingWebgl, 350)` tras `showWindow` a t=50ms. A t=350ms la
GPU surface de WKWebView esta inicializada (~300ms de margen). Los slots llevan ~345ms
montados, suficiente para que React haya ejecutado `bindSlot` en todos los terminales.
```

Si los terminales nuevos (split, Cmd+T) siguen sin GPU, documentar como problema abierto
separado.

- [ ] **Step 2 (si fallo): Agregar a la tabla de intentos fallidos**

```markdown
| `retryMissingWebgl` desde `main.tsx` a t=350ms | [describir error exacto del log] |
```

- [ ] **Step 3: Commit**

```bash
git add docs/WORKSPACES_GOTCHAS.md
git commit -m "docs: document Bug 4 outcome after Hypothesis A"
```
