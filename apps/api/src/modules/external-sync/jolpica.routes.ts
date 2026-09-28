import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { prisma } from "../../infrastructure/database/prisma.js";
import {
  getActiveSyncKeys,
  sanitizeSyncErrorForDisplay,
} from "./external-sync-run.js";
import type { JolpicaClient } from "./jolpica.client.js";
import type { AutoMaterializeResult } from "./jolpica.materialize.js";
import { tryAutoMaterialize, MATERIALIZABLE_SCOPES } from "./jolpica.materialize.js";
import {
  JOLPICA_SOURCE,
  JOLPICA_SYNC_SCOPES,
  JolpicaSyncService,
} from "./jolpica.service.js";
import { JolpicaError } from "./jolpica.transport.js";

export interface JolpicaSyncRoutesOptions {
  readonly client: JolpicaClient;
  readonly requestDelayMs?: number;
}

const routeParamsSchema = z.object({
  source: z.literal(JOLPICA_SOURCE),
  scope: z.enum(JOLPICA_SYNC_SCOPES),
});

const syncBodySchema = z
  .object({
    seasonYear: z.number().int().min(1950).max(2100),
  })
  .strict();

const statusQuerySchema = z.object({
  source: z.literal(JOLPICA_SOURCE).default(JOLPICA_SOURCE),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});

function toRunView(run: {
  id: string;
  scope: string;
  seasonYear: number | null;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  lastSyncedAt: Date | null;
  statistics: unknown;
  error: string | null;
}) {
  return {
    id: run.id,
    scope: run.scope,
    seasonYear: run.seasonYear,
    status: run.status,
    startedAt: run.startedAt.toISOString(),
    finishedAt: run.finishedAt ? run.finishedAt.toISOString() : null,
    durationMs: run.finishedAt
      ? run.finishedAt.getTime() - run.startedAt.getTime()
      : null,
    lastSyncedAt: run.lastSyncedAt ? run.lastSyncedAt.toISOString() : null,
    statistics: run.statistics ?? null,
    error: sanitizeSyncErrorForDisplay(run.error),
  };
}

function mapRefreshFailure(error: unknown): {
  statusCode: number;
  code: string;
  error: string;
} {
  if (error instanceof JolpicaError) {
    if (error.code === "HTTP" && error.statusCode === 429) {
      return {
        statusCode: 429,
        code: "SOURCE_RATE_LIMITED",
        error: "A fonte externa limitou as requisições; tente novamente mais tarde",
      };
    }
    if (error.code === "HTTP" && error.statusCode === 404) {
      return {
        statusCode: 404,
        code: "SOURCE_NOT_FOUND",
        error: "Recurso não encontrado na fonte externa",
      };
    }
    if (error.code === "TIMEOUT") {
      return {
        statusCode: 504,
        code: "SOURCE_TIMEOUT",
        error: "A fonte externa não respondeu a tempo",
      };
    }
    if (error.code === "MALFORMED") {
      return {
        statusCode: 502,
        code: "SOURCE_MALFORMED",
        error: "Resposta da fonte externa malformada",
      };
    }
    return {
      statusCode: 502,
      code: "SOURCE_UNAVAILABLE",
      error: "Falha ao consultar a fonte externa",
    };
  }
  return {
    statusCode: 502,
    code: "SYNC_FAILED",
    error: "Falha ao sincronizar dados externos",
  };
}

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<string | null> {
  const userId = request.user?.id;
  if (!userId) {
    void reply.code(401).send({
      error: "Não autenticado",
      code: "UNAUTHENTICATED",
    });
    return null;
  }
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  if (!user || user.role !== "ADMIN") {
    void reply.code(403).send({
      error: "Apenas administradores podem sincronizar dados externos",
      code: "FORBIDDEN",
    });
    return null;
  }
  return userId;
}

export const jolpicaSyncRoutes: FastifyPluginAsync<JolpicaSyncRoutesOptions> =
  async (fastify, options) => {
    const service = new JolpicaSyncService(options.client, {
      requestDelayMs: options.requestDelayMs ?? 0,
    });

    fastify.get(
      "/api/external-sync/status",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const parsed = statusQuerySchema.safeParse(request.query ?? {});
        if (!parsed.success) {
          return reply.code(400).send({
            error: "Parâmetros inválidos",
            code: "VALIDATION_ERROR",
          });
        }
        const { source, limit } = parsed.data;
        const [lastRun, lastSuccess, recent] = await Promise.all([
          prisma.externalSyncRun.findFirst({
            where: { source },
            orderBy: { startedAt: "desc" },
          }),
          prisma.externalSyncRun.findFirst({
            where: { source, status: "SUCCESS" },
            orderBy: { startedAt: "desc" },
          }),
          prisma.externalSyncRun.findMany({
            where: { source },
            orderBy: { startedAt: "desc" },
            take: limit,
          }),
        ]);
        return reply.send({
          source,
          active: getActiveSyncKeys().filter((key) =>
            key.startsWith(`${source}:`),
          ),
          lastRun: lastRun ? toRunView(lastRun) : null,
          lastSuccess: lastSuccess ? toRunView(lastSuccess) : null,
          recent: recent.map(toRunView),
        });
      },
    );

    fastify.post(
      "/api/external-sync/refresh",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const bodyParsed = syncBodySchema.safeParse(request.body ?? {});
        if (!bodyParsed.success) {
          return reply.code(400).send({
            error: "Corpo inválido",
            code: "VALIDATION_ERROR",
          });
        }

        const userId = await requireAdmin(request, reply);
        if (!userId) return;

        const report = await service.refreshSeason(
          bodyParsed.data.seasonYear,
          { triggeredById: userId },
        );

        const scopes = report.scopes.map((item) =>
          item.status === "SUCCESS"
            ? {
                scope: item.scope,
                status: item.status,
                counts: item.counts,
                durationMs: item.durationMs,
                error: null,
              }
            : {
                scope: item.scope,
                status: item.status,
                counts: null,
                durationMs: item.durationMs,
                error: mapRefreshFailure(item.error),
              },
        );

        if (!report.ok) {
          const failure = mapRefreshFailure(
            report.scopes.at(-1)?.error ?? null,
          );
          return reply.code(failure.statusCode).send({
            ok: false,
            source: report.source,
            year: report.year,
            failedScope: report.failedScope,
            code: failure.code,
            error: failure.error,
            scopes,
            durationMs: report.durationMs,
          });
        }

        return reply.send({
          ok: true,
          source: report.source,
          year: report.year,
          failedScope: null,
          code: null,
          error: null,
          scopes,
          durationMs: report.durationMs,
        });
      },
    );

    fastify.post(
      "/api/external-sync/:source/:scope",
      { preHandler: [fastify.authenticate] },
      async (request, reply) => {
        const params = routeParamsSchema.safeParse(request.params);
        if (!params.success) {
          return reply.code(400).send({
            error: "Fonte ou escopo inválidos",
            code: "VALIDATION_ERROR",
          });
        }

        const bodyParsed = syncBodySchema.safeParse(request.body ?? {});
        if (!bodyParsed.success) {
          return reply.code(400).send({
            error: "Corpo inválido",
            code: "VALIDATION_ERROR",
          });
        }

        const userId = await requireAdmin(request, reply);
        if (!userId) return;

        try {
          const report = await service.sync(
            bodyParsed.data.seasonYear,
            params.data.scope,
            { triggeredById: userId },
          );
          let materialization: AutoMaterializeResult | undefined;
          if ((MATERIALIZABLE_SCOPES as readonly string[]).includes(params.data.scope)) {
            materialization = await tryAutoMaterialize(
              { id: userId, role: "ADMIN" },
              bodyParsed.data.seasonYear,
            );
          }
          return reply.send({ ok: true, report, materialization });
        } catch (error) {
          if (error instanceof JolpicaError) {
            if (error.code === "HTTP" && error.statusCode === 404) {
              return reply.code(404).send({
                error: "Recurso não encontrado na fonte externa",
                code: "SOURCE_NOT_FOUND",
              });
            }
            if (error.code === "MALFORMED") {
              return reply.code(502).send({
                error: "Resposta da fonte externa malformada",
                code: "SOURCE_MALFORMED",
              });
            }
            return reply.code(502).send({
              error: "Falha ao consultar a fonte externa",
              code: "SOURCE_UNAVAILABLE",
            });
          }
          throw error;
        }
      },
    );
  };

export default jolpicaSyncRoutes;
