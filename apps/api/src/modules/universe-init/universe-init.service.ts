import { randomUUID } from "node:crypto";
import { Prisma, type Role } from "@prisma/client";
import type { PrismaClient, DriverRole } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { computeContentHash } from "../external-sync/jolpica.hash.js";
import {
  INITIALIZATION_SCOPE_VALUES,
  type InitializationScope,
  type UniverseInitializationInput,
} from "./universe-init.schemas.js";

type Db = Prisma.TransactionClient | PrismaClient;

export class UniverseInitError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "UniverseInitError";
  }
}

export interface Actor {
  id: string;
  role?: Role | null;
}

export type PlanAction = "CREATED" | "REUSED" | "CONFLICT" | "SKIPPED";

export interface PlannedTeam {
  externalId: string;
  name: string;
  shortName: string | null;
  color: string | null;
  action: PlanAction;
  universeTeamId?: string;
  bindingCreate: boolean;
  reason?: string;
}

export interface PlannedDriver {
  externalId: string;
  name: string;
  nationality: string | null;
  charAction: PlanAction;
  profileAction: PlanAction;
  entryAction: PlanAction;
  characterId?: string;
  driverProfileId?: string;
  entryId?: string;
  teamId?: string;
  teamName: string | null;
  role: DriverRole | null;
  seat: number | null;
  number: number | null;
  driverBindingCreate: boolean;
  entryBindingCreate: boolean;
  reason?: string;
}

export interface PlannedRace {
  externalRaceId: string;
  round: number;
  name: string | null;
  action: PlanAction;
  universeRaceId?: string;
  status: "FINISHED" | "UPCOMING";
  bindingCreate: boolean;
  reason?: string;
}

export interface PlannedResult {
  externalResultId: string;
  externalDriverId: string;
  driverName: string;
  driverProfileId?: string;
  raceId?: string;
  action: PlanAction;
  raceResultId?: string;
  bindingCreate: boolean;
  reason?: string;
  position: number | null;
  points: number;
  grid: number | null;
  fastestLap: boolean;
  status: string | null;
  sourceHash: string;
}

export interface PlannedStanding {
  externalStandingId: string;
  externalDriverId: string;
  driverName: string;
  driverProfileId?: string;
  seasonId: string;
  action: PlanAction;
  standingId?: string;
  bindingCreate: boolean;
  reason?: string;
  position: number | null;
  points: number;
  wins: number;
  podiums: number;
  sourceHash: string;
}

export interface InitConflict {
  kind: string;
  externalId: string;
  label: string;
  reason: string;
}

export interface InitStatus {
  initialized: boolean;
  season: InitReport["season"];
  scopes: InitializationScope[];
  seasonBindingCreated: boolean;
  summary: InitReport["summary"];
  conflicts: InitConflict[];
  worldState: { changed: boolean };
}

export interface InitReport {
  season: {
    universeSeasonId: string;
    externalSeasonId: string;
    year: number;
    source: string;
  };
  scopes: InitializationScope[];
  seasonBindingCreated: boolean;
  summary: {
    teamsCreated: number;
    teamsReused: number;
    charactersCreated: number;
    charactersReused: number;
    profilesCreated: number;
    profilesReused: number;
    entriesCreated: number;
    entriesReused: number;
    racesCreated: number;
    racesReused: number;
    resultsCreated: number;
    resultsReused: number;
    standingsCreated: number;
    standingsReused: number;
    bindingsCreated: number;
    conflicts: number;
  };
  teams: PlannedTeam[];
  drivers: PlannedDriver[];
  races: PlannedRace[];
  results: PlannedResult[];
  standings: PlannedStanding[];
  conflicts: InitConflict[];
  worldState: { changed: boolean };
}

type DraftDriver = {
  ds: {
    id: string;
    externalDriverId: string;
    teamExternalId: string | null;
    number: number | null;
    role: string | null;
  };
  externalDriver: { name: string; number: number | null; nationality: string | null; externalId: string };
  charAction: PlanAction;
  profileAction: PlanAction;
  characterId?: string;
  driverProfileId?: string;
  driverBindingCreate: boolean;
  plannedTeam?: PlannedTeam;
  role: DriverRole | null;
  number: number | null;
  seat: number | null;
  entryAction?: PlanAction;
  entryId?: string;
  entryBindingCreate?: boolean;
  reason?: string;
};

function deterministicBirthDate(seed: string): Date {
  let hash = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  const days = Math.abs(hash) % 7305;
  return new Date(Date.UTC(2000, 0, 1 + days));
}

function pushConflict(
  conflicts: InitConflict[],
  kind: string,
  externalId: string,
  label: string,
  reason: string,
): void {
  conflicts.push({ kind, externalId, label, reason });
}

export class UniverseInitService {
  async preview(actor: Actor, input: UniverseInitializationInput): Promise<InitReport> {
    return this.buildPlan(prisma, actor, input);
  }

  async execute(actor: Actor, input: UniverseInitializationInput): Promise<InitReport> {
    return prisma.$transaction(async (tx) => {
      const plan = await this.buildPlan(tx, actor, input);
      if (plan.conflicts.length > 0) {
        throw new UniverseInitError(
          "CONFLICT",
          "Existem conflitos: resolva-os antes de executar a materialização",
          409,
        );
      }
      await this.materialize(tx, actor, input, plan);
      return plan;
    });
  }

  async status(actor: Actor, input: UniverseInitializationInput): Promise<InitStatus> {
    const plan = await this.buildPlan(prisma, actor, input);
    const initialized =
      plan.conflicts.length === 0 &&
      plan.summary.bindingsCreated === 0 &&
      plan.summary.teamsCreated === 0 &&
      plan.summary.charactersCreated === 0 &&
      plan.summary.profilesCreated === 0 &&
      plan.summary.entriesCreated === 0 &&
      plan.summary.racesCreated === 0 &&
      plan.summary.resultsCreated === 0 &&
      plan.summary.standingsCreated === 0;
    return {
      initialized,
      season: plan.season,
      scopes: plan.scopes,
      seasonBindingCreated: plan.seasonBindingCreated,
      summary: plan.summary,
      conflicts: plan.conflicts,
      worldState: plan.worldState,
    };
  }

  private async buildPlan(
    db: Db,
    actor: Actor,
    input: UniverseInitializationInput,
  ): Promise<InitReport> {
    const scopes: InitializationScope[] = input.scopes ?? [...INITIALIZATION_SCOPE_VALUES];
    const conflicts: InitConflict[] = [];

    const season = await db.season.findUnique({
      where: { id: input.seasonId },
      select: { id: true },
    });
    if (!season) {
      throw new UniverseInitError("NOT_FOUND", "Temporada do universo não encontrada", 404);
    }
    const extSeason = await db.externalSeason.findUnique({
      where: { id: input.externalSeasonId },
      select: { id: true, source: true, year: true },
    });
    if (!extSeason) {
      throw new UniverseInitError("NOT_FOUND", "Temporada externa não encontrada", 404);
    }

    const seasonBindingCreate = await this.resolveSeasonBinding(
      db,
      input.seasonId,
      input.externalSeasonId,
      conflicts,
    );

    let teams: PlannedTeam[] = [];
    let drivers: PlannedDriver[] = [];
    let races: PlannedRace[] = [];
    let results: PlannedResult[] = [];
    let standings: PlannedStanding[] = [];

    const hasGridDependent = scopes.some(
      (scope) => scope === "DRIVER_GRID" || scope === "RESULTS" || scope === "STANDINGS",
    );

    if (hasGridDependent) {
      const driverSeasons = await db.externalDriverSeason.findMany({
        where: { source: extSeason.source, seasonYear: extSeason.year },
        include: { externalDriver: true },
        orderBy: [{ externalDriver: { name: "asc" } }],
      });
      const teamExternalIds = [
        ...new Set(
          driverSeasons
            .map((ds) => ds.teamExternalId)
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      teams = await this.planTeams(db, actor, extSeason.source, teamExternalIds, conflicts);
      const plannedDrivers = await this.planDrivers(
        db,
        input.seasonId,
        scopes,
        driverSeasons,
        teams,
        conflicts,
      );
      drivers = plannedDrivers.drivers;
      const profiles = plannedDrivers.resolvedProfiles;
      if (scopes.includes("RACES")) {
        races = await this.planRaces(db, input.seasonId, extSeason, conflicts);
      }
      if (scopes.includes("RESULTS")) {
        results = await this.planResults(db, extSeason, races, profiles, conflicts);
      }
      if (scopes.includes("STANDINGS")) {
        standings = await this.planStandings(
          db,
          extSeason,
          input.seasonId,
          profiles,
          conflicts,
        );
      }
    } else if (scopes.includes("RACES")) {
      races = await this.planRaces(db, input.seasonId, extSeason, conflicts);
    }

    const bindingsCreated =
      (seasonBindingCreate ? 1 : 0) +
      teams.filter((team) => team.bindingCreate).length +
      drivers.filter((driver) => driver.driverBindingCreate).length +
      drivers.filter((driver) => driver.entryBindingCreate).length +
      races.filter((race) => race.bindingCreate).length +
      results.filter((result) => result.bindingCreate).length +
      standings.filter((standing) => standing.bindingCreate).length;

    const countBy = (items: readonly { action: PlanAction }[], action: PlanAction) =>
      items.filter((item) => item.action === action).length;
    const countByDriverAction = (
      items: readonly PlannedDriver[],
      field: "charAction" | "profileAction" | "entryAction",
      action: PlanAction,
    ) => items.filter((item) => item[field] === action).length;

    return {
      season: {
        universeSeasonId: input.seasonId,
        externalSeasonId: input.externalSeasonId,
        year: extSeason.year,
        source: extSeason.source,
      },
      scopes,
      seasonBindingCreated: seasonBindingCreate,
      summary: {
        teamsCreated: countBy(teams, "CREATED"),
        teamsReused: countBy(teams, "REUSED"),
        charactersCreated: countByDriverAction(drivers, "charAction", "CREATED"),
        charactersReused: countByDriverAction(drivers, "charAction", "REUSED"),
        profilesCreated: countByDriverAction(drivers, "profileAction", "CREATED"),
        profilesReused: countByDriverAction(drivers, "profileAction", "REUSED"),
        entriesCreated: countByDriverAction(drivers, "entryAction", "CREATED"),
        entriesReused: countByDriverAction(drivers, "entryAction", "REUSED"),
        racesCreated: countBy(races, "CREATED"),
        racesReused: countBy(races, "REUSED"),
        resultsCreated: countBy(results, "CREATED"),
        resultsReused: countBy(results, "REUSED"),
        standingsCreated: countBy(standings, "CREATED"),
        standingsReused: countBy(standings, "REUSED"),
        bindingsCreated,
        conflicts: conflicts.length,
      },
      teams,
      drivers,
      races,
      results,
      standings,
      conflicts,
      worldState: { changed: false },
    };
  }

  private async resolveSeasonBinding(
    db: Db,
    seasonId: string,
    externalSeasonId: string,
    conflicts: InitConflict[],
  ): Promise<boolean> {
    const binding = await db.externalBindingSeason.findUnique({
      where: { externalSeasonId },
      select: { seasonId: true, confidence: true },
    });
    if (!binding) return true;
    if (binding.confidence !== "CONFIRMED") {
      pushConflict(
        conflicts,
        "SEASON_BINDING_SUGGESTED",
        externalSeasonId,
        "Temporada externa",
        "O vínculo da temporada está sugerido: confirme-o antes de inicializar",
      );
      return false;
    }
    if (binding.seasonId !== seasonId) {
      pushConflict(
        conflicts,
        "SEASON_BINDING_MISMATCH",
        externalSeasonId,
        "Temporada externa",
        "O vínculo da temporada aponta para outra temporada do universo",
      );
      return false;
    }
    return false;
  }

  private async planTeams(
    db: Db,
    actor: Actor,
    source: string,
    externalIds: string[],
    conflicts: InitConflict[],
  ): Promise<PlannedTeam[]> {
    const plan: PlannedTeam[] = [];
    for (const externalId of [...externalIds].sort()) {
      const extTeam = await db.externalTeam.findUnique({
        where: { source_externalId: { source, externalId } },
        select: { id: true, name: true, shortName: true, color: true },
      });
      if (!extTeam) {
        pushConflict(conflicts, "TEAM_NOT_FOUND", externalId, externalId, "Equipe externa não encontrada");
        continue;
      }
      const binding = await db.externalBindingTeam.findUnique({
        where: { externalTeamId: extTeam.id },
        select: { id: true, confidence: true, teamId: true },
      });
      if (binding) {
        if (binding.confidence === "CONFIRMED") {
          plan.push({
            externalId,
            name: extTeam.name,
            shortName: extTeam.shortName,
            color: extTeam.color,
            action: "REUSED",
            universeTeamId: binding.teamId,
            bindingCreate: false,
          });
        } else {
          pushConflict(conflicts, "TEAM_BINDING_SUGGESTED", externalId, extTeam.name, "Vínculo de equipe sugerido não confirmado");
        }
        continue;
      }
      const sameName = await db.team.findFirst({
        where: { userId: actor.id, name: extTeam.name },
        select: { id: true },
      });
      if (sameName) {
        pushConflict(conflicts, "TEAM_NAME_CONFLICT", externalId, extTeam.name, "Já existe equipe no universo com o mesmo nome sem vínculo");
        continue;
      }
      plan.push({
        externalId,
        name: extTeam.name,
        shortName: extTeam.shortName,
        color: extTeam.color,
        action: "CREATED",
        universeTeamId: randomUUID(),
        bindingCreate: true,
      });
    }
    return plan;
  }

  private async planDrivers(
    db: Db,
    seasonId: string,
    scopes: InitializationScope[],
    driverSeasons: Array<{
      id: string;
      externalDriverId: string;
      teamExternalId: string | null;
      number: number | null;
      role: string | null;
      externalDriver: { name: string; number: number | null; nationality: string | null; externalId: string };
    }>,
    teams: PlannedTeam[],
    conflicts: InitConflict[],
  ): Promise<{ drivers: PlannedDriver[]; resolvedProfiles: Map<string, string> }> {
    const grid = scopes.includes("DRIVER_GRID");
    const teamById = new Map(teams.map((team) => [team.externalId, team]));
    const drafts: DraftDriver[] = [];
    const resolvedProfiles = new Map<string, string>();

    for (const ds of driverSeasons) {
      const draft: DraftDriver = {
        ds,
        externalDriver: ds.externalDriver,
        charAction: "SKIPPED",
        profileAction: "SKIPPED",
        driverBindingCreate: false,
        role: null,
        number: null,
        seat: null,
      };
      const label = ds.externalDriver.name;
      const binding = await db.externalBindingDriver.findUnique({
        where: { externalDriverId: ds.externalDriverId },
        select: { confidence: true, characterId: true },
      });
      let resolved = false;
      if (binding) {
        if (binding.confidence === "CONFIRMED") {
          draft.charAction = "REUSED";
          draft.characterId = binding.characterId;
          const profile = await db.driverProfile.findUnique({
            where: { characterId: binding.characterId },
            select: { id: true },
          });
          if (profile) {
            draft.profileAction = "REUSED";
            draft.driverProfileId = profile.id;
            resolved = true;
          } else if (grid) {
            draft.profileAction = "CREATED";
            draft.driverProfileId = randomUUID();
            resolved = true;
          } else {
            pushConflict(
              conflicts,
              "DRIVER_PROFILE_REQUIRED",
              ds.externalDriver.externalId,
              label,
              "Personagem vinculado não possui perfil de piloto: inclua o escopo DRIVER_GRID",
            );
          }
        } else {
          pushConflict(conflicts, "DRIVER_BINDING_SUGGESTED", ds.externalDriver.externalId, label, "Vínculo de piloto sugerido não confirmado");
        }
      } else if (grid) {
        draft.charAction = "CREATED";
        draft.characterId = randomUUID();
        draft.profileAction = "CREATED";
        draft.driverProfileId = randomUUID();
        draft.driverBindingCreate = true;
        resolved = true;
      } else {
        pushConflict(conflicts, "DRIVER_GRID_REQUIRED", ds.externalDriver.externalId, label, "Piloto sem vínculo: inclua o escopo DRIVER_GRID para materializá-lo");
      }

      if (resolved && draft.driverProfileId) {
        resolvedProfiles.set(ds.externalDriver.externalId, draft.driverProfileId);
      }

      if (resolved) {
        const plannedTeam = ds.teamExternalId ? teamById.get(ds.teamExternalId) : undefined;
        if (plannedTeam && plannedTeam.universeTeamId) {
          draft.plannedTeam = plannedTeam;
          draft.role = (ds.role ?? "").toUpperCase() === "RESERVE" ? "RESERVE" : "RACE_SEAT";
          draft.number = ds.number ?? ds.externalDriver.number ?? null;
        } else if (plannedTeam && plannedTeam.action === "CONFLICT" && grid) {
          draft.entryAction = "CONFLICT";
          draft.reason = plannedTeam.reason;
        } else if (!grid) {
          draft.entryAction = "SKIPPED";
          draft.reason = "Escopo DRIVER_GRID não selecionado";
        } else {
          draft.entryAction = "SKIPPED";
          draft.reason = "Sem equipe informada: personagem materializado sem entrada no grid";
        }
      } else {
        draft.entryAction = "SKIPPED";
      }
      drafts.push(draft);
    }

    const raceSeatGroups = new Map<string, DraftDriver[]>();
    const reserveGroups = new Map<string, DraftDriver[]>();
    for (const draft of drafts) {
      if (!draft.plannedTeam || !grid) continue;
      const key = draft.plannedTeam.externalId;
      if (draft.role === "RESERVE") {
        const group = reserveGroups.get(key) ?? [];
        group.push(draft);
        reserveGroups.set(key, group);
      } else if (draft.entryAction === undefined) {
        const group = raceSeatGroups.get(key) ?? [];
        group.push(draft);
        raceSeatGroups.set(key, group);
      }
    }

    for (const group of raceSeatGroups.values()) {
      group.sort(
        (a, b) =>
          (a.number ?? 9999) - (b.number ?? 9999) ||
          a.externalDriver.name.localeCompare(b.externalDriver.name),
      );
      group.forEach((draft, index) => {
        if (index >= 2) {
          draft.entryAction = "CONFLICT";
          draft.reason = "A equipe possui no máximo dois assentos de corrida";
          pushConflict(
            conflicts,
            "SEAT_CAPACITY",
            draft.externalDriver.externalId,
            draft.externalDriver.name,
            draft.reason,
          );
        } else {
          draft.seat = index + 1;
        }
      });
    }

    for (const group of reserveGroups.values()) {
      group.slice(1).forEach((draft) => {
        draft.entryAction = "CONFLICT";
        draft.reason = "A equipe já possui um piloto reserva nesta temporada";
        pushConflict(
          conflicts,
          "RESERVE_LIMIT",
          draft.externalDriver.externalId,
          draft.externalDriver.name,
          draft.reason,
        );
      });
    }

    for (const draft of drafts) {
      if (draft.entryAction !== undefined) continue;
      const team = draft.plannedTeam;
      if (!team || !team.universeTeamId || !draft.driverProfileId) {
        draft.entryAction = "SKIPPED";
        continue;
      }
      if (draft.role === "RESERVE") {
        if (await this.universeTeamExists(db, team.universeTeamId)) {
          const reserveCount = await db.seasonDriverEntry.count({
            where: {
              seasonId,
              teamId: team.universeTeamId,
              role: "RESERVE",
              status: "ACTIVE",
              driverProfileId: { not: draft.driverProfileId },
            },
          });
          if (reserveCount > 0) {
            draft.entryAction = "CONFLICT";
            draft.reason = "A equipe já possui um piloto reserva nesta temporada";
            pushConflict(conflicts, "RESERVE_LIMIT", draft.externalDriver.externalId, draft.externalDriver.name, draft.reason);
            continue;
          }
        }
      } else if (await this.universeTeamExists(db, team.universeTeamId)) {
        const occupant = await db.seasonDriverEntry.findUnique({
          where: {
            seasonId_teamId_seat: {
              seasonId,
              teamId: team.universeTeamId,
              seat: draft.seat ?? 0,
            },
          },
          select: { driverProfileId: true },
        });
        if (occupant && occupant.driverProfileId !== draft.driverProfileId) {
          draft.entryAction = "CONFLICT";
          draft.reason = "Assento já ocupado no universo por outro piloto";
          pushConflict(conflicts, "SEAT_OCCUPIED", draft.externalDriver.externalId, draft.externalDriver.name, draft.reason);
          continue;
        }
      }

      const existingEntry = await this.entryFor(db, seasonId, draft.driverProfileId);
      if (existingEntry) {
        const same =
          existingEntry.status === "ACTIVE" &&
          existingEntry.teamId === team.universeTeamId &&
          existingEntry.role === draft.role &&
          (existingEntry.seat ?? null) === draft.seat &&
          (existingEntry.number ?? null) === draft.number;
        if (same) {
          const entryBinding = await db.externalBindingDriverSeason.findUnique({
            where: { externalDriverSeasonId: draft.ds.id },
            select: { confidence: true },
          });
          if (entryBinding && entryBinding.confidence !== "CONFIRMED") {
            draft.entryAction = "CONFLICT";
            draft.reason = "Vínculo de entrada sugerido não confirmado";
            pushConflict(conflicts, "DRIVER_SEASON_BINDING_SUGGESTED", draft.externalDriver.externalId, draft.externalDriver.name, draft.reason);
            continue;
          }
          draft.entryAction = "REUSED";
          draft.entryId = existingEntry.id;
          draft.entryBindingCreate = !entryBinding;
        } else {
          draft.entryAction = "CONFLICT";
          draft.reason = "Entrada existente diverge: override do universo preservado";
          pushConflict(conflicts, "ROSTER_CONFLICT", draft.externalDriver.externalId, draft.externalDriver.name, draft.reason);
        }
      } else {
        draft.entryAction = "CREATED";
        draft.entryId = randomUUID();
        draft.entryBindingCreate = true;
      }
    }

    const drivers: PlannedDriver[] = drafts.map((draft) => ({
      externalId: draft.externalDriver.externalId,
      name: draft.externalDriver.name,
      nationality: draft.externalDriver.nationality,
      charAction: draft.charAction,
      profileAction: draft.profileAction,
      entryAction: draft.entryAction ?? "SKIPPED",
      characterId: draft.characterId,
      driverProfileId: draft.driverProfileId,
      entryId: draft.entryId,
      teamId: draft.plannedTeam?.universeTeamId,
      teamName: draft.plannedTeam?.name ?? null,
      role: draft.role ?? null,
      seat: draft.seat ?? null,
      number: draft.number ?? null,
      driverBindingCreate: draft.driverBindingCreate,
      entryBindingCreate: draft.entryBindingCreate ?? false,
      reason: draft.reason,
    }));

    return { drivers, resolvedProfiles };
  }

  private async universeTeamExists(db: Db, teamId: string): Promise<boolean> {
    const team = await db.team.findUnique({ where: { id: teamId }, select: { id: true } });
    return team !== null;
  }

  private async entryFor(db: Db, seasonId: string, driverProfileId?: string) {
    if (!driverProfileId) return null;
    return db.seasonDriverEntry.findUnique({
      where: { seasonId_driverProfileId: { seasonId, driverProfileId } },
    });
  }

  private async planRaces(
    db: Db,
    seasonId: string,
    extSeason: { source: string; year: number },
    conflicts: InitConflict[],
  ): Promise<PlannedRace[]> {
    const races = await db.externalRace.findMany({
      where: { source: extSeason.source, seasonYear: extSeason.year },
      orderBy: { round: "asc" },
      select: {
        id: true,
        round: true,
        grandPrix: true,
        name: true,
        _count: { select: { results: true } },
      },
    });
    const plan: PlannedRace[] = [];
    for (const ext of races) {
      const label = ext.grandPrix ?? ext.name ?? `Rodada ${ext.round}`;
      const status: "FINISHED" | "UPCOMING" = ext._count.results > 0 ? "FINISHED" : "UPCOMING";
      const binding = await db.externalBindingRace.findUnique({
        where: { externalRaceId: ext.id },
        select: { raceId: true, confidence: true, race: { select: { seasonId: true } } },
      });
      if (binding) {
        if (binding.confidence !== "CONFIRMED") {
          pushConflict(conflicts, "RACE_BINDING_SUGGESTED", ext.id, label, "Vínculo de corrida sugerido não confirmado");
          continue;
        }
        if (binding.race.seasonId !== seasonId) {
          pushConflict(conflicts, "RACE_SEASON_MISMATCH", ext.id, label, "A corrida vinculada pertence a outra temporada do universo");
          continue;
        }
        plan.push({
          externalRaceId: ext.id,
          round: ext.round,
          name: label,
          action: "REUSED",
          universeRaceId: binding.raceId,
          status,
          bindingCreate: false,
        });
        continue;
      }
      const byRound = await db.race.findFirst({
        where: { seasonId, round: ext.round },
        select: { id: true },
      });
      if (byRound) {
        plan.push({
          externalRaceId: ext.id,
          round: ext.round,
          name: label,
          action: "REUSED",
          universeRaceId: byRound.id,
          status,
          bindingCreate: true,
        });
      } else {
        plan.push({
          externalRaceId: ext.id,
          round: ext.round,
          name: label,
          action: "CREATED",
          universeRaceId: randomUUID(),
          status,
          bindingCreate: true,
        });
      }
    }
    return plan;
  }

  private async planResults(
    db: Db,
    extSeason: { source: string; year: number },
    races: PlannedRace[],
    profiles: Map<string, string>,
    conflicts: InitConflict[],
  ): Promise<PlannedResult[]> {
    const externalResults = await db.externalResult.findMany({
      where: { source: extSeason.source, externalRace: { seasonYear: extSeason.year } },
      include: {
        externalRace: { select: { round: true } },
        externalDriver: { select: { name: true, externalId: true } },
      },
      orderBy: [{ externalDriver: { name: "asc" } }, { externalRace: { round: "asc" } }],
    });
    const raceById = new Map(races.map((race) => [race.externalRaceId, race]));
    const plan: PlannedResult[] = [];
    for (const ext of externalResults) {
      const label = `${ext.externalDriver.name} rodada ${ext.externalRace.round ?? "?"}`;
      const base = {
        externalResultId: ext.id,
        externalDriverId: ext.externalDriver.externalId,
        driverName: ext.externalDriver.name,
      };
      const race = raceById.get(ext.externalRaceId);
      if (!race || race.action === "CONFLICT") {
        pushConflict(conflicts, "RACE_NOT_RESOLVED", ext.id, label, "Inclua o escopo RACES para materializar as corridas antes dos resultados");
        plan.push({
          ...base,
          action: "CONFLICT",
          bindingCreate: false,
          reason: "Corrida não resolvida",
          position: null,
          points: 0,
          grid: null,
          fastestLap: false,
          status: null,
          sourceHash: "",
        });
        continue;
      }
      const driverProfileId = profiles.get(ext.externalDriver.externalId);
      if (!driverProfileId) {
        pushConflict(conflicts, "DRIVER_GRID_REQUIRED", ext.id, label, "Piloto sem perfil resolvido: inclua o escopo DRIVER_GRID");
        plan.push({
          ...base,
          action: "CONFLICT",
          bindingCreate: false,
          reason: "Piloto não materializado",
          position: null,
          points: 0,
          grid: null,
          fastestLap: false,
          status: null,
          sourceHash: "",
        });
        continue;
      }
      const existing = await db.raceResult.findUnique({
        where: {
          raceId_driverProfileId: {
            raceId: race.universeRaceId!,
            driverProfileId,
          },
        },
      });
      if (existing) {
        const binding = await db.externalBindingResult.findUnique({
          where: { raceResultId: existing.id },
          select: { confidence: true },
        });
        if (binding && binding.confidence === "CONFIRMED") {
          plan.push({
            ...base,
            driverProfileId,
            raceId: race.universeRaceId,
            action: "REUSED",
            raceResultId: existing.id,
            bindingCreate: false,
            position: null,
            points: 0,
            grid: null,
            fastestLap: false,
            status: null,
            sourceHash: "",
          });
        } else {
          pushConflict(conflicts, "RESULT_CONFLICT", ext.id, label, "Resultado já existe no universo sem vínculo: não sobrescrever");
          plan.push({
            ...base,
            action: "CONFLICT",
            bindingCreate: false,
            reason: "Resultado canônico existente",
            position: null,
            points: 0,
            grid: null,
            fastestLap: false,
            status: null,
            sourceHash: "",
          });
        }
        continue;
      }
      const sourceHash = computeContentHash({
        position: ext.position,
        points: ext.points,
        grid: ext.grid,
        fastestLap: ext.fastestLap,
        status: ext.status,
        round: ext.externalRace.round,
      });
      plan.push({
        ...base,
        driverProfileId,
        raceId: race.universeRaceId,
        action: "CREATED",
        raceResultId: randomUUID(),
        bindingCreate: true,
        position: ext.position ?? null,
        points: ext.points ?? 0,
        grid: ext.grid ?? null,
        fastestLap: ext.fastestLap ?? false,
        status: ext.status ?? null,
        sourceHash,
      });
    }
    return plan;
  }

  private async planStandings(
    db: Db,
    extSeason: { source: string; year: number },
    seasonId: string,
    profiles: Map<string, string>,
    conflicts: InitConflict[],
  ): Promise<PlannedStanding[]> {
    const externalStandings = await db.externalStanding.findMany({
      where: { source: extSeason.source, seasonYear: extSeason.year },
      include: { externalDriver: { select: { name: true, externalId: true } } },
      orderBy: [{ position: "asc" }, { externalDriver: { name: "asc" } }],
    });
    const plan: PlannedStanding[] = [];
    for (const ext of externalStandings) {
      const label = ext.externalDriver.name;
      const driverProfileId = profiles.get(ext.externalDriver.externalId);
      if (!driverProfileId) {
        pushConflict(conflicts, "DRIVER_GRID_REQUIRED", ext.id, label, "Piloto sem perfil resolvido: inclua o escopo DRIVER_GRID");
        plan.push({
          externalStandingId: ext.id,
          externalDriverId: ext.externalDriver.externalId,
          driverName: label,
          seasonId,
          action: "CONFLICT",
          bindingCreate: false,
          reason: "Piloto não materializado",
          position: null,
          points: 0,
          wins: 0,
          podiums: 0,
          sourceHash: "",
        });
        continue;
      }
      const existing = await db.championshipStanding.findUnique({
        where: { seasonId_driverProfileId: { seasonId, driverProfileId } },
      });
      if (existing) {
        const binding = await db.externalBindingStanding.findUnique({
          where: { championshipStandingId: existing.id },
          select: { confidence: true },
        });
        if (binding && binding.confidence === "CONFIRMED") {
          plan.push({
            externalStandingId: ext.id,
            externalDriverId: ext.externalDriver.externalId,
            driverName: label,
            driverProfileId,
            seasonId,
            action: "REUSED",
            standingId: existing.id,
            bindingCreate: false,
            position: null,
            points: 0,
            wins: 0,
            podiums: 0,
            sourceHash: "",
          });
        } else {
          pushConflict(conflicts, "STANDING_CONFLICT", ext.id, label, "Classificação já existe no universo sem vínculo: não sobrescrever");
          plan.push({
            externalStandingId: ext.id,
            externalDriverId: ext.externalDriver.externalId,
            driverName: label,
            driverProfileId,
            seasonId,
            action: "CONFLICT",
            bindingCreate: false,
            reason: "Classificação canônica existente",
            position: null,
            points: 0,
            wins: 0,
            podiums: 0,
            sourceHash: "",
          });
        }
        continue;
      }
      const sourceHash = computeContentHash({
        position: ext.position,
        points: ext.points,
        wins: ext.wins,
        podiums: ext.podiums,
      });
      plan.push({
        externalStandingId: ext.id,
        externalDriverId: ext.externalDriver.externalId,
        driverName: label,
        driverProfileId,
        seasonId,
        action: "CREATED",
        standingId: randomUUID(),
        bindingCreate: true,
        position: ext.position ?? null,
        points: ext.points ?? 0,
        wins: ext.wins ?? 0,
        podiums: ext.podiums ?? 0,
        sourceHash,
      });
    }
    return plan;
  }

  private async materialize(
    tx: Prisma.TransactionClient,
    actor: Actor,
    input: UniverseInitializationInput,
    plan: InitReport,
  ): Promise<void> {
    if (plan.seasonBindingCreated) {
      await tx.externalBindingSeason.create({
        data: {
          externalSeasonId: input.externalSeasonId,
          seasonId: input.seasonId,
          confidence: "CONFIRMED",
          boundBy: actor.role ?? null,
        },
      });
    }

    for (const team of plan.teams) {
      if (team.action !== "CREATED" || !team.universeTeamId) continue;
      await tx.team.create({
        data: {
          id: team.universeTeamId,
          userId: actor.id,
          name: team.name,
          shortName: team.shortName,
          color: team.color,
        },
      });
      await tx.externalBindingTeam.create({
        data: {
          externalTeamId: await this.externalTeamId(tx, plan.season.source, team.externalId),
          teamId: team.universeTeamId,
          confidence: "CONFIRMED",
          boundBy: actor.role ?? null,
        },
      });
    }

    for (const driver of plan.drivers) {
      if (driver.charAction === "CREATED" && driver.characterId) {
        await tx.character.create({
          data: {
            id: driver.characterId,
            userId: actor.id,
            controlledBy: "USER",
            name: driver.name,
            nationality: driver.nationality ?? "Unknown",
            gender: null,
            birthDate: deterministicBirthDate(`${plan.season.source}:${driver.externalId}`),
            dna: {},
          },
        });
      }
      if (driver.profileAction === "CREATED" && driver.driverProfileId && driver.characterId) {
        await tx.driverProfile.create({
          data: {
            id: driver.driverProfileId,
            characterId: driver.characterId,
            number: driver.number ?? null,
            teamId: null,
          },
        });
      }
      if (driver.driverBindingCreate && driver.characterId) {
        await tx.externalBindingDriver.create({
          data: {
            externalDriverId: await this.externalDriverId(tx, plan.season.source, driver.externalId),
            characterId: driver.characterId,
            confidence: "CONFIRMED",
            boundBy: actor.role ?? null,
          },
        });
      }
      if (driver.entryAction === "CREATED" && driver.entryId && driver.driverProfileId && driver.teamId) {
        await tx.seasonDriverEntry.create({
          data: {
            id: driver.entryId,
            seasonId: input.seasonId,
            driverProfileId: driver.driverProfileId,
            teamId: driver.teamId,
            role: driver.role,
            seat: driver.seat,
            number: driver.number,
            status: "ACTIVE",
            provenance: "IMPORTED",
          },
        });
        await tx.externalBindingDriverSeason.create({
          data: {
            externalDriverSeasonId: await this.externalDriverSeasonId(
              tx,
              plan.season.source,
              driver.externalId,
              plan.season.year,
            ),
            seasonDriverEntryId: driver.entryId,
            confidence: "CONFIRMED",
            boundBy: actor.role ?? null,
          },
        });
        await tx.driverEntryEvent.create({
          data: {
            entryId: driver.entryId,
            kind: "CREATED",
            from: Prisma.JsonNull,
            to: {
              teamId: driver.teamId,
              role: driver.role,
              seat: driver.seat,
              number: driver.number,
              status: "ACTIVE",
            } as Prisma.InputJsonValue,
            reason: "Initialization do universo a partir do External Season",
          },
        });
      } else if (
        driver.entryAction === "REUSED" &&
        driver.entryId &&
        driver.entryBindingCreate
      ) {
        await tx.externalBindingDriverSeason.create({
          data: {
            externalDriverSeasonId: await this.externalDriverSeasonId(
              tx,
              plan.season.source,
              driver.externalId,
              plan.season.year,
            ),
            seasonDriverEntryId: driver.entryId,
            confidence: "CONFIRMED",
            boundBy: actor.role ?? null,
          },
        });
      }
    }

    for (const race of plan.races) {
      if (race.action === "CREATED" && race.universeRaceId) {
        await tx.race.create({
          data: {
            id: race.universeRaceId,
            seasonId: input.seasonId,
            name: race.name ?? `Rodada ${race.round}`,
            circuit: await this.circuitName(tx, race.externalRaceId),
            country: null,
            date: await this.raceDate(tx, race.externalRaceId),
            round: race.round,
            status: race.status,
            provenance: "IMPORTED",
          },
        });
        await tx.externalBindingRace.create({
          data: {
            externalRaceId: race.externalRaceId,
            raceId: race.universeRaceId,
            confidence: "CONFIRMED",
            boundBy: actor.role ?? null,
          },
        });
      } else if (race.bindingCreate && race.universeRaceId) {
        await tx.externalBindingRace.create({
          data: {
            externalRaceId: race.externalRaceId,
            raceId: race.universeRaceId,
            confidence: "CONFIRMED",
            boundBy: actor.role ?? null,
          },
        });
      }
    }

    for (const result of plan.results) {
      if (result.action !== "CREATED" || !result.raceResultId || !result.raceId || !result.driverProfileId) {
        continue;
      }
      await tx.raceResult.create({
        data: {
          id: result.raceResultId,
          raceId: result.raceId,
          driverProfileId: result.driverProfileId,
          position: result.position,
          points: result.points,
          grid: result.grid,
          fastestLap: result.fastestLap,
          status: result.status,
          provenance: "IMPORTED",
          sourceHash: result.sourceHash,
        },
      });
      await tx.externalBindingResult.create({
        data: {
          externalResultId: result.externalResultId,
          raceResultId: result.raceResultId,
          confidence: "CONFIRMED",
          boundBy: actor.role ?? null,
        },
      });
      await tx.race.updateMany({
        where: { id: result.raceId, status: "UPCOMING" },
        data: { status: "FINISHED" },
      });
    }

    for (const standing of plan.standings) {
      if (standing.action !== "CREATED" || !standing.standingId || !standing.driverProfileId) {
        continue;
      }
      await tx.championshipStanding.create({
        data: {
          id: standing.standingId,
          seasonId: standing.seasonId,
          driverProfileId: standing.driverProfileId,
          position: standing.position,
          points: standing.points,
          wins: standing.wins,
          podiums: standing.podiums,
          provenance: "IMPORTED",
          sourceHash: standing.sourceHash,
        },
      });
      await tx.externalBindingStanding.create({
        data: {
          externalStandingId: standing.externalStandingId,
          championshipStandingId: standing.standingId,
          confidence: "CONFIRMED",
          boundBy: actor.role ?? null,
        },
      });
    }
  }

  private async externalTeamId(tx: Prisma.TransactionClient, source: string, externalId: string): Promise<string> {
    const team = await tx.externalTeam.findUniqueOrThrow({
      where: { source_externalId: { source, externalId } },
      select: { id: true },
    });
    return team.id;
  }

  private async externalDriverId(tx: Prisma.TransactionClient, source: string, externalId: string): Promise<string> {
    const driver = await tx.externalDriver.findUniqueOrThrow({
      where: { source_externalId: { source, externalId } },
      select: { id: true },
    });
    return driver.id;
  }

  private async externalDriverSeasonId(
    tx: Prisma.TransactionClient,
    source: string,
    externalId: string,
    year: number,
  ): Promise<string> {
    const driver = await tx.externalDriver.findUniqueOrThrow({
      where: { source_externalId: { source, externalId } },
      select: { id: true },
    });
    const ds = await tx.externalDriverSeason.findUniqueOrThrow({
      where: {
        source_externalDriverId_seasonYear: {
          source,
          externalDriverId: driver.id,
          seasonYear: year,
        },
      },
      select: { id: true },
    });
    return ds.id;
  }

  private async circuitName(tx: Prisma.TransactionClient, externalRaceId: string): Promise<string | null> {
    const race = await tx.externalRace.findUnique({
      where: { id: externalRaceId },
      select: { circuitName: true },
    });
    return race?.circuitName ?? null;
  }

  private async raceDate(tx: Prisma.TransactionClient, externalRaceId: string): Promise<Date | null> {
    const race = await tx.externalRace.findUnique({
      where: { id: externalRaceId },
      select: { date: true },
    });
    return race?.date ?? null;
  }
}

export const universeInitService = new UniverseInitService();