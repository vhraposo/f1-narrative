import { env } from "./config/env.js";
import { buildApp } from "./app.js";
import { createOllamaProviderFromEnv } from "./modules/generation/ollama-provider.js";

// Decisão server-side: OLLAMA_MODEL presente → provider real; ausente →
// NullProvider (assembly-only). Configuração inválida é fail-closed no startup.
const generationProvider = process.env.OLLAMA_MODEL
  ? createOllamaProviderFromEnv()
  : undefined;

const app = buildApp(undefined, generationProvider);
const port = env.API_PORT;
const host = env.API_HOST;

try {
  await app.listen({ port, host });
  app.log.info(`API em execução em http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
