import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";

import { env } from "./config/env.js";
import { prisma } from "./infrastructure/database/prisma.js";
import authPlugin from "./infrastructure/auth/auth-plugin.js";
import authRoutes from "./modules/auth/auth.routes.js";
import healthRoutes from "./modules/health/health.routes.js";
import charactersRoutes from "./modules/characters/characters.routes.js";
import characterHeadshotMaterializationRoutes from "./modules/characters/character-headshot-materialization.routes.js";
import driversRoutes from "./modules/drivers/driver-profile.routes.js";
import teamsRoutes from "./modules/teams/team.routes.js";
import teamPerformanceRoutes from "./modules/performance/team-performance.routes.js";
import driverAttributeRoutes from "./modules/performance/driver-attribute.routes.js";
import simulationRoutes from "./modules/simulation/qualifying.routes.js";
import raceSimulationRoutes from "./modules/simulation/race-simulation.routes.js";
import rosterRoutes from "./modules/roster/roster.routes.js";
import relationshipsRoutes from "./modules/relationships/relationship.routes.js";
import championshipRoutes from "./modules/championship/championship.routes.js";
import championshipProgressionRoutes from "./modules/championship/championship-progression.routes.js";
import eventsRoutes from "./modules/events/event.routes.js";
import worldRoutes from "./modules/world/world.routes.js";
import availabilityRoutes from "./modules/availability/availability.routes.js";
import scheduleRoutes from "./modules/schedule/schedule.routes.js";
import memoryRoutes from "./modules/memory/memory.routes.js";
import conversationRoutes from "./modules/conversation/conversation.routes.js";
import conversationTurnRoutes from "./modules/conversation/conversation-turn.routes.js";
import contextRoutes from "./modules/context/context.routes.js";
import conversationRagRoutes from "./modules/context/conversation-rag.routes.js";
import conversationRagMaterializeRoutes, {
  type ConversationRagMaterializeRoutesOptions,
} from "./modules/context/conversation-rag-materialize.routes.js";
import generationRoutes from "./modules/generation/generation.routes.js";
import generationGenerateRoutes from "./modules/generation/generation-generate.routes.js";
import {
  nullProvider,
  type GenerationProvider,
} from "./modules/generation/generation.assembly.js";
import type { EmbeddingProviderWithInputType } from "./modules/external-research/external-embedding-store.js";
import {
  COHERE_MODEL,
  COHERE_PROVIDER,
  COHERE_VERSION,
  COHERE_DIMENSIONS,
  CohereEmbeddingProvider,
} from "./modules/external-research/external-embedding-provider.js";
import { JolpicaClient } from "./modules/external-sync/jolpica.client.js";
import { JolpicaTransport } from "./modules/external-sync/jolpica.transport.js";
import jolpicaSyncRoutes, {
  type JolpicaSyncRoutesOptions,
} from "./modules/external-sync/jolpica.routes.js";
import reconciliationRoutes from "./modules/reconciliation/reconciliation.routes.js";
import universeInitRoutes from "./modules/universe-init/universe-init.routes.js";
import playerEntryRoutes from "./modules/player-entry/player-entry.routes.js";
import universeEditorRoutes from "./modules/universe-editor/universe-editor.routes.js";
import {
  OpeningGridClient,
} from "./modules/opening-grid/opening-grid.client.js";
import { OpeningGridTransport } from "./modules/opening-grid/opening-grid.transport.js";
import openingGridRoutes, {
  type OpeningGridRoutesOptions,
} from "./modules/opening-grid/opening-grid.routes.js";
import { OpenF1Client } from "./modules/external-openf1/openf1.client.js";
import { OpenF1Transport } from "./modules/external-openf1/openf1.transport.js";
import openF1EnrichmentRoutes, {
  type OpenF1EnrichmentRoutesOptions,
} from "./modules/external-openf1/openf1.routes.js";

function defaultRagProvider(): EmbeddingProviderWithInputType {
  const apiKey = process.env.COHERE_API_KEY;
  if (apiKey && apiKey.trim().length > 0) {
    return new CohereEmbeddingProvider({ apiKey });
  }
  return {
    name: COHERE_PROVIDER,
    model: COHERE_MODEL,
    version: COHERE_VERSION,
    dimensions: COHERE_DIMENSIONS,
    async embed(): Promise<number[]> {
      throw new Error("Cohere provider not configured: COHERE_API_KEY ausente ou vazia.");
    },
  };
}

export function buildApp(
  ragProvider?: EmbeddingProviderWithInputType,
  generationProvider?: GenerationProvider,
  jolpicaClient?: JolpicaClient,
  openingGridClient?: OpeningGridClient,
  openF1Client?: OpenF1Client,
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
    },
  });

  void app.register(helmet, {
    contentSecurityPolicy: false,
  });

  void app.register(cors, {
    origin: [env.CLIENT_ORIGIN],
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    maxAge: 86400,
  });

  void app.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  void app.register(authPlugin);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });

  void app.register(healthRoutes);
  void app.register(authRoutes);
  void app.register(charactersRoutes);
  void app.register(characterHeadshotMaterializationRoutes);
  void app.register(driversRoutes);
  void app.register(teamsRoutes);
  void app.register(teamPerformanceRoutes);
  void app.register(driverAttributeRoutes);
  void app.register(simulationRoutes);
  void app.register(raceSimulationRoutes);
  void app.register(rosterRoutes);
  void app.register(relationshipsRoutes);
  void app.register(championshipRoutes);
  void app.register(championshipProgressionRoutes);
  void app.register(eventsRoutes);
  void app.register(worldRoutes);
  void app.register(availabilityRoutes);
  void app.register(scheduleRoutes);
  void app.register(memoryRoutes);
  void app.register(conversationRoutes);
  void app.register(conversationTurnRoutes, {
    provider: generationProvider ?? nullProvider,
    ragProvider: ragProvider ?? defaultRagProvider(),
  });
  void app.register(contextRoutes);
  void app.register(conversationRagRoutes);
  const materializeOptions: ConversationRagMaterializeRoutesOptions = {
    provider: ragProvider ?? defaultRagProvider(),
  };
  void app.register(conversationRagMaterializeRoutes, materializeOptions);
  void app.register(generationRoutes);
  void app.register(generationGenerateRoutes, {
    provider: generationProvider ?? nullProvider,
  });
  const jolpicaOptions: JolpicaSyncRoutesOptions = {
    client:
      jolpicaClient ??
      new JolpicaClient({
        transport: new JolpicaTransport({
          baseUrl: env.JOLPICA_BASE_URL,
          timeoutMs: env.JOLPICA_TIMEOUT_MS,
          maxRetries: env.JOLPICA_MAX_RETRIES,
        }),
      }),
    requestDelayMs: env.JOLPICA_REQUEST_DELAY_MS,
  };
  void app.register(jolpicaSyncRoutes, jolpicaOptions);
  const openingGridOptions: OpeningGridRoutesOptions = {
    client:
      openingGridClient ??
      new OpeningGridClient({
        transport: new OpeningGridTransport({
          baseUrl: env.OPENING_GRID_BASE_URL,
          timeoutMs: env.OPENING_GRID_TIMEOUT_MS,
          maxRetries: env.OPENING_GRID_MAX_RETRIES,
        }),
      }),
  };
  void app.register(openingGridRoutes, openingGridOptions);
  const openF1Options: OpenF1EnrichmentRoutesOptions = {
    client:
      openF1Client ??
      new OpenF1Client({
        baseUrl: env.OPENF1_BASE_URL,
        timeoutMs: env.OPENF1_TIMEOUT_MS,
        maxRetries: env.OPENF1_MAX_RETRIES,
      }),
  };
  void app.register(openF1EnrichmentRoutes, openF1Options);
  void app.register(reconciliationRoutes);
  void app.register(universeInitRoutes);
  void app.register(playerEntryRoutes);
  void app.register(universeEditorRoutes);

  return app;
}
