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
import driversRoutes from "./modules/drivers/driver-profile.routes.js";
import teamsRoutes from "./modules/teams/team.routes.js";
import relationshipsRoutes from "./modules/relationships/relationship.routes.js";
import championshipRoutes from "./modules/championship/championship.routes.js";
import eventsRoutes from "./modules/events/event.routes.js";
import worldRoutes from "./modules/world/world.routes.js";
import availabilityRoutes from "./modules/availability/availability.routes.js";
import scheduleRoutes from "./modules/schedule/schedule.routes.js";
import memoryRoutes from "./modules/memory/memory.routes.js";
import conversationRoutes from "./modules/conversation/conversation.routes.js";
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
): FastifyInstance {
  const app = Fastify({
    logger: {
      level: env.NODE_ENV === "development" ? "info" : "warn",
    },
  });

  void app.register(helmet, {
    contentSecurityPolicy: false, // API: CSP não se aplica a respostas JSON
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
  void app.register(driversRoutes);
  void app.register(teamsRoutes);
  void app.register(relationshipsRoutes);
  void app.register(championshipRoutes);
  void app.register(eventsRoutes);
  void app.register(worldRoutes);
  void app.register(availabilityRoutes);
  void app.register(scheduleRoutes);
  void app.register(memoryRoutes);
  void app.register(conversationRoutes);
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

  return app;
}
