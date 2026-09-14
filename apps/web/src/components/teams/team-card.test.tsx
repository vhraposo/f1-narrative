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

function renderCard(
  team: Team,
  drivers: Driver[],
  overrides: Record<string, unknown> = {},
) {
  return render(
    <TeamCard team={team} drivers={drivers} {...overrides} />,
  );
}

function renderCardInWrapper(
  team: Team,
  drivers: Driver[],
  overrides: Record<string, unknown> = {},
) {
  const { container } = render(
    <div data-testid="page-wrapper">
      <TeamCard team={team} drivers={drivers} {...overrides} />
    </div>,
  );
  const wrapper = container.querySelector(
    '[data-testid="page-wrapper"]',
  ) as HTMLElement;
  return { container, wrapper };
}

describe("TeamCard", () => {
  it("mostra nome, sigla e contagem real de pilotos", () => {
    renderCard(makeTeam(), [makeDriver()]);

    expect(
      screen.getByRole("heading", { name: "McLaren" }),
    ).toBeDefined();
    expect(screen.getByText("MCL")).toBeDefined();
    expect(screen.getByText("1 PILOTO")).toBeDefined();
  });

  it("reflete a cor real da equipe na barra de identidade", () => {
    const { container } = renderCard(makeTeam(), []);
    const accentBar = container.querySelector(
      'article > span[aria-hidden="true"]',
    ) as HTMLElement;
    expect(accentBar).not.toBeNull();
    expect(accentBar.style.backgroundColor).toBe("rgb(255, 128, 0)");
  });

  it("sem cor: usa fallback neutro sem hardcode", () => {
    const { container } = renderCard(makeTeam({ color: null }), []);
    const accentBar = container.querySelector(
      'article > span[aria-hidden="true"]',
    ) as HTMLElement | null;
    if (accentBar) {
      expect(accentBar.style.backgroundColor).toBe("");
    }
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.getPropertyValue("--team-primary")).toBe("");
    expect(article.style.getPropertyValue("--team-gradient")).toBe("");
  });

  it("mostra a composição com número, nome e nacionalidade", () => {
    renderCard(makeTeam(), [makeDriver()]);

    expect(screen.getByText("#81")).toBeDefined();
    expect(screen.getByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("Brasileira")).toBeDefined();
  });

  it("usa a imagem do personagem quando disponível", () => {
    const { container } = renderCard(
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
    const { container } = renderCard(makeTeam(), [makeDriver()]);
    const hidden = Array.from(container.querySelectorAll("[aria-hidden]"));
    expect(hidden.some((el) => el.textContent === "A")).toBe(true);
  });

  it("links cada piloto para a sua ficha de personagem", () => {
    renderCard(makeTeam(), [makeDriver()]);

    const link = screen
      .getByRole("link", { name: /Alicya Kucharski/ })
      .getAttribute("href");
    expect(link).toBe("/app/characters/c1");
  });

  it("sem pilotos: mostra estado vazio sem inventar linha", () => {
    renderCard(makeTeam(), []);
    expect(screen.getByText("Nenhum piloto vinculado")).toBeDefined();
    expect(screen.queryByRole("link", { name: /Alicya/ })).toBeNull();
  });

  it("pluraliza o contador de pilotos", () => {
    renderCard(makeTeam(), [makeDriver(), makeDriver({ id: "d2", characterId: "c2" })]);
    expect(screen.getByText("2 PILOTOS")).toBeDefined();
  });

  it("as ações de editar e remover ficam fora da navegação do piloto", () => {
    renderCard(makeTeam(), [makeDriver()], {
      onEdit: () => undefined,
      onRemove: () => undefined,
    });
    expect(screen.getByRole("button", { name: /Editar/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Remover/ })).toBeDefined();
  });

  it("dispara o edit ao clicar em Editar", async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    renderCard(makeTeam(), [makeDriver()], { onEdit });
    await user.click(screen.getByRole("button", { name: /Editar/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("confirma a remoção via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderCard(makeTeam(), [makeDriver()], { onRemove });
    await user.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByText("Remover equipe")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onRemove).toHaveBeenCalledWith(expect.objectContaining({ id: "t1" }));
  });

  it("hover aplica o background da identidade apenas no próprio card", () => {
    const { container } = renderCard(
      makeTeam({ visualIdentity: { primary: "#E80020", secondary: "#FFF" } }),
      [],
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.className).toContain("relative");
    expect(article.className).toContain("isolate");
    expect(article.className).toContain("group");
    expect(article.className).toContain("before:bg-[image:var(--team-gradient)]");
    expect(article.className).toContain("hover:before:opacity-100");
    expect(article.className).toContain("hover:border-[color:var(--team-border)]");
    expect(article.style.getPropertyValue("--team-gradient")).toContain(
      "linear-gradient(135deg, #E80020, #FFF)",
    );
  });

  it("o wrapper da página não recebe a identidade", () => {
    const { wrapper } = renderCardInWrapper(
      makeTeam({ visualIdentity: { primary: "#E80020" } }),
      [],
    );
    const wrapperClass = wrapper.getAttribute("class") ?? "";
    expect(wrapperClass).not.toContain("group");
    expect(wrapperClass).not.toContain("before:");
    expect(wrapper.className).not.toContain("group");
    expect(wrapper.style.getPropertyValue("--team-primary")).toBe("");
    expect(wrapper.style.getPropertyValue("--team-gradient")).toBe("");
  });

  it("segundo TeamCard não é afetado pelo hover do primeiro", () => {
    const { container } = render(
      <div>
        <TeamCard
          team={makeTeam({ visualIdentity: { primary: "#E80020" } })}
          drivers={[]}
        />
        <TeamCard team={makeTeam({ id: "t2", color: null })} drivers={[]} />
      </div>,
    );
    const articles = container.querySelectorAll("article");
    expect(articles.length).toBe(2);
    const first = articles[0] as HTMLElement;
    const second = articles[1] as HTMLElement;
    expect(first.className).toContain("hover:before:opacity-100");
    expect(first.style.getPropertyValue("--team-primary")).toBe("#E80020");
    expect(second.className).not.toContain("hover:before:opacity-100");
    expect(second.className).not.toContain("group");
    expect(second.style.getPropertyValue("--team-primary")).toBe("");
    expect(second.style.getPropertyValue("--team-gradient")).toBe("");
  });

  it("primary color aparece como variável no próprio card", () => {
    const { container } = renderCard(
      makeTeam({ visualIdentity: { primary: "#E80020" } }),
      [],
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.getPropertyValue("--team-primary")).toBe("#E80020");
    expect(article.style.getPropertyValue("--team-secondary")).not.toBe("");
    expect(article.style.getPropertyValue("--team-accent")).not.toBe("");
  });

  it("foreground permanece legível sobre o background da identidade", () => {
    const { container } = renderCard(
      makeTeam({ visualIdentity: { primary: "#E80020" } }),
      [makeDriver()],
    );
    const article = container.querySelector("article") as HTMLElement;
    expect(article.style.getPropertyValue("--team-fg")).not.toBe("");
    const heading = screen.getByRole("heading", {
      name: "McLaren",
    });
    expect(heading.className).toContain("group-hover:text-[color:var(--team-fg)]");
    const content = article.querySelector("div.relative");
    expect(content?.className).toContain("z-[1]");
  });

  it("cores reais das equipes 2026", () => {
    const cases: [string, string, string][] = [
      ["Ferrari", "#E80020", "rgb(232, 0, 32)"],
      ["Red Bull", "#3671C6", "rgb(54, 113, 198)"],
      ["Mercedes", "#27F4D2", "rgb(39, 244, 210)"],
      ["McLaren", "#FF8000", "rgb(255, 128, 0)"],
    ];
    for (const [name, hex, rgb] of cases) {
      const { unmount } = renderCard(makeTeam({ name, color: hex }), []);
      const bars = Array.from(
        document.querySelectorAll('article > span[aria-hidden="true"]'),
      ) as HTMLElement[];
      expect(bars.some((b) => b.style.backgroundColor === rgb)).toBe(true);
      unmount();
    }
  });
});
