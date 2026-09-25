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
    headshotUrl: null,
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
    const accentBar = container.querySelector('article [aria-hidden="true"]') as HTMLElement | null;
    if (accentBar && accentBar.tagName === "SPAN") {
      expect(accentBar.style.backgroundColor).toBe("");
    }
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

  it("piloto de outro usuário (isOwned=false): somente leitura, sem links nem ações", () => {
    const { container } = render(
      <DriverCard
        driver={makeDriver()}
        onRemove={() => undefined}
        isRemoving={false}
        isOwned={false}
      />,
    );
    expect(container.querySelector('a[href="/app/characters/c1"]')).toBeNull();
    expect(screen.queryByRole("link", { name: /Editar perfil/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Remover/ })).toBeNull();
    expect(
      screen.getByRole("heading", { name: "Alicya Kucharski" }),
    ).toBeDefined();
    expect(screen.getByText("#81")).toBeDefined();
    expect(screen.getByText("McLaren")).toBeDefined();
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

  it("mostra bandeira junto à nacionalidade conhecida", () => {
    render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    const flag = screen.getByRole("img", {
      name: "Brazil flag",
    }) as HTMLImageElement;
    expect(flag.getAttribute("src")).toBe(
      "https://flags.restcountries.com/v5/svg/br.svg",
    );
  });

  it("não mostra bandeira para nacionalidade desconhecida", () => {
    render(
      <DriverCard
        driver={makeDriver({
          character: {
            id: "c1",
            name: "Piloto Fantasma",
            nationality: "Atlantean",
            imageUrl: null,
          },
        })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(screen.queryByRole("img", { name: "Atlantean flag" })).toBeNull();
  });

  it("hover da nacionalidade aplica apenas no próprio card, de forma sutil", () => {
    const { container } = render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toContain("relative");
    expect(article.className).toContain("isolate");
    expect(article.className).toContain("before:bg-[image:var(--national-gradient)]");
    expect(article.className).toContain("hover:before:opacity-100");
    const gradient = article.style.getPropertyValue("--national-gradient");
    expect(gradient).toBe(
      "linear-gradient(135deg, rgba(0,156,59,0.16) 0%, rgba(255,223,0,0.14) 52%, rgba(0,39,118,0.16) 100%)",
    );
    expect(article.style.getPropertyValue("--national-border")).toBe(
      "rgba(0,39,118,0.35)",
    );
    expect(article.style.getPropertyValue("--national-glow")).toBe(
      "rgba(0,39,118,0.14)",
    );
  });

  it("o wrapper da página não recebe a paleta nacional", () => {
    const { container } = render(
      <div data-testid="page-wrapper">
        <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />
      </div>,
    );
    const article = container.querySelector("article") as HTMLElement;
    const wrapper = container.querySelector(
      '[data-testid="page-wrapper"]',
    ) as HTMLElement;
    const wrapperClass = wrapper.getAttribute("class") ?? "";
    expect(wrapperClass).not.toContain("before:");
    expect(wrapper.style.getPropertyValue("--national-primary")).toBe("");
    expect(wrapper.style.getPropertyValue("--national-gradient")).toBe("");
    expect(article.style.getPropertyValue("--national-primary")).not.toBe("");
  });

  it("segundo DriverCard sem nacionalidade conhecida não é afetado", () => {
    const { container } = render(
      <div>
        <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />
        <DriverCard
          driver={makeDriver({
            id: "dX",
            characterId: "cX",
            character: {
              id: "cX",
              name: "Ghost",
              nationality: "Atlantean",
              imageUrl: null,
            },
          })}
          onRemove={() => undefined}
          isRemoving={false}
        />
      </div>,
    );
    const articles = container.querySelectorAll("article");
    expect(articles.length).toBe(2);
    const first = articles[0] as HTMLElement;
    const second = articles[1] as HTMLElement;
    expect(first.style.getPropertyValue("--national-primary")).not.toBe("");
    expect(second.style.getPropertyValue("--national-primary")).toBe("");
    expect(second.style.getPropertyValue("--national-gradient")).toBe("");
    expect(second.className).not.toContain("hover:before:opacity-100");
  });

  it("título preserva legibilidade: usa text-foreground", () => {
    render(
      <DriverCard driver={makeDriver()} onRemove={() => undefined} isRemoving={false} />,
    );
    const heading = screen.getByRole("heading", { name: "Alicya Kucharski" });
    expect(heading.className).toContain("text-foreground");
  });

  it("piloto sem número e nacionalidade desconhecida não quebra renderização", () => {
    expect(() =>
      render(
        <DriverCard
          driver={makeDriver({
            number: null,
            character: {
              id: "cX",
              name: "Ghost",
              nationality: "Nebulian",
              imageUrl: null,
            },
          })}
          onRemove={() => undefined}
          isRemoving={false}
        />,
      ),
    ).not.toThrow();
  });

  it("mostra headshot quando headshotUrl está presente", () => {
    render(
      <DriverCard
        driver={makeDriver({ headshotUrl: "https://img.test/h.png" })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    const img = screen.getByRole("img", { name: "Alicya Kucharski" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://img.test/h.png");
    expect(img.className).toContain("h-16");
    expect(img.className).toContain("w-20");
    expect(img.className).toContain("object-cover");
  });

  it("prefere a imagem do character (alta resolução) quando headshotUrl também existe", () => {
    render(
      <DriverCard
        driver={makeDriver({
          headshotUrl: "https://media.formula1.com/a.png.transform/1col/image.png",
          character: {
            id: "c1",
            name: "Alicya Kucharski",
            nationality: "Brasileira",
            imageUrl:
              "https://media.formula1.com/a.png.transform/2col-retina/image.png",
          },
        })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    const img = screen.getByRole("img", { name: "Alicya Kucharski" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe(
      "https://media.formula1.com/a.png.transform/2col-retina/image.png",
    );
  });

  it("usa imageUrl quando headshotUrl é nulo", () => {
    render(
      <DriverCard
        driver={makeDriver({
          headshotUrl: null,
          character: {
            id: "c1",
            name: "Alicya Kucharski",
            nationality: "Brasileira",
            imageUrl: "https://img.test/c.jpg",
          },
        })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    const img = screen.getByRole("img", { name: "Alicya Kucharski" }) as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://img.test/c.jpg");
  });

  it("fallback para inicial quando headshotUrl e imageUrl são nulos", () => {
    render(
      <DriverCard
        driver={makeDriver({ headshotUrl: null })}
        onRemove={() => undefined}
        isRemoving={false}
      />,
    );
    expect(screen.queryByRole("img", { name: "Alicya Kucharski" })).toBeNull();
    expect(screen.getByText("A")).toBeDefined();
  });
});
