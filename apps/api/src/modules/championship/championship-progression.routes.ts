import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  raceIdPathParamsSchema,
  seasonIdPathParamsSchema,
} from "./championship.schema.js";
import { recomputeSeasonStandings } from "./championship-progression.service.js";

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

      const seasonRaces = await prisma.race.findMany({
        where: { seasonId: season.id },
        select: { id: true, status: true },
      });

      const otherRacesFinished = seasonRaces
        .filter((scheduled) => scheduled.id !== race.id)
        .every((scheduled) => scheduled.status === "FINISHED");
      const nextSeasonStatus = otherRacesFinished ? "FINISHED" : "ACTIVE";

      await prisma.$transaction(async (tx) => {
        await recomputeSeasonStandings(tx, season.id);
        await tx.race.update({
          where: { id: race.id },
          data: { status: "FINISHED" },
        });
        await tx.season.update({
          where: { id: season.id },
          data: { status: nextSeasonStatus },
        });
      });

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