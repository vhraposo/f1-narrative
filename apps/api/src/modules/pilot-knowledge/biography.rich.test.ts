import { describe, expect, it } from "vitest";

import { getF1dbDataset } from "../f1db/f1db.dataset.js";
import { resolveF1dbDriver } from "../f1db/f1db.drivers.js";
import {
  buildApprovedBiographyClaims,
  type ApprovedClaimSet,
} from "./biography.claims.js";
import { BIOGRAPHY_COMPOSER_VERSION } from "./biography.composer.js";
import { evaluateBiographyCoverage } from "./biography.coverage.js";
import { getCuratedEvidenceForDriver } from "./biography.evidence.js";
import { renderRichDeterministicBiography } from "./biography.fallback.js";
import { planBiographyParagraphs } from "./biography.planner.js";
import { composeBiographyFromClaims } from "./biography.pipeline.js";
import type { BiographyFacts } from "./pilot-knowledge.profile.js";

function factsFor(driverKey: string, overrides: Partial<BiographyFacts> = {}): BiographyFacts {
  const driver = resolveF1dbDriver({ name: driverKey });
  return {
    publicName: driver?.name ?? driverKey,
    fullName: driver?.fullName ?? driverKey,
    dateOfBirth: driver?.dateOfBirth ? new Date(`${driver.dateOfBirth}T00:00:00.000Z`) : null,
    placeOfBirth: driver?.placeOfBirth ?? null,
    nationality: driver?.nationalityCountryId ?? null,
    debutYear: null,
    teams: [],
    championships: [],
    interests: [],
    career: null,
    ...overrides,
  };
}

function buildSet(name: string, overrides: Partial<BiographyFacts> = {}): ApprovedClaimSet {
  const dataset = getF1dbDataset();
  const driver = resolveF1dbDriver({ name });
  return buildApprovedBiographyClaims({
    externalDriverId: `ext-${name}`,
    facts: factsFor(name, overrides),
    f1dbDriver: driver,
    f1dbAmbiguous: false,
    f1dbSourceVersion: dataset?.sourceVersion ?? null,
    curated: getCuratedEvidenceForDriver(driver?.id ?? null),
    evidenceVersion: "test-evidence",
  });
}

function paragraphsOf(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);
}

describe("rich biography — Gasly (evidence curada real)", () => {
  const set = buildSet("Pierre Gasly");
  const coverage = evaluateBiographyCoverage(set);

  it("1) evidence rica cobre origens, kart, base, F1, personalidade e interesses", () => {
    expect(coverage.rich).toBe(true);
    expect(coverage.relevantCount).toBeGreaterThanOrEqual(6);
    const categories = new Set(set.claims.map((claim) => claim.category));
    expect(categories.has("ORIGIN")).toBe(true);
    expect(categories.has("KARTING")).toBe(true);
    expect(categories.has("JUNIOR_CAREER")).toBe(true);
    expect(categories.has("F1_ENTRY")).toBe(true);
    expect(categories.has("TEAM_HISTORY")).toBe(true);
    expect(categories.has("PUBLIC_PERSONALITY")).toBe(true);
    expect(categories.has("INTERESTS")).toBe(true);
  });

  it("2) planner ordena identidade → kart → base → F1 → conquistas → pessoa → interesses", () => {
    const plan = planBiographyParagraphs(set);
    const ids = plan.map((paragraph) => paragraph.id);
    expect(ids[0]).toBe("identity_origins");
    expect(ids).toContain("karting");
    expect(ids.indexOf("karting")).toBeLessThan(ids.indexOf("junior_career"));
    expect(ids.indexOf("junior_career")).toBeLessThan(ids.indexOf("f1_entry_teams"));
    expect(ids.indexOf("f1_entry_teams")).toBeLessThan(ids.indexOf("achievements"));
    expect(ids.indexOf("achievements")).toBeLessThan(ids.indexOf("personality"));
    expect(ids.indexOf("personality")).toBeLessThan(ids.indexOf("interests"));
    const used = plan.flatMap((paragraph) => paragraph.claimIds);
    expect(new Set(used).size).toBe(used.length);
  });

  it("3) fallback rico gera narrativa multi-parágrafo factual", () => {
    const text = renderRichDeterministicBiography(set)!;
    expect(text).not.toBeNull();
    const paragraphs = paragraphsOf(text);
    expect(paragraphs.length).toBeGreaterThanOrEqual(5);
    expect(paragraphs.length).toBeLessThanOrEqual(8);
    expect(text).toContain("Rouen");
    expect(text.toLowerCase()).toContain("kart");
    expect(text).toContain("Toro Rosso");
    expect(text).toContain("Monza");
    expect(text).toContain("futebol");
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toMatch(/[#*_`]/);
    expect(text).not.toContain("Ferrari");
    expect(text).not.toContain("talentoexceptional");
  });

  it("4) composer rico aprovado melhora a narrativa; erros caem para o rico determinístico", async () => {
    const richStub = async ({ claimSet }: { claimSet: ApprovedClaimSet }) => {
      const plans = planBiographyParagraphs(claimSet);
      return plans
        .map((plan) =>
          plan.claimIds
            .slice(0, 2)
            .map((id) => {
              const claim = claimSet.claims.find((entry) => entry.id === id);
              return claim ? `${claim.display}.` : "";
            })
            .join(" "),
        )
        .filter((paragraph) => paragraph.trim().length > 0)
        .join("\n\n");
    };
    const approved = await composeBiographyFromClaims({
      claimSet: set,
      facts: factsFor("Pierre Gasly"),
      composer: richStub,
    });
    expect(approved.mode).toBe("LLM_APPROVED");
    expect(paragraphsOf(approved.display).length).toBeGreaterThanOrEqual(3);

    const wrongTeam = async ({ claimSet }: { claimSet: ApprovedClaimSet }) => {
      const base = await richStub({ claimSet });
      return `${base} Pierre Gasly correu pela Ferrari em toda a carreira.`;
    };
    const rejected = await composeBiographyFromClaims({
      claimSet: set,
      facts: factsFor("Pierre Gasly"),
      composer: wrongTeam,
    });
    expect(rejected.mode).toBe("RICH_DETERMINISTIC");
    expect(rejected.fallbackReason).toContain("unsupported-proper-noun:Ferrari");
    expect(paragraphsOf(rejected.display).length).toBeGreaterThanOrEqual(5);
  });
});

describe("rich biography — Norris (evidence curada real)", () => {
  it("5) cobre infância, kart, base, McLaren, conquistas, persona, interesses e projetos", () => {
    const set = buildSet("Lando Norris");
    const coverage = evaluateBiographyCoverage(set);
    expect(coverage.rich).toBe(true);
    const text = renderRichDeterministicBiography(set)!;
    const paragraphs = paragraphsOf(text);
    expect(paragraphs.length).toBeGreaterThanOrEqual(5);
    expect(text).toContain("Glastonbury");
    expect(text).toContain("Valentino Rossi");
    expect(text.toLowerCase()).toContain("kart");
    expect(text).toContain("McLaren");
    expect(text).toContain("2025");
    expect(text).toContain("Quadrant");
    expect(text.toLowerCase()).toContain("simulador");
    expect(text).toContain("LN Racing Kart");
    expect(text).not.toMatch(/https?:\/\//i);
    expect(text).not.toContain("Verstappen conquistou");
  });
});

describe("sparse biography — sem evidence rica", () => {
  it("6) piloto só com identidade/F1 continua compacto e não força riqueza", async () => {
    const set = buildApprovedBiographyClaims({
      externalDriverId: "ext-sparse",
      f1dbDriver: null,
      f1dbAmbiguous: false,
      f1dbSourceVersion: null,
      facts: {
        publicName: "Piloto Sparse",
        fullName: "Piloto Sparse Completo",
        dateOfBirth: new Date("1995-05-05T00:00:00.000Z"),
        nationality: "Dutch",
        debutYear: 2020,
        championships: [],
        teams: ["Equipe A"],
        career: null,
      },
    });
    expect(evaluateBiographyCoverage(set).rich).toBe(false);
    const result = await composeBiographyFromClaims({
      claimSet: set,
      facts: {
        publicName: "Piloto Sparse",
        fullName: "Piloto Sparse Completo",
        dateOfBirth: new Date("1995-05-05T00:00:00.000Z"),
        nationality: "Dutch",
        debutYear: 2020,
        championships: [],
        teams: ["Equipe A"],
        career: null,
      },
    });
    expect(result.mode).toBe("FALLBACK");
    expect(paragraphsOf(result.display).length).toBe(1);
    expect(result.display).toContain("Piloto Sparse");
  });

  it("7) evidence version e generator version mudam o fingerprint", () => {
    const base = buildApprovedBiographyClaims({
      externalDriverId: "ext-1",
      f1dbDriver: null,
      f1dbAmbiguous: false,
      f1dbSourceVersion: null,
      facts: { publicName: "Piloto", nationality: "Dutch" },
    });
    const withEvidence = buildApprovedBiographyClaims({
      externalDriverId: "ext-1",
      f1dbDriver: null,
      f1dbAmbiguous: false,
      f1dbSourceVersion: null,
      facts: { publicName: "Piloto", nationality: "Dutch" },
      curated: getCuratedEvidenceForDriver("pierre-gasly"),
      evidenceVersion: "v2",
    });
    expect(base.fingerprint).not.toBe(withEvidence.fingerprint);
    expect(withEvidence.evidenceVersion).toBe("v2");
    expect(BIOGRAPHY_COMPOSER_VERSION).toBe("biography-composer.v3");
  });
});
