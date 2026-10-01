import { randomUUID } from "node:crypto";
import { once } from "node:events";

import type { FastifyPluginAsync, FastifyReply } from "fastify";

import { env } from "../../config/env.js";
import { prisma } from "../../infrastructure/database/prisma.js";
import type { EmbeddingProviderWithInputType } from "../external-research/external-embedding-store.js";
import type { GenerationProvider } from "../generation/generation.assembly.js";
import { GenerationRagFrameNotFoundError } from "../generation/generation-rag-context.js";
import { OllamaProviderError } from "../generation/ollama-provider.js";
import { conversationIdParamSchema, turnBodySchema } from "./conversation.schema.js";
import {
  executeTurn,
  TurnUserCharacterError,
  type TurnStreamOptions,
} from "./conversation-turn.js";

export interface ConversationTurnStreamRoutesOptions {
  provider: GenerationProvider;
  ragProvider?: EmbeddingProviderWithInputType;
}

const activeStreams = new Set<string>();

export function getActiveStreamCount(): number {
  return activeStreams.size;
}

async function accessibleConversationId(conversationId: string, userId: string) {
  const membership = await prisma.conversationParticipant.findFirst({
    where: {
      conversationId,
      character: { userId },
    },
    select: { conversationId: true },
  });
  return membership?.conversationId ?? null;
}

type SseWriter = {
  send: (event: string, data: unknown) => void;
  comment: (text: string) => void;
  close: () => void;
};

function startSse(reply: FastifyReply): SseWriter {
  reply.hijack();
  const raw = reply.raw;
  const origin = reply.request.headers.origin;
  const headers: Record<string, string> = {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  };
  if (origin !== undefined && origin === env.CLIENT_ORIGIN) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Credentials"] = "true";
  }
  raw.writeHead(200, headers);
  raw.write(": connected\n\n");

  let closed = false;
  const closedPromise = new Promise<void>((resolve) => {
    const resolveOnce = () => resolve();
    raw.once("close", resolveOnce);
    raw.once("finish", resolveOnce);
  });
  let tail: Promise<void> = Promise.resolve();

  const writeRaw = async (chunk: string): Promise<void> => {
    if (raw.writableEnded) return;
    if (!raw.write(chunk)) {
      await Promise.race([once(raw, "drain"), closedPromise]);
    }
  };

  return {
    send(event, data) {
      if (closed) return;
      const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
      tail = tail.then(() => writeRaw(frame)).catch(() => undefined);
    },
    comment(text) {
      if (closed) return;
      tail = tail.then(() => writeRaw(`: ${text}\n\n`)).catch(() => undefined);
    },
    close() {
      if (closed) return;
      closed = true;
      void tail.finally(() => {
        if (!raw.writableEnded) raw.end();
      });
    },
  };
}

function mapStreamError(error: unknown): { code: string; message: string } {
  if (error instanceof OllamaProviderError) {
    if (error.category === "timeout") {
      return {
        code: "PROVIDER_TIMEOUT",
        message: "A geração excedeu o tempo limite.",
      };
    }
    return { code: "PROVIDER_ERROR", message: "Falha ao gerar a resposta." };
  }
  if (error instanceof TurnUserCharacterError) {
    return {
      code: "TURN_USER_MISSING",
      message: "Nenhum personagem seu participa da conversa.",
    };
  }
  if (error instanceof GenerationRagFrameNotFoundError) {
    return {
      code: "RAG_FRAME_NOT_FOUND",
      message: "Contexto externo não encontrado.",
    };
  }
  return { code: "TURN_FAILED", message: "Falha ao gerar a resposta." };
}

export const conversationTurnStreamRoutes: FastifyPluginAsync<
  ConversationTurnStreamRoutesOptions
> = async (fastify, opts) => {
  const provider = opts.provider;

  fastify.post(
    "/api/conversations/:id/turn/stream",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const userId = request.user!.id;
      const params = conversationIdParamSchema.safeParse(request.params);
      if (!params.success) {
        return reply.code(400).send({
          error: "Identificador inválido",
          code: "VALIDATION_ERROR",
        });
      }
      const body = turnBodySchema.safeParse(request.body);
      if (!body.success) {
        return reply.code(400).send({
          error: "Dados inválidos",
          code: "VALIDATION_ERROR",
          issues: body.error.issues,
        });
      }

      const accessible = await accessibleConversationId(params.data.id, userId);
      if (!accessible) {
        return reply.code(404).send({
          error: "Conversa não encontrada",
          code: "NOT_FOUND",
        });
      }

      const requestId = randomUUID();
      const controller = new AbortController();
      const writer = startSse(reply);
      activeStreams.add(requestId);

      let disconnected = false;
      const onClose = () => {
        disconnected = true;
        controller.abort();
      };
      request.raw.on("close", onClose);
      reply.raw.on("close", onClose);
      const heartbeat = globalThis.setInterval(
        () => writer.comment("ping"),
        15_000,
      );

      const streamOptions: TurnStreamOptions = {
        onStarted: (speakers) =>
          writer.send("generation.started", {
            requestId,
            conversationId: accessible,
            speakers,
          }),
        onDelta: (characterId, delta) =>
          writer.send("generation.delta", { requestId, characterId, delta }),
        signal: controller.signal,
        failFast: true,
      };

      try {
        const result = await executeTurn(
          prisma,
          provider,
          {
            conversationId: accessible,
            userId,
            userPrompt: body.data.userPrompt,
            ...(body.data.ragFrameId !== undefined
              ? { ragFrameId: body.data.ragFrameId }
              : {}),
          },
          {
            ...(opts.ragProvider !== undefined
              ? { ragProvider: opts.ragProvider }
              : {}),
            stream: streamOptions,
          },
        );

        if (!disconnected) {
          writer.send("generation.completed", { requestId, ...result });
        }
      } catch (error) {
        if (!disconnected) {
          const mapped = mapStreamError(error);
          writer.send("generation.error", {
            requestId,
            code: mapped.code,
            message: mapped.message,
          });
        }
      } finally {
        globalThis.clearInterval(heartbeat);
        request.raw.off("close", onClose);
        reply.raw.off("close", onClose);
        activeStreams.delete(requestId);
        writer.close();
      }
    },
  );
};

export default conversationTurnStreamRoutes;
