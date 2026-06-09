import { cn } from "@/lib/utils";
import { useCallback } from "react";
import { PaneTabBar } from "./PaneTabBar";
import { PanelContent } from "./PanelContent";
import type { PanelCallbacks } from "./PanelContent";
import type { PaneNode } from "./lib/types";

type Props = {
  pane: PaneNode;
  workspaceId: string;
  workspaceCwd?: string;
  focused: boolean;
  onActivatePanel: (workspaceId: string, panelId: string) => void;
  onClosePanel: (workspaceId: string, panelId: string) => void;
  onFocusPane: (workspaceId: string, paneId: string) => void;
  onNewTerminal: (workspaceId: string, paneId: string) => void;
  callbacks: PanelCallbacks;
};

export function PaneView({
  pane,
  workspaceId,
  workspaceCwd: _workspaceCwd,
  focused,
  onActivatePanel,
  onClosePanel,
  onFocusPane,
  onNewTerminal,
  callbacks,
}: Props) {
  const handleFocus = useCallback(() => {
    if (!focused) onFocusPane(workspaceId, pane.id);
  }, [focused, workspaceId, pane.id, onFocusPane]);

  return (
    <div
      className="flex h-full flex-col"
      onMouseDownCapture={handleFocus}
      onFocus={handleFocus}
    >
      <PaneTabBar
        panels={pane.panels}
        activePanelId={pane.activePanelId}
        onActivate={(panelId) => onActivatePanel(workspaceId, panelId)}
        onClose={(panelId) => onClosePanel(workspaceId, panelId)}
        onNewTerminal={() => onNewTerminal(workspaceId, pane.id)}
      />
      <div className="relative min-h-0 flex-1">
        {pane.panels.map((panel) => (
          <div
            key={panel.id}
            className={cn(
              "absolute inset-0",
              panel.id !== pane.activePanelId && "invisible pointer-events-none",
            )}
          >
            <PanelContent
              panel={panel}
              visible={panel.id === pane.activePanelId}
              focused={focused && panel.id === pane.activePanelId}
              callbacks={callbacks}
            />
          </div>
        ))}
        {pane.panels.length === 0 && (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            Empty pane — click + to add a terminal
          </div>
        )}
      </div>
    </div>
  );
}
