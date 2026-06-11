import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { refreshTerminalLeaf } from "@/modules/terminal";
import { useEffect, useState } from "react";
import { panelIcon, panelTitle } from "./lib/panelTitle";

import { allPanes, findPanelPane } from "./lib/splitNode";
import type { Panel, Workspace } from "./lib/types";
import type { UseWorkspacesReturn } from "./lib/useWorkspaces";
import { SplitNodeView } from "./SplitNodeView";
import type { PanelCallbacks } from "./PanelContent";

type Props = {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  onDividerChange?: (workspaceId: string, splitId: string, position: number) => void;
  onMovePanel: UseWorkspacesReturn["movePanel"];
  onSplitPaneAndPlace: UseWorkspacesReturn["splitPaneAndPlace"];
  callbacks: PanelCallbacks;
};

export function WorkspaceView({
  workspaces,
  activeWorkspaceId,
  onMovePanel,
  onSplitPaneAndPlace,
  ...rest
}: Props) {
  const [draggingPanel, setDraggingPanel] = useState<Panel | null>(null);
  const [draggingWorkspaceId, setDraggingWorkspaceId] = useState<string | null>(null);

  // After workspace switch the CSS visibility:hidden is removed. The WebGL
  // canvas doesn't repaint on its own after that — force a refresh once the
  // DOM change has been painted.
  useEffect(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!ws) return;
    const raf = requestAnimationFrame(() => {
      for (const pane of allPanes(ws.paneTree)) {
        if (pane.activePanelId) refreshTerminalLeaf(pane.activePanelId);
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [activeWorkspaceId]); // eslint-disable-line react-hooks/exhaustive-deps

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );

  function handleDragStart(event: DragStartEvent) {
    document.body.style.cursor = "grabbing";
    const panelId = String(event.active.id);
    for (const ws of workspaces) {
      const result = findPanelPane(ws.paneTree, panelId);
      if (result) { setDraggingPanel(result.panel); setDraggingWorkspaceId(ws.id); break; }
    }
  }

  function handleDragCancel() {
    document.body.style.cursor = "";
    setDraggingPanel(null);
    setDraggingWorkspaceId(null);
  }

  function handleDragEnd(event: DragEndEvent) {
    document.body.style.cursor = "";
    setDraggingPanel(null);
    setDraggingWorkspaceId(null);
    const { active, over } = event;
    if (!over) return;

    const panelId = String(active.id);
    const overId = String(over.id);

    // Only handle zone drops (zone:<paneId>:<direction>)
    if (!overId.startsWith("zone:")) return;

    const parts = overId.split(":");
    const targetPaneId = parts[1]!;
    const zone = parts[2] as "top" | "bottom" | "left" | "right" | "center";

    // Find source workspace and pane
    let sourceWorkspaceId: string | null = null;
    let sourcePaneId: string | null = null;
    for (const ws of workspaces) {
      for (const pane of allPanes(ws.paneTree)) {
        if (pane.panels.some((p) => p.id === panelId)) {
          sourceWorkspaceId = ws.id;
          sourcePaneId = pane.id;
          break;
        }
      }
      if (sourceWorkspaceId) break;
    }
    if (!sourceWorkspaceId) return;

    // Ensure the drop target belongs to the same workspace as the source panel.
    // Inactive workspaces share the same screen position (absolute inset-0) and
    // could produce false collision hits if their zones were registered.
    const targetInSourceWorkspace = workspaces
      .find((ws) => ws.id === sourceWorkspaceId);
    if (!targetInSourceWorkspace) return;
    const targetPaneExists = allPanes(targetInSourceWorkspace.paneTree).some(
      (p) => p.id === targetPaneId,
    );
    if (!targetPaneExists) return;

    if (zone === "center") {
      if (sourcePaneId === targetPaneId) return;
      onMovePanel(sourceWorkspaceId, panelId, targetPaneId);
    } else {
      onSplitPaneAndPlace(sourceWorkspaceId, targetPaneId, zone, panelId);
    }
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={handleDragCancel}
    >
      <div className={cn("relative h-full w-full", draggingPanel && "[&_*]:!cursor-grabbing cursor-grabbing")}>
        {workspaces.map((ws) => (
          <div
            key={ws.id}
            className={cn(
              "absolute inset-0",
              ws.id !== activeWorkspaceId && "opacity-0 invisible",
            )}
          >
            <SplitNodeView
              node={ws.paneTree}
              workspaceId={ws.id}
              workspaceCwd={ws.cwd}
              activePaneId={ws.activePaneId}
              isWorkspaceActive={ws.id === activeWorkspaceId}
              onActivatePanel={rest.onActivatePanel}
              onClosePanel={rest.onClosePanel}
              onFocusPane={rest.onFocusPane}
              onNewTerminal={rest.onNewTerminal}
              onDividerChange={rest.onDividerChange}
              callbacks={rest.callbacks}
            />
          </div>
        ))}
      </div>
      <DragOverlay dropAnimation={null}>
        {draggingPanel && (
          <div className="pointer-events-none flex h-5 items-center gap-1 rounded bg-muted px-1.5 text-[11px] text-foreground shadow-lg ring-1 ring-primary/40 opacity-90">
            <span className="shrink-0 opacity-70">{panelIcon(draggingPanel, draggingWorkspaceId ?? undefined)}</span>
            <span className="max-w-[120px] truncate">{panelTitle(draggingPanel)}</span>
          </div>
        )}
      </DragOverlay>
    </DndContext>
  );
}
