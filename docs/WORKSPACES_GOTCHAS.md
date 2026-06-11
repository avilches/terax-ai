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

---

## Bug 4: geometría de ventana (posición/tamaño) no se guarda ni restaura (EN CURSO)

### Síntoma

Al cerrar y reabrir la app, las ventanas aparecen siempre en posición y tamaño por defecto
(1280×800, posición aleatoria por macOS). El JSON `workspaces.json` siempre muestra `x:0, y:0,
width:1280, height:800`.

### Causa 1 — save: `if let` triple falla silenciosamente

El handler `CloseRequested` usaba:

```rust
if let (Ok(pos), Ok(inner), Ok(scale)) =
    (w.outer_position(), w.inner_size(), w.scale_factor())
```

Si cualquiera de los tres falla (en particular `scale_factor()` que puede fallar si el WebKit
ya está parcialmente desmontado), el bloque completo se salta y la geometría nunca se actualiza.
La entrada en el JSON queda con los valores por defecto (0, 0, 1280, 800).

**Fix**: separar las llamadas y usar `unwrap_or(1.0)` para `scale_factor()` de modo que un fallo
en ella no impida guardar posición y tamaño.

### Causa 2 — save: unidades mezcladas (físico vs lógico)

`outer_position()` e `inner_size()` devuelven **pixels físicos**. El builder
`WebviewWindowBuilder::inner_size(f64, f64)` y `.position(f64, f64)` esperan **pixels lógicos**.
En pantallas Retina (scale_factor=2), guardar físico (2560×1600) y restaurar como lógico produce
una ventana de 5120×3200 lógicos (doble de la pantalla).

**Fix**: convertir siempre a lógico al guardar: `pos.to_logical(scale)` y `inner.to_logical(scale)`.

### Causa 3 — restore: macOS "cascade" ignora posición pre-show

macOS aplica posicionamiento automático (cascade) cuando una ventana se muestra por primera vez.
Cualquier posición establecida antes de `show()` — ya sea en el builder (`.position()`) o
mediante `set_position()` en un estado oculto — puede ser sobreescrita por el OS.

Establecer la posición justo después de `show()` (sincrónico) tampoco funciona de forma fiable
porque AppKit procesa el `orderFront:` de forma asíncrona en el run loop de Cocoa.

**Fix correcto**: escuchar `WindowEvent::Focused(true)` con un flag de "primer foco". Cuando la
ventana recibe foco por primera vez, macOS ya ha terminado de posicionarla (cascade completado).
Aplicar `set_size(LogicalSize)` y `set_position(LogicalPosition)` en ese momento garantiza que
la geometría se establece sobre la ventana ya visible y estabilizada.

### Intentos fallidos de restore

- **`builder.position(x, y)` en el builder**: ignorado por macOS cascade al hacer `show()`.
- **`set_position()` antes de `show()`**: el frame se aplica en ventana oculta pero macOS lo
  descarta al hacer `orderFront:`.
- **`set_position()` justo después de `show()` (síncrono)**: `show()` pone el `orderFront:` en
  la cola del run loop de Cocoa; la llamada síncrona siguiente a `set_position()` llega antes de
  que Cocoa procese el show, por lo que la posición se aplica en la ventana todavía oculta y
  macOS la sobreescribe al mostrarla.

### Nota sobre `tauri-plugin-window-state`

El plugin oficial usaba `WindowEvent::Ready` (disponible en Tauri 1) para aplicar geometría
después de que la ventana estuviera completamente inicializada. En Tauri 2 ese evento no existe.
El equivalente más cercano es el primer `Focused(true)`.

---

## Estado de archivos tras todos los fixes

| Archivo | Cambio |
|---|---|
| `src/components/ui/resizable.tsx` | Separador horizontal `h-[10px]`, fondo transparente, línea visual 1px vía `::after` |
| `src/modules/workspaces/PaneTabBar.tsx` | `onClick` en `DraggableTab` + fallback `onPointerUp` en contenedor; `touch-none` y `cursor-grab` en `DraggableTab` |
| `src/modules/workspaces/PaneView.tsx` | `visible={panel.id === pane.activePanelId && isWorkspaceActive}` |
| `src/modules/workspaces/WorkspaceView.tsx` | `onDragCancel` en `DndContext`; `document.body.style.cursor` sincrónico durante drag; debug logging pendiente de eliminar |
| `src/modules/terminal/lib/rendererPool.ts` | `WEBGL_MAX_CONTEXTS = 7` con reap proactivo en `attachWebgl` |
