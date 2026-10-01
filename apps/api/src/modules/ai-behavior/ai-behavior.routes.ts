import type { FastifyPluginAsync, FastifyReply } from "fastify";
import { z } from "zod";

import type { GenerationProvider } from "../generation/generation.assembly.js";
import {
  evaluateCharacterBehavior,
  executeCharacterDecision,
  listCharacterDecisions,
  recoverStaleExecutions,
} from "./ai-behavior.service.js";
import { AiBehaviorError } from "./ai-behavior.policy.js";

export interface AiBehaviorRoutesOptions {
  provider: GenerationProvider;
}

const evaluateBodySchema = z
  .object({
    characterId: z.string().uuid("Personagem inválido"),
    trigger: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const executeBodySchema = z
  .object({
    decisionId: z.string().uuid("Decisão inválida"),
  })
  .strict();

const decisionsQuerySchema = z.object({
  characterId: z.string().uuid("Personagem inválido").optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

async function sendBehaviorError(reply: FastifyReply, error: unknown) {
  if (error instanceof AiBehaviorError) {
    return reply
      .code(error.statusCode)
      .send({ error: error.message, code: error.code });
  }
  throw error;
}

export const aiBehaviorRoutes: FastifyPluginAsync<AiBehaviorRoutesOptions> =
  async (fastify, options) => {
    fastify.post(
      "/api/ai-behavior/evaluate",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const parsed = evaluateBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            error: "Dados inválidos",
            code: "VALIDATION_ERROR",
            issues: parsed.error.issues,
          });
        }
        try {
          const decision = await evaluateCharacterBehavior(
            request.user!.id,
            parsed.data.characterId,
            parsed.data.trigger ?? "MANUAL",
          );
          return reply.send({ decision });
        } catch (error) {
          return sendBehaviorError(reply, error);
        }
      },
    );

    fastify.post(
      "/api/ai-behavior/execute",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const parsed = executeBodySchema.safeParse(request.body ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            error: "Dados inválidos",
            code: "VALIDATION_ERROR",
            issues: parsed.error.issues,
          });
        }
        try {
          const decision = await executeCharacterDecision(
            request.user!.id,
            parsed.data.decisionId,
            options.provider,
          );
          return reply.send({ decision });
        } catch (error) {
          return sendBehaviorError(reply, error);
        }
      },
    );

    fastify.post(
      "/api/ai-behavior/recover",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const result = await recoverStaleExecutions(request.user!.id);
        return reply.send(result);
      },
    );

    fastify.get(
      "/api/ai-behavior/decisions",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const parsed = decisionsQuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            error: "Parâmetros inválidos",
            code: "VALIDATION_ERROR",
            issues: parsed.error.issues,
          });
        }
        try {
          const decisions = await listCharacterDecisions(
            request.user!.id,
            parsed.data.characterId,
            parsed.data.limit,
          );
          return reply.send({ decisions });
        } catch (error) {
          return sendBehaviorError(reply, error);
        }
      },
    );
  };

export default aiBehaviorRoutes;
