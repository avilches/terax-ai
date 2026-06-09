# Phase 1 — Shell Layout Design

**Date:** 2026-06-08
**Status:** Approved
**Project:** Terax layout restructure (Phase 1 of 4)

---

## Goal

Restructure the visual layout to a 3-column shell without touching the data model or content rendering. The global tab bar moves from horizontal-top to a vertical workspace sidebar on the left. Explorer, Source Control, and Git History panels move from the left sidebar to a new right panel.

Phase 2 will replace the content model. This phase only moves furniture — but it must be architected to support three hard constraints established here.

---

## Hard constraints (affect all 4 phases)

These are not Phase 1 deliverables, but the architecture of Phase 1 must not make them impossible later.

### 1. Multiple windows

Terax supports multiple main windows. Each window is an independent Tauri WebView window sharing the same Rust process. A new window is opened via `Cmd+Shift+N` (or menu). Each window displays its own subset of workspaces in its sidebar. In Phase 1 each window's workspace list is independent; in Phase 2+ workspaces have global IDs and can migrate between windows.

**Implication for Phase 1:** `WorkspaceSidebar` must receive its workspace list as props (not read from a global singleton), so that each window instance can hold a different list. Do not couple `WorkspaceSidebar` to a module-scoped store.

### 2. Full persistence

Everything persists across restarts:
- Window positions and sizes → `tauri-plugin-window-state` (already wired)
- Which workspaces each window contains → `tauri-plugin-store`
- Right panel width, active tab, open/closed state → `tauri-plugin-store`
- Workspace layout (pane tree, open panels per pane) → Phase 2 (store per workspace)
- Terminal session content (scrollback, running processes) → Phase 3 (tmux daemon)

**Implication for Phase 1:** `rightPanelOpen`, `rightPanelWidth`, `rightPanelActiveTab` must be persisted immediately in this phase via `usePreferencesStore`. Window state already persists via `tauri-plugin-window-state`.

### 3. Everything is movable everywhere

- A **tab/panel** can move: within a pane → to another pane → to another workspace (same window) → to a workspace in another window.
- A **workspace** can move: from one window's sidebar to another window's sidebar.
- Dropping a tab on the **edge** of a pane creates a new split.
- Dropping a tab on an **empty area** of the workspace creates a new pane.

**Implication for Phase 1:** All entities need stable global IDs from day one. Workspace IDs, pane IDs, and panel IDs must be UUIDs, never positional indices. Cross-window moves in Phase 2+ will use Tauri events to transfer entity IDs between WebView instances.

---

## Final layout

```
┌──────┬──────────────────────────────────────┬──────────────┐
│      │  Header (titlebar, search, bell)      │              │
│  WS  ├──────────────────────────────────────┤   Right      │
│  S   │                                       │   Panel      │
│  I   │   Content area (unchanged in Ph.1)   │              │
│  D   │   current useTabs rendering           │  [Explorer]  │
│  E   │                                       │  [Git]       │
│  B   │                                       │  [History]   │
│  A   │                                       │              │
│  R   │                                       │              │
│      ├──────────────────────────────────────┤              │
│      │  Status bar                           │              │
└──────┴──────────────────────────────────────┴──────────────┘
  52px          flex (min ~400px)                 240px default
```

---

## Components

### Created

**`WorkspaceSidebar`** (`src/app/components/WorkspaceSidebar.tsx`)

A narrow (52px) vertical strip on the left. Receives the workspace/tab list as props — never reads from a module-scoped singleton (multi-window constraint). Renders one icon/avatar per entry. Active entry highlighted with accent ring. `+` button at bottom creates a new tab. Supports tooltips on hover. Keyboard: Up/Down arrows cycle entries when focused.

Props:
```ts
type WorkspaceSidebarProps = {
  workspaces: Pick<Tab, "id" | "title" | "kind">[];
  activeId: number;
  onSelect: (id: number) => void;
  onNew: () => void;
};
```

Each workspace avatar: 2-letter abbreviation from title, or kind icon. Stable color derived from the workspace ID (so it survives restarts without storing a color preference per workspace).

**`RightPanel`** (`src/app/components/RightPanel.tsx`)

Collapsible right panel. Default width 240px, min 160px, max 480px. Tab strip at top: Explorer · Git · History. Content below switches accordingly. Width, active tab, and open/closed state all persisted. A toggle button in the header collapses/expands. When collapsed: 0px width, resize handle hidden.

Props:
```ts
type RightPanelProps = {
  explorerRoot: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  // ... forwarded props for child panels
};
```

Internal state (persisted via `usePreferencesStore`):
- `rightPanelOpen: boolean` — default `true`
- `rightPanelWidth: number` — default `240`
- `rightPanelActiveTab: "explorer" | "git" | "history"` — default `"explorer"`

### Removed

- `SidebarRail` — current activity bar (left strip with icons). Deleted.
- Left collapsible panel area (the `ResizablePanel` that held Explorer/Git/History). Deleted.
- `TabBar` inside `Header`. Header no longer renders tabs.
- `useSidebarPanel` hook — replaced by `rightPanelOpen` preference.

### Modified

**`App.tsx`** — new 3-column layout using `react-resizable-panels`:

```tsx
<div className="flex h-screen overflow-hidden">
  <WorkspaceSidebar
    workspaces={tabs}
    activeId={activeId}
    onSelect={setActiveId}
    onNew={() => newTab(inheritedCwdForNewTab())}
  />
  <ResizablePanelGroup direction="horizontal" className="flex-1 min-w-0">
    <ResizablePanel id="center" order={1} minSize={30}>
      {/* existing content — unchanged */}
    </ResizablePanel>
    <ResizableHandle id="center-right-handle" />
    <ResizablePanel
      id="right"
      order={2}
      defaultSize={20}
      minSize={12}
      maxSize={35}
      collapsible
      onCollapse={() => setRightPanelOpen(false)}
      onExpand={() => setRightPanelOpen(true)}
    >
      <RightPanel ... />
    </ResizablePanel>
  </ResizablePanelGroup>
</div>
```

**`Header`** — removes `<TabBar>` and all tab-related props. Keeps: titlebar drag region, window controls, inline search (`SearchInline`), notification bell, settings button.

**`FileExplorer`, `SourceControlPanel`, `GitHistoryPane`** — no logic changes. Moved to `RightPanel` call site only.

**`src/modules/shortcuts/shortcuts.ts`** — add `rightPanel.toggle` shortcut. Remove `sidebar.toggle`.

**`usePreferencesStore`** — add three new keys: `rightPanelOpen`, `rightPanelWidth`, `rightPanelActiveTab`.

---

## Multi-window: new window creation (Phase 1 deliverable)

In Phase 1 we deliver the ability to open multiple main windows. Each window runs the same React app root with its own independent tab list (identical to opening a fresh Terax instance, except they share the Rust process).

Implementation: `open_main_window` Tauri command (mirrors `open_settings_window` pattern). The new window gets a fresh `useTabs` state seeded from the persisted workspace list for that window ID. In Phase 1, windows do not share workspace state — cross-window workspace migration is Phase 2.

Shortcut: `Cmd+Shift+N` opens a new main window.

---

## Drag & drop foundations (architecture only, no UI in Phase 1)

Phase 4 delivers the full drag UX. Phase 1 must lay the foundation:

1. **Stable UUID IDs**: `Tab.id` is currently a `number` (auto-increment). In Phase 1 it becomes a `string` UUID. This is the only data model change in Phase 1 — everything else remains. The UUID change is a prerequisite for cross-window entity transfer.

2. **dnd-kit installed**: Add `@dnd-kit/core` and `@dnd-kit/sortable` as dependencies (no UI yet, just available for Phase 4).

3. **No IPC drag protocol yet** — cross-window drag uses a Tauri event `terax:workspace-transfer` (designed in Phase 2, implemented in Phase 4).

---

## What does NOT change

- `useTabs` logic — only `Tab.id` type changes from `number` to `string` UUID
- `PaneNode`, split pane rendering within terminal tabs — untouched
- `WorkspaceSurface` — untouched
- `TerminalStack`, `EditorStack`, `PreviewStack`, etc. — untouched
- PTY lifecycle — untouched
- Status bar — untouched
- The content rendered in the center area — pixel-identical to current

---

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Toggle right panel | `Cmd+Shift+E` |
| New window | `Cmd+Shift+N` |
| Cycle workspaces up/down | `Cmd+Shift+[` / `Cmd+Shift+]` |
| Focus Explorer in right panel | `Cmd+Shift+F` |

---

## Data: new preference keys

```ts
// Added to Preferences type in src/modules/settings/store.ts
rightPanelOpen: boolean;        // default: true
rightPanelWidth: number;        // default: 240
rightPanelActiveTab: "explorer" | "git" | "history"; // default: "explorer"
```

---

## Validation checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes
- [ ] `Tab.id` is now a UUID string — all consumers compile and run correctly
- [ ] Terminal tabs open and PTYs work normally
- [ ] Explorer follows active terminal cwd (OSC 7)
- [ ] Source control panel shows git status
- [ ] Git history pane renders commit graph
- [ ] Right panel resizes and collapses correctly
- [ ] Right panel state (width, tab, open) persists across restarts
- [ ] `WorkspaceSidebar` shows all tabs, clicking switches correctly
- [ ] `+` in workspace sidebar creates a new terminal tab
- [ ] `Cmd+Shift+N` opens a new main window with independent workspace list
- [ ] Notification bell visible in header
- [ ] Window controls unchanged (macOS traffic lights / Linux+Windows custom)
- [ ] `@dnd-kit/core` installed, no UI regressions
