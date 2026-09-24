import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  raceIdPathParamsSchema,
  seasonIdPathParamsSchema,
} from "./championship.schema.js";
import { pointsForPosition } from "./championship-progression.engine.js";

type StandingAggregate = {
  driverProfileId: string;
  points: number;
  wins: number;
  podiums: number;
  rankName: string | null;
  teamId: string | null;
};

function applyRacePoints(
  position: number | null | undefined,
): number {
  return pointsForPosition(position);
}

export const championshipProgressionRoutes: FastifyPluginAsync = async (
  fastify,
) => {
  fastify.post(
    "/api/races/:raceId/championship/apply",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceIdPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const race = await prisma.race.findUnique({
        where: { id: params.data.raceId },
        select: { id: true, seasonId: true, status: true },
      });
      if (!race) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }
      const season = await prisma.season.findUnique({
        where: { id: race.seasonId },
        select: { id: true, status: true },
      });
      if (!season) {
        return reply.code(404).send({
          error: "Temporada não encontrada",
          code: "NOT_FOUND",
        });
      }

      const [seasonResults, seasonRaces] = await Promise.all([
        prisma.raceResult.findMany({
          where: { race: { seasonId: season.id } },
          select: {
            driverProfileId: true,
            position: true,
            points: true,
            driverProfile: {
              select: {
                teamId: true,
                character: { select: { name: true } },
              },
            },
          },
        }),
        prisma.race.findMany({
          where: { seasonId: season.id },
          select: { id: true, status: true },
        }),
      ]);

      const otherRacesFinished = seasonRaces
        .filter((scheduled) => scheduled.id !== race.id)
        .every((scheduled) => scheduled.status === "FINISHED");
      const nextSeasonStatus = otherRacesFinished ? "FINISHED" : "ACTIVE";

      const byDriver = new Map<string, StandingAggregate>();
      const pointsByRaceRow: Array<{
        driverProfileId: string;
        points: number;
      }> = [];

      for (const result of seasonResults) {
        const earned = applyRacePoints(result.position);
        pointsByRaceRow.push({
          driverProfileId: result.driverProfileId,
          points: earned,
        });

        const current =
          byDriver.get(result.driverProfileId) ??
          ({
            driverProfileId: result.driverProfileId,
            points: 0,
            wins: 0,
            podiums: 0,
            rankName: result.driverProfile.character.name,
            teamId: result.driverProfile.teamId,
          } satisfies StandingAggregate);
        current.points += earned;
        if (result.position === 1) current.wins += 1;
        if (
          result.position !== null &&
          result.position >= 1 &&
          result.position <= 3
        ) {
          current.podiums += 1;
        }
        byDriver.set(result.driverProfileId, current);
      }

      const aggregates = [...byDriver.values()].sort(
        (a, b) =>
          b.points - a.points ||
          b.wins - a.wins ||
          b.podiums - a.podiums ||
          (a.rankName ?? "").localeCompare(b.rankName ?? "pt", "pt"),
      );

      const standingsToSave = aggregates.map((entry, index) => ({
        seasonId: season.id,
        driverProfileId: entry.driverProfileId,
        points: entry.points,
        wins: entry.wins,
        podiums: entry.podiums,
        position: index + 1,
      }));

      await prisma.$transaction([
        ...pointsByRaceRow.map((row) =>
          prisma.raceResult.updateMany({
            where: {
              raceId: race.id,
              driverProfileId: row.driverProfileId,
            },
            data: { points: row.points },
          }),
        ),
        ...standingsToSave.map((standing) =>
          prisma.championshipStanding.upsert({
            where: {
              seasonId_driverProfileId: {
                seasonId: standing.seasonId,
                driverProfileId: standing.driverProfileId,
              },
            },
            create: standing,
            update: {
              points: standing.points,
              wins: standing.wins,
              podiums: standing.podiums,
              position: standing.position,
            },
          }),
        ),
        prisma.race.update({
          where: { id: race.id },
          data: { status: "FINISHED" },
        }),
        prisma.season.update({
          where: { id: season.id },
          data: { status: nextSeasonStatus },
        }),
      ]);

      const saved = await prisma.championshipStanding.findMany({
        where: { seasonId: season.id },
        select: {
          driverProfileId: true,
          points: true,
          wins: true,
          podiums: true,
          position: true,
        },
        orderBy: { position: "asc" },
      });

      return reply.send({
        race: { id: race.id, status: "FINISHED" },
        season: { id: season.id, status: nextSeasonStatus },
        standings: saved,
      });
    },
  );

  fastify.get(
    "/api/seasons/:seasonId/standings/teams",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const season = await prisma.season.findUnique({
        where: { id: params.data.seasonId },
        select: { id: true },
      });
      if (!season) {
        return reply.code(404).send({
          error: "Temporada não encontrada",
          code: "NOT_FOUND",
        });
      }

      const userId = request.user!.id;
      const [standings, entries] = await Promise.all([
        prisma.championshipStanding.findMany({
          where: { seasonId: season.id, driverProfile: { character: { userId } } },
          select: {
            driverProfileId: true,
            points: true,
            wins: true,
            podiums: true,
            driverProfile: {
              select: {
                character: { select: { name: true } },
              },
            },
          },
        }),
        prisma.seasonDriverEntry.findMany({
          where: { seasonId: season.id },
          select: {
            driverProfileId: true,
            teamId: true,
            team: { select: { id: true, name: true } },
          },
        }),
      ]);

      const teamByDriver = new Map(
        entries.map((entry) => [entry.driverProfileId, entry]),
      );

      const byTeam = new Map<
        string,
        {
          teamId: string;
          name: string;
          points: number;
          wins: number;
          podiums: number;
        }
      >();

      for (const standing of standings) {
        const entry = teamByDriver.get(standing.driverProfileId);
        if (!entry || entry.teamId === null) continue;
        const teamId = entry.teamId;
        const current = byTeam.get(teamId) ?? {
          teamId,
          name: entry.team?.name ?? "",
          points: 0,
          wins: 0,
          podiums: 0,
        };
        current.points += standing.points;
        current.wins += standing.wins;
        current.podiums += standing.podiums;
        byTeam.set(teamId, current);
      }

      const teams = [...byTeam.values()]
        .sort(
          (a, b) =>
            b.points - a.points ||
            b.wins - a.wins ||
            b.podiums - a.podiums ||
            a.name.localeCompare(b.name, "pt"),
        )
        .map((team, index) => ({ position: index + 1, ...team }));

      return reply.send({ teams });
    },
  );
};

export default championshipProgressionRoutes;