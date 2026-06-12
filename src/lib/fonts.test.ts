import { describe, expect, it } from "vitest";
import { buildFontStack, normalizeFontFamilies } from "./fonts";

const DEFAULTS = '"JetBrains Mono", Menlo, Monaco, "Courier New", monospace';

describe("normalizeFontFamilies", () => {
  it("quotes bare names containing spaces", () => {
    expect(normalizeFontFamilies("MesloLGS NF")).toEqual(['"MesloLGS NF"']);
  });

  it("keeps simple identifiers unquoted", () => {
    expect(normalizeFontFamilies("Menlo")).toEqual(["Menlo"]);
  });

  it("preserves already-quoted names without double quoting", () => {
    expect(normalizeFontFamilies('"Fira Code", \'Hack Nerd Font\'')).toEqual([
      '"Fira Code"',
      '"Hack Nerd Font"',
    ]);
  });

  it("lowercases generic family keywords and never quotes them", () => {
    expect(normalizeFontFamilies("Monospace, ui-monospace")).toEqual([
      "monospace",
      "ui-monospace",
    ]);
  });

  it("drops empty entries and trims whitespace", () => {
    expect(normalizeFontFamilies(" , Menlo ,  , ")).toEqual(["Menlo"]);
  });

  it("returns empty list for empty or whitespace input", () => {
    expect(normalizeFontFamilies("")).toEqual([]);
    expect(normalizeFontFamilies("   ")).toEqual([]);
  });
});

describe("buildFontStack", () => {
  it("returns the default stack when the preference is empty", () => {
    expect(buildFontStack("", DEFAULTS)).toBe(DEFAULTS);
    expect(buildFontStack("  ", DEFAULTS)).toBe(DEFAULTS);
  });

  it("prepends a single user font to the default stack", () => {
    expect(buildFontStack("MesloLGS NF", DEFAULTS)).toBe(
      `"MesloLGS NF", ${DEFAULTS}`,
    );
  });

  it("prepends a full user list to the default stack", () => {
    expect(buildFontStack("Fira Code, Hack", DEFAULTS)).toBe(
      `"Fira Code", Hack, ${DEFAULTS}`,
    );
  });
});
