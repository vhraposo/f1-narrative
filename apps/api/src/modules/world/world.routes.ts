import type { FastifyPluginAsync } from "fastify";
import { prisma } from "../../infrastructure/database/prisma.js";
import { updateWorldSchema } from "./world.schema.js";

// Chave fixa do WorldState global: correspondente ao @unique default("default")
// do modelo. Garante um único registro de estado do mundo em toda a aplicação.
const WORLD_KEY = "default";

const worldSelect = {
  id: true,
  key: true,
  currentDate: true,
  currentSeasonId: true,
  currentRaceId: true,
  currentSession: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Resolve o WorldState único, criando-o se ainda não existir.
//
// Concorrência: Prisma `upsert` sobre a chave única `key` é atômico no banco —
// duas chamadas simultâneas terminam com EXATAMENTE uma linha com
// `key='default'`. Isso resolve a corrida "GET + GET -> dois WorldStates" sem
// exigir migration (a constraint @unique já existe no schema).
async function resolveWorld() {
  return prisma.worldState.upsert({
    where: { key: WORLD_KEY },
    update: {},
    create: { key: WORLD_KEY },
    select: worldSelect,
  });
}

// Valida referências a Season/Race. Como currentSeasonId/currentRaceId são
// referências escalares SEM FK no banco, a existência é verificada
// explicitamente aqui — nunca permitimos uma referência silenciosa a um
// registro inexistente. Retorna a mensagem de erro ou null quando tudo ok.
async function findInvalidReference(
  seasonId: string | null | undefined,
  raceId: string | null | undefined,
): Promise<string | null> {
  if (seasonId) {
    const season = await prisma.season.findUnique({
      where: { id: seasonId },
      select: { id: true },
    });
    if (!season) return "Temporada não encontrada";
  }
  if (raceId) {
    const race = await prisma.race.findUnique({
      where: { id: raceId },
      select: { id: true },
    });
    if (!race) return "Corrida não encontrada";
  }
  return null;
}

export const worldRoutes: FastifyPluginAsync = async (fastify) => {
  // Estado global do universo (singleton). Leitura autenticada.
  fastify.get(
    "/api/world",
    { preHandler: [fastify.authenticate] },
    async () => {
      const world = await resolveWorld();
      return { world };
    },
  );

  // Atualização do estado global (singleton). Nenhum POST/DELETE nem endpoint
  // por usuário: existe sempre um, e apenas um.
  fastify.patch(
    "/api/world",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const parsed = updateWorldSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const invalid = await findInvalidReference(
        parsed.data.currentSeasonId,
        parsed.data.currentRaceId,
      );
      if (invalid) {
        return reply.code(400).send({
          error: invalid,
          code: "VALIDATION_ERROR",
        });
      }

      const world = await prisma.worldState.upsert({
        where: { key: WORLD_KEY },
        update: {
          ...(parsed.data.currentDate !== undefined
            ? { currentDate: new Date(parsed.data.currentDate) }
            : {}),
          ...(parsed.data.currentSeasonId !== undefined
            ? { currentSeasonId: parsed.data.currentSeasonId }
            : {}),
          ...(parsed.data.currentRaceId !== undefined
            ? { currentRaceId: parsed.data.currentRaceId }
            : {}),
          ...(parsed.data.currentSession !== undefined
            ? { currentSession: parsed.data.currentSession }
            : {}),
        },
        create: {
          key: WORLD_KEY,
          ...(parsed.data.currentDate !== undefined
            ? { currentDate: new Date(parsed.data.currentDate) }
            : {}),
          ...(parsed.data.currentSeasonId !== undefined
            ? { currentSeasonId: parsed.data.currentSeasonId }
            : {}),
          ...(parsed.data.currentRaceId !== undefined
            ? { currentRaceId: parsed.data.currentRaceId }
            : {}),
          ...(parsed.data.currentSession !== undefined
            ? { currentSession: parsed.data.currentSession }
            : {}),
        },
        select: worldSelect,
      });

      return reply.send({ world });
    },
  );
};

export default worldRoutes;