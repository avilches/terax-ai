# Tab Context Menu

## Summary

Right-click on any tab in the tab bar shows a context menu with close, new terminal, and new browser actions.

## Menu structure

```
Close Tab              Cmd+W / Ctrl+W
Close Other Tabs       (disabled when only 1 tab in pane)
Close All Tabs
---
New Terminal Tab       Cmd+T / Ctrl+T
New Terminal Split Right  Cmd+D / Ctrl+D
New Terminal Split Down   Cmd+Shift+D / Ctrl+Shift+D
---
New Browser Tab        Cmd+Shift+O / Ctrl+Shift+O
New Browser Split Right
New Browser Split Down
```

Shortcut labels are rendered via `getBindingTokens()` from `shortcuts.ts` so they adapt to platform (Mac symbols vs. Ctrl+ text).

Right-clicking a tab does NOT activate it. The context menu always targets the right-clicked tab, regardless of which tab is currently active.

## Architecture: Approach A - threaded callbacks

Five new composed callbacks flow top-down through the component tree. Close operations are computed locally in PaneView from the existing `onClosePanel` prop.

### New callback props (added at each layer)

```ts
onSplitTerminalRight: (workspaceId: string, paneId: string) => void
onSplitTerminalDown:  (workspaceId: string, paneId: string) => void
onNewBrowser:         (workspaceId: string, paneId: string) => void
onSplitBrowserRight:  (workspaceId: string, paneId: string) => void
onSplitBrowserDown:   (workspaceId: string, paneId: string) => void
```

These are added to: `WorkspaceView.Props`, `SplitNodeView.Props` (+ passed to PaneView explicitly), `PaneView.Props`, `PaneTabBar.Props`, `DraggableTab` internal props.

### Close operations (local to PaneView)

PaneView constructs two closures using its existing `pane.panels` and `onClosePanel(workspaceId, panelId)`:

- `onCloseOtherPanels(panelId)`: filters panels, calls `onClosePanel` for each except `panelId`
- `onCloseAllPanels()`: calls `onClosePanel` for every panel in the pane

`onClosePanel` already handles `disposeSession` for terminal panels, so no new plumbing is needed for cleanup.

### App.tsx implementations

```ts
onSplitTerminalRight: (wsId, paneId) => {
  const newPaneId = splitPane(wsId, paneId, "horizontal");
  openPanel(wsId, newPaneId, { id: crypto.randomUUID(), kind: "terminal", cwd: ... });
}

onSplitTerminalDown: (wsId, paneId) => {
  const newPaneId = splitPane(wsId, paneId, "vertical");
  openPanel(wsId, newPaneId, { id: crypto.randomUUID(), kind: "terminal", cwd: ... });
}

onNewBrowser: (wsId, paneId) => {
  // Uses existing openPreviewInPanel logic adapted for a specific paneId
  const panelId = crypto.randomUUID();
  openPanel(wsId, paneId, { id: panelId, kind: "preview", url: "" });
  setTimeout(() => previewHandles.current.get(panelId)?.focusAddressBar(), 0);
}

onSplitBrowserRight: (wsId, paneId) => {
  const newPaneId = splitPane(wsId, paneId, "horizontal");
  // same as onNewBrowser but targeting newPaneId
}

onSplitBrowserDown: (wsId, paneId) => {
  const newPaneId = splitPane(wsId, paneId, "vertical");
  // same as onNewBrowser but targeting newPaneId
}
```

## Component changes

### PaneTabBar.tsx

`DraggableTab` is wrapped in `ContextMenu` + `ContextMenuTrigger asChild`:

```tsx
<ContextMenu>
  <ContextMenuTrigger asChild>
    <div ref={setNodeRef} {...attributes} {...listeners} ...>
      {/* existing tab content unchanged */}
    </div>
  </ContextMenuTrigger>
  <ContextMenuContent>
    <ContextMenuItem onSelect={() => onClose(panel.id)}>
      Close Tab
      <ContextMenuShortcut>{formatShortcut("tab.close")}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem disabled={panels.length <= 1} onSelect={() => onCloseOtherPanels(panel.id)}>
      Close Other Tabs
    </ContextMenuItem>
    <ContextMenuItem onSelect={onCloseAllPanels}>
      Close All Tabs
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={onNewTerminal}>
      New Terminal Tab
      <ContextMenuShortcut>{formatShortcut("tab.new")}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem onSelect={onSplitTerminalRight}>
      New Terminal Split Right
      <ContextMenuShortcut>{formatShortcut("pane.splitRight")}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem onSelect={onSplitTerminalDown}>
      New Terminal Split Down
      <ContextMenuShortcut>{formatShortcut("pane.splitDown")}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuSeparator />
    <ContextMenuItem onSelect={onNewBrowser}>
      New Browser Tab
      <ContextMenuShortcut>{formatShortcut("tab.newPreview")}</ContextMenuShortcut>
    </ContextMenuItem>
    <ContextMenuItem onSelect={onSplitBrowserRight}>
      New Browser Split Right
    </ContextMenuItem>
    <ContextMenuItem onSelect={onSplitBrowserDown}>
      New Browser Split Down
    </ContextMenuItem>
  </ContextMenuContent>
</ContextMenu>
```

A small `formatShortcut(id: ShortcutId): string` helper in `PaneTabBar.tsx` resolves the default binding via `SHORTCUTS` and calls `getBindingTokens()` to join into a display string (e.g. `"⌘W"`, `"Ctrl+W"`).

`DraggableTab` receives `panels` (the full array from the parent pane) to evaluate the `disabled` state for "Close Other Tabs".

### PaneView.tsx

Receives the 5 new callbacks as props. Constructs and passes to PaneTabBar:
- `onCloseOtherPanels`: locally derived
- `onCloseAllPanels`: locally derived
- `onNewTerminal`: already exists
- `onSplitTerminalRight/Down`: from props, bound to `(workspaceId, pane.id)`
- `onNewBrowser/onSplitBrowserRight/Down`: from props, bound to `(workspaceId, pane.id)`

### SplitNodeView.tsx

Adds the 5 new callbacks to its `Props` type and passes them explicitly to `PaneView` (matching the existing pattern for the other callbacks).

### WorkspaceView.tsx

Adds the 5 new callbacks to its `Props` type. They flow through `...rest` automatically.

## Disabled states

- "Close Other Tabs" is disabled when `panels.length <= 1`
- All other items are always enabled

## UX notes

- Right-click does not change active tab or focused pane
- "New Browser" opens with empty URL and auto-focuses the address bar (existing `focusAddressBar()` behavior)
- Shortcut hints match the user's current keybinding overrides because `SHORTCUTS` is the single source of truth
