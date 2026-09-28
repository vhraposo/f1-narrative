import type { Env } from "../../config/env.js";
import { LocalStorageProvider } from "./local-storage.provider.js";
import { S3CompatibleStorageProvider } from "./s3-compatible-storage.provider.js";
import { StorageError, type StorageProvider } from "./storage-provider.js";

export function createStorageProviderFromEnv(env: Env): StorageProvider {
  if (env.STORAGE_PROVIDER === "local") {
    return new LocalStorageProvider(env.STORAGE_LOCAL_ROOT);
  }

  const required: Array<[string, string | undefined]> = [
    ["S3_ENDPOINT", env.S3_ENDPOINT],
    ["S3_BUCKET", env.S3_BUCKET],
    ["S3_REGION", env.S3_REGION],
    ["S3_ACCESS_KEY_ID", env.S3_ACCESS_KEY_ID],
    ["S3_SECRET_ACCESS_KEY", env.S3_SECRET_ACCESS_KEY],
  ];
  const missing = required
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    throw new StorageError(
      "S3_CONFIG_MISSING",
      `Configuração S3 incompleta: ${missing.join(", ")}`,
      500,
    );
  }

  return new S3CompatibleStorageProvider({
    endpoint: env.S3_ENDPOINT!,
    bucket: env.S3_BUCKET!,
    region: env.S3_REGION!,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
  });
}
