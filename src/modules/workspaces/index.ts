export type { Panel, PaneNode, SplitNode, Workspace } from "./lib/types";
export { useWorkspaces, type UseWorkspacesReturn } from "./lib/useWorkspaces";
export { panelTitle, panelIcon } from "./lib/panelTitle";
export {
  allPaneIds,
  allPanes,
  findPane,
  findPanelPane,
  firstPaneId,
  siblingPane,
  splitPaneInTree,
  removePaneFromTree,
  updatePane,
  updateDivider,
} from "./lib/splitNode";
