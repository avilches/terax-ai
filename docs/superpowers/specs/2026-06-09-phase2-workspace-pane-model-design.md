# Phase 2 — Workspace + Pane Model Design

**Date:** 2026-06-09
**Status:** Approved
**Project:** Terax pane model redesign (Phase 2 of 4)

---

## Goal

Replace the flat `Tab` model with a three-level hierarchy — `Workspace → SplitNode → Panel` — enabling per-pane tab bars where any content type can live as a tab inside a pane. This is a clean replacement: `useTabs` is deleted, `useWorkspaces` replaces it, and all consumers are updated in one pass. The app will not be usable mid-implementation; work proceeds on main with the app broken until complete.

---

## Type hierarchy

### Workspace

```typescript
type Workspace = {
  id: string;           // UUID
  title: string;
  cwd?: string;         // workspace-level cwd (inherited by new terminal panels)
  paneTree: SplitNode;  // binary tree
  activePaneId: string; // which pane has keyboard focus
};
```

### SplitNode (binary tree, replaces N-ary PaneNode)

```typescript
type SplitNode =
  | {
      kind: "pane";
      id: string;              // UUID
      panels: Panel[];
      activePanelId: string | null;
    }
  | {
      kind: "split";
      id: string;              // UUID
      orientation: "horizontal" | "vertical";
      first: SplitNode;
      second: SplitNode;
      dividerPosition: number; // 0.0–1.0, persisted
    };
```

**Key difference from old model:** Binary (`first`/`second`) instead of N-ary (`children[]`). `dividerPosition` is stored explicitly, enabling layout persistence without relying on `react-resizable-panels` internal state.

### Panel (replaces Tab as the content unit)

```typescript
type Panel =
  | { id: string; kind: "terminal";        cwd?: string;  title: string }
  | { id: string; kind: "editor";          path: string;  title: string; dirty: boolean; preview: boolean }
  | { id: string; kind: "preview";         url: string;   title: string }
  | { id: string; kind: "markdown";        path: string;  title: string }
  | { id: string; kind: "git-diff";        path: string;  repoRoot: string; mode: "-" | "+"; originalPath: string | null; title: string }
  | { id: string; kind: "git-history";     repoRoot: string; title: string }
  | { id: string; kind: "git-commit-file"; repoRoot: string; sha: string; path: string; originalPath: string | null; title: string };
```

`Panel.id` is a UUID. It is the stable identity across pane moves (Phase 4 drag), PTY lifecycle, and persistence.

---

## PTY identity migration

**Before:** `leafId: number` (from shared `nextPaneIdRef`) was the key for PTY sessions and renderer slots.

**After:** `Panel.id: string` (UUID) is the key. The PTY session is identified by its panel's UUID.

### Changes required

| File | Change |
|---|---|
| `src/modules/terminal/lib/useTerminalSession.ts` | `sessions: Map<number, Session>` → `Map<string, Session>` |
| `src/modules/terminal/lib/rendererPool.ts` | Slot keys `number` → `string` |
| `src/modules/terminal/lib/panes.ts` | **Deleted** — replaced by `src/modules/workspaces/lib/splitNode.ts` |
| `src/modules/terminal/lib/pty-bridge.ts` | Session ID passed as string |
| All PTY hook call sites | `leafId` parameter type → `string` |

### What does NOT change in Rust

`pty_open`, `pty_write`, `pty_resize`, `pty_close`, `pty_close_all`, `pty_has_foreground_process`, `pty_shell_name` — all unchanged. The Rust side receives the panel UUID as the session identifier via the existing channel mechanism.

---

## `useWorkspaces` hook

**Location:** `src/modules/workspaces/lib/useWorkspaces.ts`

Replaces `useTabs` entirely. Same coordinator role in `App.tsx`.

```typescript
function useWorkspaces(initial?: { cwd?: string }) {
  // State
  workspaces: Workspace[]
  activeWorkspaceId: string

  // Workspace operations
  newWorkspace(cwd?: string): string           // returns new workspace id
  closeWorkspace(id: string): void
  setActiveWorkspaceId(id: string): void

  // Pane operations (on active workspace's paneTree)
  splitPane(paneId: string, orientation: "horizontal" | "vertical"): string  // returns new pane id
  closePane(paneId: string): void
  focusPane(paneId: string): void

  // Panel operations
  openPanel(paneId: string, panel: Panel): void
  closePanel(panelId: string): void  // if last panel in pane → closes pane; if last pane → keeps empty
  activatePanel(panelId: string): void
  movePanel(panelId: string, targetPaneId: string, targetIndex?: number): void  // used by Phase 4 drag

  // Cwd tracking (from OSC 7)
  setTerminalPanelCwd(panelId: string, cwd: string): void

  // Utility
  findPanel(panelId: string): { workspace: Workspace; pane: SplitNode & { kind: "pane" }; panel: Panel } | null
  findPane(paneId: string): { workspace: Workspace; pane: SplitNode & { kind: "pane" } } | null
  activeWorkspace: Workspace | undefined
  activePaneId: string | null  // within the active workspace
}
```

Initial state: one workspace with one pane containing one `{ kind: "terminal" }` panel.

---

## Rendering — new component tree

```
App.tsx
  └── WorkspaceView          src/modules/workspaces/WorkspaceView.tsx
       └── SplitNodeView     src/modules/workspaces/SplitNodeView.tsx  (recursive)
            ├── kind="split" → ResizablePanelGroup (orientation) with first + second + handle
            └── kind="pane"  → PaneView            src/modules/workspaces/PaneView.tsx
                  ├── PaneTabBar                   src/modules/workspaces/PaneTabBar.tsx
                  │    (mini tab strip: panel titles, close buttons, + button)
                  └── PanelContent                 src/modules/workspaces/PanelContent.tsx
                       ├── kind="terminal"  → TerminalPane  (unchanged component, new key=panelId)
                       ├── kind="editor"    → EditorPane    (unchanged component)
                       ├── kind="preview"   → PreviewPane   (unchanged component)
                       ├── kind="markdown"  → MarkdownPane  (unchanged component)
                       └── kind="git-*"     → Git diff/history panes (unchanged)
```

### PaneTabBar

The new central UI component. Per pane, shows:
- One tab button per panel (title, close `×`)
- Active tab highlighted
- `+` button opens a new terminal panel in this pane
- Drag handle on each tab (data attribute only in Phase 2; Phase 4 wires dnd-kit)

### Never-unmount rule

Panels follow the same never-unmount rule as current tabs: hidden via `invisible pointer-events-none`, never unmounted. PTYs keep running in the background when you switch panels or panes.

---

## Module layout

New module `src/modules/workspaces/` owns all workspace/pane/panel logic:

```
src/modules/workspaces/
  index.ts                  — barrel: re-exports useWorkspaces, types
  lib/
    useWorkspaces.ts         — hook (source of truth)
    splitNode.ts             — SplitNode tree operations (split, remove, find, flatten)
    panelTitle.ts            — derives display title from Panel
  WorkspaceView.tsx
  SplitNodeView.tsx
  PaneView.tsx
  PaneTabBar.tsx
  PanelContent.tsx
```

Old `src/modules/tabs/` is deleted. Old `src/modules/terminal/lib/panes.ts` is deleted.

---

## Persistence

**What persists (Phase 2):**
- Workspace list: `{ id, title, cwd, paneTree (with dividerPositions), activePaneId }` per workspace
- Active workspace ID
- Per panel: `kind`, `id`, `path/url/repoRoot` (everything except live session content)
- Terminal panels: saved as `{ kind: "terminal", cwd }` — restored by spawning a fresh PTY in that cwd

**What does NOT persist (Phase 3):**
- Terminal scrollback / session content
- Running processes (handled by tmux daemon in Phase 3)

**Persistence store keys** (in `tauri-plugin-store`, file `terax-workspaces.json`):
- `workspaces` → serialized `Workspace[]`
- `activeWorkspaceId` → string

Persisted on every state change via `useEffect` debounced 300ms.

---

## Migration from useTabs

| Old | New | Notes |
|---|---|---|
| `Tab` union type | `Panel` union type | All `id: number` → `id: string` already done in Phase 1 |
| `TerminalTab` | `Workspace` with a pane tree | `paneTree` moves up to Workspace |
| `EditorTab`, `PreviewTab`, etc. | `Panel` with matching `kind` | Flat list becomes panel inside a pane |
| `useTabs()` in App.tsx | `useWorkspaces()` in App.tsx | Direct replacement |
| `TerminalStack` | `WorkspaceView` | New rendering path |
| `EditorStack`, `PreviewStack`, etc. | `PanelContent` switch | Called from PaneView |
| `activeId: string` | `activeWorkspaceId: string` | Workspace-level active |
| `tab.activeLeafId` | `pane.activePanelId` | Pane-level active |
| `leafId: number` (PTY key) | `panelId: string` (PTY key) | UUID throughout |

---

## What does NOT change

- All Rust PTY commands (`pty_*`) — untouched
- OSC 7 / OSC 133 handlers — updated to use `panelId` string
- `rendererPool` logic — updated key type only
- `TerminalPane` component — receives `panelId: string` instead of `leafId: number`
- `EditorPane`, `PreviewPane`, `MarkdownPane`, git panes — all content panes are unchanged internally; they just get called from `PanelContent` instead of their respective Stack components
- `WorkspaceSidebar` — unchanged (still receives workspaces as props)
- `RightPanel` — unchanged (explorer, git, history tools)
- `StatusBar`, `Header`, shortcuts — minor updates to use workspace/panel terminology

---

## Validation checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes
- [ ] `cargo clippy` passes
- [ ] `cargo test` passes
- [ ] Opening a new workspace creates a fresh terminal
- [ ] Splitting a pane with `Cmd+D` creates a second pane with a new terminal panel
- [ ] Closing a panel removes it from the pane tab bar
- [ ] Closing the last panel in a pane closes the pane
- [ ] Per-pane tab bar shows all panels; clicking switches the active panel
- [ ] Editor, preview, markdown, git-diff all work as panels inside a pane
- [ ] Workspace list persists across restarts; terminal panels restart with fresh PTY in saved cwd
- [ ] Non-terminal panels (editors, previews) restore correctly
- [ ] PTY sessions keep running in background when switching panels (never-unmount)
