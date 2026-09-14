import { describe, expect, it } from "vitest";
import { resolveNationality } from "./nationalities";

describe("resolveNationality", () => {
  it("resolves English nationality", () => {
    const r = resolveNationality("Brazilian");
    expect(r.iso).toBe("BR");
    expect(r.flag).toBeDefined();
    expect(r.palette).not.toBeNull();
    expect(r.palette!.primary).toBe("#009c3b");
  });

  it("resolves PT-BR nationality", () => {
    const r = resolveNationality("Brasileira");
    expect(r.iso).toBe("BR");
    expect(r.flag).toBeDefined();
  });

  it("returns unknown for unrecognized", () => {
    const r = resolveNationality("Atlantean");
    expect(r.iso).toBeNull();
    expect(r.flag).toBeNull();
    expect(r.palette).toBeNull();
  });

  it("returns British GB flag", () => {
    const r = resolveNationality("British");
    expect(r.iso).toBe("GB");
    expect(Array.from(r.flag ?? "")).toHaveLength(2);
    expect(r.palette!.primary).toBe("#c8102e");
  });

  it("handles case-insensitive input", () => {
    const r = resolveNationality("FINNISH");
    expect(r.iso).toBe("FI");
    expect(r.flag).toBeDefined();
  });

  it("handles PT-BR Monegasco", () => {
    const r = resolveNationality("Monegasco");
    expect(r.iso).toBe("MC");
    expect(r.flag).toBeDefined();
  });

  it("palette always has three colors", () => {
    const names = [
      "British", "Dutch", "Brazilian", "French", "Mexican", "Italian",
      "Spanish", "Monegasque", "Canadian", "Japanese", "Thai", "German",
      "New Zealander", "Argentine", "Finnish", "Australian",
      "Britânico", "Brasileira", "Americana",
    ];
    for (const n of names) {
      const r = resolveNationality(n);
      if (r.palette) {
        expect(typeof r.palette.primary).toBe("string");
        expect(typeof r.palette.secondary).toBe("string");
        expect(typeof r.palette.accent).toBe("string");
      }
    }
  });
});