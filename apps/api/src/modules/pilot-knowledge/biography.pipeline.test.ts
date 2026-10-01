import { describe, expect, it } from "vitest";

import { resolveF1dbDriver } from "../f1db/f1db.drivers.js";
import { getF1dbDataset } from "../f1db/f1db.dataset.js";
import {
  buildApprovedBiographyClaims,
  planBiographyClaimIds,
  type ApprovedClaimSet,
} from "./biography.claims.js";
import { validateBiographyText } from "./biography.quality.js";
import { composeBiographyFromClaims } from "./biography.pipeline.js";
import { parseVerifierOutput } from "./biography.verifier.js";
import type { BiographyComposer } from "./biography.composer.js";
import type { BiographyFacts } from "./pilot-knowledge.profile.js";

const MAX_FACTS: BiographyFacts = {
  publicName: "Max Verstappen",
  fullName: "Max Emilian Verstappen",
  dateOfBirth: new Date("1997-09-30T00:00:00.000Z"),
  placeOfBirth: "Hasselt",
  nationality: "Dutch",
  debutYear: 2015,
  teams: [],
  championships: [2021, 2022, 2023, 2024],
  interests: ["sim racing", "jet skis", "quad bikes", "motorbikes"],
  career: null,
};

function buildMaxClaimSet(): ApprovedClaimSet {
  const dataset = getF1dbDataset();
  const f1dbDriver = resolveF1dbDriver({ name: "Max Emilian Verstappen" });
  return buildApprovedBiographyClaims({
    externalDriverId: "ext-max",
    facts: MAX_FACTS,
    f1dbDriver,
    f1dbAmbiguous: false,
    f1dbSourceVersion: dataset?.sourceVersion ?? null,
  });
}

function claimsToSentences(set: ApprovedClaimSet, maxClaims = 8): string {
  const sentences: string[] = [];
  for (let index = 0; index < Math.min(set.claims.length, maxClaims); index += 2) {
    const group = set.claims.slice(index, index + 2);
    sentences.push(`${group.map((claim) => claim.display).join("; ")}.`);
  }
  return sentences.join(" ");
}

const validStub: BiographyComposer = async ({ claimSet }) => claimsToSentences(claimSet, 20);

describe("claims da fixture Max Verstappen (dados F1DB reais)", () => {
  const set = buildMaxClaimSet();
  const byKey = (key: string) => set.claims.filter((claim) => claim.key === key);

  it("1) identidade, nascimento, local e nacionalidade corretos", () => {
    expect(byKey("FULL_NAME")[0]?.display).toBe("Max Emilian Verstappen");
    expect(byKey("BIRTH_DATE")[0]?.display).toContain("30 de setembro de 1997");
    expect(byKey("BIRTH_PLACE")[0]?.display).toBe("Hasselt");
    expect(byKey("NATIONALITY")[0]?.display).toBe("neerlandesa");
    expect(byKey("F1_DEBUT")[0]?.year).toBe(2015);
  });

  it("2) equipes cronológicas sem trocar 2014/2015/2016", () => {
    const teams = byKey("TEAM_SEASON");
    const toroRosso = teams.find((claim) => claim.display.includes("Scuderia Toro Rosso"));
    const redBull = teams.find((claim) => claim.display.includes("Red Bull Racing"));
    expect(toroRosso?.year).toBe(2015);
    expect(redBull?.year).toBe(2016);
    expect(
      teams.some((claim) => claim.display.includes("2014")),
    ).toBe(false);
  });

  it("3) primeira vitória 2016 e títulos 2021-2024", () => {
    const win = byKey("FIRST_WIN")[0];
    expect(win?.year).toBe(2016);
    expect(byKey("CHAMPIONSHIP").map((claim) => claim.year)).toEqual([
      2021, 2022, 2023, 2024,
    ]);
  });

  it("4) interesses entram apenas como claims da fixture", () => {
    expect(byKey("INTEREST").map((claim) => claim.value).sort()).toEqual([
      "jet skis",
      "motorbikes",
      "quad bikes",
      "sim racing",
    ]);
  });

  it("5) fingerprint muda quando claims mudam", () => {
    const other = buildApprovedBiographyClaims({
      externalDriverId: "ext-max",
      facts: { ...MAX_FACTS, interests: [] },
      f1dbDriver: resolveF1dbDriver({ name: "Max Emilian Verstappen" }),
      f1dbAmbiguous: false,
      f1dbSourceVersion: "v2026.15.1",
    });
    expect(other.fingerprint).not.toBe(set.fingerprint);
    expect(planBiographyClaimIds(set)[0]).toBe(set.claims[0]?.id);
  });
});

describe("pipeline de biografia — regressão da classe de corrupção observada", () => {
  it("6) composer válido é aprovado e mantém fatos da fixture", async () => {
    const result = await composeBiographyFromClaims({
      claimSet: buildMaxClaimSet(),
      facts: MAX_FACTS,
      composer: validStub,
    });
    expect(result.mode).toBe("LLM_APPROVED");
    expect(result.display).toContain("Scuderia Toro Rosso (2015)");
    expect(result.display).toContain("2021");
    expect(result.display).not.toMatch(/talentoexceptional/i);
  });

  it("7) palavra concatenada e idioma misturado caem em fallback determinístico", async () => {
    const corrupted: BiographyComposer = async () =>
      "Max Emilian Verstappen demonstrou um talentoexceptional para as corridas, com starting rápido nas categorias de base, e seguiu evoluindo até a Fórmula 1 com a Scuderia Toro Rosso em 2015.";
    const result = await composeBiographyFromClaims({
      claimSet: buildMaxClaimSet(),
      facts: MAX_FACTS,
      composer: corrupted,
    });
    expect(result.mode).toBe("FALLBACK");
    expect(result.fallbackReason).toMatch(/quality:/);
    expect(result.display).not.toMatch(/talentoexceptional/i);
    expect(result.display).toContain("Max Verstappen");
    expect(result.display).toContain("campeonato mundial");
  });

  it("8) ano inventado e equipe inventada são rejeitados", async () => {
    const wrongYear: BiographyComposer = async ({ claimSet }) =>
      `${claimsToSentences(claimSet, 4)} Max Verstappen estreou na Fórmula 1 em 2010.`;
    const yearResult = await composeBiographyFromClaims({
      claimSet: buildMaxClaimSet(),
      facts: MAX_FACTS,
      composer: wrongYear,
    });
    expect(yearResult.mode).toBe("FALLBACK");
    expect(yearResult.fallbackReason).toContain("unsupported-year:2010");

    const wrongTeam: BiographyComposer = async ({ claimSet }) =>
      `${claimsToSentences(claimSet, 4)} Max Verstappen correu pela Ferrari em toda a carreira.`;
    const teamResult = await composeBiographyFromClaims({
      claimSet: buildMaxClaimSet(),
      facts: MAX_FACTS,
      composer: wrongTeam,
    });
    expect(teamResult.mode).toBe("FALLBACK");
    expect(teamResult.fallbackReason).toMatch(/unsupported-proper-noun:Ferrari/);
  });

  it("9) verifier reprovando derruba para fallback; verifier indisponível preserva aprovado", async () => {
    const rejected = await composeBiographyFromClaims({
      claimSet: buildMaxClaimSet(),
      facts: MAX_FACTS,
      composer: validStub,
      verifier: async () => ({
        approved: false,
        issues: ["afirmação não sustentada"],
        unsupportedStatements: ["kart"],
        claimMismatches: [],
      }),
    });
    expect(rejected.mode).toBe("FALLBACK");
    expect(rejected.fallbackReason).toContain("semantic:");

    const unavailable = await composeBiographyFromClaims({
      claimSet: buildMaxClaimSet(),
      facts: MAX_FACTS,
      composer: validStub,
      verifier: async () => {
        throw new Error("provider offline");
      },
    });
    expect(unavailable.mode).toBe("LLM_APPROVED");
  });

  it("10) identidade ambígua bloqueia uso de LLM", async () => {
    const ambiguousSet = buildApprovedBiographyClaims({
      externalDriverId: "ext-max",
      facts: MAX_FACTS,
      f1dbDriver: null,
      f1dbAmbiguous: true,
      f1dbSourceVersion: null,
    });
    const result = await composeBiographyFromClaims({
      claimSet: ambiguousSet,
      facts: MAX_FACTS,
      composer: validStub,
    });
    expect(result.mode).toBe("FALLBACK");
    expect(result.fallbackReason).toBe("ambiguous-identity");
  });

  it("11) parser do verifier é estrito", () => {
    expect(parseVerifierOutput("texto")).toBeNull();
    expect(
      parseVerifierOutput(
        JSON.stringify({
          approved: true,
          issues: [],
          unsupportedStatements: [],
          claimMismatches: [],
        }),
      )?.approved,
    ).toBe(true);
    expect(
      parseVerifierOutput(
        JSON.stringify({ approved: "yes", issues: [], unsupportedStatements: [], claimMismatches: [] }),
      ),
    ).toBeNull();
  });

  it("12) validator aceita texto limpo baseado em claims", () => {
    const set = buildMaxClaimSet();
    const text = claimsToSentences(set, 8);
    const result = validateBiographyText({ text, claims: set });
    expect(result.ok).toBe(true);
  });
});
