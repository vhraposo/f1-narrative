import { env } from "./config/env.js";
import { buildApp } from "./app.js";

const app = buildApp();
const port = env.API_PORT;
const host = env.API_HOST;

try {
  await app.listen({ port, host });
  app.log.info(`API em execução em http://localhost:${port}`);
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
