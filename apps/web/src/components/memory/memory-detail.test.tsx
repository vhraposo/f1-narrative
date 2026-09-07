import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryDetail } from "@/components/memory/memory-detail";
import { ApiError } from "@/lib/api";
import type { Memory } from "@/lib/memories";
import { renderWithClient } from "@/test/render-with-client";

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

const MEMORY: Memory = {
  id: "m1",
  eventId: "ev1",
  importance: "CRITICAL",
  source: "GENERATED_EVENT",
  content: "A batida em Monza mudou a temporada por completo.",
  summary: "Incident at Monza",
  context: { round: 14, incident: true },
  emotionalImpact: 8,
  createdAt: "2026-09-05T12:00:00.000Z",
  updatedAt: "2026-09-05T12:00:00.000Z",
  participants: [
    {
      id: "c1",
      name: "Alicya Kucharski",
      nationality: "Brasileira",
      imageUrl: null,
      controlledBy: "AI",
      userId: null,
    },
  ],
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/memories/m1") return { memory: MEMORY };
    if (path === "/api/events/ev1") {
      return { event: { id: "ev1", title: "Grande Prêmio de Monza" } };
    }
    if (path === "/api/characters") return { characters: [] };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("MemoryDetail", () => {
  it("apresenta identidade, contexto e conteúdo sem JSON bruto", async () => {
    const { container } = renderWithClient(<MemoryDetail memoryId="m1" />);

    expect(
      await screen.findByRole("heading", { name: "Incident at Monza" }),
    ).toBeDefined();
    expect(
      screen.getByText("A batida em Monza mudou a temporada por completo."),
    ).toBeDefined();
    expect(screen.getByText("Crítica")).toBeDefined();
    expect(screen.getByText("Evento gerado")).toBeDefined();
    expect(screen.getByText("Resumo")).toBeDefined();
    expect(screen.getByText("Impacto")).toBeDefined();
    expect(screen.getByText("8")).toBeDefined();

    expect(container.querySelector("pre")).toBeNull();
  });

  it("exibe origem como link para o evento", async () => {
    renderWithClient(<MemoryDetail memoryId="m1" />);

    const link = await screen.findByRole("link", { name: /Grande Prêmio de Monza/ });
    expect(link.getAttribute("href")).toBe("/app/events/ev1");
  });

  it("exibe participante como link para o personagem", async () => {
    renderWithClient(<MemoryDetail memoryId="m1" />);

    const links = await screen.findAllByRole("link", {
      name: "Alicya Kucharski",
    });
    expect(links.length).toBeGreaterThan(0);
    expect(links.every((l) => l.getAttribute("href") === "/app/characters/c1")).toBe(
      true,
    );
  });
});
