# Workspaces — bugs encontrados y cómo se resolvieron

Este documento registra los problemas de la capa workspace/terminal que resultaron no obvios de
diagnosticar. El objetivo es que no haya que re-descubrirlos.

Para entender cómo funciona el sistema, lee primero [WORKSPACES.md](WORKSPACES.md).

---

## Bug 1: tabs del pane inferior no responden al click (RESUELTO)

### Síntoma

Cuando hay dos panes apilados verticalmente (uno arriba, uno abajo), los tabs del pane inferior
no responden al click de forma intermitente.

### Causa raíz

`react-resizable-panels` registra un listener en **capture phase** sobre `document`:

```javascript
document.addEventListener("pointerdown", De, true)  // capture = true
```

La función `De` llama a `e.preventDefault()` si el puntero está dentro del hit region del
separador. El separador visual tiene `h-px` (1px). La librería impone un mínimo de 10px
(`resizeTargetMinimumSize: { fine: 10 }`), por lo que expande el hit region:

```
expansion = (10 - 1) / 2 = 4.5px
hit region efectivo: separador.y - 4.5 a separador.y + 5.5
```

Esos ~5.5px se meten dentro del tab bar del pane inferior. Cuando `preventDefault()` se llama en
`pointerdown` capture (antes de cualquier handler de React), **WebKit suprime el evento `click`**
(y probablemente también `pointerup` en WKWebView, a diferencia del spec W3C).

### Fix

`src/components/ui/resizable.tsx`: separador horizontal `h-[10px]` con fondo transparente y línea
visual 1px centrada vía `::after`. A exactamente 10px, la librería no expande el hit region y
termina justo donde empieza el tab bar.

### Intentos fallidos

**Experimento 1 (empeoró):** reemplazar `onClick` en `DraggableTab` por `onPointerDown` +
`onPointerUp`, reenviando el evento a dnd-kit manualmente. Rompió todos los tabs porque el
synthetic event de React no es compatible con la máquina de estados de dnd-kit.

**Experimento 2 (no resolvió):** fallback `onPointerUp` a nivel del contenedor `PaneTabBar`,
usando `data-panel-id` para identificar el tab y activarlo si el movimiento fue < 6px. No fue
suficiente porque WebKit en WKWebView probablemente también suprime `pointerup` cuando
`preventDefault()` fue llamado en capture, al contrario del spec.

**Opción B (descartada):** listener capture en `document` con `stopImmediatePropagation()` para
bloquear al de react-resizable-panels. Descartada porque el orden de registro depende del orden de
montado, lo que lo hace frágil.

---

## Bug 2: drag de tabs falla intermitentemente (RESUELTO)

### Síntoma

Al intentar arrastrar un tab, el cursor de grab aparece brevemente y el drag se cancela antes de
activarse. Ocurre solo a veces, no siempre.

### Causa

El tab bar tiene `overflow-x: auto`. WebKit (WKWebView en Tauri) detecta el movimiento inicial
como un posible scroll horizontal y emite `pointercancel`, cancelando el drag de dnd-kit antes de
que alcance el umbral de activación de 6px. Ocurre intermitentemente porque depende del ángulo del
primer movimiento: más horizontal = más probable que WebKit lo interprete como scroll.

### Fix

`touch-action: none` (`touch-none` clase Tailwind) en `DraggableTab`. Deshabilita el handling
por defecto de touch/pointer del browser para ese elemento, impidiendo que WebKit emita
`pointercancel`. Esto está recomendado explícitamente en la documentación de dnd-kit para
elementos en contenedores scrollables.

### Notas de diagnóstico

- Añadir `onDragCancel` al `DndContext` era necesario: sin él, el estado de `draggingPanel`
  quedaba colgado si el drag se cancelaba con Escape.
- El linter (Biome) eliminó `cursor-grab` del className en varias ocasiones durante el diagnóstico.
  La clase debe estar presente junto con `active:cursor-grabbing` y `touch-none`.
- Se añadió un `useEffect` en `WorkspaceView` con listeners capture para `pointerdown`,
  `pointermove`, `pointerup`, `pointercancel` a nivel `document` para depuración. Está pendiente
  de eliminar cuando se confirme estabilidad definitiva.

---

## Bug 3: "Too many active WebGL contexts" (RESUELTO)

### Síntoma

Warning en consola: `There are too many active WebGL contexts on this page, the oldest context
will be lost.` El terminal más antiguo cae silenciosamente al renderer DOM (más lento).

### Causa raíz

En `PaneView.tsx`, `visible={panel.id === pane.activePanelId}` no consideraba si el workspace
estaba activo. Todos los workspaces (activos e inactivos) mantenían sus paneles activos con
`visible=true`, conservando cada uno su contexto WebGL indefinidamente. WKWebView en macOS permite
~8-16 contextos simultáneos. Con varios workspaces con varios panes se llegaba al límite con
facilidad.

### Relación con el bug 2

Posiblemente contributiva, aunque no es la causa principal. Cuando un contexto WebGL se pierde,
`onContextLoss` dispara `addon.dispose()` y programa una recuperación que modifica el DOM (elimina
y recrea el canvas del terminal). Esta mutación del DOM durante un drag podría haber interferido
con el pointer tracking de dnd-kit en algunos casos. El `touch-none` del bug 2 es la causa
primaria.

### Fix

1. `PaneView.tsx`: `visible={panel.id === pane.activePanelId && isWorkspaceActive}`. Workspaces
   inactivos liberan sus slots; el estado se serializa como snapshot y se restaura al volver.

2. `rendererPool.ts`: constante `WEBGL_MAX_CONTEXTS = 7`. Antes de crear un nuevo contexto WebGL,
   si ya hay 7 activos, se libera el slot idle más antiguo. Si todos están en uso, se omite el
   attach (el slot usa DOM renderer). Red de seguridad para patrones de uso no cubiertos por el
   fix anterior.

### Aclaración: no hay límite de tabs

No hay límite en el número de tabs abiertos. El límite es de contextos WebGL activos
simultáneamente. El número de contextos activos en condiciones normales es:

```
contextos activos ≈ número de panes en el workspace activo
```

Tabs no-activos dentro de un pane tienen `visible=false` y no consumen contexto. Workspaces
inactivos ídem desde el fix anterior.

---

## Bug 4 (PENDIENTE): WebGL no se adjunta al arrancar ni en terminales nuevos

### Síntoma

Al arrancar con varios terminales restaurados, ninguno muestra GPU. A medida que el usuario
crea terminales adicionales (split, Cmd+T), los terminales *existentes* eventualmente obtienen
GPU, pero el *nuevo* terminal nunca lo consigue.

### Lo que sabemos con certeza

**Secuencia de arranque relevante** (`main.tsx`):

```
await initWorkspaceState()         // IPC, carga el estado guardado
ReactDOM.createRoot(...).render()  // programa el render
await invoke("restore_window_geometry")
setTimeout(showWindow, 50)         // ventana oculta hasta aquí
setTimeout(showWindow, 500)        // safety-net
```

`main.tsx` dice explícitamente en un comentario:
> "rAF is throttled while the window is hidden and would never fire"

**Secuencia de montaje del terminal** (desde el montado del componente):

1. `useTerminalSession` setup effect → `ensureSession` → `s.ready` Promise
2. `s.ready = (async () => { await ensureMonoFontsLoaded(); await document.fonts.ready; })()`
3. Las fuentes están bundled, `document.fonts.ready` resuelve en ~1-5ms
4. `attachSession` → `bindLeafToSlot` → `bindSlot` → `scheduleUnhide` → rAF encolado
5. Todo esto ocurre a t~5ms, **antes de `showWindow` a t=50ms**

En `scheduleUnhide`, los rAFs encolados mientras la ventana está oculta **no disparan** (o se
descartan) cuando la ventana se muestra.

**Por qué los terminales existentes sí consiguen GPU después de un split:**

Cuando el usuario divide un pane, `react-resizable-panels` redimensiona el contenedor del terminal
existente. El `ResizeObserver` detecta el cambio (`w !== lastW`) y llama directamente a
`fitAddon.fit()`. Añadir el retry de WebGL ahí funcionó porque:
- El contenedor tiene dimensiones reales
- La ventana lleva tiempo visible (el usuario la está usando)
- La llamada es directa, sin depender de rAF

**Por qué el terminal nuevo nunca consigue GPU:**

El nuevo terminal se monta con el contenedor dentro de un `ResizablePanelGroup` que puede
empezar en 0×0. La secuencia es:
1. `bindSlot`: `container.clientWidth = 0` → `slot.lastW = 0`
2. `scheduleUnhide`: rAF encolado
3. `ResizeObserver` se dispara cuando el container pasa de 0→real
4. Pero `slot.currentLeafId !== p.leafId` puede ser verdad (React Strict Mode hace doble
   montaje: el primer mount se limpia, el segundo mount tiene un slot diferente)
5. El second mount's ResizeObserver ya puede encontrar `w === slot.lastW` si el container tenía
   dimensiones reales en el momento del segundo `bindSlot`

### Intentos fallidos (todos en `rendererPool.ts`)

| Intento | Razón del fallo |
|---|---|
| `setWindowActive(true)` → `applyWebglToSlots()` | `windowActive` puede inicializarse como `true` (WKWebView reporta `hasFocus()=true` aunque la ventana esté oculta). El guard `if (windowActive === active) return` bloquea el retry. |
| `prefsHydrated` en deps de `webglPref` useEffect | `loadPreferences()` puede resolver antes del `showWindow`. `applyWebglPreference` es llamado pero los slots aún tienen 0×0 o la GPU no está lista. |
| `setTimeout(retryMissingWebgl, 600)` en `configureRendererPool` | Solo se ejecuta **una vez al importar el módulo**. Para terminales creados después (split, Cmd+T), esos 600ms ya pasaron. |
| Backoff global `[300, 600, 1000, 1500, 2500, 4000]` | Mismo problema: se programa al importar el módulo, no cuando se crea cada terminal. |
| Por-slot retry desde `bindSlot`: `scheduleSlotWebglRetry(leafId)` | Se ejecuta pero `attachWebgl` sigue fallando. Posiblemente la superficie GPU de WKWebView no está lista incluso a 200ms, 500ms, etc. post-bind. |
| Mover unhide al outer rAF (1 frame antes del attach WebGL) | El problema no es el timing entre unhide y attach; es que WKWebView no proporciona la superficie GPU hasta un momento indeterminado post-`window.show()`. |
| `ResizeObserver` retry al pasar de 0×0 a dimensiones reales | Funciona para terminales existentes tras un split, pero no para el terminal nuevo por la razón del punto anterior. |

### Un test que funcionó (no reproducible de forma fiable)

Con la build que incluía `console.log("[terax-webgl] attached slot X")` en `attachWebgl`, el
usuario reportó "6 attached slot X" por ventana al arrancar, con GPU en todos los terminales.
No se ha podido determinar qué condición concreta hizo que funcionara ese intento.

### Hipótesis para el siguiente intento

El problema es de sincronización entre `window.show()` y la disponibilidad de la superficie GPU
de WKWebView. `canvas.getContext('webgl2')` devuelve null (o lanza) cuando se llama antes de que
la superficie esté lista. El número de ms exacto varía.

**Hipótesis A (más probable)**: `main.tsx` es el único lugar donde sabemos exactamente cuándo
se muestra la ventana. Llamar `applyWebglPreference(true)` explícitamente desde `main.tsx`
después de `showWindow` + un delay medido es más fiable que cualquier mecanismo indirecto.

```typescript
// main.tsx, después del setTimeout(showWindow, 50):
setTimeout(() => {
  // importar rendererPool y llamar applyWebglPreference
}, 300); // 300ms post-show
```

El obstáculo: `applyWebglPreference` itera `slots[]` — necesita que React ya haya montado los
terminales. A t=350ms desde el inicio (50ms show + 300ms delay) los componentes llevan ~345ms
montados, suficiente.

**Hipótesis B**: El problema es que `attachWebgl` falla silenciosamente (`catch` vacío). Si se
loguea el error exacto, puede revelar que es un problema de canvas 0×0, no de GPU surface.
`slot.term.cols` y `slot.term.rows` serían 0 si `fitAddon.fit()` produjo 0×0. En ese caso el
fix es que `attachWebgl` no intente crear el contexto si el terminal tiene 0 cols/rows.

**Hipótesis C**: Usar el evento Tauri `tauri://window-created` o escuchar el focus nativo de
WKWebView para disparar `applyWebglPreference` en el momento exacto en que la ventana tiene
superficie GPU disponible.

### Lo que NO se debe hacer

- Más retries en `rendererPool.ts` sin entender la causa raíz: se ha añadido y quitado
  `applyWebglToSlots`, `scheduleWebglRetries`, `scheduleSlotWebglRetry`, etc. sin éxito.
- Modificar `scheduleUnhide` sin confirmar que el problema está ahí.
- Asumir que un timeout mayor resuelve el problema sin verificarlo primero.

---

## Bug 4b: geometría de ventana — tamaño se restaura, posición descartada (RESUELTO PARCIALMENTE)

### Estado final

**Tamaño**: se guarda en pixels físicos (`inner_size()`) y se restaura con `set_size(PhysicalSize)`
llamado desde un comando IPC (`restore_window_geometry`) invocado en `main.tsx` antes del `show()`
— equivalente al `on_window_ready` del plugin oficial. Funciona de forma fiable.

**Posición**: descartada intencionalmente. Restaurar posición en macOS resultó demasiado frágil
para el riesgo que supone (ventana fuera de pantalla al cambiar de monitor). macOS coloca la
ventana automáticamente.

### Historial de problemas encontrados

#### Save: `if let` triple falla silenciosamente

El handler `CloseRequested` original agrupaba tres llamadas en un solo `if let`:

```rust
if let (Ok(pos), Ok(inner), Ok(scale)) =
    (w.outer_position(), w.inner_size(), w.scale_factor())
```

Si cualquiera falla, el bloque completo se omite. En particular `scale_factor()` puede fallar
cuando el WebKit ya está parcialmente desmontado al cerrar. La geometría queda en el valor por
defecto del JSON (0×0 o 1280×800).

**Fix**: separar las llamadas. `scale_factor()` con `unwrap_or(1.0)`.

#### Save: geometría no se persiste si el proceso se mata (Ctrl-C en dev)

`CloseRequested` no se dispara cuando el proceso se termina por señal. El JSON quedaba con los
valores por defecto creados en `add_window()`.

**Fix**: guardar geometría también en `WindowEvent::Focused(true)` y `Resized` para que la
última geometría conocida quede en disco aunque la app sea matada.

#### Save/restore: unidades mezcladas (físico vs lógico)

`outer_position()` e `inner_size()` devuelven pixels físicos. `WebviewWindowBuilder::inner_size()`
y `.position()` esperan pixels lógicos. En Retina 2×, guardar físico (2560×1600) como lógico
producía una ventana de 5120×3200 (el doble del monitor).

**Fix**: para el tamaño, `inner_size()` (físico) se pasa directamente a `set_size(PhysicalSize)`.
Para posición se intentó `to_logical(scale)` pero se descartó junto con la posición.

#### Restore de posición: macOS cascade sobreescribe cualquier posición pre-show

macOS aplica cascade (reposicionamiento automático) cuando muestra una ventana. Probado y fallido:

- **`builder.position(x, y)`**: ignorado por cascade en `orderFront:`.
- **`set_position()` antes de `show()`**: frame aplicado en ventana oculta, descartado al mostrar.
- **`set_position()` justo después de `show()` (síncrono)**: `orderFront:` es asíncrono en Cocoa;
  la llamada llega antes de que AppKit procese el show.
- **`set_position()` en `Focused(true)`**: funciona a veces pero no de forma fiable en todos los
  ciclos (dependiendo del estado de focus al arrancar con múltiples ventanas).
- **`restore_window_geometry` IPC desde `main.tsx` con `PhysicalPosition`**: funciona en algunos
  casos pero inconsistente según el monitor y el orden de creación de ventanas.

El plugin oficial (`tauri-plugin-window-state`) usaba `WindowEvent::Ready` de Tauri 1 para esto.
En Tauri 2 ese evento no existe. Sin un equivalente fiable, la restauración de posición es
demasiado frágil para el riesgo de dejar ventanas fuera de pantalla en configuraciones
multi-monitor o al cambiar de monitor.

**Decisión**: no restaurar posición. macOS coloca las ventanas automáticamente.

---

## Estado de archivos tras todos los fixes

| Archivo | Cambio |
|---|---|
| `src/components/ui/resizable.tsx` | Separador horizontal `h-[10px]`, fondo transparente, línea visual 1px vía `::after` |
| `src/modules/workspaces/PaneTabBar.tsx` | `onClick` en `DraggableTab` + fallback `onPointerUp` en contenedor; `touch-none` y `cursor-grab` en `DraggableTab` |
| `src/modules/workspaces/PaneView.tsx` | `visible={panel.id === pane.activePanelId && isWorkspaceActive}` |
| `src/modules/workspaces/WorkspaceView.tsx` | `onDragCancel` en `DndContext`; `document.body.style.cursor` sincrónico durante drag; debug logging pendiente de eliminar |
| `src/modules/terminal/lib/rendererPool.ts` | `WEBGL_MAX_CONTEXTS = 7` con reap proactivo en `attachWebgl` |
