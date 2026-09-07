import { screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { Character } from "@/lib/characters";
import type { Driver } from "@/lib/driver-profiles";
import type { Memory } from "@/lib/memories";
import type { Relationship } from "@/lib/relationships";
import { renderWithClient } from "@/test/render-with-client";
import CharacterDetailPage from "@/app/app/characters/[id]/page";

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
  useParams: () => ({ id: "c1" }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const CHARACTER: Character = {
  id: "c1",
  name: "Alicya Kucharski",
  nationality: "Brasileira",
  gender: "Feminino",
  birthDate: "1995-09-05T00:00:00.000Z",
  imageUrl: null,
  biography: "Filha de imigrantes poloneses, chegou à F1 pelo kart.",
  dna: { temperament: "methodical" },
  controlledBy: "AI",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const DRIVER: Driver = {
  id: "d1",
  characterId: "c1",
  number: 81,
  teamId: "t1",
  team: { id: "t1", name: "McLaren", shortName: "MCL", color: "#ff8000" },
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  character: {
    id: "c1",
    name: "Alicya Kucharski",
    nationality: "Brasileira",
    imageUrl: null,
  },
};

const RELATIONSHIP: Relationship = {
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
};

function makeMemory(): Memory {
  return {
    id: "m1",
    eventId: null,
    importance: "HIGH",
    source: "USER_DEFINED",
    content: "O incidente de Monza mudou a temporada.",
    summary: "Incident at Monza",
    context: { round: 14, incident: true },
    emotionalImpact: 8,
    createdAt: "2026-09-05T12:00:00.000Z",
    updatedAt: "2026-09-05T12:00:00.000Z",
    participants: [],
  };
}

let driversFixture: Driver[] = [DRIVER];
let relationshipsFixture: Relationship[] = [RELATIONSHIP];
let memoriesFixture: Memory[] = [makeMemory()];

beforeEach(() => {
  driversFixture = [DRIVER];
  relationshipsFixture = [RELATIONSHIP];
  memoriesFixture = [makeMemory()];

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/characters/c1") return { character: CHARACTER };
    if (path === "/api/drivers") return { drivers: driversFixture };
    if (path === "/api/teams") return { teams: [] };
    if (path === "/api/relationships") {
      return { relationships: relationshipsFixture };
    }
    if (path === "/api/characters/c1/memories") {
      return { memories: memoriesFixture };
    }
    if (path === "/api/characters/c1/availability") {
      return {
        availability: {
          id: "a1",
          characterId: "c1",
          status: "AVAILABLE",
          reason: null,
          since: "2026-01-01T00:00:00.000Z",
          until: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      };
    }
    if (path === "/api/characters/c1/schedule") return { schedules: [] };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("Character Detail - identidade e seções", () => {
  it("apresenta identidade, driver profile, vínculos e memórias sem JSON bruto", async () => {
    const { container } = renderWithClient(<CharacterDetailPage />);

    expect(
      await screen.findByRole("heading", { level: 1, name: "Alicya Kucharski" }),
    ).toBeDefined();
    expect(screen.getByText("Personagem · IA")).toBeDefined();
    expect(screen.getAllByText("#81").length).toBeGreaterThan(0);
    expect(screen.getAllByText("McLaren").length).toBeGreaterThan(0);
    expect(screen.getByText("Piloto")).toBeDefined();

    expect(
      screen.getByText(/Filha de imigrantes poloneses/),
    ).toBeDefined();
    expect(screen.getByText("Nacionalidade")).toBeDefined();
    expect(screen.getAllByText("Brasileira").length).toBeGreaterThan(0);

    expect(
      screen.getByRole("link", { name: "Max Verstappen" }).getAttribute("href"),
    ).toBe("/app/characters/c2");
    expect(screen.getByText("RIVALRY")).toBeDefined();
    expect(screen.getByText("Alta")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Ver tudo" }).getAttribute("href"),
    ).toBe("/app/relationships");

    expect(await screen.findByText("Incident at Monza")).toBeDefined();

    expect(screen.getByText("Disponibilidade")).toBeDefined();
    expect(screen.getByText("Agenda")).toBeDefined();
    expect(await screen.findByText("Disponível")).toBeDefined();
    expect(screen.queryByText("AVAILABLE")).toBeNull();

    // O contexto estruturado NUNCA é exposto como JSON nesta interface.
    expect(container.querySelector("pre")).toBeNull();
  });

  it("sem driver e sem vínculos: seções ausentes não viram buracos vazios", async () => {
    driversFixture = [];
    relationshipsFixture = [];
    memoriesFixture = [];

    renderWithClient(<CharacterDetailPage />);

    expect(
      await screen.findByText("Este personagem ainda não possui um perfil de piloto."),
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /Tornar piloto/ })).toBeDefined();
    expect(screen.queryByText("Piloto")).toBeNull();

    expect(
      screen.getByText(/Nenhum relacionamento registrado com Alicya/),
    ).toBeDefined();

    expect(
      await screen.findByText(/ainda não possui memórias/),
    ).toBeDefined();

    // Um único h1 por página.
    expect(
      screen.getAllByRole("heading", { level: 1 }).length,
    ).toBe(1);
  });
});