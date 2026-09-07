import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { SeasonCard } from "@/components/championship/season-card";
import type { Season } from "@/lib/championship";

function makeSeason(overrides: Partial<Season> = {}): Season {
  return {
    id: "s1",
    year: 2026,
    name: "Sexta temporada",
    status: "ACTIVE",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(overrides: {
  active?: boolean;
  current?: boolean;
  onSelect?: (season: Season) => void;
} = {}) {
  const props = {
    season: makeSeason(),
    active: false,
    current: false,
    onSelect: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    isRemoving: false,
    removeError: null,
    ...overrides,
  };
  return { ...render(<SeasonCard {...props} />), props };
}

describe("SeasonCard", () => {
  it("mostra o ano em destaque e o nome da temporada", () => {
    renderCard();
    expect(screen.getByText("2026")).toBeDefined();
    expect(screen.getByText("Sexta temporada")).toBeDefined();
    expect(screen.getByText("ACTIVE")).toBeDefined();
  });

  it("marca a temporada atual do mundo com o chip 'Atual'", () => {
    renderCard({ current: true });
    expect(screen.getByText("Atual")).toBeDefined();
  });

  it("sem ser a temporada atual: não mostra o chip 'Atual'", () => {
    renderCard({ current: false });
    expect(screen.queryByText("Atual")).toBeNull();
  });

  it("aria-pressed reflete o estado ativo", () => {
    renderCard({ active: true, current: true });
    expect(
      screen.getByRole("button", { name: /Temporada/ }).getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("seleciona a temporada ao clicar no ticket", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    renderCard({ onSelect });
    await user.click(screen.getByRole("button", { name: /Temporada/ }));
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
    );
  });

  it("confirma a remoção via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByText("Remover temporada")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(props.onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
    );
  });

  it("abre a edição pelo botão Editar", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: /Editar/ }));
    expect(props.onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "s1" }),
    );
  });
});
