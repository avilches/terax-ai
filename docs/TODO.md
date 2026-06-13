# TODO

Features e ideas a implementar en el futuro. Cada item enlaza a su plan o spec detallada cuando existe.

Bugs, features y mejoras ya auditadas y priorizadas viven aparte, en [PENDING.md](PENDING.md).

---

## Notas Markdown + Marcadores (giro de producto)

Plan completo y fuente de verdad: [NOTES_AND_BOOKMARKS_PLAN.md](NOTES_AND_BOOKMARKS_PLAN.md). Incluye especificacion, modelos de datos, 6 fases con rutas concretas, esqueletos de codigo (TS y Rust), criterios de aceptacion y comandos de verificacion por fase.

No es una mejora incremental del terminal: convierte Terax en un espacio de trabajo componible que ademas funciona como aplicacion de notas Markdown (edicion WYSIWYG) y un sistema de marcadores estilo Arc. Las notas son ficheros `.md` en disco, no una DB. Tres pilares pensados para anadirse poco a poco reusando primitivas existentes, sin crear modos exclusivos:

1. Notas Markdown con edicion WYSIWYG (estilo Notion/Bear).
2. Navegacion de notas: favoritos, recientes, busqueda por nombre y doble visor (carpetas + lista de notas) como segundo modo del explorer.
3. Marcadores estilo Arc: lista vertical de URLs a la izquierda, en carpetas, que abren en el panel `preview` existente.

### Por donde empezar

Fase 0 del plan (refactor habilitador): columna derecha data-driven (registro de vistas en lugar de los 3 tabs hardcodeados) y extraer una capa compartida de persistencia de documento desde `src/modules/editor/lib/useDocument.ts`. Las fases 1, 3, 4 y 5 dependen de ella. Es un cambio sin efecto funcional visible, buen primer PR aislado.

### Decision tecnica abierta: motor WYSIWYG

- Recomendado: Milkdown (preset Crepe), cargado solo de forma lazy para no inflar el bundle base (~7-8 MB es parte del producto).
- Alternativa ligera: extender CodeMirror con live preview estilo Obsidian, casi sin deps nuevas.
- Estrategia del plan: validar primero el modelo barato (Fase 1) antes de comprometer la dep pesada (Fase 4). Medir el peso real de Milkdown antes de adoptarlo y dejarlo documentado.

### Infra ya disponible (no reinventar)

- Modelo `Workspace -> Pane -> Panel` con union etiquetada `kind` extensible, panel `markdown` (solo lectura, `Streamdown`), editor CodeMirror con `@codemirror/lang-markdown` ya instalado, panel `preview` (iframe sandbox) reutilizable para marcadores, backend `fs_*` completo (read/write/search/grep/watch) y el patron `LazyStore` para stores persistentes (referencia: `src/modules/theme/customThemes.ts`).
- NO existe ningun sistema de favoritos, recientes ni marcadores en el codigo actual.
- `fs_search` ya hace busqueda fuzzy de nombres (smart-case, respeta `.gitignore`). Reusar para el quick-open de notas.
- `useDocument` ya implementa dirty tracking y autosave configurable. Extraer la parte reutilizable evita reescribirla para el panel `note`.
- Para la lista de notas con titulo/fecha/snippet, NO hacer N llamadas `fs_read_file`: el plan propone un comando Rust `notes_list` (una sola IPC, lectura parcial de ~512 bytes por fichero), que respeta el liston de perf de `AGENTS.md`.

### Documentacion viva a actualizar al implementar (mismo commit que el codigo)

- `docs/ARCHITECTURE.md`: modulos `notes/` y `bookmarks/`, nuevos kinds de panel, registro de vistas de la columna derecha, modelo de notas en disco.
- `docs/IPC.md`: comando `notes_list` (firma, params, retorno).
- `docs/FORK.md`: notas WYSIWYG y marcadores como divergencia anadida respecto al upstream.
- `AGENTS.md`: mapa de modulos (seccion "Module layout").
- `docs/BUILD.md`: solo si cambia el build (chunk lazy de Milkdown o dep nueva).

---

## Explorer: mejorar los destinos de drop del drag-to-move

Estado: pendiente (anotado 2026-06-13, tras integrar C2 del upstream sync).

### Contexto

La feature de arrastrar para mover archivos/carpetas dentro del explorer (C2) se reimplemento con `@dnd-kit` en lugar del hook pointer-based del upstream (`useExplorerDnd`), para no chocar con el sistema de drag de archivos a panes que el fork ya tiene (`WorkspaceDndProvider`).

Archivos implicados:

- `src/modules/explorer/TreeRow.tsx`: cada carpeta es `useDroppable({ id: "explorer-dir:<path>" })`; los archivos y carpetas son `useDraggable` (`file:<path>` / `dir:<path>`).
- `src/modules/explorer/FileExplorer.tsx`: `useDndMonitor` escucha el `onDragEnd`; si el `over` es `explorer-dir:<path>`, llama a `tree.movePath(from, toDir)`.
- `src/modules/explorer/lib/useFileTree.ts`: `movePath(from, toDir)` via `fs_rename`.

### Comportamiento actual

- Solo las CARPETAS son destino de drop. Hay que apuntar exactamente a una carpeta y se ilumina con un ring.
- No se puede soltar sobre un ARCHIVO (no deriva su carpeta padre).
- No se puede soltar sobre la RAIZ del explorer (el area vacia / fuera de las filas).

### Mejora deseada

1. Soltar sobre un ARCHIVO debe mover el elemento arrastrado a la carpeta PADRE de ese archivo. Asi no hace falta apuntar con precision a una carpeta: se deriva el destino a partir del fichero sobre el que se posa el cursor. Es el comportamiento que tenia el hook del upstream (`useExplorerDnd`): `const t = p ? (isDir(p) ? p : parentDir(p)) : rootPath;`.
2. Soltar sobre la RAIZ del explorer (o sobre el area vacia) debe mover el elemento a `rootPath`.

### Como implementarlo (boceto)

Opcion A (encaja con el `@dnd-kit` actual):

- Hacer que los ARCHIVOS tambien sean `useDroppable` con un id que codifique su carpeta padre, p. ej. `explorer-dir:<parentDir>` (reutilizando el mismo prefijo, ya que el destino es una carpeta). Asi el `over` sigue siendo una carpeta y `movePath` no cambia. Cuidado con que el mismo nodo sea draggable y droppable a la vez (mergear refs, como ya se hace en las carpetas).
- Anadir un droppable de RAIZ: el contenedor scrolleable de `FileExplorer` (el `div` con `ref={scrollRef}`) como `useDroppable({ id: "explorer-dir:<rootPath>" })`, de menor prioridad que las filas (con `pointerWithin`, la fila mas especifica gana; revisar la deteccion de colisiones para que la raiz solo capture cuando no hay fila debajo).
- La validacion de destino valido (no soltar en el propio padre = no-op, no en si mismo, no en descendiente) ya vive en `TreeRow` (`isValidDropTarget`); habra que replicarla para los nuevos droppables de archivo y de raiz, o centralizarla en el `onDragEnd` de `FileExplorer`.

Opcion B: volver al enfoque pointer-based del upstream (`useExplorerDnd`, que ya resolvia los dos casos via `elementFromPoint` + `closest("[data-fs-path]")` + fallback a `rootPath`) y hacerlo coexistir con `@dnd-kit` desactivando el `useDraggable` de las filas del explorer. Mas fiel al upstream pero reintroduce el riesgo de dos sistemas de drag.

Recomendacion: Opcion A, manteniendo un unico sistema de drag (`@dnd-kit`).

---

## Explorer: el color git no se ve cuando el fichero esta seleccionado

Estado: pendiente (anotado 2026-06-13, tras integrar C1 git decorations).

En `src/modules/explorer/TreeRow.tsx`, el tinte git del nombre solo se aplica cuando la fila NO esta seleccionada:

```tsx
className={cn(
  "min-w-0 flex-1 truncate",
  !isSelected && !gitignored && gitStatusCode && explorerGitTextClass(gitStatusCode),
)}
```

y el contenedor usa `text-foreground` cuando `isSelected` (sobre `bg-accent`). Resultado: al seleccionar un fichero modificado/nuevo, se pierde el color git.

Esto viene heredado del upstream (que tambien condiciona con `!isSelected`), probablemente porque el color git podria tener bajo contraste sobre el fondo `bg-accent` de la seleccion. Mejora deseada: mostrar el estado git tambien en la fila seleccionada, manteniendo contraste suficiente.

Opciones:

- Mantener el tinte git en el `<span>` del nombre incluso con `isSelected`, y comprobar contraste de cada color (`gitStatusColor.ts`) sobre `bg-accent`.
- O usar otro indicador no dependiente del color del texto cuando la fila esta seleccionada (p. ej. una letra de estado M/A/D/U/R atenuada a la derecha, o un punto de color), para no depender del contraste del nombre.

---

## Explorer: arrastrar DESDE el explorer HACIA el SO (Finder/Explorer)

Estado: pendiente (anotado 2026-06-13).

Hoy el drag de archivos solo funciona en dos direcciones:

- Dentro del explorer (mover, C2).
- Desde el SO hacia el explorer (copiar, C3).

Falta el sentido inverso: arrastrar un archivo/carpeta DESDE el explorer y soltarlo en Finder/Explorer del SO (u otra app) para copiarlo/exportarlo. No estaba en el plan de sync ni existe en el upstream.

Dificultad: Tauri intercepta el canal de drag-drop nativo cuando `dragDropEnabled` esta on (por eso el dnd interno usa `@dnd-kit` pointer-based). Iniciar un drag NATIVO saliente desde la webview (para que el SO lo reciba) requiere investigar si Tauri lo permite con la config actual, o un mecanismo alternativo (p. ej. el HTML5 `dragstart` con `DataTransfer` de tipo file, que suele estar bloqueado en webviews de Tauri). Investigar viabilidad antes de estimar.
