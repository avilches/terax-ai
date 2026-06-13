# Pendiente: mejorar los destinos de drop del drag-to-move del explorer

Estado: pendiente (anotado 2026-06-13, tras integrar C2 del upstream sync).

## Contexto

La feature de arrastrar para mover archivos/carpetas dentro del explorer (C2) se
reimplemento con `@dnd-kit` en lugar del hook pointer-based del upstream
(`useExplorerDnd`), para no chocar con el sistema de drag de archivos a panes que
el fork ya tiene (`WorkspaceDndProvider`).

Archivos implicados:

- `src/modules/explorer/TreeRow.tsx`: cada carpeta es `useDroppable({ id: "explorer-dir:<path>" })`; los archivos y carpetas son `useDraggable` (`file:<path>` / `dir:<path>`).
- `src/modules/explorer/FileExplorer.tsx`: `useDndMonitor` escucha el `onDragEnd`; si el `over` es `explorer-dir:<path>`, llama a `tree.movePath(from, toDir)`.
- `src/modules/explorer/lib/useFileTree.ts`: `movePath(from, toDir)` via `fs_rename`.

## Comportamiento actual

- Solo las CARPETAS son destino de drop. Hay que "apuntar" exactamente a una carpeta y se ilumina con un ring.
- No se puede soltar sobre un ARCHIVO (no deriva su carpeta padre).
- No se puede soltar sobre la RAIZ del explorer (el area vacia / fuera de las filas).

## Mejora deseada

1. Soltar sobre un ARCHIVO debe mover el elemento arrastrado a la carpeta PADRE de ese archivo. Asi no hace falta apuntar con precision a una carpeta: se deriva el destino a partir del fichero sobre el que se posa el cursor. Es el comportamiento que tenia el hook del upstream (`useExplorerDnd`): `const t = p ? (isDir(p) ? p : parentDir(p)) : rootPath;`.
2. Soltar sobre la RAIZ del explorer (o sobre el area vacia) debe mover el elemento a `rootPath`.

## Como implementarlo (boceto)

Opcion A (encaja con el @dnd-kit actual):

- Hacer que los ARCHIVOS tambien sean `useDroppable` con un id que codifique su carpeta padre, p. ej. `explorer-dir:<parentDir>` (reutilizando el mismo prefijo, ya que el destino es una carpeta). Asi el `over` sigue siendo una carpeta y `movePath` no cambia. Cuidado con que el mismo nodo sea draggable y droppable a la vez (mergear refs, como ya se hace en las carpetas).
- Anadir un droppable de RAIZ: el contenedor scrolleable de `FileExplorer` (el `div` con `ref={scrollRef}`) como `useDroppable({ id: "explorer-dir:<rootPath>" })`, de menor prioridad que las filas (con `pointerWithin`, la fila mas especifica gana; revisar la deteccion de colisiones para que la raiz solo capture cuando no hay fila debajo).
- La validacion de destino valido (no soltar en el propio padre = no-op, no en si mismo, no en descendiente) ya vive en `TreeRow` (`isValidDropTarget`); habra que replicarla para los nuevos droppables de archivo y de raiz, o centralizarla en el `onDragEnd` de `FileExplorer`.

Opcion B: volver al enfoque pointer-based del upstream (`useExplorerDnd`, que ya resolvia los dos casos via `elementFromPoint` + `closest("[data-fs-path]")` + fallback a `rootPath`) y hacerlo coexistir con `@dnd-kit` desactivando el `useDraggable` de las filas del explorer. Mas fiel al upstream pero reintroduce el riesgo de dos sistemas de drag.

Recomendacion: Opcion A, manteniendo un unico sistema de drag (`@dnd-kit`).

---

# Pendiente relacionado: el color git no se ve cuando el fichero esta seleccionado

Estado: pendiente (anotado 2026-06-13, tras integrar C1 git decorations).

En `src/modules/explorer/TreeRow.tsx`, el tinte git del nombre solo se aplica
cuando la fila NO esta seleccionada:

```tsx
className={cn(
  "min-w-0 flex-1 truncate",
  !isSelected && !gitignored && gitStatusCode && explorerGitTextClass(gitStatusCode),
)}
```

y el contenedor usa `text-foreground` cuando `isSelected` (sobre `bg-accent`).
Resultado: al seleccionar un fichero modificado/nuevo, se pierde el color git.

Esto viene heredado del upstream (que tambien condiciona con `!isSelected`),
probablemente porque el color git podria tener bajo contraste sobre el fondo
`bg-accent` de la seleccion. Mejora deseada: mostrar el estado git tambien en la
fila seleccionada, manteniendo contraste suficiente.

Opciones:

- Mantener el tinte git en el `<span>` del nombre incluso con `isSelected`, y
  comprobar contraste de cada color (`gitStatusColor.ts`) sobre `bg-accent`.
- O usar otro indicador no dependiente del color del texto cuando la fila esta
  seleccionada (p. ej. una letra de estado M/A/D/U/R atenuada a la derecha, o un
  punto de color), para no depender del contraste del nombre.

---

# Pendiente: arrastrar DESDE el explorer HACIA el SO (Finder/Explorer)

Estado: pendiente (anotado 2026-06-13).

Hoy el drag de archivos solo funciona en dos direcciones:

- Dentro del explorer (mover, C2).
- Desde el SO hacia el explorer (copiar, C3).

Falta el sentido inverso: arrastrar un archivo/carpeta DESDE el explorer y
soltarlo en Finder/Explorer del SO (u otra app) para copiarlo/exportarlo. No
estaba en el plan de sync ni existe en el upstream.

Dificultad: Tauri intercepta el canal de drag-drop nativo cuando
`dragDropEnabled` esta on (por eso el dnd interno usa `@dnd-kit` pointer-based).
Iniciar un drag NATIVO saliente desde la webview (para que el SO lo reciba)
requiere investigar si Tauri lo permite con la config actual, o un mecanismo
alternativo (p. ej. el HTML5 `dragstart` con `DataTransfer` de tipo file, que
suele estar bloqueado en webviews de Tauri). Investigar viabilidad antes de
estimar.

