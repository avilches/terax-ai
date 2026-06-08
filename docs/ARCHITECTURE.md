# Terax — Architecture and Technical Reference

Terax is a lightweight, open-source, AI-native terminal emulator (ADE). ~7-8 MB on disk. No telemetry. No account. BYOK or fully local models.

This document is the canonical reference for understanding how Terax works — both technically and from the user's perspective. It covers architecture, feature semantics, known limitations, and technical decisions that have observable effects on usage. Read `TERAX.md` before contributing; that file contains the living coding conventions.

---

## Table of contents

1. [What Terax is and is not](#1-what-terax-is-and-is-not)
2. [High-level architecture](#2-high-level-architecture)
3. [Features — user perspective](#3-features--user-perspective)
4. [Technical decisions with user-visible effects](#4-technical-decisions-with-user-visible-effects)
5. [Known limitations](#5-known-limitations)
6. [Technology stack](#6-technology-stack)
7. [Frontend module map](#7-frontend-module-map)
8. [Backend IPC surface (Rust)](#8-backend-ipc-surface-rust)
9. [AI subsystem in depth](#9-ai-subsystem-in-depth)
10. [Security model](#10-security-model)
11. [Build and packaging](#11-build-and-packaging)

---

## 1. What Terax is and is not

**Is:** a fast, terminal-first development workspace with a native PTY backend, an integrated code editor, file explorer, source control, and a first-class AI agent system.

**Is not:**
- A full IDE replacement. No language-server integration, integrated debuggers, or refactoring engines at IDE scale.
- A general-purpose browser. The web preview pane is scoped to local dev servers and lightweight doc viewing only.
- A cloud product. No accounts, no telemetry, no managed sessions. Keys live in the OS keychain.
- A shell replacement. It runs your shell (zsh, bash, fish, pwsh) via a real PTY, it does not replace it.

---

## 2. High-level architecture

Terax uses a strict **two-process model**. The Rust process owns all OS access. The WebView (React) never touches the filesystem, processes, shells, or the network directly — everything goes through typed IPC calls (`invoke()`) to Tauri commands registered in `src-tauri/src/lib.rs`.

```
┌─────────────────────────────────────────────────────────────┐
│  Tauri process (Rust)                                       │
│                                                             │
│  pty::*         — PTY sessions (portable-pty)               │
│  fs::*          — Filesystem (read, write, search, watch)   │
│  git::*         — Git operations (subprocess)               │
│  shell::*       — Oneshot commands, persistent sessions,    │
│                   background processes                      │
│  net::*         — HTTP proxy for AI providers (SSRF guard)  │
│  secrets::*     — OS keychain (keyring crate)               │
│  workspace::*   — Auth registry + WSL bridge                │
│  history::*     — Shell history (suggest, record, list)     │
│  agent::*       — Claude hooks installer                    │
│                                                             │
└──────────────────────────┬──────────────────────────────────┘
                           │ invoke() / Tauri channels / events
┌──────────────────────────▼──────────────────────────────────┐
│  WebView (React + TypeScript)                               │
│                                                             │
│  terminal/      — xterm.js (WebGL), PTY bridge, OSC parsing │
│  editor/        — CodeMirror 6, AI autocomplete, diffs      │
│  ai/            — Agent, sessions, tools, composer          │
│  explorer/      — File tree, fuzzy search                   │
│  source-control/  — Git stage/commit/push UI                │
│  git-history/   — Commit graph, per-file diffs              │
│  theme/         — CSS variable engine, presets              │
│  agents/        — Terminal agent notifications              │
│  + tabs, header, statusbar, sidebar, settings, preview…     │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

There are two separate WebView windows: the main window (`index.html`) and the settings window (`settings.html`). Both run against the same Rust process state.

---

## 3. Features — user perspective

### 3.1 Terminal

**Multi-tab terminal with background streaming.** Tabs are never unmounted when you switch between them — each PTY keeps receiving output in the background. Switching to a tab that has been running a command shows you the complete, up-to-date buffer instantly.

**Native PTY via `portable-pty`.** Not a wrapper around `script` or `expect`. Terax spawns a real pseudo-terminal, so TUI apps (vim, htop, tmux, lazygit, etc.) work correctly, including mouse input and true color.

**Shell integration.** Terax injects init scripts at shell startup that emit OSC 7 (current working directory) and OSC 133 sequences (prompt boundaries, command start, command end, exit code). This enables:
- The CWD breadcrumb in the status bar to update as you `cd` through directories.
- The file explorer to follow the active terminal's working directory.
- The AI agent to know which directory to operate in without being told.
- Command block detection for future features.

Supported shells: zsh (full), bash (full), fish (full), PowerShell 7+ (full), PowerShell 5.1 (full), cmd.exe (no integration — basic terminal only).

**Split panes.** Terminals can be split horizontally and vertically within a tab. Each pane is an independent PTY.

**Inline search.** `Cmd+F` / `Ctrl+F` opens an inline search bar that searches the xterm.js buffer. Matches are highlighted in the viewport and you can jump between them.

**Link detection.** URLs in terminal output are clickable and open in the system browser.

**True color and 256-color.** The xterm.js WebGL renderer supports the full color space. The terminal color palette is driven by the active app theme, not hardcoded.

**WSL as a first-class workspace (Windows only).** Each tab can be set to run inside a specific WSL distro via the workspace switcher in the status bar. The file explorer, git operations, and AI tools all operate inside that distro's filesystem — it is not a wrapped subprocess.

### 3.2 Code editor

**CodeMirror 6.** A proper code editor, not a textarea. Syntax highlighting, bracket matching, line numbers, code folding, multi-cursor, and tab/indent handling work correctly.

**Language support.** TypeScript / JavaScript (JSX/TSX), Rust, Python, Go, HTML, CSS, JSON, Markdown, PHP, C/C++/Java/C# (via legacy modes), and more. Language is detected from the file extension and the appropriate language pack is loaded on demand.

**Vim mode.** Opt-in via settings. Uses `@replit/codemirror-vim` which implements the Vim keybinding model inside CodeMirror. Normal/insert/visual modes, motions, operators, and `:` commands work. Not a full Vim emulation, but covers the common workflow.

**Ten built-in editor themes**, independent from the app theme: Atom One Dark, Aura, Copilot, GitHub Dark, GitHub Light, Gruvbox Dark, Nord, Tokyo Night, Xcode Dark, Xcode Light.

**Inline AI autocomplete.** As you type, Terax can suggest completions using any configured provider (cloud or local). The suggestion appears as ghost text inline. `Tab` to accept, continue typing to dismiss. Requires an AI provider to be configured; local models (LM Studio, MLX, Ollama) are a practical choice for low-latency autocomplete without API costs.

**AI edit diffs.** When the AI agent proposes a file change, Terax opens it in a side-by-side diff view (`ai-diff` tab kind) using CodeMirror's merge extension. You can accept or reject individual hunks before the file is written. The actual write only happens after acceptance.

**File sync.** The editor reads and writes files through the Rust filesystem commands. If a file changes on disk while you have it open (e.g., `git checkout` or an AI tool write), the editor can detect the change via the file watcher.

### 3.3 File explorer

**Tree view with icons.** The Catppuccin icon theme covers the full range of file types. Folder icons are context-aware (e.g., `src/`, `.github/`, `node_modules/`).

**Keyboard navigation.** Arrow keys to move, `Enter` to open, `F2` / double-click to rename inline, right-click or context menu key for actions (new file, new folder, rename, delete, copy path, reveal in finder, open in terminal).

**Fuzzy search.** The search bar in the explorer panel searches file names across the entire workspace tree using the `nucleo-matcher` crate on the Rust side.

**Attach to AI.** Files and selections can be attached to the AI composer directly from the explorer. The attachment appears as a chip in the input bar and is included in the AI context.

**Root follows active tab.** The explorer root tracks the working directory of the active terminal tab (derived from OSC 7). If you `cd ~/projects/foo` in a terminal, the explorer follows.

### 3.4 Source control

**Git status and staging.** The source control panel shows modified, staged, untracked, and conflicted files. You can stage / unstage individual files or hunks. The diff view uses the same CodeMirror merge extension as AI diffs.

**Commit.** Type a commit message and commit with `Cmd+Enter` / `Ctrl+Enter`. No separate terminal command needed.

**Push.** Push to the remote with upstream awareness — Terax tells you if you are ahead, behind, or diverged before you push.

**Branch display.** The current branch (or detached HEAD state) is shown in the header.

**All git operations are gated on workspace authorization.** A directory must be authorized (see section 4.3) before any git command can run against it. This prevents the AI or the source control panel from operating on paths that were not explicitly opened.

### 3.5 Git history

**Commit graph.** The git history pane renders a proper commit graph with lane routing for merges and branches, similar to GitLens or Sourcetree. Refs (branches, tags, HEAD) are shown on the relevant commits.

**Per-commit diffs.** Click a commit to see its changed files. Click a file to see the full diff for that file in that commit.

**Remote links.** For commits on GitHub/GitLab/Bitbucket remotes, there is a link to open the commit page in the browser.

**Commit search and filter.** Filter the history by commit message, author, or date range.

### 3.6 AI agent

See section 9 for the full technical detail. From the user's perspective:

**BYOK — you bring your own API key.** Terax never stores keys on disk or sends them to any Terax server. Keys go straight into the OS keychain and are read back from there. Keys are sent directly to the provider (via the Rust HTTP proxy — see section 4.2).

**Supported providers:**
- Cloud (key required): OpenAI, Anthropic, Google Gemini, Groq, xAI (Grok), Cerebras, plus any OpenAI-compatible endpoint (OpenRouter, DeepSeek, Mistral, etc.)
- Local / offline (no key needed, model ID supplied at runtime): LM Studio, MLX, Ollama

**Composer.** The AI input bar at the bottom of the AI panel accepts:
- Free-text prompts.
- `#snippet-name` to insert reusable prompt fragments (snippets / skills).
- `@file/path` to attach a file from the workspace.
- Selections from the terminal or editor (dragged or sent via right-click "Ask AI").
- Image attachments.
- Voice input (streamed transcription via Whisper).

**Slash commands.** The AI composer recognizes these built-in slash commands:
- `/compact` — compress the conversation history when context gets long (implemented in `lib/compact.ts`).
- `/init` — scan the workspace and generate a `TERAX.md` file with project description, commands, architecture overview, and conventions.
- `/plan` — toggle plan mode. While plan mode is on, all file-mutating tool calls (`write_file`, `edit`, `multi_edit`, `create_directory`) are queued instead of applied. The user reviews the full queue in one pass and applies or discards changes atomically. `/plan off` exits plan mode and discards the queue.
- `/claude-code <request>` — delegate work to a Claude Code agent running in a terminal tab. The main agent acts as orchestrator: it checks for an already-active agent via `read_agent_output`, spawns one if none is active, or sends a follow-up instruction via `send_to_agent`.

**Agent tools.** The AI can use tools to act on your workspace:
- `read_file`, `list_directory`, `fs_search`, `fs_grep` — execute automatically without asking.
- `write_file`, `create_directory`, `rename`, `delete`, `run_command`, `shell_session_run`, `shell_bg_spawn` — show a confirmation card in the UI, the AI pauses until you approve or reject.

**Plan mode.** Before running a multi-step task, the agent can generate a plan and present it for review. You can edit or approve the plan before execution starts.

**Sub-agents.** The main agent can invoke specialized sub-agents with their own system prompts and restricted tool subsets. For example, a "search-only" sub-agent that can read but not write.

**Custom agents.** You can define agents with custom system prompts and tool subsets in Settings > Agents.

**Sessions.** Conversations are organized into named sessions. Sessions persist across restarts via `tauri-plugin-store`. Switching the API key clears the in-memory chat objects but sessions remain.

**`TERAX.md` as project memory.** Terax loads `TERAX.md` from the workspace root as agent context, similar to how Cursor uses `.cursorrules` or Claude Code uses `CLAUDE.md`. Put project-specific instructions, architecture notes, or constraints there.

**Auto-compact.** When a session gets long, `/compact` summarizes the history to free up context while preserving the conversation's meaning.

**Terminal coding-agent integration.** When Claude Code (or a future compatible agent) runs inside a Terax terminal, Terax detects its state via OSC sequences emitted by agent hooks. A notification bell in the header shows the agent's status (working / needs attention / done) with OS notifications when you are away from the window.

### 3.7 Web preview

**Auto-detected dev server.** When a localhost URL is detected in the terminal output (e.g., `http://localhost:5173`), a pill appears in the status bar offering to open a preview tab. The preview tab renders the URL in a native child webview — not an iframe inside the main webview.

**Image and PDF viewers.** The preview pane also handles images and PDFs opened from the file explorer.

**Sandboxed.** The preview runs in its own webview context. It cannot communicate with the Terax app surface.

### 3.8 Themes and customization

**App theme.** The theme engine writes CSS custom properties to the document root. All UI components consume the theme through those variables. There are 10 built-in app themes: Terax Default, Nord, Tide, Catppuccin, Tokyo Night, Caffeine, Claude, Gruvbox, Sage, Rose Pine.

**Theme editor.** You can create and edit themes in-app. Changes are live-previewed. Custom themes are persisted to the settings store and can be exported as JSON files to share.

**Background image.** A background image can be set with adjustable opacity and blur. The image sits below the UI surface layer.

**Editor theme is independent.** The editor theme is a separate setting from the app theme. You can have a Catppuccin app theme with a GitHub Light editor theme.

**Terminal palette follows app theme.** The xterm.js ANSI color palette (colors 0-15) is derived from the active app theme, so the terminal colors are consistent with the UI.

### 3.9 Command palette

`Cmd+K` / `Ctrl+K` opens the command palette. It supports multiple modes (file finder, command runner, content search) distinguished by a prefix character. Fuzzy matching. Results are ranked by recency (MRU).

### 3.10 Settings

Settings open in a separate window (not a panel in the main window). Deep-linking is supported — `openSettingsWindow("models")` opens directly to the Models section. The settings window is `always_on_top` relative to the main window.

Sections: General, AI (providers and model selection), Themes, Shortcuts, Agents, About.

---

## 4. Technical decisions with user-visible effects

### 4.1 Tabs are never unmounted

When you switch tabs, the outgoing tab is hidden with `invisible pointer-events-none` CSS classes. It is never unmounted from the React tree. This means:

- PTY sessions keep streaming in the background. A running `npm run dev` in tab 2 continues while you are editing a file in tab 1.
- Tab state (scroll position, xterm buffer, editor content, unsaved changes) is preserved exactly as you left it.
- Memory usage is proportional to the number of open tabs, not just the visible one. Each tab holds a live xterm instance, and any mounted editor holds CodeMirror state. There is no "sleep" mechanism for idle tabs.

### 4.2 AI calls go through the Rust HTTP proxy

The WebView does not make HTTP requests to AI provider APIs directly. All provider calls go through `net::ai_http_request` / `net::ai_http_stream` Tauri commands, which are thin HTTP proxies implemented in Rust using `reqwest`. The reasons:

- **SSRF protection.** The proxy guards against requests to private IP ranges, preventing a prompt-injection attack from redirecting AI calls to your local network.
- **Key isolation.** API keys never need to be in JavaScript memory. The Rust layer reads them from the keychain and forwards them.
- **No CSP bypass needed.** The WebView CSP does not need to allowlist each provider domain individually in a maintainable way.

The observable effect: AI calls have one extra hop (JS -> Rust -> provider). The latency overhead is negligible (~1ms).

### 4.3 Workspace authorization

Before any git command, file operation, or AI tool can run against a directory, that directory must be in the `WorkspaceRegistry`. The registry is populated automatically when you open Terax in a directory (via CLI argument or the OS file manager context menu), and when you explicitly navigate to one. `workspace_authorize` is the IPC command for explicit authorization.

The practical effect: if you open Terax without a directory argument and then type a path into the AI composer, the AI will need the workspace to be authorized before it can make git calls or run commands there.

### 4.4 API keys are keychain-only

Keys written via Settings > AI go into the OS keychain (`keyring` crate, service `"terax-ai"`). They are never written to the settings store (`tauri-plugin-store`), localStorage, or any file. On Linux, `keyring` uses a file-based fallback (typically Secret Service via `libsecret` if available, otherwise a file under the cache dir).

Consequence: **keys cannot be exported or transferred**. If you reinstall Terax or move to a new machine, you re-enter your keys. If you want to use the same key across machines, you manage that yourself.

### 4.5 `AiComposerProvider` mounts unconditionally

The AI composer context provider is mounted at the root of `App.tsx` regardless of whether any API key is configured. A conditional mount (e.g., "only mount once the key is loaded") would change the parent element type at the moment the key resolves, causing React to unmount and remount the entire app tree — including every live PTY. The provider is safe to mount empty; it just means `isBusy` is derived correctly even before sessions hydrate.

### 4.6 Windows: ConPTY spawn serialization

On Windows, opening a new terminal tab serializes through a `SPAWN_LOCK` mutex. Concurrent ConPTY open calls leave one of the resulting PTYs with a stalled output pipe. This means: if you open several tabs very quickly on Windows, the tabs open in sequence rather than in parallel. The delay is typically under 200ms per tab and is only perceptible during rapid tab creation.

### 4.7 Windows: Job Objects for process cleanup

Every ConPTY child process on Windows is assigned to a Job Object with `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE`. When the Job handle is released (Terax closes, crashes, or is killed), the OS terminates the entire process subtree of that shell session. Without this, `npm run dev` started inside a PowerShell terminal would continue running after Terax exits, as `TerminateProcess` only kills the immediate child.

Closing a tab from the UI (the explicit close button) also kills the immediate child. The Job Object handles the "Terax process died unexpectedly" case.

### 4.8 OSC trust model

Terax's shell integration emits and parses OSC 7 (cwd) and OSC 133 (prompt/command boundaries). The cwd from OSC 7 updates the status bar breadcrumb, the explorer root, and the AI agent's working directory. This means a malicious command outputting a crafted OSC sequence could theoretically spoof the displayed cwd. The shell integration scripts are trusted; arbitrary terminal output from untrusted remote connections (SSH to untrusted hosts) is a trust boundary to be aware of.

### 4.9 Forward-slash canonical paths

The frontend stores all paths in forward-slash form. OSC 7 on Windows emits `/C:/Users/foo`; Terax normalizes it to `C:/Users/foo` at parse time. `homeDir()` on Windows returns backslashes; `App.tsx` converts at the boundary. Any code consuming a path that might originate from the OS must normalize separators with `.split(/[\\/]/)`. This is documented in `TERAX.md` and enforced in code review.

The reason: consistent string equality for path comparison (e.g., preventing the file explorer from flashing when `tab.cwd` arrives). Using two representations and forgetting to normalize in one place causes subtle bugs.

### 4.10 React 19 Strict Mode double-mount

In development (`pnpm tauri dev`), React 19's Strict Mode double-invokes `useEffect`. This means a PTY is opened and immediately closed before the real one opens. You will see `pty opened id=1` then `pty closed id=1` followed by `pty opened id=2` in dev logs. This is expected and does not happen in production builds.

---

## 5. Known limitations

### 5.1 No SSH support (yet)

SSH is on the roadmap but not yet implemented. Terax does not manage SSH connections, key agents, or remote filesystems. You can of course `ssh user@host` in a terminal tab — the PTY runs it fine — but the editor, file explorer, git panel, and AI tools all operate on the local filesystem (or the WSL filesystem on Windows). See ROADMAP.md.

### 5.2 No persistent terminal layout restore

Terminal sessions are not persisted across restarts. When you close and reopen Terax, you start with a fresh terminal. Tab layout (number of tabs, split pane configuration, working directories) is not saved. Shell history within the terminal is whatever your shell persists natively (`.zsh_history`, `.bash_history`, etc.). Persistent sessions and layout restore are on the roadmap.

### 5.3 AI agent step limit

The agent runs with `stopWhen: stepCountIs(MAX_AGENT_STEPS)`. If the agent reaches this limit mid-task, it stops and reports what it has done. Long agentic tasks that require many tool calls in sequence may hit this limit. You can continue by sending a follow-up message.

### 5.4 Security deny-list is strict and not bypassable

The AI tool surface (`lib/security.ts`) maintains a deny-list of path patterns that cannot be read or written by the AI tools: `.env*`, `.ssh/`, credential files, keychain directories, and similar. This list applies on both read and write paths. There is no "override" UI. If you want the AI to work with a file that matches a deny-list pattern, you must do it manually outside the AI tools.

### 5.5 Background process log capture is bounded

Processes spawned via `shell_bg_spawn` (the AI tool for long-running background processes like dev servers) capture their stdout/stderr into a ring buffer of fixed size. The `shell_bg_logs` tool returns the most recent N lines. Older output is discarded. If a dev server produces very high-frequency log output, old lines scroll out of the ring buffer.

### 5.6 AI context redaction for private tabs

The terminal's last-N-lines buffer is available as live context to the AI agent. Tabs marked as "private" are excluded from this context. However, the AI can still `run_command` and observe its output — the private tab flag prevents automatic context inclusion, not all possible information access.

### 5.7 Linux keychain fallback

On Linux, if a Secret Service daemon (e.g., GNOME Keyring, KWallet) is not running, `keyring` falls back to a file-based store. This file is located under the platform cache directory and is readable by any process with the same user permissions. On headless servers or CI machines, consider whether this is acceptable for your threat model.

### 5.8 No LSP / language server

The editor does not support Language Server Protocol. There is no hover documentation, go-to-definition, inline diagnostics, or refactoring from language servers. CodeMirror's built-in syntax highlighting and autocomplete work, but IDE-level language intelligence does not. This is a deliberate scope decision (see ROADMAP.md > Out of scope).

### 5.9 File explorer watch lag

The file tree watches for filesystem changes via `notify`. On some Linux filesystems (including certain WSL mounts) the watcher latency can be higher than on macOS (kqueue/FSEvents) or Windows (ReadDirectoryChangesW). A file created in the terminal may take a second or two to appear in the explorer.

### 5.10 Apple Silicon / macOS code signing

Terax is not yet notarized by Apple. The first launch on macOS Gatekeeper requires right-click > Open (or `xattr -dr com.apple.quarantine Terax.app`). Auto-updates are signed with minisign but not Apple-notarized.

### 5.11 Windows: no code signing

On first launch Windows shows "Windows protected your PC" (SmartScreen). Click "More info" then "Run anyway". This is expected until the project acquires a code-signing certificate.

### 5.12 Web preview is not a full browser

The preview pane renders local dev servers in a native child webview. It does not have navigation history, bookmarks, devtools, or extension support. It is not a replacement for opening your dev server in Chrome or Firefox. External URLs work but the experience is intentionally minimal.

### 5.13 Autocomplete model vs. chat model

The AI autocomplete in the editor uses a separate model preference (`DEFAULT_AUTOCOMPLETE_MODEL`) from the main chat/agent model. For low-latency autocomplete, local models (LM Studio, MLX, Ollama) are significantly better than cloud models because they avoid round-trip latency. Cloud models work but completions will feel slow.

---

## 6. Technology stack

### Rust backend
| Crate | Version | Role |
|---|---|---|
| `tauri` | `2.x` | App framework, webview, IPC |
| `portable-pty` | `0.9` | Native PTY sessions |
| `reqwest` | `0.12` (rustls) | HTTP client for AI proxy |
| `keyring` | `3.6` | OS keychain (macOS Keychain, Windows Credential Store, Linux Secret Service) |
| `ignore` | `0.4` | Gitignore-aware directory traversal |
| `grep-regex` / `grep-searcher` | `0.1` | Content search |
| `nucleo-matcher` | `0.3` | Fuzzy file matching |
| `notify` | `8.2` | Filesystem watching |
| `globset` | `0.4` | Glob pattern matching |
| `tokio` | `1` (rt only) | Async runtime (minimal footprint) |
| `windows-sys` | `0.61` | Win32 Job Objects, process management |
| `dirs` | `6` | Cross-platform home/cache directories |
| `tempfile` | `3` | Temporary files for shell init scripts |
| `bytes` / `futures-util` | `1` / `0.3` | Streaming HTTP response handling |

Tauri plugins used: `store`, `updater`, `window-state`, `autostart`, `os`, `notification`, `log`, `opener`, `process`.

### TypeScript frontend
| Library | Version | Role |
|---|---|---|
| React | `19.2` | UI framework |
| Vite | `8.x` + Rolldown | Build tool and dev server |
| TypeScript | `~6.0` | Type system |
| Tailwind CSS | `v4` | Styling (config via `@theme` in CSS, no `tailwind.config.*`) |
| shadcn/ui | latest | UI primitives (regenerate via CLI, do not hand-edit) |
| Radix UI | `1.x` | Accessible component base |
| Zustand | `5.x` | Module-scoped global state |
| Vercel AI SDK | `v6` (`ai@6`) | Chat, streaming, agent orchestration |
| xterm.js | `6.x` | Terminal renderer (WebGL addon) |
| CodeMirror | `6.x` | Code editor |
| `motion` | latest | Animations (Framer Motion successor) |
| `react-resizable-panels` | `4.x` | Resizable layout panels |
| Sonner | `2.x` | Toast notifications |
| Zod | `4.x` | Schema validation |
| `streamdown` | `2.x` | Markdown streaming renderer |
| Biome | `2.x` | Linter and formatter |
| vitest | `4.x` | Unit tests |

---

## 7. Frontend module map

All modules live under `src/modules/`. Each is self-contained, exports a thin barrel via `index.ts`, and owns its hooks under `lib/`. Path imports always use `@/...`; relative imports across modules are not allowed.

```
src/
├── app/
│   ├── App.tsx                    — Root coordinator, wires all modules
│   ├── components/                — WorkspaceSurface, WorkspaceInputBar, OsIcon…
│   └── hooks/                     — useTabCloseGuards, useWorkspaceSwitcher
├── components/
│   ├── ui/                        — shadcn primitives (do not hand-edit)
│   ├── ai-elements/               — Vercel AI Elements (do not hand-edit)
│   └── WindowControls.tsx         — Custom title bar buttons (Linux, Windows)
├── lib/                           — Global utils: platform, fonts, zoom, utils
├── settings/                      — Second window (SettingsApp.tsx + sections)
├── styles/                        — globals.css, fonts.css, tokens, terminalTheme
└── modules/
    ├── terminal/                  — xterm.js stack, PTY bridge, OSC parsing, blocks
    │   └── block/                 — Block overlay, shell input, mode machine, history
    ├── editor/                    — CodeMirror 6 stack, autocomplete, diffs, vim
    ├── ai/                        — AI agent, sessions, tools, composer, stores
    │   ├── agents/                — Sub-agent registry and runner
    │   ├── components/            — AiChat, AiInputBar, AiMiniWindow, diffs, chips…
    │   ├── hooks/                 — useAiBootstrap, useSelectionAskAi, useWhisperRecording
    │   ├── lib/                   — agent.ts, sessions, composer, security, transport…
    │   ├── store/                 — chatStore, chatRuntime, planStore, todoStore…
    │   └── tools/                 — fs, shell, search, edit, terminal, subagent, todo
    ├── agents/                    — Terminal agent notifications (Claude Code, etc.)
    │   ├── components/            — NotificationBell, AgentToast
    │   ├── lib/                   — route, notify, review, agentIcon
    │   └── store/                 — agentStore, managedAgentsStore
    ├── explorer/                  — File tree, fuzzy search, icons, inline rename
    ├── source-control/            — Git stage/commit/push panel
    ├── git-history/               — Commit graph, per-file diffs
    ├── header/                    — Top bar, inline search
    ├── statusbar/                 — CWD breadcrumb, workspace env selector, AI tools indicator
    ├── sidebar/                   — Activity bar, collapsible side panels
    ├── tabs/                      — useTabs (source of truth), TabBar, useWorkspaceCwd
    ├── shortcuts/                 — Global keymap registry, useGlobalShortcuts
    ├── theme/                     — CSS variable engine, presets, custom themes, bg image
    ├── settings/                  — Settings store, preferences, window opener
    ├── preview/                   — Dev server preview pane
    ├── markdown/                  — Markdown renderer pane
    ├── workspace/                 — Local + WSL environment switching
    ├── updater/                   — Auto-updater dialog
    └── command-palette/           — Fuzzy command/file/search palette
```

### Tab kinds (tagged union)

`terminal` | `editor` | `preview` | `markdown` | `ai-diff` | `git-diff` | `git-history` | `git-commit-file`

All tab kinds follow the same never-unmount rule.

---

## 8. Backend IPC surface (Rust)

All commands registered in `src-tauri/src/lib.rs` via `tauri::generate_handler![]`.

### `pty::*` — PTY sessions
State: `PtyState = RwLock<HashMap<id, Session>>`

| Command | Description |
|---|---|
| `pty_open` | Spawn a new PTY session, returns a Tauri `Channel<PtyEvent>` for streaming output |
| `pty_write` | Write bytes to a PTY (keyboard input) |
| `pty_resize` | Resize PTY (columns / rows) |
| `pty_close` | Close PTY and kill the shell process |
| `pty_close_all` | Close all PTYs (used on app exit) |
| `pty_has_foreground_process` | Whether a process other than the shell itself is in the foreground |
| `pty_shell_name` | Detected shell name for the PTY session |

The shell integration scripts (`scripts/`) are injected at spawn time. Platform detection happens in `pty/shell_init.rs` with `#[cfg(unix)]` / `#[cfg(windows)]` split.

### `fs::*` — Filesystem
| Command | Description |
|---|---|
| `fs_read_dir` | Directory listing (one level) |
| `list_subdirs` | List only subdirectories (for the explorer tree) |
| `fs_read_file` | Read file contents as UTF-8 string |
| `fs_write_file` | Write file contents |
| `fs_stat` | File metadata (size, mtime, is_dir) |
| `fs_canonicalize` | Resolve symlinks and normalize path |
| `fs_create_file` | Create a new file |
| `fs_create_dir` | Create a new directory (recursive) |
| `fs_rename` | Rename or move a file/directory |
| `fs_delete` | Delete a file or directory |
| `fs_watch_add` | Start watching a path for changes (emits Tauri events) |
| `fs_watch_remove` | Stop watching a path |
| `fs_search` | Fuzzy file name search via `nucleo-matcher` + `ignore` |
| `fs_list_files` | List all files in a tree (respects `.gitignore`) |
| `fs_grep` | Content search via `grep-*` crates |
| `fs_grep_interactive` | Streaming grep for command palette content search |
| `fs_glob` | Glob pattern matching |

### `git::*` — Source control
All git commands are gated on the `WorkspaceRegistry`. Git is invoked as a subprocess (not via `git2`).

| Command | Description |
|---|---|
| `git_resolve_repo` | Find the git repo root for a given path |
| `git_panel_snapshot` | Fast status snapshot for the source control panel |
| `git_status` | Full porcelain status |
| `git_diff` | Diff of staged or unstaged changes |
| `git_diff_content` | Full diff content for a specific file |
| `git_stage` / `git_unstage` | Stage/unstage a file |
| `git_discard` | Discard unstaged changes for a file |
| `git_commit` | Create a commit |
| `git_fetch` | Fetch from remote |
| `git_pull_ff_only` | Fast-forward pull |
| `git_push` | Push to remote |
| `git_log` | Commit history (used by git history pane) |
| `git_show_commit` | Commit details and changed files |
| `git_commit_files` | Files changed in a specific commit |
| `git_commit_file_diff` | Diff of a specific file in a specific commit |
| `git_remote_url` | Remote URL for the repo (used for remote links) |

### `shell::*` — Command execution
| Command | Description |
|---|---|
| `shell_run_command` | One-shot subshell exec. Unix: `$SHELL -lc`. Windows: `pwsh -NoProfile -Command` |
| `shell_session_open` | Open a persistent named shell session (state across calls) |
| `shell_session_run` | Run a command in an open session and return combined output |
| `shell_session_close` | Close a persistent session |
| `shell_bg_spawn` | Spawn a background process (dev server etc.), returns a handle |
| `shell_bg_logs` | Read recent output from a background process's ring buffer |
| `shell_bg_kill` | Kill a background process |
| `shell_bg_list` | List all running background processes |

### `net::*` — AI HTTP proxy
| Command | Description |
|---|---|
| `ai_http_request` | Non-streaming HTTP request to AI provider |
| `ai_http_stream` | Streaming HTTP request (SSE) to AI provider |
| `lm_ping` | Connectivity check to a local model endpoint |

All requests go through an SSRF guard that refuses private IP ranges and loopback addresses that are not explicitly recognized local model endpoints.

### `secrets::*` — OS keychain
| Command | Description |
|---|---|
| `secrets_get` | Read a key from the keychain by service/account |
| `secrets_set` | Write a key to the keychain |
| `secrets_delete` | Delete a key from the keychain |
| `secrets_get_all` | List all stored key names (not values) |

Service constant: `"terax-ai"`. Keys are never returned to logs.

### `workspace::*`
| Command | Description |
|---|---|
| `workspace_authorize` | Grant access to a directory for git/AI/shell operations |
| `workspace_current_dir` | Query the authorized current directory |
| `wsl_list_distros` | List installed WSL distributions (Windows only) |
| `wsl_default_distro` | Get the default WSL distro |
| `wsl_home` | Get the home directory of a WSL distro |

### `history::*` — Shell history
| Command | Description |
|---|---|
| `history_suggest` | Fuzzy-match a prefix against shell history |
| `history_record` | Record a command execution to history |
| `history_list` | Return recent history entries |
| `history_commands` | Return all history entries |

### Misc
| Command | Description |
|---|---|
| `open_settings_window` | Open (or focus) the Settings window, optionally deep-linking a tab |
| `get_launch_dir` | Return the CLI launch directory (drained on first call) |
| `agent_enable_claude_hooks` | Atomically install Claude Code terminal hooks |
| `agent_claude_hooks_status` | Query whether hooks are installed |

---

## 9. AI subsystem in depth

### Provider configuration (`config.ts`)

`PROVIDERS` is an array of provider descriptors, each with an id, display name, `@ai-sdk/*` factory, a list of known model IDs, and a `keyOptional` flag (true for local providers). `DEFAULT_MODEL_ID` and `DEFAULT_AUTOCOMPLETE_MODEL` are hardcoded defaults overridable via Settings > AI.

Each provider's SDK bundle is kept in its own Vite chunk (`ai-anthropic`, `ai-google`, `ai-openai`, etc.) and lazy-imported in `lib/agent.ts`. Unused providers have zero cost on the initial load.

### Agent (`lib/agent.ts`)

The main agent is `Experimental_Agent` from the Vercel AI SDK v6. It runs with `stopWhen: stepCountIs(MAX_AGENT_STEPS)`. The `Chat` object from `@ai-sdk/react` drives the conversation UI. The provider instance is constructed at call time based on the configured provider + API key read from the keychain.

### Transport (`lib/transport.ts`)

A custom fetch adapter replaces the browser's `fetch` for AI SDK calls. Instead of fetching directly from the webview, it marshals the request through `net::ai_http_request` / `net::ai_http_stream` Tauri commands. This keeps API keys and outbound network calls off the webview entirely.

### Sessions (`lib/sessions.ts` + `store/chatStore.ts`)

Sessions are stored in `tauri-plugin-store` as:
- `terax-ai-sessions.json`: session list + `activeId`
- `messages:<sessionId>`: message array per session

`chatStore.ts` maintains a module-scoped `Map<sessionId, Chat<UIMessage>>`. `getOrCreateChat(apiKey, sessionId)` lazily constructs a `Chat`, seeded with messages from a hydration map populated once in `App.tsx`. `AgentRunBridge` mirrors active-session messages to disk on every change and auto-derives session titles from the first user message.

Switching the API key in Settings wipes the in-memory `Chat` map (because the provider instance must change). Sessions remain in the store and are re-hydrated on next access.

### Tools (`tools/tools.ts`)

Tools are composed from eight builder modules (`buildFsTools`, `buildEditTools`, `buildSearchTools`, `buildShellTools`, `buildTerminalTools`, `buildTodoTools`, `buildSubagentTools`, `buildManagedAgentTools`). Each tool receives a `ToolContext` object that wires in lazy getters for cwd, terminal buffer, workspace root, and agent helpers.

**Filesystem tools** (`tools/fs.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `read_file` | yes | — | Read a UTF-8 file (25KB / 2000-line cap; windowed with `offset`/`limit`). Caches a hash so repeated full reads return `unchanged: true` without re-emitting content. |
| `list_directory` | yes | — | List immediate entries (files + dirs) in a directory. |
| `write_file` | — | yes | Create or overwrite a file. When plan mode is on, enqueues to `planStore` instead of writing. Prefer `edit`/`multi_edit` for in-place changes. |
| `create_directory` | — | yes | Create a directory (recursive). Plan-mode aware. |

**Edit tools** (`tools/edit.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `edit` | — | yes | Replace an exact string in a file. Requires a prior `read_file` call on the same path in the session (read-before-edit invariant). `old_string` must be unique unless `replace_all: true`. Plan-mode aware. |
| `multi_edit` | — | yes | Apply multiple exact-string replacements to a single file atomically. All edits are applied in order to an in-memory buffer; any failure aborts the batch before writing. Requires prior `read_file`. Plan-mode aware. |

**Search tools** (`tools/search.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `grep` | yes | — | Regex content search (Rust ripgrep dialect), `.gitignore`-aware. Returns `{path, line, text}` hits; `max_results` cap (default 30, max 500). |
| `glob` | yes | — | Find files by globset pattern, `.gitignore`-aware. Returns up to `max_results` (default 500) paths. |

**Shell tools** (`tools/shell.ts`)

Each chat session has one persistent agent shell (lazily opened via `shell_session_open`; keyed by `sessionId:workspaceScopeKey`). cwd persists across `bash_run` calls within a session (so `cd foo` then `bash_run pwd` works).

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `bash_run` | — | yes | Run a foreground command in the session's persistent shell. cwd survives across calls. Not for interactive tools (vim, less, top). |
| `bash_background` | — | yes | Spawn a long-running background process (dev servers, watchers). Returns a handle; output captured into a 4MB ring buffer. |
| `bash_logs` | yes | — | Read accumulated output from a `bash_background` handle. Pass `since_offset` for incremental tailing. Reports `dropped` bytes from ring-buffer evictions. |
| `bash_list` | yes | — | List all background processes (running and exited). Call before spawning to avoid duplicate dev servers. |
| `bash_kill` | yes | — | Kill a background process by handle. Idempotent. |

**Terminal tools** (`tools/terminal.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `suggest_command` | yes | — | Propose a single shell command. Renders a card with an "Insert" button — the command is NOT executed automatically; the user clicks to insert it at the prompt. |
| `get_terminal_output` | yes | — | Return the tail of the active terminal's scrollback (default 80 lines, max 2000). Returns an empty string if no active terminal; refuses if the tab is in Privacy mode. |
| `open_preview` | yes | — | Open a preview tab (in-app iframe) at a localhost URL. Restricted to loopback addresses only. |

**Sub-agent tool** (`tools/subagent.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `run_subagent` | yes | — | Spawn an isolated read-only sub-agent with a restricted toolset and fresh message history. Returns a text summary. |

**Todo tool** (`tools/todo.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `todo_write` | yes | — | Replace the agent's task list (visible in TodoStrip in the UI). Always pass the full list; pass stable `id` values across calls to keep the UI from flickering. |

**Managed agent tools** (`tools/agent.ts`)

| Tool | Auto | Approval | Description |
|---|---|---|---|
| `spawn_coding_agent` | — | yes | Spawn a Claude Code agent in a new terminal tab bound to this chat session. Only one agent per session at a time. |
| `send_to_agent` | — | yes | Type a follow-up instruction into the active Claude Code agent's terminal and submit it. Increments a round counter per agent. |
| `read_agent_output` | yes | — | Inspect the active Claude Code agent: whether one exists, its phase, rounds, and tail of terminal output. Called first when handling a `/claude-code` request. |

The security deny-list in `lib/security.ts` applies to all tool calls that touch paths. Patterns include `.env*`, `.ssh/`, `*credentials*`, keychain database paths, and shell history files.

### Plan mode (`store/planStore.ts`)

Activated by the `/plan` slash command. While active, `write_file`, `edit`, `multi_edit`, and `create_directory` do not apply immediately — they call `planStore.enqueue()` with a `QueuedEdit` (path, original content, proposed content, kind, isNewFile). The UI renders the queue as a reviewable list; `applyAll()` writes them in order. `/plan off` disables plan mode and discards the queue.

### Sub-agents (`agents/registry.ts`, `agents/runSubagent.ts`)

Sub-agents are registered by name with their own system prompt and an allow-list of tool names from the master tool set. The main agent invokes `run_subagent(type, prompt)`. The sub-agent runs synchronously within the same agent turn (not a separate session). Recursion is prevented by excluding `run_subagent` from the sub-agent's tool list.

All four built-in sub-agent types are restricted to the read-only tool set (`read_file`, `list_directory`, `grep`, `glob`):

| Type | Label | Purpose |
|---|---|---|
| `explore` | Explore | Read-only codebase explorer — locates files, traces references, summarizes architecture. |
| `code-review` | Code review | Reviews code for correctness, architecture, performance, security issues. |
| `security` | Security review | Audits code/config for injection, auth bypass, secret leakage, missing validation. |
| `general` | General research | Multi-step research questions that span many files. |

### Composer (`lib/composer.tsx`)

A React context wrapping the entire AI panel. Provides:
- Text input state shared between `AiInputBar` and `AiMiniWindow`.
- Attachment state (files, selections, images). Selections are drained into chips and wrapped as `<selection source="terminal|editor">…</selection>` in the final prompt.
- Voice input pipeline (`hooks/useWhisperRecording.ts`): browser MediaRecorder → WAV buffer → whisper transcription API → composer text.

### Live context bridge (`lib/useAiLiveBridge.ts`)

`App.tsx` registers lazy getters for the AI subsystem: `getCwd()` returns the active tab's cwd, `getTerminalContext()` returns the last 300 lines of the active terminal's xterm.js buffer. These are not pre-snapshotted on every render; they are read lazily when a tool call actually needs them.

### Terminal agent integration (Claude Code)

There are two independent but complementary paths for Claude Code integration:

**Passive monitoring (OSC-based):** Works for any Claude Code session in any Terax terminal, whether or not it was spawned by the AI agent.

1. Claude Code installs Terax hooks via `agent_enable_claude_hooks`. These hooks emit an `OSC 777` marker through the hook's `terminalSequence` field (hooks lost `/dev/tty` access in Claude Code v2.1.139).
2. The OSC 777 marker self-arms `agent_detect.rs` in the PTY reader. The detector then tracks the agent's state via subsequent OSC sequences.
3. OSC 133;C (command prompt shown) arms the detector. Subsequent hook events transition the state machine: `started` / `working` / `attention` (needs user input) / `finished` / `exited`.
4. The frontend `AgentNotificationsBridge.tsx` maps these state transitions to the shared notification router (`lib/route.ts`): suppress if the tab is focused and visible, send an OS notification if the window is not focused, show a Sonner toast if the window is focused but the tab is hidden.
5. The `NotificationBell` in the header aggregates status across all terminal agent sessions and the built-in Terax local agent.

**Active orchestration (managed agents):** Triggered by the `/claude-code` slash command. The Terax AI agent acts as orchestrator.

1. The user types `/claude-code <request>`. The composer converts this to a structured orchestrator prompt.
2. The main agent calls `read_agent_output` to check whether a Claude Code agent is already active in this chat session (`managedAgentsStore`, keyed by `sessionId`).
3. If none is active: the main agent calls `spawn_coding_agent(prompt)`. Terax opens a new terminal tab, runs `claude --print "<prompt>"` in it, and registers the tab in `managedAgentsStore` bound to the current session.
4. If one is active: the main agent calls `send_to_agent(instruction)`. The instruction is written to the agent terminal's PTY input as a single-line string followed by a CR after a 90ms delay (the delay lets Claude Code's TUI render the input before Enter lands).
5. `read_agent_output` returns the agent's phase, round count, and tail of its terminal scrollback buffer — the main agent uses this to craft informed follow-ups.
6. The passive OSC-based monitoring path still fires in parallel, so the notification bell reflects the agent's state regardless of which path was used.

---

## 10. Security model

**IPC boundary.** The WebView cannot access the filesystem, spawn processes, or make outbound HTTP requests directly. Every OS operation is an explicit `invoke()` call to a named Tauri command. The `capabilities/default.json` file is the allowlist — only commands listed there are available to the webview.

**Path authorization.** Git commands and AI tool file operations require the target directory to be in the `WorkspaceRegistry`. The registry is populated by explicit user gestures (opening a directory, using the context menu) or by the CLI launch argument.

**AI tool path guard.** `lib/security.ts` maintains a deny-list that is applied before any file read or write from an AI tool. The deny-list is not bypassable from the AI side.

**SSRF protection.** The Rust HTTP proxy (`net.rs`) rejects requests to private IP ranges (10.x, 192.168.x, 172.16-31.x, 127.x, ::1, and similar) except for explicitly recognized local model endpoints. This prevents a prompt injection attack from redirecting AI HTTP calls to services on your local network.

**Keychain isolation.** API keys never appear in JavaScript memory, logs, settings files, or network requests as plaintext. They are read from the OS keychain in Rust and forwarded directly in the HTTP proxy call.

**CSP.** The WebView has a strict Content Security Policy (see `tauri.conf.json`). `connect-src` allows `self`, Tauri IPC, and `https:` plus `http://localhost:*` (for local model endpoints). `script-src` allows `wasm-unsafe-eval` (required for xterm.js WebGL). No `unsafe-eval`.

**OSC trust.** Terax only processes OSC 7 and OSC 133 sequences from shell integration scripts. There is no OSC-based execution primitive (unlike iTerm2's proprietary sequences). The risk is cwd spoofing from maliciously crafted output, not code execution.

---

## 11. Build and packaging

### Development
```bash
pnpm install
pnpm tauri dev         # frontend (Vite, port 1420) + Rust (cargo run)
pnpm dev               # frontend only (no Rust)
```

### Quality checks
```bash
pnpm lint              # biome lint ./src
pnpm check-types       # tsc --noEmit
pnpm test              # vitest run
cd src-tauri && cargo clippy --all-targets --locked -D warnings
cd src-tauri && cargo test --locked
```

### Production build
```bash
pnpm tauri build
```

Artifacts land in `src-tauri/target/release/bundle/`.

### Bundle chunk strategy (vite.config.ts)

Manual `manualChunks` splits the bundle to keep the initial load fast:
- `react` — React, ReactDOM, scheduler, clsx, tailwind-merge, cva, Vite preload helper
- `radix` — all Radix UI primitives
- `xterm` — xterm.js and addons
- `codemirror` — CodeMirror core, themes, vim
- `cm-lang-<name>` — each CodeMirror language pack (loaded on demand by `languageResolver.ts`)
- `cm-legacy-<name>` — each legacy mode
- `ai-anthropic` / `ai-google` / `ai-openai` / `ai-cerebras` / `ai-groq` / `ai-xai` / `ai-openai-compat` / `ai-sdk-shared` — each provider SDK isolated for lazy loading
- `streamdown` — markdown streaming renderer

### Rust release profile
`codegen-units=1`, `lto=fat`, `opt-level=s` (size-optimized), `panic=abort`, `strip=true`. Result: ~7-8 MB binary.

### Platform targets

| Platform | Format | Notes |
|---|---|---|
| macOS | `.dmg` + `.app` | `minimumSystemVersion: 13.0`, `titleBarStyle: Overlay`, entitlements.plist |
| Linux | `.deb`, `.rpm`, `.AppImage` | deb/rpm link against system webkit2gtk; AppImage bundles media framework |
| Windows | NSIS `.exe` | `currentUser` mode (no admin required), WebView2 via `downloadBootstrapper` |
| Arch Linux | AUR `terax-bin` | Tracks latest release |

### Auto-updater

Update manifest endpoint: `https://github.com/crynta/terax-ai/releases/latest/download/latest.json`

Updates are signed with a minisign key. The public key is embedded in `tauri.conf.json`. The updater verifies the signature before applying an update.
