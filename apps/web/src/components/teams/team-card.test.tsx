import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { TeamCard } from "@/components/teams/team-card";
import type { Driver } from "@/lib/driver-profiles";
import type { Team } from "@/lib/teams";

function makeTeam(overrides: Partial<Team> = {}): Team {
  return {
    id: "t1",
    name: "McLaren",
    shortName: "MCL",
    color: "#ff8000",
    userId: "u1",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDriver(overrides: Partial<Driver> = {}): Driver {
  return {
    id: "d1",
    characterId: "c1",
    number: 81,
    teamId: "t1",
    team: {
      id: "t1",
      name: "McLaren",
      shortName: "MCL",
      color: "#ff8000",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    character: {
      id: "c1",
      name: "Alicya Kucharski",
      nationality: "Brasileira",
      imageUrl: null,
    },
    ...overrides,
  };
}

function renderTeam(
  team: Team,
  drivers: Driver[],
  overrides: { onEdit?: () => void; onRemove?: () => void } = {},
) {
  return render(
    <TeamCard
      team={team}
      drivers={drivers}
      onEdit={overrides.onEdit ?? (() => undefined)}
      onRemove={overrides.onRemove ?? (() => undefined)}
      isRemoving={false}
      removeError={null}
    />,
  );
}

describe("TeamCard", () => {
  it("mostra nome, sigla e contagem real de pilotos", () => {
    renderTeam(makeTeam(), [makeDriver()]);

    expect(
      screen.getByRole("heading", { name: "McLaren" }),
    ).toBeDefined();
    expect(screen.getByText("MCL")).toBeDefined();
    expect(screen.getByText("1 PILOTO")).toBeDefined();
  });

  it("reflete a cor real da equipe na barra de identidade", () => {
    const { container } = renderTeam(makeTeam(), []);
    const bars = Array.from(
      container.querySelectorAll('[aria-hidden="true"][style]'),
    );
    expect(
      bars.some((el) => (el as HTMLElement).style.backgroundColor !== ""),
    ).toBe(true);
  });

  it("sem cor: usa fallback neutro sem hardcode", () => {
    const { container } = renderTeam(
      makeTeam({ color: null }),
      [],
    );
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("mostra a composição com número, nome e nacionalidade", () => {
    renderTeam(makeTeam(), [makeDriver()]);

    expect(screen.getByText("#81")).toBeDefined();
    expect(screen.getByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("Brasileira")).toBeDefined();
  });

  it("usa a imagem do personagem quando disponível", () => {
    const { container } = renderTeam(
      makeTeam(),
      [
        makeDriver({
          character: {
            id: "c1",
            name: "Alicya Kucharski",
            nationality: "Brasileira",
            imageUrl: "/face.jpg",
          },
        }),
      ],
    );
    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/face.jpg");
  });

  it("usa a inicial como fallback quando não há imagem", () => {
    const { container } = renderTeam(makeTeam(), [makeDriver()]);
    const hidden = Array.from(container.querySelectorAll("[aria-hidden]"));
    expect(hidden.some((el) => el.textContent === "A")).toBe(true);
  });

  it("links cada piloto para a sua ficha de personagem", () => {
    renderTeam(makeTeam(), [makeDriver()]);

    const link = screen
      .getByRole("link", { name: /Alicya Kucharski/ })
      .getAttribute("href");
    expect(link).toBe("/app/characters/c1");
  });

  it("sem pilotos: mostra estado vazio sem inventar linha", () => {
    renderTeam(makeTeam(), []);
    expect(screen.getByText("Nenhum piloto vinculado")).toBeDefined();
    expect(screen.queryByRole("link", { name: /Alicya/ })).toBeNull();
  });

  it("pluraliza o contador de pilotos", () => {
    renderTeam(makeTeam(), [makeDriver(), makeDriver({ id: "d2", characterId: "c2" })]);
    expect(screen.getByText("2 PILOTOS")).toBeDefined();
  });

  it("as ações de editar e remover ficam fora da navegação do piloto", () => {
    renderTeam(makeTeam(), [makeDriver()]);
    expect(screen.getByRole("button", { name: /Editar/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Remover/ })).toBeDefined();
  });

  it("dispara o edit ao clicar em Editar", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderTeam(makeTeam(), [makeDriver()], { onEdit });
    await user.click(screen.getByRole("button", { name: /Editar/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("confirma a remoção via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderTeam(makeTeam(), [makeDriver()], { onRemove });
    await user.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByText("Remover equipe")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });
});
