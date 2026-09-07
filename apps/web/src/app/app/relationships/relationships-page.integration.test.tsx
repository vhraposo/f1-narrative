import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { Character } from "@/lib/characters";
import type { Relationship } from "@/lib/relationships";
import { renderWithClient } from "@/test/render-with-client";
import RelationshipsPage from "@/app/app/relationships/page";

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

const CHARACTERS: Character[] = [
  {
    id: "c1",
    name: "Alicya Kucharski",
    nationality: "Brasileira",
    gender: "Feminino",
    birthDate: "1995-09-05T00:00:00.000Z",
    imageUrl: null,
    biography: null,
    dna: { temperament: "methodical" },
    controlledBy: "AI",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "c2",
    name: "Max Verstappen",
    nationality: "Holandês",
    gender: "Masculino",
    birthDate: "1997-09-30T00:00:00.000Z",
    imageUrl: "/max.jpg",
    biography: null,
    dna: { temperament: "aggressive" },
    controlledBy: "USER",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

const RELATIONSHIPS: Relationship[] = [
  {
    id: "r1",
    characterAId: "c1",
    characterBId: "c2",
    dimensions: { RIVALRY: "Alta" },
    characterA: {
      id: "c1",
      name: "Alicya Kucharski",
      nationality: "Brasileira",
      imageUrl: null,
    },
    characterB: {
      id: "c2",
      name: "Max Verstappen",
      nationality: "Holandês",
      imageUrl: "/max.jpg",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
];

let relationshipsFixture: Relationship[];
let failRelationships = false;

beforeEach(() => {
  relationshipsFixture = RELATIONSHIPS;
  failRelationships = false;

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/relationships") {
      if (failRelationships) throw new ApiError("Falha", 500);
      return { relationships: relationshipsFixture };
    }
    if (path === "/api/characters") return { characters: CHARACTERS };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Relationships Page - social connections", () => {
  it("renderiza o cabeçalho e as conexões com os dois personagens", async () => {
    renderWithClient(<RelationshipsPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Relacionamentos" }),
    ).toBeDefined();
    expect(screen.getByText("UNIVERSO / RELACIONAMENTOS")).toBeDefined();
    expect(await screen.findByText("Alicya Kucharski")).toBeDefined();
    expect(await screen.findByText("Max Verstappen")).toBeDefined();
  });

  it("linka cada personagem para a ficha real", async () => {
    renderWithClient(<RelationshipsPage />);

    expect(
      (
        await screen.findByRole("link", { name: "Max Verstappen" })
      ).getAttribute("href"),
    ).toBe("/app/characters/c2");
  });

  it("mostra as dimensões como metadata sem semântica inventada", async () => {
    renderWithClient(<RelationshipsPage />);

    expect(await screen.findByText("RIVALRY")).toBeDefined();
    expect(screen.getByText("Alta")).toBeDefined();
  });

  it("estado vazio: nenhuma conexão", async () => {
    relationshipsFixture = [];
    renderWithClient(<RelationshipsPage />);

    expect(
      await screen.findByText("Você ainda não tem relacionamentos."),
    ).toBeDefined();
  });

  it("estado de erro: falha ao carregar", async () => {
    failRelationships = true;
    renderWithClient(<RelationshipsPage />);

    expect(await screen.findByText("Dados indisponíveis")).toBeDefined();
    expect(
      screen.getByRole("button", { name: /Tentar novamente/ }),
    ).toBeDefined();
  });
});
