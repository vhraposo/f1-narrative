import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DriverCard } from "@/components/drivers/driver-card";
import type { ChampionshipStanding } from "@/lib/championship";
import type { Driver } from "@/lib/driver-profiles";

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

function makeStanding(
  overrides: Partial<ChampionshipStanding> = {},
): ChampionshipStanding {
  return {
    id: "st1",
    seasonId: "s1",
    driverProfileId: "d1",
    points: 148,
    position: 3,
    wins: 1,
    podiums: 2,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    driverProfile: {
      id: "d1",
      characterId: "c1",
      number: 81,
      teamId: "t1",
      character: {
        id: "c1",
        name: "Alicya Kucharski",
        nationality: "Brasileira",
        imageUrl: null,
      },
    },
    ...overrides,
  };
}

describe("DriverCard", () => {
  it("mostra o número do piloto com destaque", () => {
    render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    expect(screen.getByText("#81")).toBeDefined();
  });

  it("mostra nome, nacionalidade e equipe com a cor real", () => {
    const { container } = render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    expect(
      screen.getByRole("heading", { name: "Alicya Kucharski" }),
    ).toBeDefined();
    expect(screen.getByText("Brasileira")).toBeDefined();
    expect(screen.getByText("McLaren")).toBeDefined();
    expect(container.querySelector('[style*="background-color"]')).not.toBeNull();
  });

  it("usa a imagem do character quando disponível", () => {
    render(
      <DriverCard
        driver={makeDriver({
          character: {
            id: "c1",
            name: "Alicya Kucharski",
            nationality: "Brasileira",
            imageUrl: "/face.jpg",
          },
        })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Alicya Kucharski" }).getAttribute("src"),
    ).toBe("/face.jpg");
  });

  it("usa a inicial como fallback quando não há imagem", () => {
    const { container } = render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    const hidden = Array.from(container.querySelectorAll("[aria-hidden]"));
    expect(hidden.some((el) => el.textContent === "A")).toBe(true);
  });

  it("sem equipe: não inventa nenhuma identidade de equipe", () => {
    const { container } = render(
      <DriverCard
        driver={makeDriver({ team: null, teamId: null })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(screen.getByText("Brasileira")).toBeDefined();
    expect(screen.getByText("#81")).toBeDefined();
    expect(screen.queryByText("McLaren")).toBeNull();
    expect(container.querySelector('[style*="background-color"]')).toBeNull();
  });

  it("sem cor de equipe: usa fallback neutro sem hardcode", () => {
    const { container } = render(
      <DriverCard
        driver={makeDriver({
          team: {
            id: "t1",
            name: "McLaren",
            shortName: "MCL",
            color: null,
          },
        })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(screen.getByText("McLaren")).toBeDefined();
    expect(container.querySelector("[style]")).toBeNull();
  });

  it("sem número: mantém a vaga na grid sem inventar número", () => {
    render(
      <DriverCard
        driver={makeDriver({ number: null })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(screen.getByText("#—")).toBeDefined();
  });

  it("mostra posição e pontos quando há classificação real", () => {
    render(
      <DriverCard
        driver={makeDriver()}
        standing={makeStanding()}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(screen.getByText(/P3 · 148 PTS · 1V · 2P/)).toBeDefined();
  });

  it("sem classificação: não há chip de performance", () => {
    render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    expect(screen.queryByText(/PTS/)).toBeNull();
    expect(screen.queryByText(/^P/)).toBeNull();
  });

  it("o tile navega para a ficha do character e as ações ficam fora dele", () => {
    const { container } = render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    const tile = container.querySelector(
      'a[href="/app/characters/c1"]',
    ) as HTMLAnchorElement;
    expect(tile).not.toBeNull();
    expect(tile.querySelector("a")).toBeNull();
    expect(
      screen
        .getByRole("link", { name: /Editar perfil/ })
        .getAttribute("href"),
    ).toBe("/app/characters/c1");
    expect(screen.getByRole("button", { name: /Remover/ })).toBeDefined();
  });

  it("confirma a remoção via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(
      <DriverCard driver={makeDriver()} onRemove={onRemove} isRemoving={false} />,
    );
    await user.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByText("Remover piloto")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "d1" }),
    );
  });
});
