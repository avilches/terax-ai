# Remove AI Subsystem Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the entire AI chat/agent subsystem from Terax, leaving a clean terminal emulator with file explorer, code editor, and git tooling, while keeping the passive agent notification bell.

**Architecture:** Progressive layer removal — each task leaves the project compiling and tests passing. Start from UI entry points and work inward to Rust. The passive OSC-based agent detection (`pty/agent_detect.rs`) and notification bell (`modules/agents/`) are preserved throughout.

**Tech Stack:** React 19, TypeScript, Tauri 2, Rust — `pnpm check-types` and `cargo clippy` are the primary validation tools at each step.

---

## Task 0: Move native.ts to shared location

`src/modules/ai/lib/native.ts` contains typed wrappers for ALL Tauri `invoke()` calls. It is imported by git-history, source-control, editor, and app hooks — modules with no AI relationship. Moving it unblocks all later deletions.

**Files:**
- Create: `src/lib/native.ts` (copy of `src/modules/ai/lib/native.ts`)
- Modify: `src/app/components/useGitBranch.ts`
- Modify: `src/app/hooks/useWorkspaceSwitcher.ts`
- Modify: `src/modules/git-history/GitHistoryPane.tsx`
- Modify: `src/modules/git-history/lib/graph.ts`
- Modify: `src/modules/source-control/useSourceControl.ts`
- Modify: `src/modules/source-control/useSourceControlContext.ts`
- Modify: `src/modules/source-control/useSourceControlPanel.ts`
- Modify: `src/modules/editor/lib/diffCache.ts`

- [ ] **Step 1: Copy native.ts to shared location**

```bash
cp src/modules/ai/lib/native.ts src/lib/native.ts
```

- [ ] **Step 2: Update imports in all consumer files**

In each file below, replace `from "@/modules/ai/lib/native"` with `from "@/lib/native"`:

```bash
# Run all replacements at once:
files=(
  "src/app/components/useGitBranch.ts"
  "src/app/hooks/useWorkspaceSwitcher.ts"
  "src/modules/git-history/GitHistoryPane.tsx"
  "src/modules/git-history/lib/graph.ts"
  "src/modules/source-control/useSourceControl.ts"
  "src/modules/source-control/useSourceControlContext.ts"
  "src/modules/source-control/useSourceControlPanel.ts"
  "src/modules/editor/lib/diffCache.ts"
)
for f in "${files[@]}"; do
  sed -i '' 's|from "@/modules/ai/lib/native"|from "@/lib/native"|g' "$f"
done
```

- [ ] **Step 3: Verify no remaining imports of the old path outside src/modules/ai/**

```bash
grep -r 'from "@/modules/ai/lib/native"' src/ --include="*.ts" --include="*.tsx" \
  | grep -v "src/modules/ai/"
```

Expected: no output.

- [ ] **Step 4: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/native.ts src/app/components/useGitBranch.ts \
  src/app/hooks/useWorkspaceSwitcher.ts \
  src/modules/git-history/GitHistoryPane.tsx \
  src/modules/git-history/lib/graph.ts \
  src/modules/source-control/useSourceControl.ts \
  src/modules/source-control/useSourceControlContext.ts \
  src/modules/source-control/useSourceControlPanel.ts \
  src/modules/editor/lib/diffCache.ts
git commit -m "refactor: move native.ts to src/lib/native.ts"
```

---

## Task 1: Rewrite WorkspaceInputBar (Layer 1)

`WorkspaceInputBar` wraps both `ShellInput` (block mode — keep) and `AiComposerInput` (AI — remove). After this task the bottom bar only renders the shell input for block-mode terminal tabs.

**Files:**
- Modify: `src/app/components/WorkspaceInputBar.tsx`

- [ ] **Step 1: Replace the entire file with the stripped version**

```tsx
import { cn } from "@/lib/utils";
import { useBlockController } from "@/modules/terminal/lib/blockController";
import { useTheme } from "@/modules/theme";
import { lazy, Suspense } from "react";

const ShellInput = lazy(() => import("@/modules/terminal/block/ShellInput"));

type Props = {
  isBlockTab: boolean;
  activeLeafId: number | null;
};

export function WorkspaceInputBar({ isBlockTab, activeLeafId }: Props) {
  const { resolvedMode, themeId, customThemes } = useTheme();
  const themeKey = `${resolvedMode}:${themeId}:${customThemes.length}`;
  const controller = useBlockController(isBlockTab ? activeLeafId : null);
  const blockMode = controller?.blockMode ?? "prompt";

  if (!isBlockTab || !controller || activeLeafId === null) return null;

  return (
    <div className="shrink-0 border-t border-border/60 bg-card/40 px-3 py-2">
      <Suspense fallback={null}>
        <ShellInput
          leafId={activeLeafId}
          mode={blockMode}
          focused
          themeKey={themeKey}
          onSubmit={controller.submitCommand}
          onInterrupt={controller.interrupt}
          getCwd={controller.getCwd}
        />
      </Suspense>
    </div>
  );
}
```

- [ ] **Step 2: Fix call sites — find where WorkspaceInputBar is used and remove the now-removed props**

```bash
grep -rn "WorkspaceInputBar" src/ --include="*.tsx" --include="*.ts"
```

Remove the following props from the call site (they no longer exist): `hasComposer`, `panelOpen`, `keysLoaded`, `cwd`, `home`, `isTerminalTab`, `onConnect`.

If removing these props leaves variables declared but unused in App.tsx (e.g., `const { hasComposer } = useAiBootstrap()`), TypeScript will error with `noUnusedLocals`. In that case, change the destructuring to only keep variables still used by other consumers — or suppress with a `// @ts-ignore` comment as a temporary measure until Task 7 removes the whole `useAiBootstrap()` call.

- [ ] **Step 3: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/app/components/WorkspaceInputBar.tsx
git commit -m "refactor: strip AI composer from WorkspaceInputBar"
```

---

## Task 2: Strip AI controls from StatusBar (Layer 1)

`StatusBar` renders `AgentStatusPill`, `AiStatusBarControls`, and `AiOpenButton` — all AI-only. The right side of the status bar becomes empty after this task (the notification bell is in the header, not here).

**Files:**
- Modify: `src/modules/statusbar/StatusBar.tsx`

- [ ] **Step 1: Replace StatusBar with the stripped version**

Remove: `useChatStore` usage, `AgentStatusPill`, `AiStatusBarControls`, `AiOpenButton`, `onOpenMini` prop, `hasComposer` prop.

```tsx
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { IncognitoIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { CwdBreadcrumb } from "./CwdBreadcrumb";
import { WorkspaceEnvSelector } from "./WorkspaceEnvSelector";
import type { WorkspaceEnv } from "@/modules/workspace";

type Props = {
  cwd: string | null;
  filePath?: string | null;
  home: string | null;
  onCd: (path: string) => void;
  onWorkspaceChange: (env: WorkspaceEnv) => void;
  privateActive: boolean;
};

export function StatusBar({
  cwd,
  filePath,
  home,
  onCd,
  onWorkspaceChange,
  privateActive,
}: Props) {
  return (
    <footer className="flex h-8 shrink-0 items-center justify-between gap-3 border-t border-border/60 bg-card/60 px-3 text-[11px]">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <WorkspaceEnvSelector onSelect={onWorkspaceChange} />
        <CwdBreadcrumb cwd={cwd} filePath={filePath} home={home} onCd={onCd} />
        {privateActive ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="flex shrink-0 cursor-default items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10.5px] font-medium text-amber-700 dark:text-amber-400">
                <HugeiconsIcon icon={IncognitoIcon} size={11} strokeWidth={2} />
                <span>Private</span>
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-64 text-[11px] leading-relaxed">
              This terminal is in private mode.
            </TooltipContent>
          </Tooltip>
        ) : null}
      </div>
    </footer>
  );
}
```

- [ ] **Step 2: Fix call sites — find where StatusBar is used and remove now-removed props**

```bash
grep -rn "StatusBar" src/ --include="*.tsx" --include="*.ts" | grep -v "node_modules"
```

Remove from the call site: `hasComposer`, `onOpenMini`.

- [ ] **Step 3: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/statusbar/StatusBar.tsx
git commit -m "refactor: remove AI controls from StatusBar"
```

---

## Task 3: Clean up settings window (Layer 2)

Remove the Models and Agents sections from the settings window and all their dependencies.

**Files:**
- Delete: `src/settings/sections/ModelsSection.tsx`
- Delete: `src/settings/sections/AgentsSection.tsx`
- Delete: `src/settings/components/ProviderKeyCard.tsx`
- Delete: `src/settings/components/ProviderIcon.tsx`
- Modify: `src/settings/SettingsApp.tsx`

- [ ] **Step 1: Delete AI settings files**

```bash
rm src/settings/sections/ModelsSection.tsx
rm src/settings/sections/AgentsSection.tsx
rm src/settings/components/ProviderKeyCard.tsx
rm src/settings/components/ProviderIcon.tsx
```

- [ ] **Step 2: Remove tabs from SettingsApp.tsx**

Open `src/settings/SettingsApp.tsx`. Remove:
- The `models` tab entry and its import of `ModelsSection`
- The `agents` tab entry and its import of `AgentsSection`

The remaining tabs are: `general`, `themes`, `shortcuts`, `about`.

- [ ] **Step 3: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add -A src/settings/
git commit -m "refactor: remove AI and Agents sections from settings window"
```

---

## Task 4: Strip AI fields from preferences store

`src/modules/settings/store.ts` imports types from `@/modules/ai/config` and stores AI-related preferences (model selection, autocomplete config, custom endpoints). These all go.

**Files:**
- Modify: `src/modules/settings/store.ts`

- [ ] **Step 1: Remove the AI config import (lines 1–13)**

Delete the entire import block at the top of the file:
```ts
import {
  DEFAULT_AUTOCOMPLETE_MODEL,
  DEFAULT_MODEL_ID,
  isKnownModelId,
  LMSTUDIO_DEFAULT_BASE_URL,
  MLX_DEFAULT_BASE_URL,
  OLLAMA_DEFAULT_BASE_URL,
  migrateLegacyCompatEndpoint,
  OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
  type AutocompleteProviderId,
  type CustomEndpoint,
  type ModelId,
} from "@/modules/ai/config";
```

- [ ] **Step 2: Remove AI fields from the `Preferences` type**

Remove these fields from the `Preferences` type:
```ts
defaultModelId: ModelId;
customInstructions: string;
autocompleteEnabled: boolean;
autocompleteProvider: AutocompleteProviderId;
autocompleteModelId: string;
lmstudioBaseURL: string;
lmstudioModelId: string;
mlxBaseURL: string;
mlxModelId: string;
ollamaBaseURL: string;
ollamaModelId: string;
openaiCompatibleBaseURL: string;
openaiCompatibleModelId: string;
openaiCompatibleContextLimit: number;
customEndpoints: CustomEndpoint[];
openrouterModelId: string;
favoriteModelIds: string[];
recentModelIds: string[];
```

- [ ] **Step 3: Remove corresponding KEY_ constants**

Remove these constant declarations:
```ts
const KEY_DEFAULT_MODEL = "defaultModelId";
const KEY_CUSTOM_INSTRUCTIONS = "customInstructions";
const KEY_AUTOCOMPLETE_ENABLED = "autocompleteEnabled";
const KEY_AUTOCOMPLETE_PROVIDER = "autocompleteProvider";
const KEY_AUTOCOMPLETE_MODEL = "autocompleteModelId";
const KEY_LMSTUDIO_BASE_URL = "lmstudioBaseURL";
const KEY_LMSTUDIO_MODEL_ID = "lmstudioModelId";
const KEY_MLX_BASE_URL = "mlxBaseURL";
const KEY_MLX_MODEL_ID = "mlxModelId";
const KEY_OLLAMA_BASE_URL = "ollamaBaseURL";
const KEY_OLLAMA_MODEL_ID = "ollamaModelId";
const KEY_OPENAI_COMPAT_BASE_URL = "openaiCompatibleBaseURL";
const KEY_OPENAI_COMPAT_MODEL_ID = "openaiCompatibleModelId";
const KEY_OPENAI_COMPAT_CONTEXT_LIMIT = "openaiCompatibleContextLimit";
const KEY_CUSTOM_ENDPOINTS = "customEndpoints";
const KEY_OPENROUTER_MODEL_ID = "openrouterModelId";
const KEY_FAVORITE_MODELS = "favoriteModelIds";
const KEY_RECENT_MODELS = "recentModelIds";
```

- [ ] **Step 4: Remove corresponding entries from DEFAULT_PREFERENCES**

Remove these entries from the `DEFAULT_PREFERENCES` object:
```ts
defaultModelId: DEFAULT_MODEL_ID,
customInstructions: "",
autocompleteEnabled: false,
autocompleteProvider: "cerebras",
autocompleteModelId: DEFAULT_AUTOCOMPLETE_MODEL.cerebras ?? "",
lmstudioBaseURL: LMSTUDIO_DEFAULT_BASE_URL,
lmstudioModelId: "",
mlxBaseURL: MLX_DEFAULT_BASE_URL,
mlxModelId: "",
ollamaBaseURL: OLLAMA_DEFAULT_BASE_URL,
ollamaModelId: "",
openaiCompatibleBaseURL: OPENAI_COMPATIBLE_DEFAULT_BASE_URL,
openaiCompatibleModelId: "",
openaiCompatibleContextLimit: 128_000,
customEndpoints: [],
openrouterModelId: "",
favoriteModelIds: [],
recentModelIds: [],
```

- [ ] **Step 5: Remove the store read/write logic for the removed keys**

Search for and delete every reference to the removed KEY_ constants in the store load/save functions (grep for `KEY_DEFAULT_MODEL`, `KEY_AUTOCOMPLETE_ENABLED`, etc. and remove the corresponding `store.get` / `store.set` calls).

- [ ] **Step 6: Type-check**

```bash
pnpm check-types
```

Expected: zero errors. If `usePreferencesStore` consumers break because they reference removed fields, fix them too.

- [ ] **Step 7: Commit**

```bash
git add src/modules/settings/store.ts
git commit -m "refactor: remove AI preference fields from settings store"
```

---

## Task 5: Clean up AgentNotificationsBridge and delete review.ts

`review.ts` is entirely for the managed-agent review loop (AI orchestrating Claude Code). `AgentNotificationsBridge` calls it on agent `finished` events. Both dependencies on the AI module need to go.

**Files:**
- Delete: `src/modules/agents/lib/review.ts`
- Delete: `src/modules/agents/store/managedAgentsStore.ts`
- Modify: `src/modules/agents/components/AgentNotificationsBridge.tsx`

- [ ] **Step 1: Rewrite AgentNotificationsBridge to remove managed-agent logic**

Replace the `handleSignal` function — remove the `maybeTriggerManagedReview` call and `useManagedAgentsStore.getState().remove()` call:

```ts
function handleSignal(sig: AgentSignal, ctx: Ctx): void {
  const leafId = leafIdForPty(sig.id);
  if (leafId === null) return;
  const store = useAgentStore.getState();

  switch (sig.kind) {
    case "started": {
      const info = tabInfo(ctx.tabs, leafId);
      if (!info) return;
      store.start(leafId, info.tabId, sig.agent ?? "agent");
      return;
    }
    case "working":
      store.setStatus(leafId, "working");
      return;
    case "attention": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "attention", ctx);
      return;
    }
    case "finished": {
      store.setStatus(leafId, "waiting");
      const session = store.sessions[leafId];
      if (session) route(session, "finished", ctx);
      return;
    }
    case "exited":
      store.finish(leafId);
      return;
  }
}
```

Also remove from the imports at the top of the file:
```ts
import { maybeTriggerManagedReview } from "../lib/review";       // remove
import { useManagedAgentsStore } from "../store/managedAgentsStore"; // remove
```

- [ ] **Step 2: Delete review.ts and managedAgentsStore.ts**

```bash
rm src/modules/agents/lib/review.ts
rm src/modules/agents/store/managedAgentsStore.ts
```

- [ ] **Step 3: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add src/modules/agents/components/AgentNotificationsBridge.tsx
git add src/modules/agents/lib/review.ts src/modules/agents/store/managedAgentsStore.ts
git commit -m "refactor: remove managed-agent logic from AgentNotificationsBridge"
```

---

## Task 6: Clean up remaining AI consumers

Several files outside `src/modules/ai/` import from it. Fix each one so the directory can be safely deleted.

**Files:**
- Modify: `src/modules/statusbar/StatusBar.tsx` (already done in Task 2, verify clean)
- Modify: `src/modules/terminal/block/BlockOverlay.tsx`
- Modify: `src/modules/source-control/useSourceControlPanel.ts`
- Delete: `src/components/ai-elements/` (entire directory)

- [ ] **Step 1: Find all remaining imports from @/modules/ai outside the module itself**

```bash
grep -rn 'from "@/modules/ai' src/ --include="*.ts" --include="*.tsx" \
  | grep -v "src/modules/ai/"
```

For each result, open the file and remove the import and any code that uses it.

- [ ] **Step 2: Fix BlockOverlay.tsx**

Open `src/modules/terminal/block/BlockOverlay.tsx`. Remove the `useChatStore` import and any JSX/logic that calls it (typically "Ask AI" button or context). Remove only the AI-specific code; preserve all block-mode terminal functionality.

- [ ] **Step 3: Fix useSourceControlPanel.ts**

Open `src/modules/source-control/useSourceControlPanel.ts`. Remove:
- `import { providerNeedsKey, resolveModel } from "@/modules/ai/config";`
- `import { useChatStore } from "@/modules/ai/store/chatStore";`

Remove any code that uses these (typically AI commit message generation). Keep all git stage/commit/push functionality.

- [ ] **Step 4: Delete src/components/ai-elements/**

```bash
rm -rf src/components/ai-elements/
```

- [ ] **Step 5: Verify no remaining imports**

```bash
grep -rn 'from "@/modules/ai' src/ --include="*.ts" --include="*.tsx" \
  | grep -v "src/modules/ai/"
grep -rn 'from "@/components/ai-elements' src/ --include="*.ts" --include="*.tsx"
```

Both must return no output.

- [ ] **Step 6: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove all imports from ai module in consumer files"
```

---

## Task 7: Clean up App.tsx (Layer 4)

**Important:** This task must happen BEFORE Task 8 (delete ai/). App.tsx still imports from `@/modules/ai/` and removing those imports requires the module to exist so TypeScript validates the changes one step at a time.

**Files:**
- Modify: `src/app/App.tsx`

With the AI module gone, remove the wiring in `App.tsx`: `AiComposerProvider`, `AgentRunBridge`, `LocalAgentNotificationsBridge`, `AiMiniWindow`, `SelectionAskAi`, `useAiLiveBridge`, `useAiBootstrap`, `hydrateSessions`, and all AI-related state/callbacks.

**Files:**
- Modify: `src/app/App.tsx`

- [ ] **Step 1: Remove AI imports from App.tsx**

Delete these import lines (found around lines 13–24):
```ts
import { AgentRunBridge, AiMiniWindow, LocalAgentNotificationsBridge,
         SelectionAskAi, useAiBootstrap, useAiLiveBridge,
         useChatStore, useSelectionAskAi } from "@/modules/ai";
import { AiComposerProvider } from "@/modules/ai/lib/composer";
import { native } from "@/modules/ai/lib/native";  // now at @/lib/native if still needed
```

If `native` from `@/lib/native` is still needed in App.tsx, update that import. If not, remove it.

- [ ] **Step 2: Remove AI state declarations**

Remove these lines (around 193–202):
```ts
const miniOpen = useChatStore((s) => s.mini.open);
const miniPresence = usePresence(miniOpen, 200);
const openMini = useChatStore((s) => s.openMini);
const focusInput = useChatStore((s) => s.focusInput);
const openPanel = useChatStore((s) => s.openPanel);
const panelOpen = useChatStore((s) => s.panelOpen);
const setLive = useChatStore((s) => s.setLive);
const respondToApproval = useChatStore((s) => s.respondToApproval);
const { hasComposer, keysLoaded } = useAiBootstrap();
```

- [ ] **Step 3: Remove AI callbacks and shortcuts**

Remove `togglePanelAndFocus`, `askFromSelection`, and any function that references the removed state. Remove from the shortcuts map: `"ai.toggle"`, `"ai.askSelection"`. Remove from the command palette: `toggleAi`, `askAiSelection`.

- [ ] **Step 4: Remove useAiLiveBridge call**

Delete the `useAiLiveBridge({ ... })` call block.

- [ ] **Step 5: Remove conditional AI component mounts**

Remove these from the JSX:
```tsx
{hasComposer && <AgentRunBridge ... />}
{hasComposer && <LocalAgentNotificationsBridge />}
{hasComposer && miniPresence.mounted && <AiMiniWindow ... />}
{askPresence.mounted && <SelectionAskAi ... />}
```

- [ ] **Step 6: Remove AiComposerProvider wrapper**

Replace:
```tsx
<AiComposerProvider>{shell}</AiComposerProvider>
```
with just:
```tsx
{shell}
```

- [ ] **Step 7: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/App.tsx
git commit -m "refactor: remove AI wiring from App.tsx"
```

---

## Task 8: Delete src/modules/ai/ (Layer 3)

All consumers are clean and App.tsx no longer imports from the module. Delete the directory.

**Files:**
- Delete: `src/modules/ai/` (entire directory, ~57 files)

- [ ] **Step 1: Delete the directory**

```bash
rm -rf src/modules/ai/
```

- [ ] **Step 2: Type-check**

```bash
pnpm check-types
```

Expected: zero errors. If any consumer was missed, the error message will point to the exact file and line.

- [ ] **Step 3: Run tests**

```bash
pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: delete src/modules/ai/"
```

---

## Task 9: Remove editor AI autocomplete (Layer 5)

The editor has an inline AI autocomplete extension (ghost text). Remove it without touching any other editor functionality.

**Files:**
- Delete: `src/modules/editor/lib/autocomplete/` (entire directory)
- Modify: `src/modules/editor/EditorPane.tsx`

- [ ] **Step 1: Delete the autocomplete directory**

```bash
rm -rf src/modules/editor/lib/autocomplete/
```

- [ ] **Step 2: Remove autocomplete wiring from EditorPane.tsx**

Open `src/modules/editor/EditorPane.tsx`. Remove:
- `import { getKey } from "@/modules/ai/lib/keyring";` (now `@/lib/native` if needed, but likely unused)
- `import { inlineCompletion } from "./lib/autocomplete/inlineExtension";`
- Any `getKey(...)` call and the `useEffect` or logic block that initializes autocomplete
- The `inlineCompletion(...)` extension from the CodeMirror extensions array

- [ ] **Step 3: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 4: Commit**

```bash
git add -A src/modules/editor/
git commit -m "refactor: remove AI inline autocomplete from editor"
```

---

## Task 10: Remove npm dependencies (Layer 6)

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Remove AI SDK packages**

```bash
pnpm remove ai @ai-sdk/anthropic @ai-sdk/cerebras @ai-sdk/google \
  @ai-sdk/groq @ai-sdk/openai @ai-sdk/openai-compatible \
  @ai-sdk/react @ai-sdk/xai streamdown
```

- [ ] **Step 2: Verify no orphaned imports**

```bash
pnpm check-types
```

Expected: zero errors. If any import still references a removed package, fix it.

- [ ] **Step 3: Run full frontend checks**

```bash
pnpm lint && pnpm check-types && pnpm test
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore: remove AI SDK npm dependencies"
```

---

## Task 11: Remove Rust modules (Layer 7)

Delete the `net` (HTTP proxy) and `secrets` (keychain) Rust modules. Keep `agent` (Claude hooks installer — the notification bell depends on hooks being installed).

**Files:**
- Delete: `src-tauri/src/modules/net.rs`
- Delete: `src-tauri/src/modules/secrets.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/modules/mod.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Delete the Rust modules**

```bash
rm src-tauri/src/modules/net.rs
rm src-tauri/src/modules/secrets.rs
```

- [ ] **Step 2: Update src-tauri/src/lib.rs**

**Line 3** — remove `net` and `secrets` from the use statement:
```rust
// Before:
use modules::{agent, fs, git, history, net, pty, secrets, shell, workspace};
// After:
use modules::{agent, fs, git, history, pty, shell, workspace};
```

**Line ~160** — remove the secrets state management:
```rust
// Remove this line:
.manage(secrets::SecretsState::default())
```

**Lines ~232–238** — remove the net and secrets handlers from `tauri::generate_handler![]`:
```rust
// Remove these lines:
secrets::secrets_get,
secrets::secrets_set,
secrets::secrets_delete,
secrets::secrets_get_all,
net::lm_ping,
net::ai_http_request,
net::ai_http_stream,
```

Keep: `agent::agent_enable_claude_hooks` and `agent::agent_claude_hooks_status`.

- [ ] **Step 3: Update src-tauri/src/modules/mod.rs**

Remove the `pub mod net;` and `pub mod secrets;` declarations.

- [ ] **Step 4: Remove Cargo.toml dependencies**

Open `src-tauri/Cargo.toml` and remove:
```toml
reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "stream"] }
bytes = "1"
futures-util = "0.3"
```

Also remove the platform-specific `keyring` blocks:
```toml
[target.'cfg(target_os = "macos")'.dependencies]
keyring = { ... }

[target.'cfg(target_os = "windows")'.dependencies]
keyring = { ... }
```

Note: `tokio` is used by other async Rust code — keep it.

- [ ] **Step 5: Verify Rust compiles cleanly**

```bash
cd src-tauri && cargo clippy --all-targets --locked -D warnings
```

Expected: zero warnings (treated as errors).

- [ ] **Step 6: Run Rust tests**

```bash
cd src-tauri && cargo test --locked
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/modules/net.rs src-tauri/src/modules/secrets.rs \
  src-tauri/src/lib.rs src-tauri/src/modules/mod.rs src-tauri/Cargo.toml \
  src-tauri/Cargo.lock
git commit -m "chore: remove net and secrets Rust modules"
```

---

## Task 12: Final cleanup of src/lib/native.ts

With `secrets.rs` and `net.rs` gone, the corresponding TypeScript functions in `src/lib/native.ts` call Tauri commands that no longer exist. They are dead code (nothing calls them after AI removal), but remove them to avoid confusion.

**Files:**
- Modify: `src/lib/native.ts`

- [ ] **Step 1: Remove AI/net/secrets functions from native.ts**

Open `src/lib/native.ts` and delete these function groups:
- `secretsGet`, `secretsSet`, `secretsDelete`, `secretsGetAll` (secrets commands)
- `aiHttpRequest`, `aiHttpStream`, `lmPing` (net commands)
- `shellSessionOpen`, `shellSessionRun`, `shellSessionClose` (shell session — used by AI agent only)
- `shellBgSpawn`, `shellBgLogs`, `shellBgKill`, `shellBgList` (background shell — used by AI agent only)

Keep all fs, git, workspace, pty, history functions — they are still used by non-AI modules.

- [ ] **Step 2: Type-check**

```bash
pnpm check-types
```

Expected: zero errors.

- [ ] **Step 3: Final full validation**

```bash
pnpm lint && pnpm check-types && pnpm test
cd src-tauri && cargo clippy --all-targets --locked -D warnings && cargo test --locked
```

Expected: everything passes.

- [ ] **Step 4: Commit**

```bash
git add src/lib/native.ts
git commit -m "chore: remove dead AI/secrets/net functions from native.ts"
```

---

## Completion checklist

- [ ] `pnpm lint` passes
- [ ] `pnpm check-types` passes
- [ ] `pnpm test` passes
- [ ] `cargo clippy --all-targets --locked -D warnings` passes
- [ ] `cargo test --locked` passes
- [ ] Terminal tab opens and PTY works
- [ ] File explorer follows active terminal cwd
- [ ] Editor opens and saves files
- [ ] Source control panel shows git status and diff
- [ ] Git history pane renders commit graph
- [ ] Settings window opens (General, Themes, Shortcuts, About — no AI/Agents tabs)
- [ ] NotificationBell renders in header
- [ ] Running `claude` in a terminal tab triggers notification bell state transitions
