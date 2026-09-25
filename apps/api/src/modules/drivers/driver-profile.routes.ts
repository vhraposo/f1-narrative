import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import { ensureUniverse } from "../universe/universe.service.js";
import {
  driverCharacterIdParamSchema,
  driverIdParamSchema,
  driverListQuerySchema,
  updateDriverProfileSchema,
  upsertDriverSchema,
} from "./driver-profile.schema.js";

const WORLD_KEY = "default";

type DriverListItem = {
  number: number | null;
  characterId: string;
  character: { name: string };
};

function compareDrivers(a: DriverListItem, b: DriverListItem): number {
  if (a.number !== b.number) {
    if (a.number === null) return 1;
    if (b.number === null) return -1;
    return a.number - b.number;
  }
  const byName = a.character.name.localeCompare(b.character.name);
  if (byName !== 0) return byName;
  return a.characterId.localeCompare(b.characterId);
}

const characterSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
} as const;

const teamSelect = {
  id: true,
  name: true,
  shortName: true,
  color: true,
} as const;

const driverInclude = {
  character: { select: characterSelect },
  team: { select: teamSelect },
} as const;

export const driversRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/drivers",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const query = driverListQuerySchema.safeParse(request.query ?? {});
      if (!query.success) {
        return reply.code(400).send({
          error: "Parâmetros inválidos",
          code: "VALIDATION_ERROR",
          issues: query.error.issues,
        });
      }

      const universe = await ensureUniverse(userId);
      const [profiles, world] = await Promise.all([
        prisma.driverProfile.findMany({
          where: { character: { universeId: universe.id } },
          select: {
            id: true,
            characterId: true,
            number: true,
            customHeadshotUrl: true,
            createdAt: true,
            updatedAt: true,
            character: { select: characterSelect },
          },
        }),
        prisma.worldState.findUnique({
          where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
          select: { currentSeasonId: true },
        }),
      ]);

      const seasonId = query.data.seasonId ?? world?.currentSeasonId ?? null;

      const entries =
        seasonId && profiles.length > 0
          ? await prisma.seasonDriverEntry.findMany({
              where: {
                seasonId,
                driverProfileId: { in: profiles.map((profile) => profile.id) },
              },
              select: {
                driverProfileId: true,
                teamId: true,
                number: true,
                status: true,
                team: { select: teamSelect },
              },
            })
          : [];

      const entryByProfile = new Map(
        entries.map((entry) => [entry.driverProfileId, entry]),
      );

      const characterIds = profiles.map((profile) => profile.characterId);
      const bindings =
        characterIds.length > 0
          ? await prisma.externalBindingDriver.findMany({
              where: {
                characterId: { in: characterIds },
                universeId: universe.id,
              },
              select: {
                characterId: true,
                externalDriver: { select: { headshotUrl: true } },
              },
            })
          : [];
      const headshotByCharacter = new Map<string, string | null>(
        bindings.map((binding) => [
          binding.characterId,
          binding.externalDriver.headshotUrl,
        ]),
      );

      const drivers = profiles
        .map((profile) => {
          const entry = entryByProfile.get(profile.id);
          const active = entry !== undefined && entry.status === "ACTIVE";
          const externalHeadshot =
            headshotByCharacter.get(profile.characterId) ?? null;
          return {
            id: profile.id,
            characterId: profile.characterId,
            number: active ? (entry!.number ?? profile.number) : profile.number,
            teamId: active ? (entry!.teamId ?? null) : null,
            team: active ? (entry!.team ?? null) : null,
            headshotUrl: externalHeadshot,
            customHeadshotUrl: profile.customHeadshotUrl,
            displayHeadshotUrl:
              profile.customHeadshotUrl ?? externalHeadshot,
            createdAt: profile.createdAt,
            updatedAt: profile.updatedAt,
            character: profile.character,
          };
        })
        .sort(compareDrivers);

      return { drivers };
    },
  );

  fastify.get(
    "/api/drivers/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const universe = await ensureUniverse(userId);
      const profile = await prisma.driverProfile.findFirst({
        where: { id: params.data.id, character: { universeId: universe.id } },
        select: {
          id: true,
          characterId: true,
          number: true,
          customHeadshotUrl: true,
          createdAt: true,
          updatedAt: true,
          character: {
            select: {
              id: true,
              name: true,
              nationality: true,
              imageUrl: true,
              birthDate: true,
              biography: true,
            },
          },
        },
      });

      if (!profile) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }

      const world = await prisma.worldState.findUnique({
        where: { universeId_key: { universeId: universe.id, key: WORLD_KEY } },
        select: { currentSeasonId: true },
      });
      const seasonId = world?.currentSeasonId ?? null;

      const [entry, binding, attributes] = await Promise.all([
        seasonId
          ? prisma.seasonDriverEntry.findUnique({
              where: {
                seasonId_driverProfileId: {
                  seasonId,
                  driverProfileId: profile.id,
                },
              },
              select: {
                teamId: true,
                number: true,
                role: true,
                seat: true,
                status: true,
                team: { select: teamSelect },
              },
            })
          : Promise.resolve(null),
        prisma.externalBindingDriver.findFirst({
          where: { characterId: profile.characterId, universeId: universe.id },
          select: { externalDriver: { select: { headshotUrl: true } } },
        }),
        seasonId
          ? prisma.driverAttribute.findUnique({
              where: {
                seasonId_driverProfileId: {
                  seasonId,
                  driverProfileId: profile.id,
                },
              },
              select: {
                speed: true,
                consistency: true,
                racecraft: true,
                aggression: true,
              },
            })
          : Promise.resolve(null),
      ]);

      const active = entry !== null && entry.status === "ACTIVE";
      const externalHeadshot = binding?.externalDriver.headshotUrl ?? null;
      const driver = {
        id: profile.id,
        characterId: profile.characterId,
        number: active ? (entry!.number ?? profile.number) : profile.number,
        teamId: active ? (entry!.teamId ?? null) : null,
        team: active ? (entry!.team ?? null) : null,
        headshotUrl: externalHeadshot,
        customHeadshotUrl: profile.customHeadshotUrl,
        displayHeadshotUrl: profile.customHeadshotUrl ?? externalHeadshot,
        role: entry?.role ?? null,
        seat: entry?.seat ?? null,
        status: entry?.status ?? null,
        attributes: attributes ?? null,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
        character: profile.character,
      };

      return reply.send({ driver });
    },
  );

  fastify.patch(
    "/api/drivers/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      if (
        typeof request.body === "object" &&
        request.body !== null &&
        "teamId" in request.body
      ) {
        return reply.code(400).send({
          error:
            "A vinculação de equipe é administrada pelas operações de roster (/api/roster/assign, /api/roster/hire, /api/roster/reserve, /api/roster/release). Edite apenas o número base neste endpoint.",
          code: "ROSTER_OPERATION_REQUIRED",
        });
      }

      const parsed = updateDriverProfileSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const universe = await ensureUniverse(userId);
      const existing = await prisma.driverProfile.findFirst({
        where: { id: params.data.id, character: { universeId: universe.id } },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }

      const data: Prisma.DriverProfileUpdateInput = {};
      if (parsed.data.number !== undefined) {
        data.number = parsed.data.number ?? null;
      }
      if (parsed.data.customHeadshotUrl !== undefined) {
        data.customHeadshotUrl = parsed.data.customHeadshotUrl ?? null;
      }

      const driver = await prisma.driverProfile.update({
        where: { id: existing.id },
        data,
        include: driverInclude,
      });

      return reply.send({ driver });
    },
  );

  fastify.put(
    "/api/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      if (
        typeof request.body === "object" &&
        request.body !== null &&
        "teamId" in request.body
      ) {
        return reply.code(400).send({
          error:
            "A vinculação de equipe é administrada pelas operações de roster (/api/roster/assign, /api/roster/hire, /api/roster/reserve, /api/roster/release). Edite apenas o número base neste endpoint.",
          code: "ROSTER_OPERATION_REQUIRED",
        });
      }

      const parsed = upsertDriverSchema.safeParse(request.body ?? {});
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const character = await prisma.character.findFirst({
        where: { id: params.data.characterId, userId },
        select: { id: true },
      });

      if (!character) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      const driver = await prisma.driverProfile.upsert({
        where: { characterId: character.id },
        create: {
          characterId: character.id,
          number: parsed.data.number ?? null,
        },
        update: {
          number: parsed.data.number ?? null,
        },
        include: driverInclude,
      });

      return reply.send({ driver });
    },
  );

  fastify.delete(
    "/api/drivers/:characterId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = driverCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const driver = await prisma.driverProfile.findFirst({
        where: {
          characterId: params.data.characterId,
          character: { userId },
        },
        select: { id: true },
      });

      if (!driver) {
        return reply.code(404).send({
          error: "Piloto não encontrado",
          code: "NOT_FOUND",
        });
      }

      try {
        await prisma.driverProfile.delete({ where: { id: driver.id } });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2003"
        ) {
          return reply.code(409).send({
            error:
              "Não é possível excluir o piloto enquanto houver resultados ou classificação vinculados",
            code: "CONFLICT",
          });
        }
        throw error;
      }

      return reply.code(204).send();
    },
  );
};

export default driversRoutes;
