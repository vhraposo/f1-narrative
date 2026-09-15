import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  deriveAccent,
  deriveSecondary,
  formatHex,
  foregroundFor,
  parseHex,
  relativeLuminance,
  resolveTeamIdentity,
  teamIdentityFor,
  TEAM_IDENTITIES_2026,
  withAlpha,
} from "./team-identity";

describe("parseHex", () => {
  it("parses 6-digit hex", () => {
    expect(parseHex("#e80020")).toEqual([232, 0, 32]);
  });

  it("parses 3-digit shorthand", () => {
    expect(parseHex("#fff")).toEqual([255, 255, 255]);
  });

  it("throws on invalid hex", () => {
    expect(() => parseHex("not-hex")).toThrow("Invalid hex color");
  });
});

describe("formatHex", () => {
  it("formats rgb to lowercase hex", () => {
    expect(formatHex(232, 0, 32)).toBe("#e80020");
  });

  it("pads single-digit channels", () => {
    expect(formatHex(1, 2, 3)).toBe("#010203");
  });
});

describe("withAlpha", () => {
  it("produces valid rgba string", () => {
    const result = withAlpha("#e80020", 0.55);
    expect(result).toMatch(/^rgba\(232,0,32,0\.55\)$/);
  });
});

describe("relativeLuminance", () => {
  it("white ≈ 1, black ≈ 0", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 2);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 2);
  });
});

describe("contrastRatio", () => {
  it("black vs white = 21", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 0);
  });

  it("same color = 1", () => {
    expect(contrastRatio("#e80020", "#e80020")).toBeCloseTo(1, 0);
  });
});

describe("foregroundFor", () => {
  it("returns white for dark backgrounds", () => {
    expect(foregroundFor("#000000")).toBe("#ffffff");
    expect(foregroundFor("#1e3a5f")).toBe("#ffffff");
  });

  it("returns dark for light backgrounds", () => {
    expect(foregroundFor("#ffffff")).toBe("#111827");
    expect(foregroundFor("#f0f0f0")).toBe("#111827");
  });
});

describe("deriveSecondary", () => {
  it("returns a valid hex different from primary", () => {
    const s = deriveSecondary("#e80020");
    expect(s).toMatch(/^#[0-9a-f]{6}$/);
    expect(s).not.toBe("#e80020");
  });
});

describe("deriveAccent", () => {
  it("returns a valid hex different from primary", () => {
    const a = deriveAccent("#3671c6");
    expect(a).toMatch(/^#[0-9a-f]{6}$/);
    expect(a).not.toBe("#3671c6");
  });
});

describe("resolveTeamIdentity", () => {
  it("returns null when no color or visualIdentity", () => {
    expect(resolveTeamIdentity({})).toBeNull();
    expect(resolveTeamIdentity({ color: null, visualIdentity: null })).toBeNull();
  });

  it("falls back to team.color when visualIdentity absent", () => {
    const r = resolveTeamIdentity({ color: "#ff0000" });
    expect(r).not.toBeNull();
    expect(r!.primary).toBe("#ff0000");
    expect(r!.gradient).toContain("#ff0000");
  });

  it("persisted visualIdentity overrides the 2026 catalog and team.color", () => {
    const r = resolveTeamIdentity({
      name: "McLaren",
      color: "#000000",
      visualIdentity: { primary: "#3671c6" },
    });
    expect(r!.primary).toBe("#3671c6");
  });

  it("uses provided secondary/foreground and derives missing", () => {
    const r = resolveTeamIdentity({
      visualIdentity: { primary: "#ff0000", secondary: "#fff", foreground: "#000" },
    });
    expect(r!.secondary).toBe("#fff");
    expect(r!.foreground).toBe("#000");
    expect(r!.accent).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("gradient contains primary and secondary", () => {
    const r = resolveTeamIdentity({ visualIdentity: { primary: "#aaa", secondary: "#bbb" } });
    expect(r!.gradient).toContain("#aaa");
    expect(r!.gradient).toContain("#bbb");
    expect(r!.gradient).toContain(r!.accent);
  });

  it("resolves the 11 central 2026 team identities from materialized names", () => {
    const teams: [string, string][] = [
      ["Mercedes-AMG PETRONAS Formula One Team", "#00a19b"],
      ["Scuderia Ferrari HP", "#e80020"],
      ["McLaren", "#ff8000"],
      ["Red Bull Racing", "#1e41ff"],
      ["Visa Cash App Racing Bulls F1 Team", "#6692ff"],
      ["RB F1 Team", "#6692ff"],
      ["BWT Alpine Formula One Team", "#0093cc"],
      ["Haas F1 Team", "#ffffff"],
      ["Audi Revolut F1 Team", "#b0b4b7"],
      ["Atlassian Williams Racing", "#64c4ff"],
      ["Aston Martin Aramco Formula One Team", "#006f62"],
      ["Cadillac Formula 1 Team", "#121212"],
    ];
    expect(Object.keys(TEAM_IDENTITIES_2026)).toHaveLength(11);
    for (const [name, primary] of teams) {
      const identity = teamIdentityFor(name);
      expect(identity?.primary).toBe(primary);
      expect(identity?.secondary).toMatch(/^#[0-9a-f]{6}$/i);
      expect(identity?.accent).toMatch(/^#[0-9a-f]{6}$/i);
      expect(identity?.foreground).toMatch(/^#[0-9a-f]{6}$/i);
      expect(identity?.muted).toMatch(/^rgba\(/);
      expect(identity?.border).toMatch(/^rgba\(/);
      expect(identity?.gradient).toContain(primary);
    }
  });

  it("uses the central identity before Team.color for known teams", () => {
    const r = resolveTeamIdentity({
      name: "McLaren",
      color: "#123456",
      visualIdentity: null,
    });
    expect(r?.primary).toBe("#ff8000");
    expect(r?.secondary).toBe("#1d1d1b");
    expect(r?.accent).toBe("#00a19b");
    expect(r?.gradient).toContain("#00a19b");
  });
});
