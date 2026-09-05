import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactNode } from "react";

// QueryClient real, específico de teste: retry:false para queries (evita
// re-buscas assíncronas e flakes) e staleTime:0 para que qualquer refetch
// após invalidação ocorra imediatamente. Não copia o resto da config de
// produção (staleTime 60s / retry 1) de forma alguma desnecessária.
export function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
      },
    },
  });
}

// Renderiza com QueryClientProvider real (mesmo mecanismo do Providers de
// produção, sem o SessionProvider — não usado pelo fluxo de chat) e devolve
// o client para asserts diretos de cache. Cada chamada usa um client novo
// (isolamento de cache por teste).
export function renderWithClient(
  ui: ReactNode,
  client: QueryClient = createTestQueryClient(),
): RenderResult & { client: QueryClient } {
  const utils = render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
  return { ...utils, client };
}