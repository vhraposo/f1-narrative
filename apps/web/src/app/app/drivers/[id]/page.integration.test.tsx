import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { DriverDetail } from "@/lib/driver-profiles";
import { renderWithClient } from "@/test/render-with-client";
import DriverDetailPage from "@/app/app/drivers/[id]/page";

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

vi.mock("next/navigation", () => ({
  useParams: () => ({ id: "d1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const DRIVER: DriverDetail = {
  id: "d1",
  characterId: "c1",
  number: 11,
  teamId: "t1",
  headshotUrl: "https://img.example/perez-ext.jpg",
  customHeadshotUrl: null,
  displayHeadshotUrl: "https://img.example/perez-ext.jpg",
  team: {
    id: "t1",
    name: "Cadillac F1 Team",
    shortName: "CAD",
    color: "#004341",
  },
  role: "RACE_SEAT",
  seat: 1,
  status: "ACTIVE",
  attributes: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  character: {
    id: "c1",
    name: "Sergio Pérez",
    nationality: "Mexicano",
    imageUrl: null,
    birthDate: "1990-01-26T00:00:00.000Z",
    biography: null,
  },
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/drivers/d1") return { driver: DRIVER };
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.patch.mockImplementation(async () => ({ driver: DRIVER }));
  apiMock.post.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Driver detail page", () => {
  it("carrega os dados do Driver (nome, número, equipe, nacionalidade)", async () => {
    renderWithClient(<DriverDetailPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Sergio Pérez" }),
    ).toBeDefined();
    expect(screen.getAllByText("#11").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Cadillac F1 Team").length).toBeGreaterThan(0);
    expect(screen.getByText("Mexicano")).toBeDefined();
  });

  it("não usa Character como fonte: consulta /api/drivers/:id", async () => {
    renderWithClient(<DriverDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Sergio Pérez" });

    const calls = apiMock.get.mock.calls.map((call) => String(call[0]));
    expect(calls).toContain("/api/drivers/d1");
    expect(calls.some((path) => path.startsWith("/api/characters"))).toBe(false);
  });

  it("salva a edição pelo endpoint do Driver", async () => {
    const user = userEvent.setup();
    renderWithClient(<DriverDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Sergio Pérez" });

    await user.click(screen.getByRole("button", { name: /Editar/ }));
    const input = screen.getByLabelText("Número do piloto");
    await user.clear(input);
    await user.type(input, "7");
    await user.click(screen.getByRole("button", { name: /Salvar/ }));

    expect(apiMock.patch).toHaveBeenCalledWith("/api/drivers/d1", {
      number: 7,
      customHeadshotUrl: null,
    });
  });

  it("mostra a foto do Driver (displayHeadshotUrl)", async () => {
    renderWithClient(<DriverDetailPage />);

    const img = (await screen.findByRole("img", {
      name: "Sergio Pérez",
    })) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://img.example/perez-ext.jpg");
  });

  it("sem foto: usa o placeholder com a inicial, sem quebrar", async () => {
    apiMock.get.mockImplementation(async () => ({
      driver: { ...DRIVER, headshotUrl: null, displayHeadshotUrl: null },
    }));
    renderWithClient(<DriverDetailPage />);

    await screen.findByRole("heading", { level: 1, name: "Sergio Pérez" });
    expect(screen.queryByRole("img", { name: "Sergio Pérez" })).toBeNull();
    expect(screen.getByText("S")).toBeDefined();
  });

  it("preview da imagem e envio do override como customHeadshotUrl", async () => {
    const user = userEvent.setup();
    renderWithClient(<DriverDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Sergio Pérez" });

    await user.click(screen.getByRole("button", { name: /Editar/ }));
    await user.type(
      screen.getByLabelText("Imagem do piloto (URL)"),
      "https://img.example/nova.jpg",
    );
    expect(
      screen.getByRole("img", { name: "Pré-visualização" }),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: /Salvar/ }));

    expect(apiMock.patch).toHaveBeenCalledWith("/api/drivers/d1", {
      number: 11,
      customHeadshotUrl: "https://img.example/nova.jpg",
    });
  });

  it("limpar o campo de imagem remove o override (null)", async () => {
    apiMock.get.mockImplementation(async () => ({
      driver: {
        ...DRIVER,
        customHeadshotUrl: "https://img.example/custom.jpg",
        displayHeadshotUrl: "https://img.example/custom.jpg",
      },
    }));
    const user = userEvent.setup();
    renderWithClient(<DriverDetailPage />);
    await screen.findByRole("heading", { level: 1, name: "Sergio Pérez" });

    await user.click(screen.getByRole("button", { name: /Editar/ }));
    await user.clear(screen.getByLabelText("Imagem do piloto (URL)"));
    await user.click(screen.getByRole("button", { name: /Salvar/ }));

    expect(apiMock.patch).toHaveBeenCalledWith("/api/drivers/d1", {
      number: 11,
      customHeadshotUrl: null,
    });
  });

  it("404: mostra estado de piloto não encontrado", async () => {
    apiMock.get.mockImplementation(async () => {
      throw new ApiError("Piloto não encontrado", 404);
    });
    renderWithClient(<DriverDetailPage />);

    expect(
      await screen.findByRole("heading", { name: "Piloto não encontrado" }),
    ).toBeDefined();
  });
});
