import { LazyStore } from "@tauri-apps/plugin-store";

const STORE_PATH = "workspace-state.json";
const store = new LazyStore(STORE_PATH, { defaults: {}, autoSave: false });

type SavedWorkspace = { cwd?: string };
type SavedState = { workspaces: SavedWorkspace[]; activeIndex: number };

let cached: SavedState | null = null;

export async function initWorkspaceState(): Promise<void> {
  try {
    const saved = await store.get<SavedState>("state");
    if (saved && Array.isArray(saved.workspaces) && saved.workspaces.length > 0) {
      cached = saved;
    }
  } catch {
    cached = null;
  }
}

export function getSavedWorkspaceState(): SavedState | null {
  return cached;
}

let saveTimer: ReturnType<typeof setTimeout> | null = null;

export function saveWorkspaceState(
  workspaces: { cwd?: string }[],
  activeIndex: number,
): void {
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const state: SavedState = {
      workspaces: workspaces.map((w) => ({ cwd: w.cwd })),
      activeIndex: Math.max(0, Math.min(activeIndex, workspaces.length - 1)),
    };
    void store.set("state", state).then(() => store.save()).catch(() => {});
  }, 800);
}
