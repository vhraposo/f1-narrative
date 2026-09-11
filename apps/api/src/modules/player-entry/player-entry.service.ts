import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { entryInclude, rosterService } from "../roster/roster.service.js";

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

function raceSeatSortKey(
  number: number | null,
  name: string,
): { key: number; name: string } {
  return { key: number ?? 9999, name };
}

export const playerEntryService = {
  async setup(userId: string, input: SetupInput) {
    const seasons = await prisma.season.findMany({
      where: {
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
        userId,
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

    for (const team of teams) {
      const binding = team.externalTeamBindings[0];
      const externalDs = source
        ? await prisma.externalDriverSeason.findMany({
            where: {
              source,
              seasonYear: externalYear ?? 0,
              teamExternalId: binding.externalTeam.externalId,
            },
            include: { externalDriver: { select: { name: true, number: true } } },
          })
        : [];

      const riders = externalDs
        .filter((item) => (item.role ?? "").toUpperCase() !== "RESERVE")
        .sort(
          (a, b) =>
            raceSeatSortKey(a.number ?? a.externalDriver.number, a.externalDriver.name).key -
              raceSeatSortKey(
                b.number ?? b.externalDriver.number,
                b.externalDriver.name,
              ).key ||
            a.externalDriver.name.localeCompare(b.externalDriver.name),
        )
        .slice(0, 2);

      const reserves = externalDs
        .filter((item) => (item.role ?? "").toUpperCase() === "RESERVE")
        .map((item) => ({
          name: item.externalDriver.name,
          number: item.number ?? item.externalDriver.number ?? null,
          teamName: item.teamNameSnapshot ?? binding.externalTeam.name,
        }));

      const universeEntries = await prisma.seasonDriverEntry.findMany({
        where: { seasonId: input.seasonId, teamId: team.id },
        include: entryInclude,
      });

      const seats: Array<{
        seat: number;
        source: { name: string; number: number | null; teamName: string | null } | null;
        universe: { characterName: string; provenance: string } | null;
      }> = [1, 2].map((seat) => {
        const rider = riders[seat - 1];
        const univ = universeEntries.find((entry) => entry.seat === seat);
        return {
          seat,
          source: rider
            ? {
                name: rider.externalDriver.name,
                number: rider.number ?? rider.externalDriver.number ?? null,
                teamName: rider.teamNameSnapshot ?? null,
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

      result.push({
        id: team.id,
        name: team.name,
        shortName: team.shortName,
        color: team.color,
        externalTeamId: binding.externalTeam.externalId,
        seats,
        reserve: reserves,
      });
    }

    return {
      seasons: mappedSeasons,
      selection: {
        seasonId: input.seasonId,
        teams: result,
      },
    };
  },

  async create(userId: string, input: CreateInput) {
    return prisma.$transaction(async (tx: Tx) => {
      const season = await tx.season.findUnique({
        where: { id: input.seasonId },
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
        select: { confidence: true },
      });
      if (!seasonBinding || seasonBinding.confidence !== "CONFIRMED") {
        throw new PlayerEntryError(
          "SEASON_NOT_BOUND",
          "A temporada ainda não está vinculada a uma temporada externa confirmada",
          409,
        );
      }

      const team = await tx.team.findFirst({
        where: { id: input.teamId, userId },
        select: { id: true },
      });
      if (!team) {
        throw new PlayerEntryError("TEAM_NOT_FOUND", "Equipe não encontrada", 404);
      }

      const teamBinding = await tx.externalBindingTeam.findUnique({
        where: { teamId: input.teamId },
        select: { confidence: true },
      });
      if (!teamBinding || teamBinding.confidence !== "CONFIRMED") {
        throw new PlayerEntryError(
          "TEAM_NOT_MIRRORED",
          "A equipe ainda não está espelhada de uma equipe externa confirmada",
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