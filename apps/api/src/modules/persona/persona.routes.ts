import type { FastifyPluginAsync, FastifyReply } from "fastify";
import {
  PersonaServiceError,
  createPersonaEvidence,
  deletePersonaTrait,
  getPersonaView,
  isPersonaSchemaUnavailable,
  reviewPersonaEvidence,
  updatePersonaManually,
} from "./persona.service.js";
import {
  createPersonaEvidenceBodySchema,
  personaCharacterParamsSchema,
  personaEvidenceParamsSchema,
  personaTraitParamsSchema,
  personaTraitQuerySchema,
  reviewPersonaEvidenceBodySchema,
  updatePersonaBodySchema,
} from "./persona.schema.js";

function sendInvalidParams(reply: FastifyReply) {
  return reply.code(400).send({
    error: "Identificador inválido",
    code: "VALIDATION_ERROR",
  });
}

function sendInvalidBody(reply: FastifyReply, issues: unknown) {
  return reply.code(400).send({
    error: "Dados inválidos",
    code: "VALIDATION_ERROR",
    issues,
  });
}

function sendPersonaError(reply: FastifyReply, error: unknown): boolean {
  if (error instanceof PersonaServiceError) {
    reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
      ...(error.issues.length > 0 ? { issues: error.issues } : {}),
    });
    return true;
  }
  if (isPersonaSchemaUnavailable(error)) {
    reply.code(503).send({
      error: "Persona indisponível neste ambiente (migração pendente).",
      code: "UNAVAILABLE",
    });
    return true;
  }
  return false;
}

export const personaRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get(
    "/api/characters/:characterId/persona",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = personaCharacterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalidParams(reply);

      try {
        const persona = await getPersonaView(request.user!.id, params.data.characterId);
        return reply.send({ persona });
      } catch (error) {
        if (sendPersonaError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/characters/:characterId/persona",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = personaCharacterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalidParams(reply);

      const body = updatePersonaBodySchema.safeParse(request.body ?? {});
      if (!body.success) return sendInvalidBody(reply, body.error.issues);

      try {
        const persona = await updatePersonaManually(
          request.user!.id,
          params.data.characterId,
          { summary: body.data.summary, traits: body.data.traits },
        );
        return reply.send({ persona });
      } catch (error) {
        if (sendPersonaError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.delete(
    "/api/characters/:characterId/persona/traits/:traitKey",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = personaTraitParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalidParams(reply);

      const query = personaTraitQuerySchema.safeParse(request.query ?? {});
      if (!query.success) return sendInvalidParams(reply);

      try {
        const persona = await deletePersonaTrait(
          request.user!.id,
          params.data.characterId,
          params.data.traitKey,
          query.data.context,
        );
        return reply.send({ persona });
      } catch (error) {
        if (sendPersonaError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.post(
    "/api/characters/:characterId/persona/evidence",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = personaCharacterParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalidParams(reply);

      const body = createPersonaEvidenceBodySchema.safeParse(request.body ?? {});
      if (!body.success) return sendInvalidBody(reply, body.error.issues);

      try {
        const persona = await createPersonaEvidence(
          request.user!.id,
          params.data.characterId,
          {
            traitKey: body.data.traitKey,
            proposedValue: body.data.proposedValue,
            sourceType: body.data.sourceType,
            title: body.data.title,
            url: body.data.url ?? null,
            publishedAt: body.data.publishedAt
              ? new Date(body.data.publishedAt)
              : null,
            excerpt: body.data.excerpt,
            confidence: body.data.confidence,
          },
        );
        return reply.code(201).send({ persona });
      } catch (error) {
        if (sendPersonaError(reply, error)) return;
        throw error;
      }
    },
  );

  fastify.patch(
    "/api/persona-evidence/:evidenceId",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const params = personaEvidenceParamsSchema.safeParse(request.params);
      if (!params.success) return sendInvalidParams(reply);

      const body = reviewPersonaEvidenceBodySchema.safeParse(request.body ?? {});
      if (!body.success) return sendInvalidBody(reply, body.error.issues);

      try {
        const persona = await reviewPersonaEvidence(
          request.user!.id,
          params.data.evidenceId,
          { status: body.data.status, confidence: body.data.confidence },
        );
        return reply.send({ persona });
      } catch (error) {
        if (sendPersonaError(reply, error)) return;
        throw error;
      }
    },
  );
};

export default personaRoutes;
