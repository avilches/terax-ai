# Phase 1 — Shell Layout Design

**Date:** 2026-06-08
**Status:** Approved
**Project:** Terax layout restructure (Phase 1 of 4)

---

## Goal

Restructure the visual layout to a 3-column shell without touching the data model or content rendering. The global tab bar moves from horizontal-top to a vertical workspace sidebar on the left. Explorer, Source Control, and Git History panels move from the left sidebar to a new right panel. Phase 2 will replace the content model; this phase only moves furniture.

---

## Final layout

```
┌──────┬──────────────────────────────────────┬──────────────┐
│      │  Header (titlebar, search, bell)      │              │
│  WS  ├──────────────────────────────────────┤   Right      │
│  S   │                                       │   Panel      │
│  I   │   Content area (unchanged)            │              │
│  D   │   current useTabs rendering           │  [Explorer]  │
│  E   │   no model changes in Phase 1         │  [Git]       │
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

A narrow (52px) vertical strip on the left. Renders the current tab list (`useTabs`) as workspace entries — one icon/avatar per tab. The active tab is highlighted. Clicking an entry sets it active. A `+` button at the bottom creates a new tab (same as the current new-tab button). Supports tooltips showing the tab title on hover.

- Iterates `tabs` from `useTabs`
- Each entry shows a 2-letter abbreviation or icon derived from `tab.title` or `tab.kind`
- Active entry highlighted with accent color ring
- `+` at bottom calls `newTab(inheritedCwd)`
- No scrollbar until > ~15 entries (overflow-y: auto with hidden scrollbar)
- Keyboard: Up/Down arrow keys cycle workspaces when sidebar is focused

**`RightPanel`** (`src/app/components/RightPanel.tsx`)

A collapsible right panel (~240px default, min 160px, max 480px) with a tab strip at the top. Three tabs: Explorer · Git · History. Tabs switch the content section below. The panel width is persisted in settings. A toggle button in the header (or keyboard shortcut) collapses/expands it. When collapsed it takes 0px and the resize handle disappears.

- Tab strip: `Explorer` | `Git` | `History` (active tab persisted in `usePreferencesStore`)
- Resize: drag handle on the left border using `react-resizable-panels`
- Collapse: `Cmd+Shift+E` toggles (same shortcut as current sidebar toggle, remapped)
- Content: renders `<FileExplorer>`, `<SourceControlPanel>`, or `<GitHistoryPane>` based on active tab
- Initial width: 240px, remembered via `rightPanelWidth` preference key

**`RightPanelResizeHandle`** — thin draggable border between center and right panel, provided by `react-resizable-panels`.

### Removed

- `SidebarRail` — the current activity bar (left strip with Explorer/Git/History icons). Deleted.
- The collapsible left panel area (`ResizablePanel` for the sidebar content). Deleted.
- The `TabBar` component rendered inside `Header`. The `Header` no longer renders tabs.

### Modified

**`App.tsx`** — new 3-column layout:

```tsx
<div class="flex h-screen">
  <WorkspaceSidebar tabs={tabs} activeId={activeId} onSelect={setActiveId} onNew={newTab} />
  <ResizablePanelGroup direction="horizontal" class="flex-1">
    <ResizablePanel minSize={30}>
      <main>…content…</main>
    </ResizablePanel>
    <ResizableHandle />
    <ResizablePanel defaultSize={20} minSize={12} maxSize={35} collapsible>
      <RightPanel />
    </ResizablePanel>
  </ResizablePanelGroup>
</div>
```

Removes: `SidebarRail`, left `ResizablePanelGroup`, `useSidebarPanel` hook usage, `panelOpen`/`toggleSidebar` for the left panel.

**`Header`** — removes `<TabBar>` and all tab-related props (`tabs`, `activeId`, `onSelect`, `onNew`, `onClose`, `onPin`, `onRename`, `compact`). Keeps: titlebar drag region, window controls, inline search, notification bell, settings button.

**`FileExplorer`, `SourceControlPanel`, `GitHistoryPane`** — no logic changes. Just moved from the left sidebar slot to `RightPanel`. Each is already self-contained; the move is a change in call site only.

**`useSidebarPanel`** — removed. The left sidebar concept goes away. Right panel visibility is tracked by a simple `rightPanelOpen: boolean` in `usePreferencesStore`.

**`src/modules/shortcuts/shortcuts.ts`** — remap `sidebar.toggle` to `rightPanel.toggle`. Remove `sidebar.explorer.focus`, `sidebar.sourceControl.focus` — replace with `rightPanel.tab` shortcuts if needed.

---

## Data / state changes

No changes to `useTabs`, `PaneNode`, `TerminalTab`, or any content-layer state.

New preference keys added to `usePreferencesStore`:
- `rightPanelOpen: boolean` (default: `true`)
- `rightPanelWidth: number` (default: `240`, pixels)
- `rightPanelActiveTab: "explorer" | "git" | "history"` (default: `"explorer"`)

---

## What does NOT change

- `useTabs` and all tab types — untouched
- `WorkspaceSurface` — untouched
- `TerminalStack`, `EditorStack`, etc. — untouched
- PTY lifecycle — untouched
- `PaneTreeView`, split panes within terminal tabs — untouched
- The content rendered in the center area — pixel-identical to current

---

## Keyboard shortcuts

| Action | Shortcut |
|---|---|
| Toggle right panel | `Cmd+Shift+E` (was sidebar toggle) |
| Focus Explorer tab in right panel | `Cmd+Shift+F` |
| Focus Git tab in right panel | `Cmd+Shift+G` (reassigned from unused) |
| Cycle workspaces (sidebar) | `Cmd+Shift+[` / `Cmd+Shift+]` |

---

## Validation checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes
- [ ] Terminal tabs open and PTYs work normally
- [ ] Explorer follows active terminal cwd (OSC 7) — unchanged behaviour
- [ ] Source control panel shows git status
- [ ] Git history pane renders commit graph
- [ ] Right panel resizes and collapses correctly
- [ ] Right panel tab selection persists across restarts
- [ ] WorkspaceSidebar shows all tabs, clicking switches correctly
- [ ] New workspace button (`+`) creates a new terminal tab
- [ ] Notification bell still visible in header
- [ ] Window controls (macOS traffic lights / custom Linux+Windows) unchanged
