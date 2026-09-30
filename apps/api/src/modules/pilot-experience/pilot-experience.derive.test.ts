import { describe, expect, it } from "vitest";

import {
  deriveExperiences,
  filterApplicableExperiences,
  type PilotSportFacts,
} from "./pilot-experience.derive.js";
import { decideMemoryRule, projectMemories, renderMemory } from "./pilot-experience.memory-rules.js";

const EMPTY: PilotSportFacts = {
  races: [],
  standings: [],
  entries: [],
  relationships: [],
  narrativeEvents: [],
  invalidatedChampionshipExperienceIds: [],
  curated: [],
};

function facts(overrides: Partial<PilotSportFacts>): PilotSportFacts {
  return { ...EMPTY, ...overrides };
}

describe("pilot experience derivation", () => {
  it("1) deriva vitória, primeira vitória/pódio/pontos e abandono", () => {
    const derived = deriveExperiences(
      facts({
        races: [
          {
            raceId: "r1",
            seasonId: "s1",
            seasonYear: 2025,
            round: 1,
            name: "GP A",
            date: new Date("2025-03-01"),
            finished: true,
            position: 1,
            resultStatus: "Finished",
            points: 25,
          },
          {
            raceId: "r2",
            seasonId: "s1",
            seasonYear: 2025,
            round: 2,
            name: "GP B",
            date: new Date("2025-03-15"),
            finished: true,
            position: 1,
            resultStatus: "Finished",
            points: 25,
          },
          {
            raceId: "r3",
            seasonId: "s1",
            seasonYear: 2025,
            round: 3,
            name: "GP C",
            date: new Date("2025-04-01"),
            finished: true,
            position: null,
            resultStatus: "DNF",
            points: 0,
          },
        ],
      }),
    );

    const keys = derived.map((experience) => experience.sourceKey);
    expect(keys).toContain("race:r1:win");
    expect(keys).toContain("race:r2:win");
    expect(keys).toContain("race:r1:first-win");
    expect(keys).toContain("race:r1:first-podium");
    expect(keys).toContain("race:r1:first-point");
    expect(keys).toContain("race:r3:dnf");
    expect(keys).toContain("race:r2:win");
    expect(derived.filter((experience) => experience.sourceKey === "race:r2:first-win")).toHaveLength(0);
  });

  it("2) corrida não finalizada não gera vitória nem marcos", () => {
    const derived = deriveExperiences(
      facts({
        races: [
          {
            raceId: "r1",
            seasonId: "s1",
            seasonYear: 2026,
            round: 1,
            name: "GP Futuro",
            date: new Date("2026-12-01"),
            finished: false,
            position: 1,
            resultStatus: "Finished",
            points: 25,
          },
        ],
      }),
    );
    expect(derived).toHaveLength(0);
  });

  it("3) campeonato, team change e relationship event são derivados", () => {
    const derived = deriveExperiences(
      facts({
        standings: [{ seasonId: "s1", seasonYear: 2025, position: 1, points: 300, wins: 10 }],
        entries: [
          { seasonId: "s1", seasonYear: 2025, teamId: "t1", teamName: "Equipe A" },
          { seasonId: "s2", seasonYear: 2026, teamId: "t2", teamName: "Equipe B" },
        ],
        relationships: [
          {
            id: "rel1",
            kind: "TEAMMATE",
            state: "ENDED",
            displayName: "Colega",
            validFrom: new Date("2024-01-01"),
            validTo: new Date("2026-01-01"),
            updatedAt: new Date("2026-01-02"),
          },
        ],
      }),
    );
    const keys = derived.map((experience) => experience.sourceKey);
    expect(keys).toContain("season:s1:champion");
    expect(keys).toContain("team-change:s2:t2");
    expect(keys).toContain("relationship:rel1:started");
    expect(keys).toContain("relationship:rel1:ended");
    const championship = derived.find((experience) => experience.sourceKey === "season:s1:champion");
    expect(championship?.salience).toBe("CRITICAL");
  });

  it("4) título invalidado por correção gera SPORTING_DEFEAT determinística", () => {
    const derived = deriveExperiences(
      facts({ invalidatedChampionshipExperienceIds: ["exp-old-1"] }),
    );
    expect(derived).toHaveLength(1);
    expect(derived[0]).toMatchObject({
      experienceType: "SPORTING_DEFEAT",
      source: "TIMELINE_CORRECTION",
      sourceKey: "correction:exp-old-1:title-lost",
      salience: "HIGH",
    });
  });

  it("5) eventos futuros são filtrados pelo worldDate", () => {
    const derived = deriveExperiences(
      facts({
        races: [
          {
            raceId: "r1",
            seasonId: "s1",
            seasonYear: 2026,
            round: 9,
            name: "GP Futuro",
            date: new Date("2026-10-01"),
            finished: true,
            position: 1,
            resultStatus: "Finished",
            points: 25,
          },
        ],
      }),
    );
    const filtered = filterApplicableExperiences(derived, new Date("2026-06-01"));
    expect(filtered).toHaveLength(0);
    const unfiltered = filterApplicableExperiences(derived, new Date("2026-12-01"));
    expect(unfiltered.length).toBeGreaterThan(0);
  });

  it("6) determinismo: mesma entrada ⇒ mesma saída ordenada", () => {
    const input = facts({
      races: [
        {
          raceId: "r1",
          seasonId: "s1",
          seasonYear: 2025,
          round: 1,
          name: "GP A",
          date: new Date("2025-03-01"),
          finished: true,
          position: 1,
          resultStatus: "Finished",
          points: 25,
        },
      ],
      curated: [
        {
          sourceKey: "curated:test:1",
          experienceType: "PERSONAL_MILESTONE",
          title: "Marco pessoal",
          salience: "HIGH",
        },
      ],
    });
    const first = deriveExperiences(input);
    const second = deriveExperiences(input);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});

describe("memory projection rules", () => {
  it("7) primeira vitória vira memory HIGH; vitórias seguintes LOW", () => {
    const experiences = deriveExperiences(
      facts({
        races: [
          {
            raceId: "r1",
            seasonId: "s1",
            seasonYear: 2025,
            round: 1,
            name: "GP A",
            date: new Date("2025-03-01"),
            finished: true,
            position: 1,
            resultStatus: "Finished",
            points: 25,
          },
          {
            raceId: "r2",
            seasonId: "s1",
            seasonYear: 2025,
            round: 2,
            name: "GP B",
            date: new Date("2025-03-15"),
            finished: true,
            position: 1,
            resultStatus: "Finished",
            points: 25,
          },
        ],
      }),
    );
    const memories = projectMemories(experiences);
    const firstWin = memories.find((memory) => memory.ruleCode === "first-win-memory");
    expect(firstWin?.importance).toBe("HIGH");
    expect(firstWin?.memoryType).toBe("SPORTING_VICTORY");
    expect(firstWin?.content).toContain("primeira vitória");
    const win = memories.find((memory) => memory.ruleCode === "win-memory");
    expect(win?.importance).toBe("LOW");
    expect(win?.memoryType).toBe("SIGNIFICANT_RACE");
  });

  it("8) DNF e corrida comum NÃO viram memory", () => {
    const experiences = deriveExperiences(
      facts({
        races: [
          {
            raceId: "r1",
            seasonId: "s1",
            seasonYear: 2025,
            round: 1,
            name: "GP A",
            date: new Date("2025-03-01"),
            finished: true,
            position: 7,
            resultStatus: "Finished",
            points: 6,
          },
          {
            raceId: "r2",
            seasonId: "s1",
            seasonYear: 2025,
            round: 2,
            name: "GP B",
            date: new Date("2025-03-15"),
            finished: false,
            position: null,
            resultStatus: "DNF",
            points: 0,
          },
        ],
      }),
    );
    const memories = projectMemories(experiences);
    expect(memories.some((memory) => memory.experience.sourceKey === "race:r2:dnf")).toBe(false);
    expect(memories.some((memory) => memory.experience.sourceKey === "race:r1:first-point")).toBe(true);
  });

  it("9) championship vira memory CRITICAL; curated LOW é ignorada", () => {
    const experiences = deriveExperiences(
      facts({
        standings: [{ seasonId: "s1", seasonYear: 2025, position: 1, points: 300, wins: 10 }],
        curated: [
          {
            sourceKey: "curated:low",
            experienceType: "OTHER_RELEVANT_EXPERIENCE",
            title: "Detalhe pequeno",
            salience: "LOW",
          },
        ],
      }),
    );
    const memories = projectMemories(experiences);
    const title = memories.find((memory) => memory.memoryType === "CHAMPIONSHIP");
    expect(title?.importance).toBe("CRITICAL");
    expect(memories.some((memory) => memory.experience.sourceKey === "curated:low")).toBe(false);
  });

  it("10) derivedKey é estável e determinístico; render não usa LLM", () => {
    const experiences = deriveExperiences(
      facts({
        standings: [{ seasonId: "s1", seasonYear: 2025, position: 1, points: 300, wins: 10 }],
      }),
    );
    const first = projectMemories(experiences);
    const second = projectMemories(experiences);
    expect(first.map((memory) => memory.derivedKey)).toEqual(second.map((memory) => memory.derivedKey));
    expect(first[0]?.derivedKey).toBe("season:s1:champion:championship-memory");
    const decision = decideMemoryRule(
      { experienceType: "SIGNIFICANT_RACE", salience: "LOW" },
      { firstWinExperienceId: null },
    );
    expect(decision.derive).toBe(false);
    expect(renderMemory(experiences[0]!, "CHAMPIONSHIP")).toContain("Campeão mundial");
  });
});
