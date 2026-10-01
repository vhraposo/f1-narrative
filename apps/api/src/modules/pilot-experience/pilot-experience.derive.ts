import type {
  MemoryImportance,
  PilotExperienceSource,
  PilotExperienceType,
} from "@prisma/client";

export type RaceFact = {
  readonly raceId: string;
  readonly seasonId: string;
  readonly seasonYear: number;
  readonly round: number | null;
  readonly name: string;
  readonly date: Date | null;
  readonly finished: boolean;
  readonly position: number | null;
  readonly resultStatus: string | null;
  readonly points: number;
};

export type StandingFact = {
  readonly seasonId: string;
  readonly seasonYear: number;
  readonly position: number | null;
  readonly points: number | null;
  readonly wins: number | null;
};

export type EntryFact = {
  readonly seasonId: string;
  readonly seasonYear: number;
  readonly teamId: string | null;
  readonly teamName: string | null;
};

export type RelationshipFact = {
  readonly id: string;
  readonly kind: string;
  readonly state: string;
  readonly displayName: string;
  readonly validFrom: Date | null;
  readonly validTo: Date | null;
  readonly updatedAt: Date;
};

export type NarrativeEventFact = {
  readonly id: string;
  readonly title: string;
  readonly importance: string;
  readonly worldDate: Date | null;
};

export type CuratedExperienceInput = {
  readonly sourceKey: string;
  readonly experienceType: PilotExperienceType;
  readonly title: string;
  readonly summary?: string | null;
  readonly salience: MemoryImportance;
  readonly occurredAt?: Date | null;
  readonly seasonYear?: number | null;
};

export type PilotSportFacts = {
  readonly races: readonly RaceFact[];
  readonly standings: readonly StandingFact[];
  readonly entries: readonly EntryFact[];
  readonly relationships: readonly RelationshipFact[];
  readonly narrativeEvents: readonly NarrativeEventFact[];
  readonly invalidatedChampionshipExperienceIds: readonly string[];
  readonly curated: readonly CuratedExperienceInput[];
};

export type DerivedExperience = {
  readonly experienceType: PilotExperienceType;
  readonly source: PilotExperienceSource;
  readonly sourceKey: string;
  readonly seasonYear: number | null;
  readonly seasonId: string | null;
  readonly raceId: string | null;
  readonly eventId: string | null;
  readonly occurredAt: Date | null;
  readonly salience: MemoryImportance;
  readonly title: string;
  readonly summary: string | null;
};

const SALIENCE_RANK: Record<MemoryImportance, number> = {
  LOW: 1,
  MEDIUM: 2,
  HIGH: 3,
  CRITICAL: 4,
};

export function compareSalience(a: MemoryImportance, b: MemoryImportance): number {
  return SALIENCE_RANK[b] - SALIENCE_RANK[a];
}

function raceOrder(race: RaceFact): [number, number] {
  return [race.seasonYear, race.round ?? 999];
}

function formatRaceLabel(race: RaceFact): string {
  return `${race.name} ${race.seasonYear}`.trim();
}

export function deriveExperiences(facts: PilotSportFacts): DerivedExperience[] {
  const derived: DerivedExperience[] = [];

  const finished = facts.races.filter((race) => race.finished);
  const ordered = [...finished].sort((a, b) => {
    const [ay, ar] = raceOrder(a);
    const [by, br] = raceOrder(b);
    return ay - by || ar - br || a.raceId.localeCompare(b.raceId);
  });

  for (const race of ordered) {
    if (race.position === 1) {
      derived.push({
        experienceType: "SPORTING_VICTORY",
        source: "RACE_RESULT",
        sourceKey: `race:${race.raceId}:win`,
        seasonYear: race.seasonYear,
        seasonId: race.seasonId,
        raceId: race.raceId,
        eventId: null,
        occurredAt: race.date,
        salience: "HIGH",
        title: `Vitória em ${formatRaceLabel(race)}`,
        summary: `Venceu ${formatRaceLabel(race)}.`,
      });
    }
    if (race.resultStatus !== null && /dnf|retir|desclassific|disqualif|accident|colis/i.test(race.resultStatus)) {
      derived.push({
        experienceType: "SIGNIFICANT_RACE",
        source: "RACE_RESULT",
        sourceKey: `race:${race.raceId}:dnf`,
        seasonYear: race.seasonYear,
        seasonId: race.seasonId,
        raceId: race.raceId,
        eventId: null,
        occurredAt: race.date,
        salience: "LOW",
        title: `Abandono em ${formatRaceLabel(race)}`,
        summary: `Não completou ${formatRaceLabel(race)} (${race.resultStatus}).`,
      });
    }
  }

  const firstPoint = ordered.find((race) => race.points > 0);
  if (firstPoint) {
    derived.push({
      experienceType: "CAREER_MILESTONE",
      source: "RACE_RESULT",
      sourceKey: `race:${firstPoint.raceId}:first-point`,
      seasonYear: firstPoint.seasonYear,
      seasonId: firstPoint.seasonId,
      raceId: firstPoint.raceId,
      eventId: null,
      occurredAt: firstPoint.date,
      salience: "MEDIUM",
      title: `Primeiros pontos em ${formatRaceLabel(firstPoint)}`,
      summary: "Primeiro resultado com pontos na carreira dentro deste Universe.",
    });
  }
  const firstPodium = ordered.find((race) => race.position !== null && race.position <= 3);
  if (firstPodium) {
    derived.push({
      experienceType: "CAREER_MILESTONE",
      source: "RACE_RESULT",
      sourceKey: `race:${firstPodium.raceId}:first-podium`,
      seasonYear: firstPodium.seasonYear,
      seasonId: firstPodium.seasonId,
      raceId: firstPodium.raceId,
      eventId: null,
      occurredAt: firstPodium.date,
      salience: "MEDIUM",
      title: `Primeiro pódio em ${formatRaceLabel(firstPodium)}`,
      summary: `Primeiro pódio (P${firstPodium.position}).`,
    });
  }
  const firstWin = ordered.find((race) => race.position === 1);
  if (firstWin) {
    derived.push({
      experienceType: "CAREER_MILESTONE",
      source: "RACE_RESULT",
      sourceKey: `race:${firstWin.raceId}:first-win`,
      seasonYear: firstWin.seasonYear,
      seasonId: firstWin.seasonId,
      raceId: firstWin.raceId,
      eventId: null,
      occurredAt: firstWin.date,
      salience: "HIGH",
      title: `Primeira vitória em ${formatRaceLabel(firstWin)}`,
      summary: "Primeira vitória na carreira dentro deste Universe.",
    });
  }

  for (const standing of facts.standings) {
    if (standing.position === 1) {
      derived.push({
        experienceType: "CHAMPIONSHIP",
        source: "STANDING",
        sourceKey: `season:${standing.seasonId}:champion`,
        seasonYear: standing.seasonYear,
        seasonId: standing.seasonId,
        raceId: null,
        eventId: null,
        occurredAt: null,
        salience: "CRITICAL",
        title: `Campeão mundial em ${standing.seasonYear}`,
        summary: `Título mundial conquistado neste Universe (${standing.points ?? "—"} pontos).`,
      });
    }
  }

  for (const invalidatedId of facts.invalidatedChampionshipExperienceIds) {
    derived.push({
      experienceType: "SPORTING_DEFEAT",
      source: "TIMELINE_CORRECTION",
      sourceKey: `correction:${invalidatedId}:title-lost`,
      seasonYear: null,
      seasonId: null,
      raceId: null,
      eventId: null,
      occurredAt: null,
      salience: "HIGH",
      title: "Título não se confirmou após correção histórica",
      summary: "Um título anteriormente registrado foi invalidado por uma correção da Timeline.",
    });
  }

  const entries = [...facts.entries].sort(
    (a, b) => a.seasonYear - b.seasonYear || a.seasonId.localeCompare(b.seasonId),
  );
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (!previous || !current) continue;
    if (previous.teamId && current.teamId && previous.teamId !== current.teamId) {
      derived.push({
        experienceType: "TEAM_CHANGE",
        source: "RACE_RESULT",
        sourceKey: `team-change:${current.seasonId}:${current.teamId}`,
        seasonYear: current.seasonYear,
        seasonId: current.seasonId,
        raceId: null,
        eventId: null,
        occurredAt: null,
        salience: "MEDIUM",
        title: `Mudança de equipe para ${current.teamName ?? "nova equipe"} em ${current.seasonYear}`,
        summary: `Deixou ${previous.teamName ?? "equipe anterior"} e passou a correr pela ${current.teamName ?? "nova equipe"}.`,
      });
    }
  }

  for (const relationship of facts.relationships) {
    const label = relationship.displayName;
    derived.push({
      experienceType: "RELATIONSHIP_EVENT",
      source: "RELATIONSHIP",
      sourceKey: `relationship:${relationship.id}:started`,
      seasonYear: relationship.validFrom ? relationship.validFrom.getUTCFullYear() : null,
      seasonId: null,
      raceId: null,
      eventId: null,
      occurredAt: relationship.validFrom,
      salience: "MEDIUM",
      title: `Relação pública registrada: ${label}`,
      summary: `Vínculo (${relationship.kind}) registrado neste Universe.`,
    });
    if (relationship.state === "ENDED") {
      derived.push({
        experienceType: "RELATIONSHIP_EVENT",
        source: "RELATIONSHIP",
        sourceKey: `relationship:${relationship.id}:ended`,
        seasonYear: relationship.validTo ? relationship.validTo.getUTCFullYear() : null,
        seasonId: null,
        raceId: null,
        eventId: null,
        occurredAt: relationship.validTo,
        salience: "MEDIUM",
        title: `Relação pública encerrada: ${label}`,
        summary: `Vínculo (${relationship.kind}) encerrado neste Universe.`,
      });
    }
  }

  for (const event of facts.narrativeEvents) {
    const salience: MemoryImportance = event.importance === "CRITICAL" ? "HIGH" : "MEDIUM";
    derived.push({
      experienceType: "NARRATIVE_EVENT",
      source: "UNIVERSE_EVENT",
      sourceKey: `event:${event.id}`,
      seasonYear: event.worldDate ? event.worldDate.getUTCFullYear() : null,
      seasonId: null,
      raceId: null,
      eventId: event.id,
      occurredAt: event.worldDate,
      salience,
      title: event.title,
      summary: null,
    });
  }

  for (const curated of facts.curated) {
    derived.push({
      experienceType: curated.experienceType,
      source: "CURATED",
      sourceKey: curated.sourceKey,
      seasonYear: curated.seasonYear ?? null,
      seasonId: null,
      raceId: null,
      eventId: null,
      occurredAt: curated.occurredAt ?? null,
      salience: curated.salience,
      title: curated.title,
      summary: curated.summary ?? null,
    });
  }

  return derived;
}

export function filterApplicableExperiences(
  experiences: readonly DerivedExperience[],
  worldDate: Date | null,
): DerivedExperience[] {
  if (!worldDate) return [...experiences];
  return experiences.filter(
    (experience) =>
      experience.occurredAt === null || experience.occurredAt.getTime() <= worldDate.getTime(),
  );
}
