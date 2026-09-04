import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createRaceResultSchema,
  createRaceSchema,
  createSeasonSchema,
  createStandingSchema,
  raceIdPathParamsSchema,
  raceParamsSchema,
  raceResultParamsSchema,
  seasonIdParamsSchema,
  seasonIdPathParamsSchema,
  standingParamsSchema,
  updateRaceResultSchema,
  updateRaceSchema,
  updateSeasonSchema,
  updateStandingSchema,
} from "./championship.schema.js";

const seasonSelect = {
  id: true,
  year: true,
  name: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const raceSelect = {
  id: true,
  seasonId: true,
  name: true,
  circuit: true,
  country: true,
  date: true,
  round: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} as const;

const resultSelect = {
  id: true,
  raceId: true,
  driverProfileId: true,
  position: true,
  points: true,
  grid: true,
  fastestLap: true,
  status: true,
  createdAt: true,
  updatedAt: true,
  driverProfile: {
    select: {
      id: true,
      characterId: true,
      number: true,
      teamId: true,
      character: {
        select: { id: true, name: true, nationality: true, imageUrl: true },
      },
    },
  },
} as const;

const standingSelect = {
  id: true,
  seasonId: true,
  driverProfileId: true,
  points: true,
  position: true,
  wins: true,
  podiums: true,
  createdAt: true,
  updatedAt: true,
  driverProfile: {
    select: {
      id: true,
      characterId: true,
      number: true,
      teamId: true,
      character: {
        select: { id: true, name: true, nationality: true, imageUrl: true },
      },
    },
  },
} as const;

// Detecta erros conhecidos do Prisma (violação de unicidade / FK restrita)
// e os converte em respostas previsíveis de conflito (409).
function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

// Valida se o DriverProfile existe e é de propriedade do usuário autenticado
// (ownership indireta via Character.userId). Retorna true apenas quando o
// piloto pertence ao usuário (e não é um perfil global/IA).
async function isOwnedDriver(
  driverProfileId: string,
  userId: string,
): Promise<boolean> {
  const driver = await prisma.driverProfile.findFirst({
    where: { id: driverProfileId, character: { userId } },
    select: { id: true },
  });
  return driver !== null;
}

export const championshipRoutes: FastifyPluginAsync = async (fastify) => {
  // ------------------------------------------------------------------
  // Seasons — entidade global compartilhada.
  // ------------------------------------------------------------------

  fastify.get(
    "/api/seasons",
    { preHandler: [fastify.authenticate] },
    async () => {
      const seasons = await prisma.season.findMany({
        select: seasonSelect,
        orderBy: { year: "desc" },
      });
      return { seasons };
    },
  );

  fastify.post(
    "/api/seasons",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = createSeasonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const season = await prisma.season.create({
        data: parsed.data,
        select: seasonSelect,
      });
      return reply.code(201).send({ season });
    },
  );

  fastify.get(
    "/api/seasons/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const season = await prisma.season.findUnique({
        where: { id: params.data.id },
        select: seasonSelect,
      });
      if (!season) {
        return reply.code(404).send({
          error: "Temporada não encontrada",
          code: "NOT_FOUND",
        });
      }
      return reply.send({ season });
    },
  );

  fastify.patch(
    "/api/seasons/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = updateSeasonSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const existing = await prisma.season.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "Temporada não encontrada",
          code: "NOT_FOUND",
        });
      }
      const season = await prisma.season.update({
        where: { id: existing.id },
        data: parsed.data,
        select: seasonSelect,
      });
      return reply.send({ season });
    },
  );

  fastify.delete(
    "/api/seasons/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const existing = await prisma.season.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "Temporada não encontrada",
          code: "NOT_FOUND",
        });
      }
      // Races e standings são excluídas em cascata (onDelete: Cascade).
      await prisma.season.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------
  // Races — entidade global compartilhada, pertencente a uma Season.
  // ------------------------------------------------------------------

  fastify.get(
    "/api/seasons/:seasonId/races",
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
      const races = await prisma.race.findMany({
        where: { seasonId: season.id },
        select: raceSelect,
        orderBy: [{ round: "asc" }, { date: "asc" }],
      });
      return reply.send({ races });
    },
  );

  fastify.post(
    "/api/seasons/:seasonId/races",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = createRaceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
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
      const race = await prisma.race.create({
        data: { seasonId: season.id, ...parsed.data },
        select: raceSelect,
      });
      return reply.code(201).send({ race });
    },
  );

  fastify.get(
    "/api/races/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const race = await prisma.race.findUnique({
        where: { id: params.data.id },
        select: raceSelect,
      });
      if (!race) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }
      return reply.send({ race });
    },
  );

  fastify.patch(
    "/api/races/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = updateRaceSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const existing = await prisma.race.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }
      const race = await prisma.race.update({
        where: { id: existing.id },
        data: parsed.data,
        select: raceSelect,
      });
      return reply.send({ race });
    },
  );

  fastify.delete(
    "/api/races/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const existing = await prisma.race.findUnique({
        where: { id: params.data.id },
        select: { id: true },
      });
      if (!existing) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }
      // Results são excluídos em cascata (onDelete: Cascade).
      await prisma.race.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------
  // RaceResults — ownership indireta via DriverProfile -> Character.
  // ------------------------------------------------------------------

  fastify.get(
    "/api/races/:raceId/results",
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
        select: { id: true },
      });
      if (!race) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }
      const userId = request.user!.id;
      const results = await prisma.raceResult.findMany({
        where: { raceId: race.id, driverProfile: { character: { userId } } },
        select: resultSelect,
        orderBy: [
          { position: "asc" },
          { driverProfile: { character: { name: "asc" } } },
        ],
      });
      return reply.send({ results });
    },
  );

  fastify.post(
    "/api/races/:raceId/results",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceIdPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = createRaceResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const race = await prisma.race.findUnique({
        where: { id: params.data.raceId },
        select: { id: true },
      });
      if (!race) {
        return reply.code(404).send({
          error: "Corrida não encontrada",
          code: "NOT_FOUND",
        });
      }
      if (!(await isOwnedDriver(parsed.data.driverProfileId, request.user!.id))) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }
      try {
        const result = await prisma.raceResult.create({
          data: { raceId: race.id, ...parsed.data },
          select: resultSelect,
        });
        return reply.code(201).send({ result });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Já existe um resultado desse piloto para esta corrida",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  const loadOwnedResult = async (
    id: string,
    userId: string,
  ) => {
    return prisma.raceResult.findFirst({
      where: { id, driverProfile: { character: { userId } } },
      select: { id: true },
    });
  };

  fastify.get(
    "/api/race-results/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceResultParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const userId = request.user!.id;
      const result = await prisma.raceResult.findFirst({
        where: { id: params.data.id, driverProfile: { character: { userId } } },
        select: resultSelect,
      });
      if (!result) {
        return reply.code(404).send({
          error: "Resultado não encontrado",
          code: "NOT_FOUND",
        });
      }
      return reply.send({ result });
    },
  );

  fastify.patch(
    "/api/race-results/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceResultParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = updateRaceResultSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const existing = await loadOwnedResult(params.data.id, request.user!.id);
      if (!existing) {
        return reply.code(404).send({
          error: "Resultado não encontrado",
          code: "NOT_FOUND",
        });
      }
      const result = await prisma.raceResult.update({
        where: { id: existing.id },
        data: parsed.data,
        select: resultSelect,
      });
      return reply.send({ result });
    },
  );

  fastify.delete(
    "/api/race-results/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = raceResultParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const existing = await loadOwnedResult(params.data.id, request.user!.id);
      if (!existing) {
        return reply.code(404).send({
          error: "Resultado não encontrado",
          code: "NOT_FOUND",
        });
      }
      await prisma.raceResult.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );

  // ------------------------------------------------------------------
  // ChampionshipStandings — ownership indireta via DriverProfile.
  // ------------------------------------------------------------------

  fastify.get(
    "/api/seasons/:seasonId/standings",
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
      const standings = await prisma.championshipStanding.findMany({
        where: { seasonId: season.id, driverProfile: { character: { userId } } },
        select: standingSelect,
      });
      const ordered = standings.sort(
        (a, b) => (a.position ?? Infinity) - (b.position ?? Infinity),
      );
      return reply.send({ standings: ordered });
    },
  );

  fastify.post(
    "/api/seasons/:seasonId/standings",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = seasonIdPathParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = createStandingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
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
      if (!(await isOwnedDriver(parsed.data.driverProfileId, request.user!.id))) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }
      try {
        const standing = await prisma.championshipStanding.create({
          data: { seasonId: season.id, ...parsed.data },
          select: standingSelect,
        });
        return reply.code(201).send({ standing });
      } catch (error) {
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Já existe uma classificação desse piloto para esta temporada",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  const loadOwnedStanding = async (id: string, userId: string) => {
    return prisma.championshipStanding.findFirst({
      where: { id, driverProfile: { character: { userId } } },
      select: { id: true },
    });
  };

  fastify.get(
    "/api/championship-standings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = standingParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const userId = request.user!.id;
      const standing = await prisma.championshipStanding.findFirst({
        where: { id: params.data.id, driverProfile: { character: { userId } } },
        select: standingSelect,
      });
      if (!standing) {
        return reply.code(404).send({
          error: "Classificação não encontrada",
          code: "NOT_FOUND",
        });
      }
      return reply.send({ standing });
    },
  );

  fastify.patch(
    "/api/championship-standings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = standingParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const parsed = updateStandingSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }
      const existing = await loadOwnedStanding(params.data.id, request.user!.id);
      if (!existing) {
        return reply.code(404).send({
          error: "Classificação não encontrada",
          code: "NOT_FOUND",
        });
      }
      const standing = await prisma.championshipStanding.update({
        where: { id: existing.id },
        data: parsed.data,
        select: standingSelect,
      });
      return reply.send({ standing });
    },
  );

  fastify.delete(
    "/api/championship-standings/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = standingParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const existing = await loadOwnedStanding(params.data.id, request.user!.id);
      if (!existing) {
        return reply.code(404).send({
          error: "Classificação não encontrada",
          code: "NOT_FOUND",
        });
      }
      await prisma.championshipStanding.delete({ where: { id: existing.id } });
      return reply.code(204).send();
    },
  );
};

export default championshipRoutes;
