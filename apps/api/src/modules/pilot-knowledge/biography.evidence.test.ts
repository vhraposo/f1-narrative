import { describe, expect, it } from "vitest";

import {
  curatedEvidenceVersion,
  getCuratedEvidenceDataset,
  getCuratedEvidenceForDriver,
} from "./biography.evidence.js";

describe("curated biography evidence", () => {
  it("1) dataset versionado com fontes resolvidas", () => {
    const dataset = getCuratedEvidenceDataset();
    expect(dataset).not.toBeNull();
    expect(dataset?.version).toMatch(/^[a-f0-9]{16}$/);
    expect(dataset?.drivers.has("pierre-gasly")).toBe(true);
    expect(dataset?.drivers.has("lando-norris")).toBe(true);
    expect(curatedEvidenceVersion()).toContain("v2026.15.1");
  });

  it("2) Gasly tem claims ricos com sourceRef válido e autoridade", () => {
    const bundle = getCuratedEvidenceForDriver("pierre-gasly");
    expect(bundle).not.toBeNull();
    expect((bundle?.claims.length ?? 0)).toBeGreaterThanOrEqual(20);
    const categories = new Set(bundle?.claims.map((claim) => claim.category));
    expect(categories.has("ORIGIN")).toBe(true);
    expect(categories.has("KARTING")).toBe(true);
    expect(categories.has("JUNIOR_CAREER")).toBe(true);
    expect(categories.has("PUBLIC_PERSONALITY")).toBe(true);
    const official = bundle?.claims.filter(
      (claim) => claim.authority === "PRIMARY_OFFICIAL",
    );
    expect((official?.length ?? 0)).toBeGreaterThan(5);
    for (const claim of bundle?.claims ?? []) {
      expect(bundle?.sources.has(claim.sourceRef)).toBe(true);
    }
  });

  it("3) Norris tem projetos e personalidade com provenance", () => {
    const bundle = getCuratedEvidenceForDriver("lando-norris");
    const keys = new Set(bundle?.claims.map((claim) => claim.key));
    expect(keys.has("QUADRANT")).toBe(true);
    expect(keys.has("LN_RACING_KART")).toBe(true);
    expect(keys.has("SIM_RACING")).toBe(true);
    expect(keys.has("MENTAL_HEALTH_OPENNESS")).toBe(true);
    const personality = bundle?.claims.filter(
      (claim) => claim.category === "PUBLIC_PERSONALITY",
    );
    expect(personality?.every((claim) => claim.attribution !== null)).toBe(true);
  });

  it("4) Verstappen tem evidence rica real com fontes oficiais", () => {
    const bundle = getCuratedEvidenceForDriver("max-verstappen");
    expect(bundle).not.toBeNull();
    expect((bundle?.claims.length ?? 0)).toBeGreaterThanOrEqual(30);
    const categories = new Set(bundle?.claims.map((claim) => claim.category));
    for (const expected of [
      "ORIGIN",
      "KARTING",
      "JUNIOR_CAREER",
      "F1_ENTRY",
      "TEAM_HISTORY",
      "F1_ACHIEVEMENTS",
      "PUBLIC_PERSONALITY",
      "INTERESTS",
      "PROJECTS",
      "CURRENT_CONTEXT",
    ]) {
      expect(categories.has(expected as never)).toBe(true);
    }
    const keys = new Set(bundle?.claims.map((claim) => claim.key));
    expect(keys.has("CHAMPIONSHIP_2021")).toBe(true);
    expect(keys.has("NURBURGRING_24H")).toBe(true);
    expect(keys.has("MAX_VS_100")).toBe(true);
    expect(keys.has("VERSTAPPEN_RACING")).toBe(true);
    const official = bundle?.claims.filter(
      (claim) => claim.authority === "PRIMARY_OFFICIAL",
    );
    expect((official?.length ?? 0)).toBeGreaterThan(20);
    for (const claim of bundle?.claims ?? []) {
      expect(bundle?.sources.has(claim.sourceRef)).toBe(true);
    }
    const personality = bundle?.claims.filter(
      (claim) => claim.category === "PUBLIC_PERSONALITY",
    );
    expect(personality?.every((claim) => claim.attribution !== null)).toBe(true);
  });

  it("5) piloto sem evidence curada retorna vazio (sem invenção)", () => {
    expect(getCuratedEvidenceForDriver("piloto-inexistente")).toBeNull();
    expect(getCuratedEvidenceForDriver(null)).toBeNull();
  });
});
