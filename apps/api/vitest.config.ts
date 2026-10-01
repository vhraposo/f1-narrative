import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
    // Todas as suítes compartilham o mesmo f1_narrative_test e o singleton
    // WorldState. Execuções paralelas entre arquivos corrompem a premissa de
    // isolamento dos testes de determinismo. Forçar serialização (padrão para
    // suítes com banco de TEST mutável).
    fileParallelism: false,
    // Teardown global de segurança (TEST-only): remove users/universes/@f1nw.test
    // e memórias órfãs deixadas por módulos legados após a suíte completa.
    globalSetup: ["./vitest.global-setup.ts"],
    env: {
      NODE_ENV: "test",
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/f1_narrative_test?schema=public",
      BETTER_AUTH_SECRET: "test-secret-for-vitest-only-0000",
      BETTER_AUTH_URL: "http://localhost:3001",
      CLIENT_ORIGIN: "http://localhost:3000",
      STORAGE_LOCAL_ROOT: "./.storage/test",
      STORAGE_MAX_UPLOAD_BYTES: "65536",
    },
  },
});
