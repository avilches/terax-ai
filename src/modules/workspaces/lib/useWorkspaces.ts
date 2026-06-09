import { useCallback, useEffect, useRef, useState } from "react";
import {
  allPaneIds,
  findPane,
  findPanelPane,
  firstPaneId,
  removePaneFromTree,
  siblingPane,
  splitPaneInTree,
  updateDivider,
  updatePane,
} from "./splitNode";
import type { Panel, PaneNode, Workspace } from "./types";

function newPaneNode(cwd?: string): PaneNode {
  const panelId = crypto.randomUUID();
  return {
    kind: "pane",
    id: crypto.randomUUID(),
    panels: [{ id: panelId, kind: "terminal", cwd }],
    activePanelId: panelId,
  };
}

function newWorkspace(cwd?: string): Workspace {
  const pane = newPaneNode(cwd);
  return {
    id: crypto.randomUUID(),
    title: cwd ? (cwd.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "shell") : "shell",
    cwd,
    paneTree: pane,
    activePaneId: pane.id,
  };
}

export function useWorkspaces(initial?: { cwd?: string }) {
  const initialWorkspace = useRef(newWorkspace(initial?.cwd));

  const [workspaces, setWorkspaces] = useState<Workspace[]>(() => [initialWorkspace.current]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string>(initialWorkspace.current.id);

  const workspacesRef = useRef(workspaces);
  useEffect(() => { workspacesRef.current = workspaces; }, [workspaces]);

  // ── Workspace operations ──────────────────────────────────────────────────

  const addWorkspace = useCallback((cwd?: string): string => {
    const ws = newWorkspace(cwd);
    setWorkspaces((prev) => [...prev, ws]);
    setActiveWorkspaceId(ws.id);
    return ws.id;
  }, []);

  const closeWorkspace = useCallback((id: string) => {
    setWorkspaces((prev) => {
      if (prev.length <= 1) return prev; // never close last workspace
      return prev.filter((w) => w.id !== id);
    });
    setActiveWorkspaceId((prev) => {
      if (prev !== id) return prev;
      const remaining = workspacesRef.current.filter((w) => w.id !== id);
      return remaining[remaining.length - 1]?.id ?? prev;
    });
  }, []);

  // ── Pane operations ───────────────────────────────────────────────────────

  const splitPane = useCallback((workspaceId: string, paneId: string, orientation: "horizontal" | "vertical"): string => {
    const newPaneId = crypto.randomUUID();
    const newSplitId = crypto.randomUUID();
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          paneTree: splitPaneInTree(w.paneTree, paneId, newSplitId, newPaneId, orientation),
          activePaneId: newPaneId,
        };
      }),
    );
    return newPaneId;
  }, []);

  const closePane = useCallback((workspaceId: string, paneId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const newTree = removePaneFromTree(w.paneTree, paneId);
        if (!newTree) return w; // never remove last pane
        const sibling = siblingPane(w.paneTree, paneId);
        const newActiveId =
          w.activePaneId === paneId
            ? (sibling?.id ?? firstPaneId(newTree))
            : w.activePaneId;
        return { ...w, paneTree: newTree, activePaneId: newActiveId };
      }),
    );
  }, []);

  const focusPane = useCallback((workspaceId: string, paneId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => w.id !== workspaceId ? w : { ...w, activePaneId: paneId }),
    );
  }, []);

  const setPaneDivider = useCallback((workspaceId: string, splitId: string, position: number) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        return { ...w, paneTree: updateDivider(w.paneTree, splitId, position) };
      }),
    );
  }, []);

  // ── Panel operations ──────────────────────────────────────────────────────

  const openPanel = useCallback((workspaceId: string, paneId: string, panel: Panel) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        return {
          ...w,
          paneTree: updatePane(w.paneTree, paneId, (p) => ({
            ...p,
            panels: [...p.panels, panel],
            activePanelId: panel.id,
          })),
        };
      }),
    );
  }, []);

  const activatePanel = useCallback((workspaceId: string, panelId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const result = findPanelPane(w.paneTree, panelId);
        if (!result) return w;
        return {
          ...w,
          activePaneId: result.pane.id,
          paneTree: updatePane(w.paneTree, result.pane.id, (p) => ({
            ...p,
            activePanelId: panelId,
          })),
        };
      }),
    );
  }, []);

  const closePanel = useCallback((workspaceId: string, panelId: string) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const result = findPanelPane(w.paneTree, panelId);
        if (!result) return w;
        const { pane } = result;
        const remaining = pane.panels.filter((p) => p.id !== panelId);
        if (remaining.length === 0) {
          // Last panel in pane — close the pane
          const newTree = removePaneFromTree(w.paneTree, pane.id);
          if (!newTree) return w; // never remove last pane
          const sibling = siblingPane(w.paneTree, pane.id);
          return {
            ...w,
            paneTree: newTree,
            activePaneId: w.activePaneId === pane.id
              ? (sibling?.id ?? firstPaneId(newTree))
              : w.activePaneId,
          };
        }
        const newActiveId =
          pane.activePanelId === panelId
            ? (remaining[remaining.length - 1]?.id ?? null)
            : pane.activePanelId;
        return {
          ...w,
          paneTree: updatePane(w.paneTree, pane.id, (p) => ({
            ...p,
            panels: remaining,
            activePanelId: newActiveId,
          })),
        };
      }),
    );
  }, []);

  const updatePanelData = useCallback((workspaceId: string, panelId: string, updater: (p: Panel) => Panel) => {
    setWorkspaces((prev) =>
      prev.map((w) => {
        if (w.id !== workspaceId) return w;
        const result = findPanelPane(w.paneTree, panelId);
        if (!result) return w;
        return {
          ...w,
          paneTree: updatePane(w.paneTree, result.pane.id, (p) => ({
            ...p,
            panels: p.panels.map((panel) => panel.id === panelId ? updater(panel) : panel),
          })),
        };
      }),
    );
  }, []);

  const setTerminalPanelCwd = useCallback((workspaceId: string, panelId: string, cwd: string) => {
    updatePanelData(workspaceId, panelId, (p) => p.kind === "terminal" ? { ...p, cwd } : p);
  }, [updatePanelData]);

  // ── Derived ───────────────────────────────────────────────────────────────

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  const findPanelGlobal = useCallback((panelId: string) => {
    for (const w of workspacesRef.current) {
      const result = findPanelPane(w.paneTree, panelId);
      if (result) return { workspace: w, ...result };
    }
    return null;
  }, []);

  const findPaneGlobal = useCallback((paneId: string) => {
    for (const w of workspacesRef.current) {
      const pane = findPane(w.paneTree, paneId);
      if (pane) return { workspace: w, pane };
    }
    return null;
  }, []);

  return {
    workspaces,
    activeWorkspaceId,
    setActiveWorkspaceId,
    activeWorkspace,
    addWorkspace,
    closeWorkspace,
    splitPane,
    closePane,
    focusPane,
    setPaneDivider,
    openPanel,
    activatePanel,
    closePanel,
    updatePanelData,
    setTerminalPanelCwd,
    findPanelGlobal,
    findPaneGlobal,
    allPaneIds,
  };
}

export type UseWorkspacesReturn = ReturnType<typeof useWorkspaces>;
