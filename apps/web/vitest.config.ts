import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // O tsconfig do web usa `jsx: "preserve"` (Next). Vite 8/vitest 4 transformam
  // via Oxc (não esbuild): forçar o runtime automático de JSX só no vitest.
  oxc: {
    jsx: { runtime: "automatic", development: false },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    // Suite de componente isolada: jsdom para o DOM do Testing Library.
    environment: "jsdom",
    // Imports explícitos de `vitest` nos testes (sem globals; sem cambios de
    // eslint). O auto-cleanup da Testing Library depende de `afterEach`
    // global; com globals:false o cleanup é registrado no vitest.setup.ts.
    globals: false,
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./vitest.setup.ts"],
  },
});