import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RaceCard } from "@/components/championship/race-card";
import type { Race } from "@/lib/championship";

function makeRace(overrides: Partial<Race> = {}): Race {
  return {
    id: "r1",
    seasonId: "s1",
    name: "GP de Interlagos",
    circuit: "Autódromo de Interlagos",
    country: "Brasil",
    date: "2026-09-05T12:00:00.000Z",
    round: 14,
    status: "FINISHED",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(overrides: {
  current?: boolean;
  onViewResults?: (race: Race) => void;
  onEdit?: (race: Race) => void;
  onRemove?: (race: Race) => void;
} = {}) {
  const props = {
    race: makeRace(),
    current: false,
    onViewResults: vi.fn(),
    onEdit: vi.fn(),
    onRemove: vi.fn(),
    isRemoving: false,
    removeError: null,
    ...overrides,
  };
  return { ...render(<RaceCard {...props} />), props };
}

describe("RaceCard", () => {
  it("mostra rodada R{round}, nome, circuito, país e data", () => {
    renderCard();
    expect(screen.getByText("R14")).toBeDefined();
    expect(screen.getByText("GP de Interlagos")).toBeDefined();
    expect(
      screen.getByText("Autódromo de Interlagos, Brasil"),
    ).toBeDefined();
    expect(screen.getByText("05/09/2026")).toBeDefined();
    expect(screen.getByText("FINISHED")).toBeDefined();
  });

  it("marca a corrida atual do mundo com o chip 'Atual'", () => {
    renderCard({ current: true });
    expect(screen.getByText("Atual")).toBeDefined();
  });

  it("sem ser atual: não mostra o chip 'Atual'", () => {
    renderCard({ current: false });
    expect(screen.queryByText("Atual")).toBeNull();
  });

  it("sem rodada: mantém a vaga sem inventar número", () => {
    render(
      <RaceCard
        race={makeRace({ round: null })}
        onViewResults={() => undefined}
        onEdit={() => undefined}
        onRemove={() => undefined}
        isRemoving={false}
        removeError={null}
      />,
    );
    expect(screen.getByText("R—")).toBeDefined();
  });

  it("abre os resultados pelo botão Resultados", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: /Resultados/ }));
    expect(props.onViewResults).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
  });

  it("abre a edição pelo botão Editar", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: /Editar/ }));
    expect(props.onEdit).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
  });

  it("confirma a remoção via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const { props } = renderCard();
    await user.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByText("Remover corrida")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(props.onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
  });
});
