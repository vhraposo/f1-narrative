import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  availabilityCharacterIdParamSchema,
  updateAvailabilitySchema,
} from "./availability.schema.js";

const availabilitySelect = {
  id: true,
  characterId: true,
  status: true,
  reason: true,
  since: true,
  until: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Resolve a disponibilidade de um Character do usuário autenticado, criando o
// default `AVAILABLE` se ainda não existir.
//
// Ownership: filtramos por `character: { userId }` — a disponibilidade herda a
// ownership do Character. Personagem de outro usuário vira 404 (nunca 403).
//
// Concorrência: o upsert sobre o campo @unique `characterId` é atômico —
// chamadas simultâneas terminam com EXATAMENTE um registro por Character.
async function resolveAvailability(characterId: string, userId: string) {
  const character = await prisma.character.findFirst({
    where: { id: characterId, userId },
    select: { id: true },
  });

  if (!character) {
    return null;
  }

  return prisma.characterAvailability.upsert({
    where: { characterId: character.id },
    update: {},
    create: { characterId: character.id },
    select: availabilitySelect,
  });
}

export const availabilityRoutes: FastifyPluginAsync = async (fastify) => {
  // Ler a disponibilidade de um Character próprio (resolvendo o default).
  fastify.get(
    "/api/characters/:characterId/availability",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = availabilityCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const availability = await resolveAvailability(
        params.data.characterId,
        userId,
      );

      if (!availability) {
        // 404 para não vazar a existência de personagens de outros usuários.
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ availability });
    },
  );

  // Atualizar a disponibilidade de um Character próprio.
  fastify.patch(
    "/api/characters/:characterId/availability",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = availabilityCharacterIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateAvailabilitySchema.safeParse(request.body);
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
        // 404 para não vazar a existência de personagens de outros usuários.
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      // until < since -> 400 VALIDATION_ERROR. A regra usa o `since` real do
      // registro (default 'now()'); se ainda não existe, o default assume
      // agora, então qualquer `until` no passado viola a regra.
      const until = parsed.data.until ?? null;
      if (until !== null) {
        const existing = await prisma.characterAvailability.findUnique({
          where: { characterId: character.id },
          select: { since: true },
        });
        const since = existing?.since ?? new Date();
        if (new Date(until).getTime() < since.getTime()) {
          return reply.code(400).send({
            error: "A data final não pode ser anterior ao início da disponibilidade",
            code: "VALIDATION_ERROR",
          });
        }
      }

      const availability = await prisma.characterAvailability.upsert({
        where: { characterId: character.id },
        update: {
          ...(parsed.data.status !== undefined
            ? { status: parsed.data.status }
            : {}),
          ...(parsed.data.reason !== undefined
            ? { reason: parsed.data.reason }
            : {}),
          ...(parsed.data.until !== undefined
            ? { until: until === null ? null : new Date(until) }
            : {}),
        },
        create: {
          characterId: character.id,
          ...(parsed.data.status !== undefined
            ? { status: parsed.data.status }
            : {}),
          ...(parsed.data.reason !== undefined
            ? { reason: parsed.data.reason }
            : {}),
          ...(parsed.data.until !== undefined
            ? { until: until === null ? null : new Date(until) }
            : {}),
        },
        select: availabilitySelect,
      });

      return reply.send({ availability });
    },
  );
};

export default availabilityRoutes;