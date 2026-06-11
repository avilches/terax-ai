import type { Theme } from "../types";

export const teraxDefault: Theme = {
  id: "terax-default",
  name: "Terax Default",
  description: "The default Terax look - clean glass over neutral surfaces.",
  editorTheme: { dark: "atomone", light: "atomone" },
  variants: {
    light: { colors: { tabFocusIndicator: "oklch(0.578 0.199 264.4)" }, inactivePaneDim: { terminal: 0.015 } },
    dark:  { colors: { tabFocusIndicator: "oklch(0.578 0.199 264.4)" }, inactivePaneDim: { terminal: 0.12 } },
  },
};
