import { EditorPane, type EditorPaneHandle } from "@/modules/editor/EditorPane";
import { GitDiffPane } from "@/modules/editor/GitDiffPane";
import { GitHistoryPane } from "@/modules/git-history/GitHistoryPane";
import type { GitHistorySearchHandle } from "@/modules/git-history/GitHistoryPane";
import { MarkdownPreviewPane } from "@/modules/markdown/MarkdownPreviewPane";
import { PreviewPane, type PreviewPaneHandle } from "@/modules/preview/PreviewPane";
import { TerminalPane, type TerminalPaneHandle } from "@/modules/terminal/TerminalPane";
import type { SearchAddon } from "@xterm/addon-search";
import { useRef } from "react";
import type { Panel } from "./lib/types";

type CommitFileDiffOpenInput = {
  repoRoot: string;
  sha: string;
  shortSha: string;
  subject: string;
  path: string;
  originalPath: string | null;
};

export type PanelCallbacks = {
  // Terminal callbacks
  onSearchReady?: (panelId: string, addon: SearchAddon) => void;
  onExit?: (panelId: string, code: number) => void;
  onCwd?: (panelId: string, cwd: string) => void;
  registerTerminalHandle?: (panelId: string, handle: TerminalPaneHandle | null) => void;
  // Editor callbacks
  onEditorDirtyChange?: (panelId: string, dirty: boolean) => void;
  onEditorClose?: (panelId: string) => void;
  registerEditorHandle?: (panelId: string, handle: EditorPaneHandle | null) => void;
  // Preview callbacks
  onPreviewUrlChange?: (panelId: string, url: string) => void;
  registerPreviewHandle?: (panelId: string, handle: PreviewPaneHandle | null) => void;
  // Git history callbacks
  onOpenCommitFile?: (input: CommitFileDiffOpenInput) => void;
  onGitHistorySearchHandle?: (panelId: string, handle: GitHistorySearchHandle | null) => void;
};

type Props = {
  panel: Panel;
  visible: boolean;
  focused: boolean;
  callbacks: PanelCallbacks;
};

export function PanelContent({ panel, visible, focused, callbacks }: Props) {
  const terminalRef = useRef<TerminalPaneHandle>(null);
  const editorRef = useRef<EditorPaneHandle>(null);
  const previewRef = useRef<PreviewPaneHandle>(null);

  switch (panel.kind) {
    case "terminal":
      return (
        <TerminalPane
          ref={(h) => {
            (terminalRef as React.MutableRefObject<TerminalPaneHandle | null>).current = h;
            callbacks.registerTerminalHandle?.(panel.id, h);
          }}
          panelId={panel.id}
          visible={visible}
          focused={focused}
          initialCwd={panel.cwd}
          onSearchReady={callbacks.onSearchReady}
          onExit={callbacks.onExit}
          onCwd={callbacks.onCwd}
        />
      );

    case "editor":
      return (
        <EditorPane
          ref={(h) => {
            (editorRef as React.MutableRefObject<EditorPaneHandle | null>).current = h;
            callbacks.registerEditorHandle?.(panel.id, h);
          }}
          path={panel.path}
          onDirtyChange={(dirty) => callbacks.onEditorDirtyChange?.(panel.id, dirty)}
          onClose={() => callbacks.onEditorClose?.(panel.id)}
        />
      );

    case "preview":
      return (
        <PreviewPane
          ref={(h) => {
            (previewRef as React.MutableRefObject<PreviewPaneHandle | null>).current = h;
            callbacks.registerPreviewHandle?.(panel.id, h);
          }}
          url={panel.url}
          visible={visible}
          onUrlChange={(url) => callbacks.onPreviewUrlChange?.(panel.id, url)}
        />
      );

    case "markdown":
      return <MarkdownPreviewPane path={panel.path} visible={visible} />;

    case "git-diff":
      return (
        <GitDiffPane
          source={{
            kind: "working",
            repoRoot: panel.repoRoot,
            path: panel.path,
            mode: panel.mode,
            originalPath: panel.originalPath,
          }}
          active={visible}
        />
      );

    case "git-commit-file":
      return (
        <GitDiffPane
          source={{
            kind: "commit",
            repoRoot: panel.repoRoot,
            sha: panel.sha,
            path: panel.path,
            originalPath: panel.originalPath,
          }}
          active={visible}
        />
      );

    case "git-history":
      return (
        <GitHistoryPane
          repoRoot={panel.repoRoot}
          onOpenCommitFile={(input) => callbacks.onOpenCommitFile?.(input)}
          onSearchHandle={(handle) => callbacks.onGitHistorySearchHandle?.(panel.id, handle)}
        />
      );
  }
}
