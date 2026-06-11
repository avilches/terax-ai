# Tab Focus Indicator Color + Inactive Pane Dim

**Date:** 2026-06-11
**Status:** Approved

## Summary

Two visual improvements to Terax's multi-pane UX:

1. A blue indicator bar on the active tab of the focused pane (terax-default theme).
2. A subtle dark overlay on panes that do not have focus, configurable per theme and per panel kind.

## Feature 1: Tab focus indicator color

### Current state

`PaneTabBar.tsx` already renders a `bg-primary` franja (2px strip) at the top of the active tab when the pane is focused. In terax-default, `--primary` resolves to near-white in dark mode and near-black in light mode — effectively invisible as an accent color.

### Design

Add a dedicated CSS variable `--tab-focus-indicator` so the indicator color can be set independently of the global `--primary` token (which affects buttons, focus rings, sidebar, etc.).

- **`src/styles/globals.css`**: add `--tab-focus-indicator: var(--primary)` in both `:root` and `.dark` blocks as a safe default. All existing themes inherit their current `--primary` color unchanged.
- **`src/modules/workspaces/PaneTabBar.tsx`**: replace `bg-primary` with an inline style or Tailwind arbitrary value that reads `var(--tab-focus-indicator)`.
- **`src/modules/theme/types.ts`**: add `tabFocusIndicator?: string` to `ThemeColors` so themes can set it via the existing `applyTheme` pipeline.
- **`src/modules/theme/themes/terax-default.ts`**: set `tabFocusIndicator` to `oklch(0.578 0.199 264.4)` (blue-500, `#3b82f6`) in both `dark` and `light` variants.

No changes needed to the other 9 built-in themes — they continue using their `--primary` color as the indicator.

## Feature 2: Inactive pane dim

### Design

Non-focused panes display a semi-transparent black overlay over their entire surface (tab bar + content). The opacity is looked up by the active panel's `kind` and is configurable per theme.

### Theme type change

In `src/modules/theme/types.ts`, add to the `Theme` interface:

```ts
inactivePaneDim?: Record<string, number>  // panel kind -> opacity 0-1
```

Using `string` keys (not `PanelKind`) avoids a circular dependency between the `theme` and `workspaces` modules.

All 10 built-in themes receive:

```ts
inactivePaneDim: { terminal: 0.12 }
```

This means: terminal panels dim to 12% black when their pane loses focus. All other panel kinds (`editor`, `preview`, `markdown`, `git-diff`, `git-history`, `git-commit-file`) default to 0 (no dim).

### Rendering

In `src/modules/workspaces/PaneView.tsx`:

1. Read the active panel's `kind` from `pane.panels` + `pane.activePanelId`.
2. Obtain the dim opacity: `theme.inactivePaneDim?.[activePanel.kind] ?? 0`.
3. When `!focused && dimOpacity > 0`, render:

```tsx
<div
  className="absolute inset-0 bg-black pointer-events-none z-10"
  style={{ opacity: dimOpacity }}
/>
```

The overlay covers the full pane (including tab bar) for a visually uniform effect. `pointer-events-none` ensures mouse interaction is unaffected.

The `useTheme()` hook (or equivalent theme context) provides the current theme object in `PaneView`.

### Extensibility

Future panel kinds can opt into dimming by adding their key to a theme's `inactivePaneDim` map. Custom user themes (via `customThemes.ts`) support the same field through the existing `validateTheme` pipeline once that is updated to allow the new field.

## Files changed

| File | Change |
|---|---|
| `src/styles/globals.css` | Add `--tab-focus-indicator: var(--primary)` fallback |
| `src/modules/theme/types.ts` | Add `tabFocusIndicator?: string` to `ThemeColors`; add `inactivePaneDim?: Record<string, number>` to `Theme` |
| `src/modules/theme/applyTheme.ts` | Map `tabFocusIndicator` to `--tab-focus-indicator` CSS variable |
| `src/modules/theme/themes/terax-default.ts` | Set `tabFocusIndicator` blue + `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/theme/themes/*.ts` (9 others) | Add `inactivePaneDim: { terminal: 0.12 }` |
| `src/modules/workspaces/PaneTabBar.tsx` | Use `var(--tab-focus-indicator)` instead of `bg-primary` |
| `src/modules/workspaces/PaneView.tsx` | Render dim overlay when `!focused` based on theme + panel kind |
