import { cn } from "@/lib/utils";
import { panelIcon, panelTitle } from "./lib/panelTitle";
import type { Panel } from "./lib/types";

type Props = {
  panels: Panel[];
  activePanelId: string | null;
  onActivate: (panelId: string) => void;
  onClose: (panelId: string) => void;
  onNewTerminal: () => void;
};

export function PaneTabBar({ panels, activePanelId, onActivate, onClose, onNewTerminal }: Props) {
  return (
    <div className="flex h-7 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 bg-card/60 px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {panels.map((p) => {
        const active = p.id === activePanelId;
        return (
          <div
            key={p.id}
            className={cn(
              "group flex h-5 min-w-0 max-w-[140px] shrink-0 cursor-pointer select-none items-center gap-1 rounded px-1.5 text-[11px] transition-colors",
              active
                ? "bg-muted text-foreground"
                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
            )}
            onClick={() => onActivate(p.id)}
          >
            <span className="shrink-0 text-[10px] opacity-70">{panelIcon(p)}</span>
            <span className="truncate">{panelTitle(p)}</span>
            {p.kind === "editor" && p.dirty && (
              <span className="shrink-0 text-[8px] text-primary">●</span>
            )}
            <button
              type="button"
              className="ml-0.5 shrink-0 opacity-0 transition-opacity group-hover:opacity-60 hover:!opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                onClose(p.id);
              }}
              title="Close panel"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        type="button"
        onClick={onNewTerminal}
        className="ml-1 shrink-0 px-1 text-sm text-muted-foreground transition-colors hover:text-foreground"
        title="New terminal in this pane"
      >
        +
      </button>
    </div>
  );
}
