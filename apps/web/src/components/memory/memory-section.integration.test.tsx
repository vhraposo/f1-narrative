import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemorySection } from "@/components/memory/memory-section";
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

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m1",
    eventId: "ev1",
    importance: "HIGH",
    source: "GENERATED_EVENT",
    content: "O incidente de Monza mudou a temporada.",
    summary: "Incident at Monza",
    context: null,
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
    ...overrides,
  };
}

let memoriesFixture: Memory[];

beforeEach(() => {
  memoriesFixture = [makeMemory()];

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/characters/c1/memories") {
      return { memories: memoriesFixture };
    }
    if (path === "/api/events") {
      return {
        events: [{ id: "ev1", title: "Grande Prêmio de Monza" }],
      };
    }
    if (path === "/api/memories/m1") {
      return { memory: memoriesFixture[0] };
    }
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

describe("MemorySection", () => {
  it("lista memórias como cards no modo lista", async () => {
    renderWithClient(
      <MemorySection characterId="c1" characterName="Alicya Kucharski" />,
    );

    expect(await screen.findByText("Incident at Monza")).toBeDefined();
    expect(
      screen.getByText("O incidente de Monza mudou a temporada."),
    ).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Abrir/ }),
    ).toBeDefined();
  });

  it("exibe estado vazio quando não há memórias", async () => {
    memoriesFixture = [];
    renderWithClient(
      <MemorySection characterId="c1" characterName="Alicya Kucharski" />,
    );

    expect(
      await screen.findByText(/Alicya Kucharski ainda não possui memórias/),
    ).toBeDefined();
  });

  it("abre o detalhe ao clicar em Abrir e exibe origem como link ao evento", async () => {
    renderWithClient(
      <MemorySection characterId="c1" characterName="Alicya Kucharski" />,
    );

    const openButton = await screen.findByRole("button", { name: /Abrir/ });
    fireEvent.click(openButton);

    expect(
      await screen.findByText("O incidente de Monza mudou a temporada."),
    ).toBeDefined();
    const eventLink = await screen.findByRole("link", {
      name: /Grande Prêmio de Monza/,
    });
    expect(eventLink.getAttribute("href")).toBe("/app/events/ev1");
  });
});
