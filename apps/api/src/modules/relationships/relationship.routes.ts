import type { FastifyPluginAsync } from "fastify";
import { Prisma } from "@prisma/client";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  createRelationshipSchema,
  relationshipIdParamsSchema,
  updateRelationshipSchema,
} from "./relationship.schema.js";
import { canonicalizeRelationshipPair } from "./relationship.pair.js";

const characterSelect = {
  id: true,
  name: true,
  nationality: true,
  imageUrl: true,
} as const;

// Detecta erros conhecidos do Prisma (violação de unique) e os converte em
// resposta previsível de conflito (409).
function isConflict(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (error.code === "P2002" || error.code === "P2003")
  );
}

export const relationshipsRoutes: FastifyPluginAsync = async (fastify) => {
  // Listar relacionamentos do usuário autenticado (ambos os Characters).
  fastify.get(
    "/api/relationships",
    { preHandler: [fastify.authenticate] },
    async (request) => {
      const userId = request.user!.id;
      const relationships = await prisma.relationship.findMany({
        where: {
          characterA: { userId },
          characterB: { userId },
        },
        include: {
          characterA: { select: characterSelect },
          characterB: { select: characterSelect },
        },
        orderBy: { createdAt: "asc" },
      });
      return { relationships };
    },
  );

  // Criar relacionamento entre dois Characters do usuário autenticado.
  fastify.post(
    "/api/relationships",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const parsed = createRelationshipSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const originalA = parsed.data.characterAId;
      const originalB = parsed.data.characterBId;

      // Auto-relação: reforço na rota, além do refine do Zod.
      if (originalA === originalB) {
        return reply.code(400).send({
          error: "Os personagens A e B devem ser diferentes",
          code: "VALIDATION_ERROR",
        });
      }

      // Ambos os Characters devem pertencer ao usuário autenticado.
      // 404 para não vazar a existência de characters de outros usuários
      // (inclusive aqueles com userId = null, controlados por IA).
      const characters = await prisma.character.findMany({
        where: { id: { in: [originalA, originalB] }, userId },
        select: { id: true },
      });

      if (characters.length !== 2) {
        return reply.code(404).send({
          error: "Personagem não encontrado",
          code: "NOT_FOUND",
        });
      }

      // Ordem canônica para persistência (A = menor, B = maior).
      const { characterAId, characterBId } = canonicalizeRelationshipPair(
        originalA,
        originalB,
      );

      const existing = await prisma.relationship.findFirst({
        where: { characterAId, characterBId },
        select: { id: true },
      });

      if (existing) {
        return reply.code(409).send({
          error: "Já existe um relacionamento entre esses personagens",
          code: "CONFLICT",
        });
      }

      try {
        const relationship = await prisma.relationship.create({
          data: {
            characterAId,
            characterBId,
            dimensions: (parsed.data.dimensions ?? {}) as Prisma.InputJsonValue,
          },
          include: {
            characterA: { select: characterSelect },
            characterB: { select: characterSelect },
          },
        });

        return reply.code(201).send({ relationship });
      } catch (error) {
        // Race condition: outra requisição pode ter criado o par no meio tempo.
        if (isConflict(error)) {
          return reply.code(409).send({
            error: "Já existe um relacionamento entre esses personagens",
            code: "CONFLICT",
          });
        }
        throw error;
      }
    },
  );

  // Ler um relacionamento próprio.
  fastify.get(
    "/api/relationships/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = relationshipIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const relationship = await prisma.relationship.findFirst({
        where: {
          id: params.data.id,
          characterA: { userId },
          characterB: { userId },
        },
        include: {
          characterA: { select: characterSelect },
          characterB: { select: characterSelect },
        },
      });

      if (!relationship) {
        return reply.code(404).send({
          error: "Relacionamento não encontrado",
          code: "NOT_FOUND",
        });
      }

      return reply.send({ relationship });
    },
  );

  // Editar apenas `dimensions` de um relacionamento próprio.
  fastify.patch(
    "/api/relationships/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = relationshipIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const parsed = updateRelationshipSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: parsed.error.issues,
        });
      }

      const existing = await prisma.relationship.findFirst({
        where: {
          id: params.data.id,
          characterA: { userId },
          characterB: { userId },
        },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Relacionamento não encontrado",
          code: "NOT_FOUND",
        });
      }

      const relationship = await prisma.relationship.update({
        where: { id: existing.id },
        data: { dimensions: parsed.data.dimensions as Prisma.InputJsonValue },
        include: {
          characterA: { select: characterSelect },
          characterB: { select: characterSelect },
        },
      });

      return reply.send({ relationship });
    },
  );

  // Excluir um relacionamento próprio.
  fastify.delete(
    "/api/relationships/:id",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = relationshipIdParamsSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }

      const existing = await prisma.relationship.findFirst({
        where: {
          id: params.data.id,
          characterA: { userId },
          characterB: { userId },
        },
        select: { id: true },
      });

      if (!existing) {
        return reply.code(404).send({
          error: "Relacionamento não encontrado",
          code: "NOT_FOUND",
        });
      }

      await prisma.relationship.delete({ where: { id: existing.id } });

      return reply.code(204).send();
    },
  );
};

export default relationshipsRoutes;
