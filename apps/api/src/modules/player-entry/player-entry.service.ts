import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import { JOLPICA_SOURCE } from "../external-sync/jolpica.service.js";
import { entryInclude, rosterService } from "../roster/roster.service.js";
import {
  resolveOpeningGrid,
  type OpeningGridState,
  type OpeningGridHolder,
} from "../opening-grid/opening-grid.resolver.js";

type Tx = Prisma.TransactionClient;

const characterSelect = {
  id: true,
  name: true,
  nationality: true,
  gender: true,
  birthDate: true,
  imageUrl: true,
  biography: true,
  controlledBy: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const;

const driverSelect = {
  id: true,
  characterId: true,
  number: true,
  teamId: true,
  updatedAt: true,
} as const;

export class PlayerEntryError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 409,
  ) {
    super(message);
    this.name = "PlayerEntryError";
  }
}

type SetupInput = {
  seasonId?: string;
};

type CreateInput = {
  seasonId: string;
  teamId: string;
  seat: number;
  name: string;
  nationality: string;
  gender: string | null;
  birthDate: Date;
};

function toStarterView(holder: OpeningGridHolder): { name: string; number: number | null } {
  return { name: holder.name, number: holder.number ?? null };
}

export const playerEntryService = {
  async setup(userId: string, input: SetupInput) {
    const universe = await ensureUniverse(userId);
    const seasons = await prisma.season.findMany({
      where: {
        universeId: universe.id,
        externalSeasonBindings: { some: { confidence: "CONFIRMED" } },
      },
      include: {
        externalSeasonBindings: {
          where: { confidence: "CONFIRMED" },
          select: {
            externalSeasonId: true,
            externalSeason: { select: { year: true, status: true } },
          },
        },
      },
      orderBy: { year: "desc" },
    });

    const mappedSeasons = seasons.map((season) => ({
      id: season.id,
      year: season.year,
      status: season.status,
      externalSeasonId: season.externalSeasonBindings[0].externalSeasonId,
      externalSeasonYear:
        season.externalSeasonBindings[0].externalSeason.year,
      externalSeasonStatus:
        season.externalSeasonBindings[0].externalSeason.status ?? null,
    }));

    if (!input.seasonId) {
      return { seasons: mappedSeasons, selection: null };
    }

    const season = mappedSeasons.find((item) => item.id === input.seasonId);
    if (!season) {
      throw new PlayerEntryError(
        "SEASON_NOT_FOUND",
        "Temporada não encontrada ou ainda não vinculada a uma temporada externa confirmada",
        404,
      );
    }

    const externalSeason = await prisma.externalSeason.findUnique({
      where: { id: season.externalSeasonId },
      select: { source: true, year: true },
    });

    const teams = await prisma.team.findMany({
      where: {
        universeId: universe.id,
        externalTeamBindings: { some: { confidence: "CONFIRMED" } },
      },
      include: {
        externalTeamBindings: {
          where: { confidence: "CONFIRMED" },
          select: {
            externalTeamId: true,
            externalTeam: { select: { name: true, externalId: true, color: true } },
          },
        },
      },
      orderBy: { createdAt: "asc" },
    });

    const source = externalSeason?.source;
    const externalYear = externalSeason?.year;
    const result = [];

    const universeEntries = await prisma.seasonDriverEntry.findMany({
      where: { seasonId: input.seasonId, teamId: { in: teams.map((team) => team.id) } },
      include: entryInclude,
    });

    const grid = await resolveOpeningGrid(prisma, {
      source: source ?? JOLPICA_SOURCE,
      year: externalYear ?? 0,
      seasonId: input.seasonId,
    });
    const gridByExternalTeam = new Map(
      grid.teams.map((team) => [team.externalTeamId, team]),
    );

    for (const team of teams) {
      const binding = team.externalTeamBindings[0];
      const entryGrid = gridByExternalTeam.get(binding.externalTeam.externalId);
      const state: OpeningGridState = entryGrid?.state ?? "RESOLVED";
      const entries = universeEntries.filter((entry) => entry.teamId === team.id);

      const seats: Array<{
        seat: number;
        state: OpeningGridState;
        source: { name: string; number: number | null; teamName: string | null } | null;
        universe: { characterName: string; provenance: string } | null;
      }> = [1, 2].map((seat) => {
        const holder = entryGrid?.seats.find((item) => item.seat === seat)?.holder ?? null;
        const univ = entries.find((entry) => entry.seat === seat);
        return {
          seat,
          state,
          source: holder
            ? {
                name: holder.name,
                number: holder.number ?? null,
                teamName: binding.externalTeam.name,
              }
            : null,
          universe: univ
            ? {
                characterName: univ.driverProfile.character.name,
                provenance: univ.provenance,
              }
            : null,
        };
      });

      const reserves = (entryGrid?.reserves ?? []).map((item) => ({
        name: item.name,
        number: item.number ?? null,
        teamName: binding.externalTeam.name,
      }));

      result.push({
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        color: team.color,
        externalTeamId: binding.externalTeam.externalId,
        openingGrid: {
          state,
          reasons: entryGrid?.reasons ?? [],
          starters: (entryGrid?.starters ?? []).map(toStarterView),
          reserves: (entryGrid?.reserves ?? []).map(toStarterView),
          participants: (entryGrid?.participants ?? []).map(toStarterView),
          seats,
        },
        seats,
        reserve: reserves,
      });
    }

    return {
      seasons: mappedSeasons,
      selection: {
        seasonId: input.seasonId,
        openingGridState: grid.state,
        teams: result,
      },
    };
  },

  async create(userId: string, input: CreateInput) {
    const universe = await ensureUniverse(userId);
    return prisma.$transaction(async (tx: Tx) => {
      const season = await tx.season.findFirst({
        where: { id: input.seasonId, universeId: universe.id },
        select: { id: true },
      });
      if (!season) {
        throw new PlayerEntryError(
          "SEASON_NOT_FOUND",
          "Temporada não encontrada",
          404,
        );
      }

      const seasonBinding = await tx.externalBindingSeason.findUnique({
        where: { seasonId: input.seasonId },
        select: { confidence: true, externalSeasonId: true },
      });
      if (!seasonBinding || seasonBinding.confidence !== "CONFIRMED") {
        throw new PlayerEntryError(
          "SEASON_NOT_BOUND",
          "A temporada ainda não está vinculada a uma temporada externa confirmada",
          409,
        );
      }

      const team = await tx.team.findFirst({
        where: { id: input.teamId, universeId: universe.id },
        select: { id: true },
      });
      if (!team) {
        throw new PlayerEntryError("TEAM_NOT_FOUND", "Equipe não encontrada", 404);
      }

      const teamBinding = await tx.externalBindingTeam.findUnique({
        where: { teamId: input.teamId },
        select: {
          confidence: true,
          externalTeam: { select: { externalId: true } },
        },
      });
      if (!teamBinding || teamBinding.confidence !== "CONFIRMED") {
        throw new PlayerEntryError(
          "TEAM_NOT_MIRRORED",
          "A equipe ainda não está espelhada de uma equipe externa confirmada",
          409,
        );
      }

      const extSeason = await tx.externalSeason.findUnique({
        where: { id: seasonBinding.externalSeasonId },
        select: { source: true, year: true },
      });
      if (!extSeason) {
        throw new PlayerEntryError(
          "EXTERNAL_SEASON_NOT_FOUND",
          "Temporada externa não encontrada",
          409,
        );
      }

      const openingGrid = await resolveOpeningGrid(tx, {
        source: extSeason.source,
        year: extSeason.year,
        seasonId: input.seasonId,
        teamIds: [input.teamId],
      });
      const teamGrid = openingGrid.teams.find(
        (gridTeam) => gridTeam.externalTeamId === teamBinding.externalTeam.externalId,
      );
      if (teamGrid?.state === "UNRESOLVED") {
        throw new PlayerEntryError(
          "OPENING_GRID_UNRESOLVED",
          "Os titulares do grid de abertura desta equipe ainda não foram determinados pela fonte",
          409,
        );
      }
      if (teamGrid?.state === "CONFLICTED") {
        throw new PlayerEntryError(
          "OPENING_GRID_CONFLICTED",
          "O grid de abertura desta equipe possui claims incompatíveis na fonte",
          409,
        );
      }

      const existing = await tx.character.findFirst({
        where: { userId, name: { equals: input.name, mode: "insensitive" } },
        select: { id: true, driverProfile: { select: { id: true } } },
      });
      if (existing && existing.driverProfile) {
        throw new PlayerEntryError(
          "CHARACTER_NAME_EXISTS",
          "Já existe um personagem com esse nome e perfil de piloto no seu universo",
          409,
        );
      }

      const character = await tx.character.create({
        data: {
          userId,
          universeId: universe.id,
          controlledBy: "USER",
          name: input.name,
          nationality: input.nationality,
          gender: input.gender,
          birthDate: input.birthDate,
          dna: {} as Prisma.InputJsonValue,
        },
        select: characterSelect,
      });

      const createdProfile = await tx.driverProfile.create({
        data: { characterId: character.id },
        select: { id: true },
      });

      const displacedBefore = await tx.seasonDriverEntry.findUnique({
        where: {
          seasonId_teamId_seat: {
            seasonId: input.seasonId,
            teamId: input.teamId,
            seat: input.seat,
          },
        },
        include: entryInclude,
      });

      const entry = await rosterService.assignDriverToSeatInTx(tx, userId, {
        seasonId: input.seasonId,
        teamId: input.teamId,
        driverProfileId: createdProfile.id,
        seat: input.seat,
      });

      const driverProfile = await tx.driverProfile.findUnique({
        where: { id: createdProfile.id },
        select: driverSelect,
      });

      const displaced =
        displacedBefore &&
        displacedBefore.status === "ACTIVE" &&
        displacedBefore.driverProfileId !== createdProfile.id
          ? {
              entry: await tx.seasonDriverEntry.findUniqueOrThrow({
                where: { id: displacedBefore.id },
                include: entryInclude,
              }),
            }
          : null;

      return { character, driverProfile, entry, displaced };
    });
  },
};

export type PlayerEntryCreateResult = Awaited<
  ReturnType<typeof playerEntryService.create>
>;