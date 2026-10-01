import { render, screen, waitFor, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ExternalSyncPanel } from "@/components/external/external-sync-panel";
import { ToastProvider, useToast } from "@/components/ui/toast";
import { ApiError } from "@/lib/api";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    get: apiMock.get,
    post: apiMock.post,
    patch: apiMock.patch,
    put: apiMock.put,
    remove: apiMock.remove,
  };
});

const sessionMock = vi.hoisted(() => ({
  session: {
    data: { user: { role: "ADMIN" as string } },
    isPending: false,
  },
}));

vi.mock("@/providers/session-provider", () => ({
  useSession: () => sessionMock.session,
}));

function ToastHarness() {
  const toast = useToast();
  return (
    <button
      type="button"
      onClick={() =>
        toast.show({ message: "Mensagem de teste", tone: "success", duration: 60 })
      }
    >
      Disparar
    </button>
  );
}

function renderWithToast(ui: React.ReactNode, duration = 3500) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider defaultDuration={duration}>{ui}</ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/external-sync/status")) {
      return {
        source: "jolpica",
        active: [],
        lastRun: null,
        lastSuccess: null,
        recent: [],
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.post.mockImplementation(async () => ({
    durationMs: 120,
    scopes: [{ scope: "STANDINGS", status: "SUCCESS" }],
  }));
});

describe("toast system", () => {
  it("1) mostra e some automaticamente após a duração", async () => {
    const user = userEvent.setup();
    renderWithToast(<ToastHarness />);
    await user.click(screen.getByRole("button", { name: "Disparar" }));
    const toast = await screen.findByText("Mensagem de teste");
    expect(toast).toBeDefined();
    await waitForElementToBeRemoved(() => screen.queryByText("Mensagem de teste"));
  });
});

describe("external sync notifications", () => {
  it("2) em andamento → sucesso, com auto-dismiss", async () => {
    const user = userEvent.setup();
    let resolvePost: ((value: unknown) => void) | undefined;
    apiMock.post.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePost = resolve;
        }),
    );
    renderWithToast(<ExternalSyncPanel year={2026} />, 500);
    await screen.findByRole("button", { name: /Atualizar dados externos/ });

    await user.click(screen.getByRole("button", { name: /Atualizar dados externos/ }));
    await waitFor(() => expect(apiMock.post).toHaveBeenCalled());
    expect(screen.getByLabelText("Notificações").textContent).toContain(
      "Sincronização em andamento",
    );

    resolvePost?.({ durationMs: 120, scopes: [{ scope: "STANDINGS", status: "SUCCESS" }] });
    expect(await screen.findByText("Sincronização realizada com sucesso.")).toBeDefined();
    await waitForElementToBeRemoved(() =>
      screen.queryByText("Sincronização realizada com sucesso."),
    );
    expect(apiMock.post).toHaveBeenCalledWith("/api/external-sync/refresh", {
      seasonYear: 2026,
    });
  });

  it("3) falha mostra notificação de erro e some", async () => {
    const user = userEvent.setup();
    apiMock.post.mockRejectedValue(new ApiError("Provider indisponível", 503));
    renderWithToast(<ExternalSyncPanel year={2026} />, 500);
    await screen.findByRole("button", { name: /Atualizar dados externos/ });

    await user.click(screen.getByRole("button", { name: /Atualizar dados externos/ }));
    expect(
      await screen.findByText("Não foi possível realizar a sincronização."),
    ).toBeDefined();
    await waitFor(() => {
      expect(screen.queryByText("Sincronização realizada com sucesso.")).toBeNull();
    });
    await waitForElementToBeRemoved(() =>
      screen.queryByText("Não foi possível realizar a sincronização."),
    );
  });
});
