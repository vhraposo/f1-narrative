import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ProfilePage from "@/app/app/profile/page";
import { ApiError } from "@/lib/api";
import type { UserProfile } from "@/lib/profile";
import { renderWithClient } from "@/test/render-with-client";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
  postBinary: vi.fn(),
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
    postBinary: apiMock.postBinary,
  };
});

const sessionMock = vi.hoisted(() => {
  const refresh = vi.fn();
  return {
    refresh,
    session: {
      data: { user: { id: "u1", name: "Ana" }, session: null },
      refresh,
    },
  };
});

vi.mock("@/providers/session-provider", () => ({
  useSession: () => sessionMock.session,
}));

const PROFILE: UserProfile = {
  userId: "u1",
  displayName: "Ana",
  email: "ana@f1nw.test",
  image: "http://localhost:3001/api/media/aaaaaaa1-bbbb-4ccc-8ddd-eeeeeeeeeeee",
  favoriteTeam: { id: "t1", name: "Aurora", shortName: "AUR", color: "#fff" },
  favoriteDriver: null,
};

type GetImplementation = (path: string) => Promise<unknown>;

function mockGet(impl: GetImplementation) {
  apiMock.get.mockImplementation(impl);
}

function profileFixture(overrides: Partial<UserProfile> = {}): UserProfile {
  return { ...PROFILE, ...overrides };
}

beforeEach(() => {
  sessionMock.refresh.mockClear();
  apiMock.get.mockReset();
  apiMock.patch.mockReset();
  apiMock.remove.mockReset();
  apiMock.postBinary.mockReset();
  mockGet(async (path: string) => {
    if (path === "/api/profile") return { profile: profileFixture() };
    if (path === "/api/teams") {
      return {
        teams: [
          { id: "t1", name: "Aurora" },
          { id: "t2", name: "Cometa" },
        ],
      };
    }
    if (path === "/api/drivers") {
      return {
        drivers: [
          { id: "d1", number: 44, character: { name: "Rafa" } },
          { id: "d2", number: 7, character: { name: "Bia" } },
        ],
      };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.patch.mockImplementation(async () => ({
    profile: profileFixture(),
  }));
  apiMock.remove.mockImplementation(async () => undefined);
  apiMock.postBinary.mockImplementation(async () => ({
    profile: profileFixture(),
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("ProfilePage", () => {
  it("mostra nome, email, avatar e estado sem favorito de piloto", async () => {
    renderWithClient(<ProfilePage />);

    expect(await screen.findByText("Ana")).toBeDefined();
    expect(screen.getByText("ana@f1nw.test")).toBeDefined();
    const avatar = screen.getByAltText("Foto de Ana") as HTMLImageElement;
    expect(avatar.src).toContain("/api/media/");
    expect(screen.getByText("Aurora")).toBeDefined();
    expect(screen.getAllByText("Nenhum piloto").length).toBeGreaterThan(0);
  });

  it("usa fallback de imagem ausente com a inicial do nome", async () => {
    mockGet(async (path: string) => {
      if (path === "/api/profile") {
        return { profile: profileFixture({ image: null }) };
      }
      if (path === "/api/teams") return { teams: [] };
      if (path === "/api/drivers") return { drivers: [] };
      throw new ApiError("Não encontrado", 404);
    });

    renderWithClient(<ProfilePage />);

    expect(await screen.findByText("Ana")).toBeDefined();
    expect(screen.queryByAltText("Foto de Ana")).toBeNull();
  });

  it("atualiza a equipe favorita e invalida o perfil", async () => {
    renderWithClient(<ProfilePage />);
    await screen.findByText("Ana");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Equipe favorita" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Cometa" }));

    await waitFor(() => {
      expect(apiMock.patch).toHaveBeenCalledWith("/api/profile", {
        favoriteTeamId: "t2",
      });
    });
    expect(await screen.findByRole("status")).toBeDefined();
  });

  it("atualiza o piloto favorito pelo endpoint de domínio", async () => {
    renderWithClient(<ProfilePage />);
    await screen.findByText("Ana");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Piloto favorito" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Rafa #44" }));

    await waitFor(() => {
      expect(apiMock.patch).toHaveBeenCalledWith("/api/profile", {
        favoriteDriverId: "d1",
      });
    });
  });

  it("faz upload do avatar via postBinary e atualiza a sessão", async () => {
    renderWithClient(<ProfilePage />);
    await screen.findByText("Ana");

    const user = userEvent.setup();
    const file = new File(
      [new Uint8Array([0x89, 0x50, 0x4e, 0x47])],
      "foto.png",
      { type: "image/png" },
    );
    const input = document.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    await user.upload(input, file);
    await user.click(await screen.findByRole("button", { name: "Salvar foto" }));

    await waitFor(() => {
      expect(apiMock.postBinary).toHaveBeenCalledWith(
        "/api/profile/avatar",
        expect.anything(),
        "foto.png",
      );
    });
    expect(sessionMock.refresh).toHaveBeenCalled();
    expect(await screen.findByText("Foto atualizada.")).toBeDefined();
  });

  it("remove o avatar pelo endpoint de domínio", async () => {
    renderWithClient(<ProfilePage />);
    await screen.findByText("Ana");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Remover foto/ }));

    await waitFor(() => {
      expect(apiMock.remove).toHaveBeenCalledWith("/api/profile/avatar");
    });
    expect(await screen.findByText("Foto removida.")).toBeDefined();
  });

  it("mostra erro da API em falha de favorito", async () => {
    apiMock.patch.mockRejectedValueOnce(
      new ApiError("Equipe favorita não pertence ao seu Universe", 403, "FAVORITE_NOT_IN_UNIVERSE"),
    );

    renderWithClient(<ProfilePage />);
    await screen.findByText("Ana");

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Equipe favorita" }));
    const listbox = await screen.findByRole("listbox");
    await user.click(within(listbox).getByRole("option", { name: "Cometa" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Equipe favorita não pertence ao seu Universe",
    );
  });
});
