import {
  QueryClient,
  QueryClientProvider,
  focusManager,
  useQuery,
} from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./session-provider", () => ({
  SessionProvider: ({ children }: { children: React.ReactNode }) => children,
}));

import { queryClientOptions } from "./providers";

afterEach(() => {
  focusManager.setFocused(true);
});

describe("queryClientOptions", () => {
  it("A - refetchOnWindowFocus habilitado por padrão", () => {
    const options = queryClientOptions().defaultOptions.queries;
    expect(options.refetchOnWindowFocus).toBe(true);
    expect(options.staleTime).toBe(60_000);
    expect(options.retry).toBe(1);
  });

  it("B - foco na janela revalida queries stale do chat", async () => {
    const fetchFn = vi.fn(async () => ["conv-1"]);
    const client = new QueryClient({
      defaultOptions: {
        queries: {
          ...queryClientOptions().defaultOptions.queries,
          staleTime: 0,
          retry: false,
        },
      },
    });

    function Probe() {
      const query = useQuery({ queryKey: ["conversations"], queryFn: fetchFn });
      return <span>{query.data ? query.data.join(",") : "loading"}</span>;
    }

    render(
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>,
    );

    await screen.findByText("conv-1");
    expect(fetchFn).toHaveBeenCalledTimes(1);

    focusManager.setFocused(false);
    focusManager.setFocused(true);

    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(2));
  });
});
