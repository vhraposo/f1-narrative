import { describe, expect, it } from "vitest";
import { flagUrlForIso, resolveNationality } from "./nationalities";

describe("resolveNationality", () => {
  it("resolves Brazilian nationality with the REST Countries flag URL", () => {
    const result = resolveNationality("Brazilian");
    expect(result.iso).toBe("BR");
    expect(result.countryName).toBe("Brazil");
    expect(result.flagUrl).toBe("https://flags.restcountries.com/v5/svg/br.svg");
    expect(result.palette?.primary).toBe("#009c3b");
    expect(result.palette?.secondary).toBe("#ffdf00");
    expect(result.palette?.accent).toBe("#002776");
  });

  it("resolves PT-BR nationality", () => {
    const result = resolveNationality("Brasileira");
    expect(result.iso).toBe("BR");
    expect(result.flagUrl).toBe("https://flags.restcountries.com/v5/svg/br.svg");
  });

  it("builds the flag URL from a normalized ISO code", () => {
    expect(flagUrlForIso("GB")).toBe("https://flags.restcountries.com/v5/svg/gb.svg");
  });

  it("returns neutral fallback for an unrecognized nationality", () => {
    const result = resolveNationality("Atlantean");
    expect(result.iso).toBeNull();
    expect(result.countryName).toBeNull();
    expect(result.flagUrl).toBeNull();
    expect(result.palette).toBeNull();
  });

  it("resolves British nationality", () => {
    const result = resolveNationality("British");
    expect(result.iso).toBe("GB");
    expect(result.countryName).toBe("United Kingdom");
    expect(result.palette?.primary).toBe("#c8102e");
  });

  it("handles case-insensitive input", () => {
    const result = resolveNationality("FINNISH");
    expect(result.iso).toBe("FI");
    expect(result.flagUrl).toBe("https://flags.restcountries.com/v5/svg/fi.svg");
  });

  it("handles PT-BR Monegasco", () => {
    const result = resolveNationality("Monegasco");
    expect(result.iso).toBe("MC");
    expect(result.flagUrl).toBe("https://flags.restcountries.com/v5/svg/mc.svg");
  });

  it("derives a complete, three-color national gradient", () => {
    const palette = resolveNationality("Brasileira").palette;
    expect(palette?.gradient).toBe(
      "linear-gradient(135deg, rgba(0,156,59,0.16) 0%, rgba(255,223,0,0.14) 52%, rgba(0,39,118,0.16) 100%)",
    );
    expect(palette?.border).toBe("rgba(0,39,118,0.35)");
    expect(palette?.glow).toBe("rgba(0,39,118,0.14)");
    expect(palette?.foreground).toBeDefined();
    expect(palette?.muted).toBeDefined();
  });
});
