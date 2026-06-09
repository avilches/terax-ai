import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";
import type { Tab } from "@/modules/tabs";

export type WorkspaceSidebarProps = {
  workspaces: Pick<Tab, "id" | "title" | "kind">[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
};

function abbrev(title: string, kind: string): string {
  const text = title.trim() || kind;
  const words = text.split(/[\s\-_/]+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  return text.slice(0, 2).toUpperCase();
}

// Stable hue 0–359 derived from the workspace ID string.
function idHue(id: string): number {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h << 5) + h + id.charCodeAt(i)) | 0;
  return (h >>> 0) % 360;
}

export function WorkspaceSidebar({
  workspaces,
  activeId,
  onSelect,
  onNew,
}: WorkspaceSidebarProps) {
  return (
    <nav
      aria-label="Workspaces"
      className="flex w-[52px] shrink-0 flex-col items-center gap-1.5 border-r border-border/60 bg-card/60 py-2"
    >
      {workspaces.map((ws) => {
        const active = ws.id === activeId;
        const hue = idHue(ws.id);
        return (
          <button
            key={ws.id}
            type="button"
            title={ws.title || ws.kind}
            aria-pressed={active}
            onClick={() => onSelect(ws.id)}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-lg text-[11px] font-semibold transition-all select-none",
              active
                ? "text-white"
                : "bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
            style={
              active
                ? ({
                    backgroundColor: `hsl(${hue} 55% 42%)`,
                    boxShadow: `0 0 0 2px hsl(var(--card) / 1), 0 0 0 4px hsl(${hue} 55% 55%)`,
                  } as CSSProperties)
                : undefined
            }
          >
            {abbrev(ws.title, ws.kind)}
          </button>
        );
      })}
      <div className="flex-1" />
      <button
        type="button"
        title="New workspace (⌘⇧N)"
        onClick={onNew}
        className="flex h-9 w-9 items-center justify-center rounded-lg border border-dashed border-border/60 text-lg text-muted-foreground transition-colors hover:border-border hover:text-foreground"
      >
        +
      </button>
    </nav>
  );
}
