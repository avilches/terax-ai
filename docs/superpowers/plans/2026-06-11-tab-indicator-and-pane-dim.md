# Tab Focus Indicator + Inactive Pane Dim — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a blue indicator bar to the active tab of a focused pane (terax-default), and add a per-theme, per-panel-kind dim overlay to non-focused panes.

**Architecture:** A new `--tab-focus-indicator` CSS variable is wired through the existing `applyTheme` pipeline; terax-default sets it to blue. A new `inactivePaneDim: Record<string, number>` field on `Theme` drives a `pointer-events-none` overlay rendered in `PaneView` for non-focused panes. The resolved theme object is exposed via `useTheme()` so components can read `inactivePaneDim` at runtime.

**Tech Stack:** TypeScript, React 19, Tailwind v4, CSS custom properties, Tauri.

---

## Files changed

| File | Change |
|---|---|
| `src/modules/theme/types.ts` | Add `tabFocusIndicator` to `ThemeColors`; add `inactivePaneDim` to `Theme` |
| `src/modules/theme/applyTheme.ts` | Add `tabFocusIndicator` entry to `COLOR_VAR` |
| `src/styles/globals.css` | Add `--tab-focus-indicator: var(--primary)` fallback |
| `src/modules/theme/ThemeProvider.tsx` | Remove `DEFAULT_THEME_ID` short-circuit; expose `resolvedTheme` |
| `src/modules/theme/themes/terax-default.ts` | Set blue indicator + `inactivePaneDim` |
| `src/modules/theme/themes/caffeine.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/catppuccin.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/claude.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/gruvbox.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/nord.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/rose-pine.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/sage.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/tide.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/tokyo-night.ts` | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/validateTheme.ts` | Parse `inactivePaneDim` from user theme JSON |
| `src/modules/workspaces/PaneTabBar.tsx` | Use `var(--tab-focus-indicator)` on the indicator div |
| `src/modules/workspaces/PaneView.tsx` | Render dim overlay when `!focused` |

---

### Task 1: Add types

**Files:**
- Modify: `src/modules/theme/types.ts`

- [ ] **Step 1: Add `tabFocusIndicator` to `ThemeColors` and `inactivePaneDim` to `Theme`**

  Replace `src/modules/theme/types.ts` content (full rewrite — the file is short):

  ```typescript
  export type ThemeMode = "light" | "dark";

  export type ThemeColors = Partial<{
    background: string;
    foreground: string;
    card: string;
    cardForeground: string;
    popover: string;
    popoverForeground: string;
    primary: string;
    primaryForeground: string;
    secondary: string;
    secondaryForeground: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    accentForeground: string;
    destructive: string;
    border: string;
    input: string;
    ring: string;
    sidebar: string;
    sidebarForeground: string;
    sidebarPrimary: string;
    sidebarPrimaryForeground: string;
    sidebarAccent: string;
    sidebarAccentForeground: string;
    sidebarBorder: string;
    sidebarRing: string;
    radius: string;
    tabFocusIndicator: string;
  }>;

  export type TerminalPalette = Partial<{
    background: string;
    foreground: string;
    cursor: string;
    cursorAccent: string;
    selection: string;
    ansi: readonly [
      string, string, string, string, string, string, string, string,
      string, string, string, string, string, string, string, string,
    ];
  }>;

  export type ThemeVariant = {
    colors?: ThemeColors;
    terminal?: TerminalPalette;
  };

  export type Theme = {
    id: string;
    name: string;
    author?: string;
    description?: string;
    variants: {
      light?: ThemeVariant;
      dark?: ThemeVariant;
    };
    editorTheme?: {
      light?: string;
      dark?: string;
    };
    inactivePaneDim?: Record<string, number>;
  };

  export const DEFAULT_THEME_ID = "terax-default";
  ```

- [ ] **Step 2: Verify TypeScript still compiles**

  ```bash
  cd /path/to/terax-ai && pnpm check-types 2>&1 | head -30
  ```
  Expected: errors only if a downstream file references the old types (fixed in later tasks). If there are compile errors in `applyTheme.ts` about `COLOR_VAR` missing `tabFocusIndicator`, that is expected — fixed in Task 2.

- [ ] **Step 3: Commit**

  ```bash
  git add src/modules/theme/types.ts
  git commit -m "feat(theme): add tabFocusIndicator to ThemeColors and inactivePaneDim to Theme"
  ```

---

### Task 2: Wire `tabFocusIndicator` through applyTheme + globals.css

**Files:**
- Modify: `src/modules/theme/applyTheme.ts:3-31`
- Modify: `src/styles/globals.css`

- [ ] **Step 1: Add `tabFocusIndicator` to `COLOR_VAR` in `applyTheme.ts`**

  `COLOR_VAR` is typed as `Record<keyof ThemeColors, string>` — TypeScript will error until every key from `ThemeColors` has an entry. Add one line after `radius: "--radius"`:

  ```typescript
  const COLOR_VAR: Record<keyof ThemeColors, string> = {
    background: "--background",
    foreground: "--foreground",
    card: "--card",
    cardForeground: "--card-foreground",
    popover: "--popover",
    popoverForeground: "--popover-foreground",
    primary: "--primary",
    primaryForeground: "--primary-foreground",
    secondary: "--secondary",
    secondaryForeground: "--secondary-foreground",
    muted: "--muted",
    mutedForeground: "--muted-foreground",
    accent: "--accent",
    accentForeground: "--accent-foreground",
    destructive: "--destructive",
    border: "--border",
    input: "--input",
    ring: "--ring",
    sidebar: "--sidebar",
    sidebarForeground: "--sidebar-foreground",
    sidebarPrimary: "--sidebar-primary",
    sidebarPrimaryForeground: "--sidebar-primary-foreground",
    sidebarAccent: "--sidebar-accent",
    sidebarAccentForeground: "--sidebar-accent-foreground",
    sidebarBorder: "--sidebar-border",
    sidebarRing: "--sidebar-ring",
    radius: "--radius",
    tabFocusIndicator: "--tab-focus-indicator",
  };
  ```

  No other changes to `applyTheme.ts`. `ALL_VARS` already includes `...Object.values(COLOR_VAR)`, so `--tab-focus-indicator` is automatically cleaned up on theme switch.

- [ ] **Step 2: Add CSS fallback in `globals.css`**

  In `src/styles/globals.css`, inside the `:root` block (after the existing variables, before the closing `}`), add:

  ```css
  --tab-focus-indicator: var(--primary);
  ```

  And inside the `.dark` block (same position), add the same line:

  ```css
  --tab-focus-indicator: var(--primary);
  ```

  This fallback ensures all existing themes that do not define `tabFocusIndicator` continue to use their `--primary` color as the tab indicator.

- [ ] **Step 3: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```
  Expected: no errors in `applyTheme.ts` or `types.ts`.

- [ ] **Step 4: Commit**

  ```bash
  git add src/modules/theme/applyTheme.ts src/styles/globals.css
  git commit -m "feat(theme): wire --tab-focus-indicator CSS variable"
  ```

---

### Task 3: Remove DEFAULT_THEME_ID short-circuit + expose resolvedTheme

**Files:**
- Modify: `src/modules/theme/ThemeProvider.tsx:38-47,142-160,179-189`

**Context:** `ThemeProvider` currently short-circuits for terax-default (`clearTheme()` + early return), skipping `applyTheme`. Since terax-default now has a color to apply (`tabFocusIndicator`), remove the short-circuit. The behavior is equivalent: `applyTheme` starts by clearing all vars (same as `clearTheme`), then writes only the defined colors.

Also add `resolvedTheme: Theme` to the context so `PaneView` can read `inactivePaneDim` at runtime.

- [ ] **Step 1: Update `ThemeProviderState` type — add `resolvedTheme`**

  Find the `ThemeProviderState` type block (lines ~38–47):

  ```typescript
  type ThemeProviderState = {
    mode: ThemePref;
    resolvedMode: "dark" | "light";
    themeId: string;
    customThemes: Theme[];
    resolvedTheme: Theme;
    setMode: (mode: ThemePref) => void;
    setThemeId: (id: string) => void;
    /** Apply a theme transiently without persisting; null reverts to committed. */
    previewThemeId: (id: string | null) => void;
  };
  ```

- [ ] **Step 2: Remove the DEFAULT_THEME_ID early-return block**

  The current block at lines ~142–147:
  ```typescript
  if (effectiveId === DEFAULT_THEME_ID) {
    clearTheme();
    if (!previewId) lastEditorPairRef.current = null;
    return;
  }
  ```
  Delete it entirely. The `useEffect` body becomes:
  ```typescript
  useEffect(() => {
    const theme = resolveTheme(effectiveId, customThemes);
    applyTheme(theme, resolvedMode);
    if (previewId) return;
    const editorPair = theme.editorTheme?.[resolvedMode];
    if (
      editorPair &&
      lastEditorPairRef.current !== editorPair &&
      (EDITOR_THEMES as readonly string[]).includes(editorPair)
    ) {
      lastEditorPairRef.current = editorPair;
      void persistEditorTheme(editorPair as EditorThemeId);
    }
  }, [effectiveId, previewId, resolvedMode, customThemes]);
  ```

  The `clearTheme` import becomes unused — remove it from the import at the top of the file:
  ```typescript
  import { applyTheme } from "./applyTheme";
  ```

- [ ] **Step 3: Add `resolvedTheme` to the `useMemo` value block**

  Find the `useMemo` block (~line 179). Add `resolvedTheme` and `previewId` to the dependency array:

  ```typescript
  const value = useMemo<ThemeProviderState>(
    () => ({
      mode,
      resolvedMode,
      themeId,
      customThemes,
      resolvedTheme: resolveTheme(previewId ?? themeId, customThemes),
      setMode,
      setThemeId,
      previewThemeId,
    }),
    [mode, resolvedMode, themeId, previewId, customThemes, setMode, setThemeId, previewThemeId],
  );
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```
  Expected: no errors.

- [ ] **Step 5: Commit**

  ```bash
  git add src/modules/theme/ThemeProvider.tsx
  git commit -m "feat(theme): expose resolvedTheme from useTheme, remove terax-default short-circuit"
  ```

---

### Task 4: Update terax-default theme

**Files:**
- Modify: `src/modules/theme/themes/terax-default.ts`

- [ ] **Step 1: Add blue indicator + inactivePaneDim**

  Replace the file entirely:

  ```typescript
  import type { Theme } from "../types";

  export const teraxDefault: Theme = {
    id: "terax-default",
    name: "Terax Default",
    description: "The default Terax look — clean glass over neutral surfaces.",
    editorTheme: { dark: "atomone", light: "atomone" },
    inactivePaneDim: { terminal: 0.12 },
    variants: {
      light: { colors: { tabFocusIndicator: "oklch(0.578 0.199 264.4)" } },
      dark:  { colors: { tabFocusIndicator: "oklch(0.578 0.199 264.4)" } },
    },
  };
  ```

  `oklch(0.578 0.199 264.4)` is the OKLCH equivalent of `#3b82f6` (Tailwind blue-500). The same value works for both dark and light modes.

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/modules/theme/themes/terax-default.ts
  git commit -m "feat(theme): terax-default blue tab indicator and terminal pane dim"
  ```

---

### Task 5: Add `inactivePaneDim` to the 9 other built-in themes

**Files:**
- Modify: `src/modules/theme/themes/caffeine.ts`, `catppuccin.ts`, `claude.ts`, `gruvbox.ts`, `nord.ts`, `rose-pine.ts`, `sage.ts`, `tide.ts`, `tokyo-night.ts`

- [ ] **Step 1: Add `inactivePaneDim: { terminal: 0.12 }` to each theme**

  Each file exports a `const` with type `Theme`. Add the field just before the closing `};` of each theme object. Example for `nord.ts` — the top-level object gains one line:

  ```typescript
  export const nord: Theme = {
    id: "nord",
    // ... existing fields unchanged ...
    inactivePaneDim: { terminal: 0.12 },
    variants: { ... },
  };
  ```

  Repeat for all 9 files. The only change in each file is one new line `inactivePaneDim: { terminal: 0.12 },` added to the top-level theme object (not inside `variants`).

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/modules/theme/themes/caffeine.ts \
          src/modules/theme/themes/catppuccin.ts \
          src/modules/theme/themes/claude.ts \
          src/modules/theme/themes/gruvbox.ts \
          src/modules/theme/themes/nord.ts \
          src/modules/theme/themes/rose-pine.ts \
          src/modules/theme/themes/sage.ts \
          src/modules/theme/themes/tide.ts \
          src/modules/theme/themes/tokyo-night.ts
  git commit -m "feat(theme): add inactivePaneDim terminal 0.12 to all built-in themes"
  ```

---

### Task 6: Parse `inactivePaneDim` in `validateTheme`

**Files:**
- Modify: `src/modules/theme/validateTheme.ts:117-131`

This file validates user-supplied JSON themes. Without updating it, user themes that include `inactivePaneDim` will have the field silently stripped.

- [ ] **Step 1: Add parsing after the `editorTheme` block**

  Find the block that ends `validateTheme` (currently ends at `return { ok: true, theme };`). Just before that return, add:

  ```typescript
  if (isObj(raw.inactivePaneDim)) {
    const dim: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.inactivePaneDim as Record<string, unknown>)) {
      if (typeof v === "number" && v >= 0 && v <= 1) dim[k] = v;
    }
    if (Object.keys(dim).length > 0) theme.inactivePaneDim = dim;
  }
  return { ok: true, theme };
  ```

  The full tail of `validateTheme` after this change:

  ```typescript
  if (isObj(raw.editorTheme)) {
    const et: Theme["editorTheme"] = {};
    if (isStr(raw.editorTheme.light)) et.light = raw.editorTheme.light;
    if (isStr(raw.editorTheme.dark)) et.dark = raw.editorTheme.dark;
    if (et.light || et.dark) theme.editorTheme = et;
  }
  if (isObj(raw.inactivePaneDim)) {
    const dim: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.inactivePaneDim as Record<string, unknown>)) {
      if (typeof v === "number" && v >= 0 && v <= 1) dim[k] = v;
    }
    if (Object.keys(dim).length > 0) theme.inactivePaneDim = dim;
  }
  return { ok: true, theme };
  ```

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/modules/theme/validateTheme.ts
  git commit -m "feat(theme): parse inactivePaneDim in validateTheme for user themes"
  ```

---

### Task 7: Use `--tab-focus-indicator` in PaneTabBar

**Files:**
- Modify: `src/modules/workspaces/PaneTabBar.tsx:64-66`

- [ ] **Step 1: Replace `bg-primary` with the CSS variable**

  Find the indicator div at line ~65:

  ```tsx
  {active && paneFocused && (
    <div className={cn("absolute inset-x-0 top-0 bg-primary", connected ? "h-[1.5px]" : "h-0.5 rounded-t")} />
  )}
  ```

  Replace with:

  ```tsx
  {active && paneFocused && (
    <div
      className={cn("absolute inset-x-0 top-0", connected ? "h-[1.5px]" : "h-0.5 rounded-t")}
      style={{ background: "var(--tab-focus-indicator)" }}
    />
  )}
  ```

  `bg-primary` is removed from `className`; background is now driven by the CSS variable via inline style.

- [ ] **Step 2: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```

- [ ] **Step 3: Commit**

  ```bash
  git add src/modules/workspaces/PaneTabBar.tsx
  git commit -m "feat(workspaces): use --tab-focus-indicator CSS var for tab focus bar"
  ```

---

### Task 8: Render dim overlay in PaneView

**Files:**
- Modify: `src/modules/workspaces/PaneView.tsx`

- [ ] **Step 1: Import `useTheme`**

  Add to the imports at the top of `PaneView.tsx`:

  ```typescript
  import { useTheme } from "@/modules/theme";
  ```

- [ ] **Step 2: Read the dim opacity inside the component**

  Inside `PaneView` (after the existing hooks, before the `return`), add:

  ```typescript
  const { resolvedTheme } = useTheme();
  const activePanel = pane.panels.find((p) => p.id === pane.activePanelId);
  const dimOpacity = focused ? 0 : (resolvedTheme.inactivePaneDim?.[activePanel?.kind ?? ""] ?? 0);
  ```

- [ ] **Step 3: Add the overlay div inside the content area**

  In the JSX, inside the `<div className="relative min-h-0 flex-1">` (the content area that already contains the panel map and drop overlays), add the dim overlay just before the closing tag of that div. The dim must be above the panel content (z-10) but below the drag-drop overlay (z-40):

  ```tsx
  <div className="relative min-h-0 flex-1">
    {pane.panels.map((panel) => (
      /* ... unchanged ... */
    ))}
    {pane.panels.length === 0 && (
      /* ... unchanged ... */
    )}

    {dimOpacity > 0 && (
      <div
        className="pointer-events-none absolute inset-0 z-10 bg-black"
        style={{ opacity: dimOpacity }}
      />
    )}

    {/* drop overlay — only register/show for the active workspace */}
    {isDragging && isWorkspaceActive && (
      /* ... unchanged ... */
    )}
  </div>
  ```

- [ ] **Step 4: Verify TypeScript compiles**

  ```bash
  pnpm check-types 2>&1 | head -20
  ```

- [ ] **Step 5: Commit**

  ```bash
  git add src/modules/workspaces/PaneView.tsx
  git commit -m "feat(workspaces): dim overlay for non-focused panes from theme config"
  ```

---

### Task 9: Full verification

- [ ] **Step 1: Run lint**

  ```bash
  pnpm lint
  ```
  Expected: no errors.

- [ ] **Step 2: Run type check**

  ```bash
  pnpm check-types
  ```
  Expected: no errors.

- [ ] **Step 3: Run frontend tests**

  ```bash
  pnpm test
  ```
  Expected: all tests pass.

- [ ] **Step 4: Run Rust checks**

  ```bash
  cd src-tauri && cargo clippy && cargo test --locked
  ```
  Expected: no errors (Rust is not affected by these changes, but worth confirming).

- [ ] **Step 5: Manual smoke test**

  Launch the app (`pnpm tauri dev`) and verify:
  1. With terax-default theme and dark mode: active tab of focused pane shows a blue `#3b82f6` bar at the top.
  2. Split the window into two panes. The unfocused pane's terminal content appears slightly darker (12% dim). Click the other pane — the dim moves.
  3. Open an editor panel in a pane. Unfocus it — no dim (only terminal gets dim).
  4. Switch to Nord theme — the indicator uses Nord's `--primary` (muted blue), not the terax-default blue.
  5. Drag a tab between panes — no visual glitches with the dim overlay.
