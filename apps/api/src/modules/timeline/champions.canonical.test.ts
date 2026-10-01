import { describe, expect, it } from "vitest";

import {
  CANONICAL_CHAMPIONS_SOURCE,
  canonicalChampionForYear,
  canonicalNameMatches,
  FIA_CANONICAL_CHAMPIONS_2000_2025,
  normalizeChampionName,
} from "./champions.canonical.js";

describe("fallback canônico de campeões 2000-2025", () => {
  it("1) cobre exatamente 2000..2025 sem 2026/1999", () => {
    const years = FIA_CANONICAL_CHAMPIONS_2000_2025.map((entry) => entry.year);
    expect(years).toHaveLength(26);
    expect(years[0]).toBe(2000);
    expect(years[years.length - 1]).toBe(2025);
    expect(years).not.toContain(2026);
    expect(years).not.toContain(1999);
    expect(canonicalChampionForYear(2026)).toBeNull();
    expect(canonicalChampionForYear(1999)).toBeNull();
  });

  it("2) nomes factuais exatos por temporada", () => {
    const expected: Record<number, string> = {
      2000: "Michael Schumacher",
      2001: "Michael Schumacher",
      2002: "Michael Schumacher",
      2003: "Michael Schumacher",
      2004: "Michael Schumacher",
      2005: "Fernando Alonso",
      2006: "Fernando Alonso",
      2007: "Kimi Räikkönen",
      2008: "Lewis Hamilton",
      2009: "Jenson Button",
      2010: "Sebastian Vettel",
      2011: "Sebastian Vettel",
      2012: "Sebastian Vettel",
      2013: "Sebastian Vettel",
      2014: "Lewis Hamilton",
      2015: "Lewis Hamilton",
      2016: "Nico Rosberg",
      2017: "Lewis Hamilton",
      2018: "Lewis Hamilton",
      2019: "Lewis Hamilton",
      2020: "Lewis Hamilton",
      2021: "Max Verstappen",
      2022: "Max Verstappen",
      2023: "Max Verstappen",
      2024: "Max Verstappen",
      2025: "Lando Norris",
    };
    for (const [year, name] of Object.entries(expected)) {
      expect(canonicalChampionForYear(Number(year))?.driverName).toBe(name);
    }
  });

  it("3) metadados de proveniência são oficiais/factuais", () => {
    expect(CANONICAL_CHAMPIONS_SOURCE.provider).toBe("FIA_CANONICAL_CHRONOLOGY");
    expect(CANONICAL_CHAMPIONS_SOURCE.license).toBe("FACTUAL_REFERENCE");
    expect(CANONICAL_CHAMPIONS_SOURCE.sourceVersion).toBe("2000-2025");
  });

  it("4) comparação de nomes é tolerante a acentos e iniciais", () => {
    expect(normalizeChampionName("Kimi Räikkönen")).toBe("kimi raikkonen");
    expect(canonicalNameMatches("Kimi Räikkönen", "Kimi Räikkönen")).toBe(true);
    expect(canonicalNameMatches("kimi raikkonen", "Kimi Räikkönen")).toBe(true);
    expect(canonicalNameMatches("L. Hamilton", "Lewis Hamilton")).toBe(true);
    expect(canonicalNameMatches("Max Verstappen", "Lando Norris")).toBe(false);
    expect(canonicalNameMatches("champ-Lando S", "Sebastian Vettel")).toBe(false);
    expect(canonicalNameMatches(null, "Lewis Hamilton")).toBe(false);
  });
});
