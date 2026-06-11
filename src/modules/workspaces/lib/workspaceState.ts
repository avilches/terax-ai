import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { Panel, SplitNode, Workspace } from "./types";

type SavedState = { workspaces: Workspace[]; activeIndex: number };

// WindowEntry mirrors the Rust WindowEntry struct (camelCase via serde rename_all).
type WindowEntry = { workspaces: Workspace[]; activeIndex: number };

let cached: SavedState | null = null;

function sanitizePanel(p: Panel): Panel {
  if (p.kind === "editor") return { ...p, dirty: false };
  return p;
}

function sanitizeTree(node: SplitNode): SplitNode {
  if (node.kind === "pane") {
    return { ...node, panels: node.panels.map(sanitizePanel) };
  }
  return { ...node, first: sanitizeTree(node.first), second: sanitizeTree(node.second) };
}

function sanitizeWorkspace(w: Workspace): Workspace {
  return { ...w, paneTree: sanitizeTree(w.paneTree) };
}

export async function initWorkspaceState(): Promise<void> {
  try {
    const label = getCurrentWebviewWindow().label;
    const entry = await invoke<WindowEntry | null>("window_get_state", { label });
    if (entry && Array.isArray(entry.workspaces) && entry.workspaces.length > 0) {
      cached = { workspaces: entry.workspaces, activeIndex: entry.activeIndex };
    }
  } catch {
    cached = null;
  }
}

export function getSavedWorkspaceState(): SavedState | null {
  return cached;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveWorkspaceState(workspaces: Workspace[], activeIndex: number): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const label = getCurrentWebviewWindow().label;
    void invoke("window_save_workspace_state", {
      label,
      workspaces: workspaces.map(sanitizeWorkspace),
      // Rust param name is active_index (snake_case); Tauri 2 does NOT auto-convert.
      // eslint-disable-next-line camelcase
      active_index: Math.max(0, Math.min(activeIndex, workspaces.length - 1)),
    }).catch(() => {});
  }, 800);
}
