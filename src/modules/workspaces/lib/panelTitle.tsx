import { ComputerTerminal01Icon, ComputerTerminal02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { ReactNode } from "react";
import type { Panel } from "./types";

function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function wsVariant(workspaceId: string): 0 | 1 {
  let sum = 0;
  for (let i = 0; i < workspaceId.length; i++) sum += workspaceId.charCodeAt(i);
  return (sum % 2) as 0 | 1;
}

export function panelTitle(panel: Panel): string {
  if (panel.title) return panel.title;
  switch (panel.kind) {
    case "terminal":        return panel.cwd ?? "shell";
    case "editor":          return basename(panel.path);
    case "preview":         return panel.url || "Preview";
    case "markdown":        return basename(panel.path);
    case "git-diff":        return basename(panel.path);
    case "git-history":     return "Git History";
    case "git-commit-file": return basename(panel.path);
  }
}

export function panelIcon(panel: Panel, workspaceId?: string): ReactNode {
  switch (panel.kind) {
    case "terminal": {
      const icon = workspaceId && wsVariant(workspaceId) === 0
        ? ComputerTerminal01Icon
        : ComputerTerminal02Icon;
      return <HugeiconsIcon icon={icon} size={11} strokeWidth={1.5} />;
    }
    case "editor":          return "📄";
    case "preview":         return "🌐";
    case "markdown":        return "📝";
    case "git-diff":        return "±";
    case "git-history":     return "⏱";
    case "git-commit-file": return "±";
  }
}
