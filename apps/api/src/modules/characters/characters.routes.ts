import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  characterIdParamSchema,
  createCharacterSchema,
  updateCharacterSchema,
} from "./characters.schema.js";

const characterSelect = {
  id: true,
  name: true,
  nationality: true,
  gender: true,
  birthDate: true,
  imageUrl: true,
  biography: true,
  dna: true,
  controlledBy: true,
  userId: true,
  createdAt: true,
  updatedAt: true,
} as const;

// Catálogo oficial de AI Characters (dados de sistema: controlledBy = AI,
// userId = null). GET-only; expõe somente o mínimo necessário à seleção.
const aiCharacterSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
  controlledBy: true,
  userId: true,
} as const;

export const charactersRoutes: FastifyPluginAsync = async (fastify) => {
  // Listar os personagens do usuário autenticado.
  fastify.get("/api/characters", { preHandler: [fastify.authenticate] }, async (request) => {
    const userId = request.user!.id;
    const characters = await prisma.character.findMany({
      where: { userId },
      select: characterSelect,
      orderBy: { createdAt: "asc" },
    });
    return { characters };
  });

  // Catálogo oficial de AI Characters (dados de sistema, userId = null).
  // Autenticado como os demais endpoints de Character; não depende do caller.
  fastify.get(
    "/api/characters/ai",
    { preHandler: [fastify.authenticate] },
    async (_request, reply) => {
      const characters = await prisma.character.findMany({
        where: { controlledBy: "AI", userId: null },
        select: aiCharacterSelect,
        orderBy: { name: "asc" },
      });
      return reply.send({ characters });
    },
  );

  // Criar personagem. userId e controlledBy são definidos pelo servidor.
  fastify.post("/api/characters", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const parsed = createCharacterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Dados inválidos",
        code: "VALIDATION_ERROR",
        issues: parsed.error.issues,
      });
    }

    const character = await prisma.character.create({
      data: {
        ...parsed.data,
        userId,
        controlledBy: "USER",
        // 'dna' não é editável pelo cliente: inicia vazio e é preservado na edição.
        dna: {} as Prisma.InputJsonValue,
      },
      select: characterSelect,
    });

    return reply.code(201).send({ character });
  });

  // Ler um personagem próprio.
  fastify.get("/api/characters/:id", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const params = characterIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: "Identificador inválido",
        code: "VALIDATION_ERROR",
      });
    }

    const character = await prisma.character.findFirst({
      where: { id: params.data.id, userId },
      select: characterSelect,
    });

    if (!character) {
      // 404 para não vazar a existência de personagens de outros usuários.
      return reply.code(404).send({
        error: "Personagem não encontrado",
        code: "NOT_FOUND",
      });
    }

    return reply.send({ character });
  });

  // Editar um personagem próprio.
  fastify.patch("/api/characters/:id", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const params = characterIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: "Identificador inválido",
        code: "VALIDATION_ERROR",
      });
    }

    const parsed = updateCharacterSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Dados inválidos",
        code: "VALIDATION_ERROR",
        issues: parsed.error.issues,
      });
    }

    const existing = await prisma.character.findFirst({
      where: { id: params.data.id, userId },
      select: { id: true },
    });

    if (!existing) {
      return reply.code(404).send({
        error: "Personagem não encontrado",
        code: "NOT_FOUND",
      });
    }

    const character = await prisma.character.update({
      where: { id: existing.id },
      data: parsed.data,
      select: characterSelect,
    });

    return reply.send({ character });
  });

  // Excluir um personagem próprio.
  fastify.delete("/api/characters/:id", { preHandler: [fastify.authenticate] }, async (request, reply) => {
    const userId = request.user!.id;
    const params = characterIdParamSchema.safeParse(request.params);
    if (!params.success) {
      return reply.code(400).send({
        error: "Identificador inválido",
        code: "VALIDATION_ERROR",
      });
    }

    const existing = await prisma.character.findFirst({
      where: { id: params.data.id, userId },
      select: { id: true },
    });

    if (!existing) {
      return reply.code(404).send({
        error: "Personagem não encontrado",
        code: "NOT_FOUND",
      });
    }

    await prisma.character.delete({ where: { id: existing.id } });

    return reply.code(204).send();
  });
};

export default charactersRoutes;
