import "dotenv/config";

import { z } from "zod";
import path from "node:path";
import { config as loadEnv } from "dotenv";

// Carrega o .env da raiz do monorepo (apps/api -> ../../.env).
// Em dev (tsx) e em produção (node dist/) o cwd é apps/api.
loadEnv({
  path: path.resolve(process.cwd(), "../../.env"),
});

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  API_HOST: z.string().default("0.0.0.0"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:3001"),
  BETTER_AUTH_SECRET: z.string().min(16, "BETTER_AUTH_SECRET muito curto"),
  CLIENT_ORIGIN: z.string().url().default("http://localhost:3000"),
  DATABASE_URL: z.string().min(1, "DATABASE_URL é obrigatório"),
  JOLPICA_BASE_URL: z
    .string()
    .url("JOLPICA_BASE_URL inválida")
    .default("https://api.jolpi.ca/ergast/f1/"),
  JOLPICA_TIMEOUT_MS: z.coerce.number().int().min(1).default(30000),
  JOLPICA_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  JOLPICA_REQUEST_DELAY_MS: z.coerce.number().int().min(0).default(0),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `- ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Configuração de ambiente inválida:\n${issues}`);
}

export const env = parsed.data;

export type Env = typeof env;
