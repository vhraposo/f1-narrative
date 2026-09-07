import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AvailabilityCard } from "@/components/availability/availability-card";
import { ApiError } from "@/lib/api";
import type { Availability } from "@/lib/availability";
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

function makeAvailability(overrides: Partial<Availability> = {}): Availability {
  return {
    id: "a1",
    characterId: "c1",
    status: "RACE_WEEKEND",
    reason: "GP em casa",
    since: "2026-09-04T12:00:00.000Z",
    until: "2026-09-06T18:00:00.000Z",
    createdAt: "2026-09-04T12:00:00.000Z",
    updatedAt: "2026-09-04T12:00:00.000Z",
    ...overrides,
  };
}

let fixture: Availability;

beforeEach(() => {
  fixture = makeAvailability();

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/characters/c1/availability")
      return { availability: fixture };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("AvailabilityCard", () => {
  it("apresenta status legível em vez do enum técnico", async () => {
    const { container } = renderWithClient(<AvailabilityCard characterId="c1" />);

    expect(
      await screen.findByText("Fim de semana de corrida"),
    ).toBeDefined();
    expect(screen.queryByText("RACE_WEEKEND")).toBeNull();
    expect(container.textContent).not.toContain("2026-09-06");
  });

  it("apresenta desde, até e motivo com dados presentes", async () => {
    renderWithClient(<AvailabilityCard characterId="c1" />);

    expect(await screen.findByText("Disponível desde")).toBeDefined();
    expect(screen.getByText("Válido até")).toBeDefined();
    expect(screen.getByText("GP em casa")).toBeDefined();
  });

  it("omite até e motivo quando ausentes", async () => {
    fixture = makeAvailability({
      status: "AVAILABLE",
      reason: null,
      until: null,
    });
    renderWithClient(<AvailabilityCard characterId="c1" />);

    expect(await screen.findByText("Disponível")).toBeDefined();
    expect(screen.queryByText("Disponível desde")).toBeDefined();
    expect(screen.queryByText("Válido até")).toBeNull();
    expect(screen.queryByText("Motivo")).toBeNull();
  });

  it("abre a edição inline e preserva o formulário", async () => {
    renderWithClient(<AvailabilityCard characterId="c1" />);

    const editButton = await screen.findByRole("button", { name: /Editar/ });
    fireEvent.click(editButton);

    expect(screen.getByText("Motivo")).toBeDefined();
    expect(screen.getByText("Válido até")).toBeDefined();
    expect(screen.getByText("Salvar")).toBeDefined();

    fireEvent.click(screen.getByText("Cancelar"));
    expect(screen.queryByLabelText("Motivo")).toBeNull();
  });
});
