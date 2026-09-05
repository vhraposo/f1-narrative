import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Com globals:false no vitest, o auto-cleanup do @testing-library/react não
// roda (ele depende de afterEach global). Registro explícito: desmonta o
// componente entre testes para evitar raízes acumuladas e avisos de act().
afterEach(() => {
  cleanup();
});