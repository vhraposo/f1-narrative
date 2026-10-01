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
  API_HOST: z.string().default("::"),
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
  OPENF1_BASE_URL: z
    .string()
    .url("OPENF1_BASE_URL inválida")
    .default("https://api.openf1.org/v1/"),
  OPENF1_TIMEOUT_MS: z.coerce.number().int().min(1).default(30000),
  OPENF1_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  OPENING_GRID_BASE_URL: z
    .string()
    .url("OPENING_GRID_BASE_URL inválida")
    .default("https://f1nw.invalid/opening-grid/"),
  OPENING_GRID_TIMEOUT_MS: z.coerce.number().int().min(1).default(30000),
  OPENING_GRID_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(1),
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  STORAGE_LOCAL_ROOT: z
    .string()
    .min(1)
    .default(path.resolve(process.cwd(), ".storage")),
  STORAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .default(5 * 1024 * 1024),
  S3_ENDPOINT: z.string().url("S3_ENDPOINT inválida").optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  F1DB_DATA_DIR: z.string().min(1).optional(),
  F1DB_CIRCUITS_SVG_DIR: z.string().min(1).optional(),
  BIOGRAPHY_EVIDENCE_DIR: z.string().min(1).optional(),
  WIKIMEDIA_COMMONS_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WIKIMEDIA_COMMONS_TIMEOUT_MS: z.coerce.number().int().min(500).default(5000),
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
