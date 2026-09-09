import { prisma } from "../../infrastructure/database/prisma.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import type { Role } from "@prisma/client";
import type { ReconciliationKind } from "./reconciliation.schemas.js";

export class ReconciliationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "ReconciliationError";
  }
}

export interface ReconciliationQuery {
  source: string;
  externalId?: string;
  seasonYear?: number;
  round?: number;
}

export interface Actor {
  id: string;
  role?: Role | null;
}

export interface Candidate {
  id: string;
  label: string;
  score: number;
}

export interface CandidateListing {
  external: {
    kind: ReconciliationKind;
    source: string;
    label: string;
  };
  currentBinding: {
    id: string;
    confidence: "SUGGESTED" | "CONFIRMED";
    targetLabel: string | null;
  } | null;
  candidates: Candidate[];
}

export interface BindingView {
  id: string;
  kind: ReconciliationKind;
  source: string;
  externalLabel: string;
  targetLabel: string;
  confidence: "SUGGESTED" | "CONFIRMED";
  boundAt: Date;
  boundBy: Role | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RosterDiffRow {
  external: {
    id: string;
    externalId: string;
    name: string;
    number: number | null;
    teamExternalId: string | null;
    teamNameSnapshot: string | null;
    role: string | null;
  };
  universe: {
    id: string;
    driverProfileId: string;
    characterId: string;
    characterName: string;
    teamName: string | null;
    seat: number | null;
    number: number | null;
    role: string | null;
  } | null;
  status: "MATCHED" | "CONFLICT" | "SUGGESTED" | "UNMATCHED";
  differences: string[];
  binding: { id: string; confidence: "SUGGESTED" | "CONFIRMED" } | null;
  suggestions: Candidate[];
}

export interface RosterDiff {
  seasonId: string;
  externalSeason: { id: string; year: number } | null;
  rows: RosterDiffRow[];
  universeOnly: {
    id: string;
    driverProfileId: string;
    characterId: string;
    characterName: string;
    teamName: string | null;
    seat: number | null;
    number: number | null;
    role: string | null;
  }[];
  seatOccupancy: {
    team: string;
    seat: number;
    external: string | null;
    universe: string | null;
  }[];
}

export interface ChampionshipDiffRow {
  external: {
    id: string;
    externalId: string;
    name: string;
    position: number | null;
    points: number | null;
    wins: number | null;
    podiums: number | null;
  };
  universe: {
    id: string;
    characterName: string;
    position: number | null;
    points: number;
    wins: number;
    podiums: number;
  } | null;
  status: "MATCHED" | "CONFLICT" | "SUGGESTED" | "UNMATCHED";
  differences: string[];
  binding: { id: string; confidence: "SUGGESTED" | "CONFIRMED" } | null;
  suggestions: Candidate[];
}

export interface ChampionshipDiff {
  seasonId: string;
  externalSeason: { id: string; year: number } | null;
  rows: ChampionshipDiffRow[];
  universeOnly: {
    id: string;
    characterName: string;
    position: number | null;
    points: number;
    wins: number;
    podiums: number;
  }[];
}

export interface ResultsDiffRow {
  external: {
    id: string;
    externalId: string;
    name: string;
    position: number | null;
    points: number | null;
    grid: number | null;
    fastestLap: boolean | null;
    status: string | null;
  };
  universe: {
    id: string;
    characterName: string;
    position: number | null;
    points: number;
    grid: number | null;
    fastestLap: boolean;
    status: string | null;
  } | null;
  status: "MATCHED" | "CONFLICT" | "SUGGESTED" | "UNMATCHED";
  differences: string[];
  binding: { id: string; confidence: "SUGGESTED" | "CONFIRMED" } | null;
  suggestions: Candidate[];
}

export interface ResultsDiff {
  raceId: string;
  externalRace: { id: string; seasonYear: number; round: number } | null;
  rows: ResultsDiffRow[];
  universeOnly: {
    id: string;
    characterName: string;
    position: number | null;
    points: number;
    grid: number | null;
    fastestLap: boolean;
    status: string | null;
  }[];
}

type ResolvedExternal = {
  kind: ReconciliationKind;
  source: string;
  label: string;
  seasonYear?: number;
  externalDriverId?: string;
  externalTeamId?: string;
  externalSeasonId?: string;
  externalRaceId?: string;
  externalDriverSeasonId?: string;
  externalResultId?: string;
  externalStandingId?: string;
};

type Terminated = "SUGGESTED" | "CONFIRMED";

const entryInclude = {
  driverProfile: {
    include: {
      character: { select: { id: true, name: true, nationality: true } },
    },
  },
  team: { select: { id: true, name: true, shortName: true } },
} as const;

function normalizeName(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.8;
  const left = na.split(" ");
  const right = nb.split(" ");
  const rightSet = new Set(right);
  const common = left.filter((token) => rightSet.has(token)).length;
  if (common > 0) {
    return 0.5 + (0.3 * common) / Math.max(left.length, right.length);
  }
  return 0;
}

function teamsEqual(
  snapshot: string | null,
  externalId: string | null,
  name: string | null | undefined,
  shortName: string | null | undefined,
): boolean {
  const snap = normalizeName(snapshot);
  const ext = normalizeName(externalId);
  const nm = normalizeName(name);
  const short = normalizeName(shortName);
  return (
    (snap !== "" && (snap === nm || snap === short)) ||
    (ext !== "" && (ext === nm || ext === short))
  );
}

export class ReconciliationService {
  constructor(private readonly defaultSource: string = JOLPICA_SOURCE) {}

  async resolveExternal(
    kind: ReconciliationKind,
    query: ReconciliationQuery,
  ): Promise<ResolvedExternal> {
    const source = query.source || this.defaultSource;
    switch (kind) {
      case "DRIVER": {
        if (!query.externalId) {
          throw new ReconciliationError("NOT_FOUND", "Piloto externo não encontrado", 404);
        }
        const driver = await prisma.externalDriver.findUnique({
          where: { source_externalId: { source, externalId: query.externalId } },
          select: { id: true, name: true },
        });
        if (!driver) {
          throw new ReconciliationError("NOT_FOUND", "Piloto externo não encontrado", 404);
        }
        return { kind, source, label: driver.name, externalDriverId: driver.id };
      }
      case "TEAM": {
        if (!query.externalId) {
          throw new ReconciliationError("NOT_FOUND", "Equipe externa não encontrada", 404);
        }
        const team = await prisma.externalTeam.findUnique({
          where: { source_externalId: { source, externalId: query.externalId } },
          select: { id: true, name: true },
        });
        if (!team) {
          throw new ReconciliationError("NOT_FOUND", "Equipe externa não encontrada", 404);
        }
        return { kind, source, label: team.name, externalTeamId: team.id };
      }
      case "SEASON": {
        const year = query.seasonYear ?? query.externalId;
        if (!year || !Number.isInteger(Number(year))) {
          throw new ReconciliationError("NOT_FOUND", "Temporada externa não encontrada", 404);
        }
        const season = await prisma.externalSeason.findUnique({
          where: { source_year: { source, year: Number(year) } },
          select: { id: true, year: true },
        });
        if (!season) {
          throw new ReconciliationError("NOT_FOUND", "Temporada externa não encontrada", 404);
        }
        return {
          kind,
          source,
          label: String(season.year),
          seasonYear: season.year,
          externalSeasonId: season.id,
        };
      }
      case "RACE": {
        if (query.seasonYear == null || query.round == null) {
          throw new ReconciliationError("NOT_FOUND", "Corrida externa não encontrada", 404);
        }
        const race = await prisma.externalRace.findUnique({
          where: {
            source_seasonYear_round: {
              source,
              seasonYear: query.seasonYear,
              round: query.round,
            },
          },
          select: { id: true, grandPrix: true, name: true },
        });
        if (!race) {
          throw new ReconciliationError("NOT_FOUND", "Corrida externa não encontrada", 404);
        }
        return {
          kind,
          source,
          label: race.grandPrix ?? race.name ?? String(query.round),
          seasonYear: query.seasonYear,
          externalRaceId: race.id,
        };
      }
      case "DRIVER_SEASON": {
        if (query.seasonYear == null) {
          throw new ReconciliationError(
            "NOT_FOUND",
            "Participação externa do piloto não encontrada",
            404,
          );
        }
        const driver = await prisma.externalDriver.findUnique({
          where: { source_externalId: { source, externalId: query.externalId! } },
          select: { id: true, name: true },
        });
        if (!driver) {
          throw new ReconciliationError("NOT_FOUND", "Piloto externo não encontrado", 404);
        }
        const entry = await prisma.externalDriverSeason.findUnique({
          where: {
            source_externalDriverId_seasonYear: {
              source,
              externalDriverId: driver.id,
              seasonYear: query.seasonYear,
            },
          },
          select: { id: true },
        });
        if (!entry) {
          throw new ReconciliationError(
            "NOT_FOUND",
            "Participação externa do piloto não encontrada",
            404,
          );
        }
        return {
          kind,
          source,
          label: `${driver.name} ${query.seasonYear}`,
          seasonYear: query.seasonYear,
          externalDriverSeasonId: entry.id,
        };
      }
      case "RESULT": {
        if (query.seasonYear == null || query.round == null) {
          throw new ReconciliationError("NOT_FOUND", "Resultado externo não encontrado", 404);
        }
        const driver = await prisma.externalDriver.findUnique({
          where: { source_externalId: { source, externalId: query.externalId! } },
          select: { id: true, name: true },
        });
        if (!driver) {
          throw new ReconciliationError("NOT_FOUND", "Piloto externo não encontrado", 404);
        }
        const race = await prisma.externalRace.findUnique({
          where: {
            source_seasonYear_round: {
              source,
              seasonYear: query.seasonYear,
              round: query.round,
            },
          },
          select: { id: true },
        });
        if (!race) {
          throw new ReconciliationError("NOT_FOUND", "Corrida externa não encontrada", 404);
        }
        const result = await prisma.externalResult.findUnique({
          where: {
            source_externalRaceId_externalDriverId: {
              source,
              externalRaceId: race.id,
              externalDriverId: driver.id,
            },
          },
          select: { id: true },
        });
        if (!result) {
          throw new ReconciliationError("NOT_FOUND", "Resultado externo não encontrado", 404);
        }
        return {
          kind,
          source,
          label: `${driver.name} rodada ${query.round ?? ""}`,
          seasonYear: query.seasonYear,
          externalResultId: result.id,
        };
      }
      case "STANDING": {
        if (query.seasonYear == null) {
          throw new ReconciliationError("NOT_FOUND", "Classificação externa não encontrada", 404);
        }
        const driver = await prisma.externalDriver.findUnique({
          where: { source_externalId: { source, externalId: query.externalId! } },
          select: { id: true, name: true },
        });
        if (!driver) {
          throw new ReconciliationError("NOT_FOUND", "Piloto externo não encontrado", 404);
        }
        const standing = await prisma.externalStanding.findUnique({
          where: {
            source_seasonYear_externalDriverId: {
              source,
              seasonYear: query.seasonYear,
              externalDriverId: driver.id,
            },
          },
          select: { id: true },
        });
        if (!standing) {
          throw new ReconciliationError("NOT_FOUND", "Classificação externa não encontrada", 404);
        }
        return {
          kind,
          source,
          label: `${driver.name} ${query.seasonYear}`,
          seasonYear: query.seasonYear,
          externalStandingId: standing.id,
        };
      }
    }
  }

  async getBinding(kind: ReconciliationKind, resolved: ResolvedExternal) {
    switch (kind) {
      case "DRIVER":
        return prisma.externalBindingDriver.findUnique({
          where: { externalDriverId: resolved.externalDriverId! },
        });
      case "TEAM":
        return prisma.externalBindingTeam.findUnique({
          where: { externalTeamId: resolved.externalTeamId! },
        });
      case "SEASON":
        return prisma.externalBindingSeason.findUnique({
          where: { externalSeasonId: resolved.externalSeasonId! },
        });
      case "RACE":
        return prisma.externalBindingRace.findUnique({
          where: { externalRaceId: resolved.externalRaceId! },
        });
      case "DRIVER_SEASON":
        return prisma.externalBindingDriverSeason.findUnique({
          where: { externalDriverSeasonId: resolved.externalDriverSeasonId! },
        });
      case "RESULT":
        return prisma.externalBindingResult.findUnique({
          where: { externalResultId: resolved.externalResultId! },
        });
      case "STANDING":
        return prisma.externalBindingStanding.findUnique({
          where: { externalStandingId: resolved.externalStandingId! },
        });
    }
  }

  async bindingTargetLabel(kind: ReconciliationKind, binding: unknown): Promise<string> {
    switch (kind) {
      case "DRIVER":
        return this.characterLabel((binding as { characterId: string }).characterId);
      case "TEAM":
        return this.teamLabel((binding as { teamId: string }).teamId);
      case "SEASON":
        return this.seasonLabel((binding as { seasonId: string }).seasonId);
      case "RACE":
        return this.raceLabel((binding as { raceId: string }).raceId);
      case "DRIVER_SEASON":
        return this.entryLabel((binding as { seasonDriverEntryId: string }).seasonDriverEntryId);
      case "RESULT":
        return this.resultLabel((binding as { raceResultId: string }).raceResultId);
      case "STANDING":
        return this.standingLabel(
          (binding as { championshipStandingId: string }).championshipStandingId,
        );
    }
  }

  async driverProfileOfCharacter(characterId: string): Promise<string | null> {
    const character = await prisma.character.findUnique({
      where: { id: characterId },
      select: { driverProfile: { select: { id: true } } },
    });
    return character?.driverProfile?.id ?? null;
  }

  private async characterLabel(id: string): Promise<string> {
    const character = await prisma.character.findUnique({
      where: { id },
      select: { name: true },
    });
    return character?.name ?? id;
  }

  private async teamLabel(id: string): Promise<string> {
    const team = await prisma.team.findUnique({ where: { id }, select: { name: true } });
    return team?.name ?? id;
  }

  private async seasonLabel(id: string): Promise<string> {
    const season = await prisma.season.findUnique({
      where: { id },
      select: { year: true },
    });
    return season ? String(season.year) : id;
  }

  private async raceLabel(id: string): Promise<string> {
    const race = await prisma.race.findUnique({ where: { id }, select: { name: true } });
    return race?.name ?? id;
  }

  private async entryLabel(id: string): Promise<string> {
    const entry = await prisma.seasonDriverEntry.findUnique({
      where: { id },
      include: entryInclude,
    });
    if (!entry) return id;
    return `${entry.driverProfile.character.name} — ${entry.team?.name ?? "sem equipe"}`;
  }

  private async resultLabel(id: string): Promise<string> {
    const result = await prisma.raceResult.findUnique({
      where: { id },
      include: { driverProfile: { include: { character: { select: { name: true } } } } },
    });
    return result?.driverProfile.character.name ?? id;
  }

  private async standingLabel(id: string): Promise<string> {
    const standing = await prisma.championshipStanding.findUnique({
      where: { id },
      include: { driverProfile: { include: { character: { select: { name: true } } } } },
    });
    return standing?.driverProfile.character.name ?? id;
  }

  async candidatesForDriver(
    userId: string,
    external: { name: string; fullName?: string | null; nationality?: string | null },
  ): Promise<Candidate[]> {
    const scope = userId
      ? { OR: [{ userId }, { userId: null }] }
      : {};
    const characters = await prisma.character.findMany({
      where: { ...scope, driverProfile: { isNot: null } },
      select: { id: true, name: true },
    });
    const boundCharacterIds = new Set(
      (await prisma.externalBindingDriver.findMany({ select: { characterId: true } })).map(
        (b) => b.characterId,
      ),
    );
    return characters
      .filter((character) => !boundCharacterIds.has(character.id))
      .map((character) => ({
        id: character.id,
        label: character.name,
        score: Math.max(
          nameSimilarity(external.name, character.name),
          nameSimilarity(external.fullName, character.name),
        ),
      }))
      .filter((candidate) => candidate.score >= 0.5)
      .sort((a, b) => b.score - a.score);
  }

  async candidatesForTeam(
    userId: string,
    external: { name: string; shortName?: string | null },
  ): Promise<Candidate[]> {
    const teams = await prisma.team.findMany({
      where: { userId },
      select: { id: true, name: true, shortName: true },
    });
    const boundTeamIds = new Set(
      (await prisma.externalBindingTeam.findMany({ select: { teamId: true } })).map(
        (b) => b.teamId,
      ),
    );
    return teams
      .filter((team) => !boundTeamIds.has(team.id))
      .map((team) => ({
        id: team.id,
        label: team.shortName ? `${team.name} (${team.shortName})` : team.name,
        score: Math.max(
          nameSimilarity(external.name, team.name),
          nameSimilarity(external.shortName, team.shortName),
          nameSimilarity(external.name, team.shortName),
        ),
      }))
      .filter((candidate) => candidate.score >= 0.5)
      .sort((a, b) => b.score - a.score);
  }

  async candidatesForSeason(external: { year: number }): Promise<Candidate[]> {
    const seasons = await prisma.season.findMany({
      where: { year: external.year },
      select: { id: true, year: true, name: true },
    });
    const boundSeasonIds = new Set(
      (await prisma.externalBindingSeason.findMany({ select: { seasonId: true } })).map(
        (b) => b.seasonId,
      ),
    );
    return seasons
      .filter((season) => !boundSeasonIds.has(season.id))
      .map((season) => ({
        id: season.id,
        label: season.name ?? String(season.year),
        score: 1,
      }));
  }

  async candidatesForRace(
    external: { seasonYear: number; round: number; grandPrix?: string | null; name?: string | null },
  ): Promise<Candidate[]> {
    const seasonBinding = await prisma.externalBindingSeason.findFirst({
      where: {
        externalSeason: { year: external.seasonYear },
        confidence: "CONFIRMED",
      },
      select: { seasonId: true },
    });
    if (!seasonBinding) return [];
    const races = await prisma.race.findMany({
      where: { seasonId: seasonBinding.seasonId },
      select: { id: true, name: true, round: true },
    });
    const boundRaceIds = new Set(
      (await prisma.externalBindingRace.findMany({ select: { raceId: true } })).map(
        (b) => b.raceId,
      ),
    );
    return races
      .filter((race) => !boundRaceIds.has(race.id))
      .map((race) => ({
        id: race.id,
        label: `${race.name}${race.round != null ? ` (rodada ${race.round})` : ""}`,
        score:
          race.round === external.round
            ? 1
            : Math.max(
                nameSimilarity(external.grandPrix, race.name),
                nameSimilarity(external.name, race.name),
              ),
      }))
      .filter((candidate) => candidate.score >= 0.5)
      .sort((a, b) => b.score - a.score);
  }

  async candidatesForDriverSeason(
    userId: string,
    external: {
      externalDriverId: string;
      seasonYear: number;
      teamExternalId?: string | null;
      teamNameSnapshot?: string | null;
    },
  ): Promise<Candidate[]> {
    const seasonBinding = await prisma.externalBindingSeason.findFirst({
      where: {
        externalSeason: { year: external.seasonYear },
        confidence: "CONFIRMED",
      },
      select: { seasonId: true },
    });
    const driverBinding = await prisma.externalBindingDriver.findFirst({
      where: { externalDriverId: external.externalDriverId, confidence: "CONFIRMED" },
      select: { characterId: true },
    });
    if (!seasonBinding || !driverBinding) return [];
    const driverProfileId = await this.driverProfileOfCharacter(driverBinding.characterId);
    if (!driverProfileId) return [];
    const entries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: seasonBinding.seasonId, driverProfileId },
      select: { id: true, team: { select: { name: true, shortName: true } } },
    });
    const boundEntryIds = new Set(
      (
        await prisma.externalBindingDriverSeason.findMany({ select: { seasonDriverEntryId: true } })
      ).map((b) => b.seasonDriverEntryId),
    );
    return entries
      .filter((entry) => !boundEntryIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        label: entry.team?.name ?? "Entrada sem equipe",
        score: Math.max(
          nameSimilarity(external.teamExternalId, entry.team?.name),
          nameSimilarity(external.teamExternalId, entry.team?.shortName),
          nameSimilarity(external.teamNameSnapshot, entry.team?.name),
        ),
      }))
      .filter((candidate) => candidate.score >= 0.5)
      .sort((a, b) => b.score - a.score);
  }

  async candidatesForResult(
    external: { externalRaceId: string; externalDriverId: string },
  ): Promise<Candidate[]> {
    const raceBinding = await prisma.externalBindingRace.findFirst({
      where: { externalRaceId: external.externalRaceId, confidence: "CONFIRMED" },
      select: { raceId: true },
    });
    const driverBinding = await prisma.externalBindingDriver.findFirst({
      where: { externalDriverId: external.externalDriverId, confidence: "CONFIRMED" },
      select: { characterId: true },
    });
    if (!raceBinding || !driverBinding) return [];
    const driverProfileId = await this.driverProfileOfCharacter(driverBinding.characterId);
    if (!driverProfileId) return [];
    const result = await prisma.raceResult.findUnique({
      where: {
        raceId_driverProfileId: {
          raceId: raceBinding.raceId,
          driverProfileId,
        },
      },
      select: { id: true },
    });
    if (!result) return [];
    const bound = await prisma.externalBindingResult.findUnique({
      where: { raceResultId: result.id },
      select: { id: true },
    });
    if (bound) return [];
    return [{ id: result.id, label: "Resultado identificado pela corrida e piloto vinculados", score: 1 }];
  }

  async candidatesForStanding(
    external: { seasonYear: number; externalDriverId: string },
  ): Promise<Candidate[]> {
    const seasonBinding = await prisma.externalBindingSeason.findFirst({
      where: {
        externalSeason: { year: external.seasonYear },
        confidence: "CONFIRMED",
      },
      select: { seasonId: true },
    });
    const driverBinding = await prisma.externalBindingDriver.findFirst({
      where: { externalDriverId: external.externalDriverId, confidence: "CONFIRMED" },
      select: { characterId: true },
    });
    if (!seasonBinding || !driverBinding) return [];
    const driverProfileId = await this.driverProfileOfCharacter(driverBinding.characterId);
    if (!driverProfileId) return [];
    const standing = await prisma.championshipStanding.findUnique({
      where: {
        seasonId_driverProfileId: {
          seasonId: seasonBinding.seasonId,
          driverProfileId,
        },
      },
      select: { id: true },
    });
    if (!standing) return [];
    const bound = await prisma.externalBindingStanding.findUnique({
      where: { championshipStandingId: standing.id },
      select: { id: true },
    });
    if (bound) return [];
    return [{ id: standing.id, label: "Classificação identificada pela temporada e piloto vinculados", score: 1 }];
  }

  private async candidatesOf(
    kind: ReconciliationKind,
    resolved: ResolvedExternal,
    userId: string,
  ): Promise<Candidate[]> {
    switch (kind) {
      case "DRIVER":
        return this.candidatesForDriver(userId, { name: resolved.label });
      case "TEAM":
        return this.candidatesForTeam(userId, { name: resolved.label });
      case "SEASON":
        return this.candidatesForSeason({ year: Number(resolved.label) });
      case "RACE": {
        const race = await prisma.externalRace.findUnique({
          where: { id: resolved.externalRaceId! },
          select: { seasonYear: true, round: true, grandPrix: true, name: true },
        });
        return race ? this.candidatesForRace(race) : [];
      }
      case "DRIVER_SEASON": {
        const ext = await prisma.externalDriverSeason.findUnique({
          where: { id: resolved.externalDriverSeasonId! },
          select: {
            externalDriverId: true,
            seasonYear: true,
            teamExternalId: true,
            teamNameSnapshot: true,
          },
        });
        return ext ? this.candidatesForDriverSeason(userId, ext) : [];
      }
      case "RESULT": {
        const ext = await prisma.externalResult.findUnique({
          where: { id: resolved.externalResultId! },
          select: { externalRaceId: true, externalDriverId: true },
        });
        return ext ? this.candidatesForResult(ext) : [];
      }
      case "STANDING": {
        const ext = await prisma.externalStanding.findUnique({
          where: { id: resolved.externalStandingId! },
          select: { seasonYear: true, externalDriverId: true },
        });
        return ext ? this.candidatesForStanding(ext) : [];
      }
    }
  }

  async listCandidates(
    userId: string,
    kind: ReconciliationKind,
    query: ReconciliationQuery,
  ): Promise<CandidateListing> {
    const resolved = await this.resolveExternal(kind, query);
    const binding = await this.getBinding(kind, resolved);
    const currentBinding = binding
      ? {
          id: binding.id,
          confidence: binding.confidence,
          targetLabel: await this.bindingTargetLabel(kind, binding),
        }
      : null;
    return {
      external: { kind, source: resolved.source, label: resolved.label },
      currentBinding,
      candidates: await this.candidatesOf(kind, resolved, userId),
    };
  }

  async suggestBinding(
    actor: Actor,
    kind: ReconciliationKind,
    query: ReconciliationQuery,
    candidateId: string,
  ) {
    const resolved = await this.resolveExternal(kind, query);
    const existing = await this.getBinding(kind, resolved);
    if (existing) {
      throw new ReconciliationError(
        "ALREADY_BOUND",
        "O registro externo já possui um vínculo. Desvincule antes de sugerir outro",
        409,
      );
    }
    const candidates = await this.candidatesOf(kind, resolved, actor.id);
    if (!candidates.some((candidate) => candidate.id === candidateId)) {
      throw new ReconciliationError(
        "INVALID_CANDIDATE",
        "O candidato informado não corresponde a uma sugestão válida",
        400,
      );
    }
    await this.createSuggestion(kind, resolved, candidateId);
    return this.getBinding(kind, resolved);
  }

  private async createSuggestion(
    kind: ReconciliationKind,
    resolved: ResolvedExternal,
    candidateId: string,
  ) {
    switch (kind) {
      case "DRIVER":
        return prisma.externalBindingDriver.create({
          data: {
            externalDriverId: resolved.externalDriverId!,
            characterId: candidateId,
            confidence: "SUGGESTED",
          },
        });
      case "TEAM":
        return prisma.externalBindingTeam.create({
          data: {
            externalTeamId: resolved.externalTeamId!,
            teamId: candidateId,
            confidence: "SUGGESTED",
          },
        });
      case "SEASON":
        return prisma.externalBindingSeason.create({
          data: {
            externalSeasonId: resolved.externalSeasonId!,
            seasonId: candidateId,
            confidence: "SUGGESTED",
          },
        });
      case "RACE":
        return prisma.externalBindingRace.create({
          data: {
            externalRaceId: resolved.externalRaceId!,
            raceId: candidateId,
            confidence: "SUGGESTED",
          },
        });
      case "DRIVER_SEASON":
        return prisma.externalBindingDriverSeason.create({
          data: {
            externalDriverSeasonId: resolved.externalDriverSeasonId!,
            seasonDriverEntryId: candidateId,
            confidence: "SUGGESTED",
          },
        });
      case "RESULT":
        return prisma.externalBindingResult.create({
          data: {
            externalResultId: resolved.externalResultId!,
            raceResultId: candidateId,
            confidence: "SUGGESTED",
          },
        });
      case "STANDING":
        return prisma.externalBindingStanding.create({
          data: {
            externalStandingId: resolved.externalStandingId!,
            championshipStandingId: candidateId,
            confidence: "SUGGESTED",
          },
        });
    }
  }

  async confirmBinding(actor: Actor, kind: ReconciliationKind, query: ReconciliationQuery) {
    const resolved = await this.resolveExternal(kind, query);
    const existing = await this.getBinding(kind, resolved);
    if (existing) {
      if (existing.confidence === "CONFIRMED") {
        return existing;
      }
      await this.requireDerivedParents(kind, resolved);
      const updated = await this.updateConfidence(kind, existing.id, actor.role);
      return updated;
    }
    await this.requireDerivedParents(kind, resolved);
    const candidates = await this.candidatesOf(kind, resolved, actor.id);
    if (candidates.length === 0) {
      throw new ReconciliationError(
        "NO_CANDIDATES",
        "Não há candidato válido para confirmar. Sugira um candidato primeiro",
        409,
      );
    }
    if (candidates.length > 1) {
      throw new ReconciliationError(
        "AMBIGUOUS_CANDIDATES",
        "Há mais de um candidato: use a sugestão para escolher o vínculo desejado",
        409,
      );
    }
    return this.createConfirmed(kind, resolved, candidates[0].id, actor.role);
  }

  private async updateConfidence(
    kind: ReconciliationKind,
    bindingId: string,
    role: Role | null | undefined,
  ) {
    const data = { confidence: "CONFIRMED" as Terminated, boundBy: role ?? null };
    switch (kind) {
      case "DRIVER":
        return prisma.externalBindingDriver.update({ where: { id: bindingId }, data });
      case "TEAM":
        return prisma.externalBindingTeam.update({ where: { id: bindingId }, data });
      case "SEASON":
        return prisma.externalBindingSeason.update({ where: { id: bindingId }, data });
      case "RACE":
        return prisma.externalBindingRace.update({ where: { id: bindingId }, data });
      case "DRIVER_SEASON":
        return prisma.externalBindingDriverSeason.update({ where: { id: bindingId }, data });
      case "RESULT":
        return prisma.externalBindingResult.update({ where: { id: bindingId }, data });
      case "STANDING":
        return prisma.externalBindingStanding.update({ where: { id: bindingId }, data });
    }
  }

  private async createConfirmed(
    kind: ReconciliationKind,
    resolved: ResolvedExternal,
    candidateId: string,
    role: Role | null | undefined,
  ) {
    const data = {
      confidence: "CONFIRMED" as Terminated,
      boundBy: role ?? null,
    };
    switch (kind) {
      case "DRIVER":
        return prisma.externalBindingDriver.create({
          data: {
            externalDriverId: resolved.externalDriverId!,
            characterId: candidateId,
            ...data,
          },
        });
      case "TEAM":
        return prisma.externalBindingTeam.create({
          data: { externalTeamId: resolved.externalTeamId!, teamId: candidateId, ...data },
        });
      case "SEASON":
        return prisma.externalBindingSeason.create({
          data: { externalSeasonId: resolved.externalSeasonId!, seasonId: candidateId, ...data },
        });
      case "RACE":
        return prisma.externalBindingRace.create({
          data: { externalRaceId: resolved.externalRaceId!, raceId: candidateId, ...data },
        });
      case "DRIVER_SEASON":
        return prisma.externalBindingDriverSeason.create({
          data: {
            externalDriverSeasonId: resolved.externalDriverSeasonId!,
            seasonDriverEntryId: candidateId,
            ...data,
          },
        });
      case "RESULT":
        return prisma.externalBindingResult.create({
          data: {
            externalResultId: resolved.externalResultId!,
            raceResultId: candidateId,
            ...data,
          },
        });
      case "STANDING":
        return prisma.externalBindingStanding.create({
          data: {
            externalStandingId: resolved.externalStandingId!,
            championshipStandingId: candidateId,
            ...data,
          },
        });
    }
  }

  async requireDerivedParents(kind: ReconciliationKind, resolved: ResolvedExternal): Promise<void> {
    if (kind === "DRIVER_SEASON") {
      const driver = await prisma.externalBindingDriver.findFirst({
        where: { externalDriverId: resolved.externalDriverId, confidence: "CONFIRMED" },
        select: { id: true },
      });
      const season = await prisma.externalBindingSeason.findFirst({
        where: {
          externalSeason: { source: resolved.source, year: resolved.seasonYear ?? 0 },
          confidence: "CONFIRMED",
        },
        select: { id: true },
      });
      if (!driver || !season) {
        throw new ReconciliationError(
          "PARENT_BINDING_REQUIRED",
          "Confirme primeiro o vínculo do piloto e da temporada",
          409,
        );
      }
    }
    if (kind === "RESULT") {
      const race = await prisma.externalBindingRace.findFirst({
        where: { externalRaceId: resolved.externalRaceId, confidence: "CONFIRMED" },
        select: { id: true },
      });
      const driver = await prisma.externalBindingDriver.findFirst({
        where: { externalDriverId: resolved.externalDriverId, confidence: "CONFIRMED" },
        select: { id: true },
      });
      if (!race || !driver) {
        throw new ReconciliationError(
          "PARENT_BINDING_REQUIRED",
          "Confirme primeiro o vínculo da corrida e do piloto",
          409,
        );
      }
    }
    if (kind === "STANDING") {
      const driver = await prisma.externalBindingDriver.findFirst({
        where: { externalDriverId: resolved.externalDriverId, confidence: "CONFIRMED" },
        select: { id: true },
      });
      const season = await prisma.externalBindingSeason.findFirst({
        where: { externalSeason: { source: resolved.source, year: resolved.seasonYear ?? 0 }, confidence: "CONFIRMED" },
        select: { id: true },
      });
      if (!driver || !season) {
        throw new ReconciliationError(
          "PARENT_BINDING_REQUIRED",
          "Confirme primeiro o vínculo da temporada e do piloto",
          409,
        );
      }
    }
  }

  async unbindBinding(actor: Actor, bindingId: string) {
    const kinds: ReconciliationKind[] = [
      "DRIVER",
      "TEAM",
      "SEASON",
      "RACE",
      "DRIVER_SEASON",
      "RESULT",
      "STANDING",
    ];
    void actor;
    for (const kind of kinds) {
      const found = await this.findBinding(kind, bindingId);
      if (found) {
        await this.deleteBinding(kind, bindingId);
        return { ok: true, kind, id: bindingId };
      }
    }
    throw new ReconciliationError("NOT_FOUND", "Vínculo não encontrado", 404);
  }

  private async findBinding(kind: ReconciliationKind, id: string) {
    switch (kind) {
      case "DRIVER":
        return prisma.externalBindingDriver.findUnique({ where: { id } });
      case "TEAM":
        return prisma.externalBindingTeam.findUnique({ where: { id } });
      case "SEASON":
        return prisma.externalBindingSeason.findUnique({ where: { id } });
      case "RACE":
        return prisma.externalBindingRace.findUnique({ where: { id } });
      case "DRIVER_SEASON":
        return prisma.externalBindingDriverSeason.findUnique({ where: { id } });
      case "RESULT":
        return prisma.externalBindingResult.findUnique({ where: { id } });
      case "STANDING":
        return prisma.externalBindingStanding.findUnique({ where: { id } });
    }
  }

  private async deleteBinding(kind: ReconciliationKind, id: string) {
    switch (kind) {
      case "DRIVER":
        return prisma.externalBindingDriver.delete({ where: { id } });
      case "TEAM":
        return prisma.externalBindingTeam.delete({ where: { id } });
      case "SEASON":
        return prisma.externalBindingSeason.delete({ where: { id } });
      case "RACE":
        return prisma.externalBindingRace.delete({ where: { id } });
      case "DRIVER_SEASON":
        return prisma.externalBindingDriverSeason.delete({ where: { id } });
      case "RESULT":
        return prisma.externalBindingResult.delete({ where: { id } });
      case "STANDING":
        return prisma.externalBindingStanding.delete({ where: { id } });
    }
  }

  async listExternal(kind: ReconciliationKind, filters: { source?: string; seasonYear?: number }) {
    const source = filters.source || this.defaultSource;
    switch (kind) {
      case "DRIVER":
        return prisma.externalDriver.findMany({
          where: { source },
          select: {
            id: true,
            externalId: true,
            name: true,
            fullName: true,
            nationality: true,
            number: true,
            lastSyncedAt: true,
          },
          orderBy: { name: "asc" },
        });
      case "TEAM":
        return prisma.externalTeam.findMany({
          where: { source },
          select: {
            id: true,
            externalId: true,
            name: true,
            shortName: true,
            color: true,
            lastSyncedAt: true,
          },
          orderBy: { name: "asc" },
        });
      case "SEASON":
        return prisma.externalSeason.findMany({
          where: { source },
          select: { id: true, year: true, name: true, status: true },
          orderBy: { year: "desc" },
        });
      case "RACE":
        return prisma.externalRace.findMany({
          where: { source, ...(filters.seasonYear != null ? { seasonYear: filters.seasonYear } : {}) },
          select: {
            id: true,
            seasonYear: true,
            round: true,
            grandPrix: true,
            name: true,
            circuitName: true,
            date: true,
            status: true,
          },
          orderBy: [{ seasonYear: "asc" }, { round: "asc" }],
        });
      case "DRIVER_SEASON":
        return prisma.externalDriverSeason.findMany({
          where: {
            source,
            ...(filters.seasonYear != null ? { seasonYear: filters.seasonYear } : {}),
          },
          select: {
            id: true,
            seasonYear: true,
            externalDriver: { select: { externalId: true, name: true } },
            teamExternalId: true,
            teamNameSnapshot: true,
            number: true,
            role: true,
          },
          orderBy: [{ seasonYear: "asc" }, { externalDriver: { name: "asc" } }],
        });
      case "RESULT":
        return prisma.externalResult.findMany({
          where: {
            source,
            ...(filters.seasonYear != null
              ? { externalRace: { seasonYear: filters.seasonYear } }
              : {}),
          },
          select: {
            id: true,
            externalRace: { select: { seasonYear: true, round: true } },
            externalDriver: { select: { externalId: true, name: true } },
            position: true,
            points: true,
            grid: true,
            fastestLap: true,
            status: true,
          },
          orderBy: [{ externalDriver: { name: "asc" } }, { externalRace: { round: "asc" } }],
        });
      case "STANDING":
        return prisma.externalStanding.findMany({
          where: {
            source,
            ...(filters.seasonYear != null ? { seasonYear: filters.seasonYear } : {}),
          },
          select: {
            id: true,
            seasonYear: true,
            externalDriver: { select: { externalId: true, name: true } },
            position: true,
            points: true,
            wins: true,
            podiums: true,
          },
          orderBy: [{ seasonYear: "asc" }, { position: "asc" }],
        });
    }
  }

  async listBindings(filters: { source?: string; confidence?: Terminated }) {
    const source = filters.source || this.defaultSource;
    const byDriver = {
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalDriver: { source },
      },
      select: {
        id: true,
        characterId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalDriver: { select: { externalId: true, name: true } },
      },
    };
    const driverRows = await prisma.externalBindingDriver.findMany(byDriver);
    const out: BindingView[] = [];
    for (const row of driverRows) {
      out.push({
        id: row.id,
        kind: "DRIVER",
        source,
        externalLabel: row.externalDriver.name,
        targetLabel: await this.characterLabel(row.characterId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const teamRows = await prisma.externalBindingTeam.findMany({
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalTeam: { source },
      },
      select: {
        id: true,
        teamId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalTeam: { select: { externalId: true, name: true } },
      },
    });
    for (const row of teamRows) {
      out.push({
        id: row.id,
        kind: "TEAM",
        source,
        externalLabel: row.externalTeam.name,
        targetLabel: await this.teamLabel(row.teamId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const seasonRows = await prisma.externalBindingSeason.findMany({
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalSeason: { source },
      },
      select: {
        id: true,
        seasonId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalSeason: { select: { year: true } },
      },
    });
    for (const row of seasonRows) {
      out.push({
        id: row.id,
        kind: "SEASON",
        source,
        externalLabel: String(row.externalSeason.year),
        targetLabel: await this.seasonLabel(row.seasonId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const raceRows = await prisma.externalBindingRace.findMany({
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalRace: { source },
      },
      select: {
        id: true,
        raceId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalRace: { select: { round: true, seasonYear: true, grandPrix: true, name: true } },
      },
    });
    for (const row of raceRows) {
      out.push({
        id: row.id,
        kind: "RACE",
        source,
        externalLabel: row.externalRace.grandPrix ?? row.externalRace.name ?? String(row.externalRace.round),
        targetLabel: await this.raceLabel(row.raceId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const entryRows = await prisma.externalBindingDriverSeason.findMany({
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalDriverSeason: { source },
      },
      select: {
        id: true,
        seasonDriverEntryId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalDriverSeason: {
          select: {
            seasonYear: true,
            externalDriver: { select: { name: true } },
          },
        },
      },
    });
    for (const row of entryRows) {
      out.push({
        id: row.id,
        kind: "DRIVER_SEASON",
        source,
        externalLabel: `${row.externalDriverSeason.externalDriver.name} ${row.externalDriverSeason.seasonYear}`,
        targetLabel: await this.entryLabel(row.seasonDriverEntryId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const resultRows = await prisma.externalBindingResult.findMany({
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalResult: { source },
      },
      select: {
        id: true,
        raceResultId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalResult: {
          select: {
            externalDriver: { select: { name: true } },
            externalRace: { select: { round: true, seasonYear: true } },
          },
        },
      },
    });
    for (const row of resultRows) {
      out.push({
        id: row.id,
        kind: "RESULT",
        source,
        externalLabel: `${row.externalResult.externalDriver.name} r${row.externalResult.externalRace.round} ${row.externalResult.externalRace.seasonYear}`,
        targetLabel: await this.resultLabel(row.raceResultId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    const standingRows = await prisma.externalBindingStanding.findMany({
      where: {
        ...(filters.confidence ? { confidence: filters.confidence } : {}),
        externalStanding: { source },
      },
      select: {
        id: true,
        championshipStandingId: true,
        confidence: true,
        boundAt: true,
        boundBy: true,
        createdAt: true,
        updatedAt: true,
        externalStanding: {
          select: {
            seasonYear: true,
            externalDriver: { select: { name: true } },
          },
        },
      },
    });
    for (const row of standingRows) {
      out.push({
        id: row.id,
        kind: "STANDING",
        source,
        externalLabel: `${row.externalStanding.externalDriver.name} ${row.externalStanding.seasonYear}`,
        targetLabel: await this.standingLabel(row.championshipStandingId),
        confidence: row.confidence,
        boundAt: row.boundAt,
        boundBy: row.boundBy,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      });
    }
    return out;
  }

  async buildRosterDiff(seasonId: string): Promise<RosterDiff> {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true },
    });
    if (!season) {
      throw new ReconciliationError("NOT_FOUND", "Temporada não encontrada", 404);
    }
    const seasonBinding = await prisma.externalBindingSeason.findFirst({
      where: { seasonId, confidence: "CONFIRMED" },
      select: { externalSeason: { select: { id: true, year: true } } },
    });
    if (!seasonBinding) {
      return { seasonId, externalSeason: null, rows: [], universeOnly: [], seatOccupancy: [] };
    }
    const year = seasonBinding.externalSeason.year;
    const externalList = await prisma.externalDriverSeason.findMany({
      where: { source: this.defaultSource, seasonYear: year },
      include: {
        externalDriver: { select: { externalId: true, name: true } },
      },
    });
    const rows: RosterDiffRow[] = [];
    const matchedEntryIds = new Set<string>();

    for (const ext of externalList) {
      const entryBinding = await prisma.externalBindingDriverSeason.findFirst({
        where: { externalDriverSeasonId: ext.id, confidence: "CONFIRMED" },
        select: {
          id: true,
          confidence: true,
          seasonDriverEntry: { include: entryInclude },
        },
      });
      const entry = entryBinding?.seasonDriverEntry ?? null;
      let universe: RosterDiffRow["universe"] = null;
      let status: RosterDiffRow["status"];
      let differences: string[] = [];
      let suggestions: Candidate[] = [];
      let binding: RosterDiffRow["binding"] = null;

      if (entry) {
        matchedEntryIds.add(entry.id);
        universe = {
          id: entry.id,
          driverProfileId: entry.driverProfileId,
          characterId: entry.driverProfile.character.id,
          characterName: entry.driverProfile.character.name,
          teamName: entry.team?.name ?? null,
          seat: entry.seat,
          number: entry.number,
          role: entry.role,
        };
        binding = { id: entryBinding!.id, confidence: entryBinding!.confidence };
        const teamOk = teamsEqual(
          ext.teamNameSnapshot,
          ext.teamExternalId,
          entry.team?.name,
          entry.team?.shortName,
        );
        const numberOk = entry.number == null || ext.number == null || entry.number === ext.number;
        if (teamOk && numberOk) {
          status = "MATCHED";
        } else {
          status = "CONFLICT";
          if (!teamOk) differences.push("team");
          if (!numberOk) differences.push("number");
        }
      } else {
        const driverBinding = await prisma.externalBindingDriver.findFirst({
          where: { externalDriverId: ext.externalDriverId, confidence: "CONFIRMED" },
          select: { characterId: true },
        });
        if (driverBinding) {
          const driverProfileId = await this.driverProfileOfCharacter(driverBinding.characterId);
          if (driverProfileId) {
            const existingEntry = await prisma.seasonDriverEntry.findUnique({
              where: {
                seasonId_driverProfileId: { seasonId, driverProfileId },
              },
              include: entryInclude,
            });
            if (existingEntry) {
              matchedEntryIds.add(existingEntry.id);
              universe = {
                id: existingEntry.id,
                driverProfileId: existingEntry.driverProfileId,
                characterId: existingEntry.driverProfile.character.id,
                characterName: existingEntry.driverProfile.character.name,
                teamName: existingEntry.team?.name ?? null,
                seat: existingEntry.seat,
                number: existingEntry.number,
                role: existingEntry.role,
              };
              status = "CONFLICT";
              differences = ["binding-missing"];
            } else {
              status = "UNMATCHED";
              differences = ["identified-without-roster-entry"];
            }
          } else {
            status = "UNMATCHED";
            differences = ["identified-without-driver-profile"];
          }
        } else {
          suggestions = await this.candidatesForDriver("", {
            name: ext.externalDriver.name,
          });
          status = suggestions.length > 0 ? "SUGGESTED" : "UNMATCHED";
          differences = suggestions.length > 0 ? ["candidate-exists"] : ["no-candidate"];
        }
      }

      rows.push({
        external: {
          id: ext.id,
          externalId: ext.externalDriver.externalId,
          name: ext.externalDriver.name,
          number: ext.number,
          teamExternalId: ext.teamExternalId,
          teamNameSnapshot: ext.teamNameSnapshot,
          role: ext.role,
        },
        universe,
        status,
        differences,
        binding,
        suggestions,
      });
    }

    const allEntries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId },
      include: entryInclude,
    });
    const universeOnly = allEntries
      .filter((entry) => !matchedEntryIds.has(entry.id))
      .map((entry) => ({
        id: entry.id,
        driverProfileId: entry.driverProfileId,
        characterId: entry.driverProfile.character.id,
        characterName: entry.driverProfile.character.name,
        teamName: entry.team?.name ?? null,
        seat: entry.seat,
        number: entry.number,
        role: entry.role,
      }));

    const seatOccupancy = this.computeSeatOccupancy(externalList, allEntries);

    return {
      seasonId,
      externalSeason: { id: seasonBinding.externalSeason.id, year },
      rows,
      universeOnly,
      seatOccupancy,
    };
  }

  private computeSeatOccupancy(
    externalList: {
      teamExternalId: string | null;
      teamNameSnapshot: string | null;
      number: number | null;
      role: string | null;
      externalDriver: { name: string };
    }[],
    universeEntries: {
      role: string | null;
      seat: number | null;
      team: { name: string | null; shortName: string | null } | null;
      driverProfile: { character: { name: string } };
    }[],
  ): RosterDiff["seatOccupancy"] {
    const externalByTeam = new Map<string, { label: string; drivers: { name: string; number: number | null }[] }>();
    for (const ext of externalList) {
      if (ext.role === "RESERVE") continue;
      const norm = normalizeName(ext.teamNameSnapshot ?? ext.teamExternalId);
      if (!norm) continue;
      const group = externalByTeam.get(norm) ?? { label: ext.teamNameSnapshot ?? ext.teamExternalId ?? norm, drivers: [] };
      group.drivers.push({ name: ext.externalDriver.name, number: ext.number });
      externalByTeam.set(norm, group);
    }
    for (const group of externalByTeam.values()) {
      group.drivers.sort((a, b) => (a.number ?? 99) - (b.number ?? 99));
    }
    const universeByTeam = new Map<string, { label: string; seats: Map<number, string> }>();
    for (const entry of universeEntries) {
      if (entry.role === "RESERVE") continue;
      const norm = normalizeName(entry.team?.name ?? entry.team?.shortName);
      if (!norm || entry.seat == null) continue;
      const group = universeByTeam.get(norm) ?? { label: entry.team?.name ?? entry.team?.shortName ?? norm, seats: new Map<number, string>() };
      group.seats.set(entry.seat, entry.driverProfile.character.name);
      universeByTeam.set(norm, group);
    }
    const occupancy: RosterDiff["seatOccupancy"] = [];
    const teamKeys = new Set([...externalByTeam.keys(), ...universeByTeam.keys()]);
    for (const norm of teamKeys) {
      const ext = externalByTeam.get(norm);
      const uni = universeByTeam.get(norm);
      const label = ext?.label ?? uni?.label ?? norm;
      for (const seat of [1, 2]) {
        const externalName = ext?.drivers[seat - 1]?.name ?? null;
        const universeName = uni?.seats.get(seat) ?? null;
        if (externalName || universeName) {
          occupancy.push({ team: label, seat, external: externalName, universe: universeName });
        }
      }
    }
    return occupancy;
  }

  async buildChampionshipDiff(seasonId: string): Promise<ChampionshipDiff> {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true },
    });
    if (!season) {
      throw new ReconciliationError("NOT_FOUND", "Temporada não encontrada", 404);
    }
    const seasonBinding = await prisma.externalBindingSeason.findFirst({
      where: { seasonId, confidence: "CONFIRMED" },
      select: { externalSeason: { select: { id: true, year: true } } },
    });
    if (!seasonBinding) {
      return { seasonId, externalSeason: null, rows: [], universeOnly: [] };
    }
    const year = seasonBinding.externalSeason.year;
    const externalList = await prisma.externalStanding.findMany({
      where: { source: this.defaultSource, seasonYear: year },
      include: { externalDriver: { select: { externalId: true, name: true } } },
    });
    const rows: ChampionshipDiffRow[] = [];
    const matchedStandingIds = new Set<string>();
    const universeStanding = (driverProfileId: string) =>
      prisma.championshipStanding.findUnique({
        where: {
          seasonId_driverProfileId: { seasonId, driverProfileId },
        },
        include: { driverProfile: { include: { character: { select: { name: true } } } } },
      });

    for (const ext of externalList) {
      const standingBinding = await prisma.externalBindingStanding.findFirst({
        where: { externalStandingId: ext.id, confidence: "CONFIRMED" },
        select: {
          id: true,
          confidence: true,
          championshipStanding: {
            include: { driverProfile: { include: { character: { select: { name: true } } } } },
          },
        },
      });
      const standing = standingBinding?.championshipStanding ?? null;
      let universe: ChampionshipDiffRow["universe"] | null = null;
      let status: ChampionshipDiffRow["status"];
      let differences: string[] = [];
      let suggestions: Candidate[] = [];
      let binding: ChampionshipDiffRow["binding"] | null = null;

      if (standing) {
        matchedStandingIds.add(standing.id);
        universe = {
          id: standing.id,
          characterName: standing.driverProfile.character.name,
          position: standing.position,
          points: standing.points,
          wins: standing.wins,
          podiums: standing.podiums,
        };
        binding = { id: standingBinding!.id, confidence: standingBinding!.confidence };
        const positionOk = standing.position == null || ext.position == null || standing.position === ext.position;
        const pointsOk = standing.points === ext.points;
        if (positionOk && pointsOk && standing.wins === (ext.wins ?? 0)) {
          status = "MATCHED";
        } else {
          status = "CONFLICT";
          if (!positionOk) differences.push("position");
          if (!pointsOk) differences.push("points");
          if (standing.wins !== (ext.wins ?? 0)) differences.push("wins");
        }
      } else {
        const driverBinding = await prisma.externalBindingDriver.findFirst({
          where: { externalDriverId: ext.externalDriverId, confidence: "CONFIRMED" },
          select: { characterId: true },
        });
        if (driverBinding) {
          const driverProfileId = await this.driverProfileOfCharacter(driverBinding.characterId);
          if (driverProfileId) {
            const existing = await universeStanding(driverProfileId);
            if (existing) {
              matchedStandingIds.add(existing.id);
              universe = {
                id: existing.id,
                characterName: existing.driverProfile.character.name,
                position: existing.position,
                points: existing.points,
                wins: existing.wins,
                podiums: existing.podiums,
              };
              status = "CONFLICT";
              differences = ["binding-missing"];
            } else {
              status = "UNMATCHED";
              differences = ["identified-without-standing"];
            }
          } else {
            status = "UNMATCHED";
            differences = ["identified-without-driver-profile"];
          }
        } else {
          suggestions = await this.candidatesForDriver("", { name: ext.externalDriver.name });
          status = suggestions.length > 0 ? "SUGGESTED" : "UNMATCHED";
          differences = suggestions.length > 0 ? ["candidate-exists"] : ["no-candidate"];
        }
      }

      rows.push({
        external: {
          id: ext.id,
          externalId: ext.externalDriver.externalId,
          name: ext.externalDriver.name,
          position: ext.position,
          points: ext.points,
          wins: ext.wins,
          podiums: ext.podiums,
        },
        universe,
        status,
        differences,
        binding,
        suggestions,
      });
    }

    const allStandings = await prisma.championshipStanding.findMany({
      where: { seasonId },
      include: { driverProfile: { include: { character: { select: { name: true } } } } },
    });
    const universeOnly = allStandings
      .filter((standing) => !matchedStandingIds.has(standing.id))
      .map((standing) => ({
        id: standing.id,
        characterName: standing.driverProfile.character.name,
        position: standing.position,
        points: standing.points,
        wins: standing.wins,
        podiums: standing.podiums,
      }));

    return {
      seasonId,
      externalSeason: { id: seasonBinding.externalSeason.id, year },
      rows,
      universeOnly,
    };
  }

  async buildResultsDiff(raceId: string): Promise<ResultsDiff> {
    const race = await prisma.race.findUnique({
      where: { id: raceId },
      select: { id: true },
    });
    if (!race) {
      throw new ReconciliationError("NOT_FOUND", "Corrida não encontrada", 404);
    }
    const raceBinding = await prisma.externalBindingRace.findFirst({
      where: { raceId, confidence: "CONFIRMED" },
      select: { externalRace: { select: { id: true, seasonYear: true, round: true } } },
    });
    if (!raceBinding) {
      return { raceId, externalRace: null, rows: [], universeOnly: [] };
    }
    const externalRace = raceBinding.externalRace;
    const externalList = await prisma.externalResult.findMany({
      where: { source: this.defaultSource, externalRaceId: externalRace.id },
      include: { externalDriver: { select: { externalId: true, name: true } } },
    });
    const rows: ResultsDiffRow[] = [];
    const matchedResultIds = new Set<string>();
    const universeResult = (driverProfileId: string) =>
      prisma.raceResult.findUnique({
        where: { raceId_driverProfileId: { raceId, driverProfileId } },
        include: { driverProfile: { include: { character: { select: { name: true } } } } },
      });

    for (const ext of externalList) {
      const resultBinding = await prisma.externalBindingResult.findFirst({
        where: { externalResultId: ext.id, confidence: "CONFIRMED" },
        select: {
          id: true,
          confidence: true,
          raceResult: {
            include: { driverProfile: { include: { character: { select: { name: true } } } } },
          },
        },
      });
      const result = resultBinding?.raceResult ?? null;
      let universe: ResultsDiffRow["universe"] | null = null;
      let status: ResultsDiffRow["status"];
      let differences: string[] = [];
      let suggestions: Candidate[] = [];
      let binding: ResultsDiffRow["binding"] | null = null;

      if (result) {
        matchedResultIds.add(result.id);
        universe = {
          id: result.id,
          characterName: result.driverProfile.character.name,
          position: result.position,
          points: result.points,
          grid: result.grid,
          fastestLap: result.fastestLap,
          status: result.status,
        };
        binding = { id: resultBinding!.id, confidence: resultBinding!.confidence };
        const positionOk = result.position == null || ext.position == null || result.position === ext.position;
        const pointsOk = result.points === ext.points;
        if (positionOk && pointsOk && result.fastestLap === (ext.fastestLap ?? false)) {
          status = "MATCHED";
        } else {
          status = "CONFLICT";
          if (!positionOk) differences.push("position");
          if (!pointsOk) differences.push("points");
          if (result.fastestLap !== (ext.fastestLap ?? false)) differences.push("fastest-lap");
        }
      } else {
        const driverBinding = await prisma.externalBindingDriver.findFirst({
          where: { externalDriverId: ext.externalDriverId, confidence: "CONFIRMED" },
          select: { characterId: true },
        });
        if (driverBinding) {
          const driverProfileId = await this.driverProfileOfCharacter(driverBinding.characterId);
          if (driverProfileId) {
            const existing = await universeResult(driverProfileId);
            if (existing) {
              matchedResultIds.add(existing.id);
              universe = {
                id: existing.id,
                characterName: existing.driverProfile.character.name,
                position: existing.position,
                points: existing.points,
                grid: existing.grid,
                fastestLap: existing.fastestLap,
                status: existing.status,
              };
              status = "CONFLICT";
              differences = ["binding-missing"];
            } else {
              status = "UNMATCHED";
              differences = ["identified-without-result"];
            }
          } else {
            status = "UNMATCHED";
            differences = ["identified-without-driver-profile"];
          }
        } else {
          suggestions = await this.candidatesForDriver("", { name: ext.externalDriver.name });
          status = suggestions.length > 0 ? "SUGGESTED" : "UNMATCHED";
          differences = suggestions.length > 0 ? ["candidate-exists"] : ["no-candidate"];
        }
      }

      rows.push({
        external: {
          id: ext.id,
          externalId: ext.externalDriver.externalId,
          name: ext.externalDriver.name,
          position: ext.position,
          points: ext.points,
          grid: ext.grid,
          fastestLap: ext.fastestLap,
          status: ext.status,
        },
        universe,
        status,
        differences,
        binding,
        suggestions,
      });
    }

    const allResults = await prisma.raceResult.findMany({
      where: { raceId },
      include: { driverProfile: { include: { character: { select: { name: true } } } } },
    });
    const universeOnly = allResults
      .filter((result) => !matchedResultIds.has(result.id))
      .map((result) => ({
        id: result.id,
        characterName: result.driverProfile.character.name,
        position: result.position,
        points: result.points,
        grid: result.grid,
        fastestLap: result.fastestLap,
        status: result.status,
      }));

    return {
      raceId,
      externalRace: { id: externalRace.id, seasonYear: externalRace.seasonYear, round: externalRace.round },
      rows,
      universeOnly,
    };
  }
}

export const reconciliationService = new ReconciliationService();

export { normalizeName, nameSimilarity };