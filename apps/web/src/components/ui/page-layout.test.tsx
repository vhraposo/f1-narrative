import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EmptyState } from "./empty-state";
import { ErrorState } from "./error-state";
import { PageHeader } from "./page-header";

describe("PageHeader", () => {
  it("renderiza h1 com kicker, título, descrição, meta e ação", () => {
    render(
      <PageHeader
        kicker="UNIVERSO / PERSONAGENS"
        title="Personagens"
        description="Seus personagens do universo narrativo."
        meta="3 personagens"
        action={<button type="button">Novo personagem</button>}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Personagens" }),
    ).toBeDefined();
    expect(screen.getByText("UNIVERSO / PERSONAGENS")).toBeDefined();
    expect(
      screen.getByText("Seus personagens do universo narrativo."),
    ).toBeDefined();
    expect(screen.getByText("3 personagens")).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Novo personagem" }),
    ).toBeDefined();
  });

  it("oculta os elementos opcionais quando não são fornecidos", () => {
    render(<PageHeader title="Pilotos" />);
    expect(
      screen.getByRole("heading", { level: 1, name: "Pilotos" }),
    ).toBeDefined();
    expect(screen.queryByText(/UNIVERSO/)).toBeNull();
    expect(screen.queryByText("3 personagens")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("usa elemento header para semântica", () => {
    const { container } = render(<PageHeader title="Eventos" />);
    expect(container.querySelector("header")).toBeDefined();
  });
});

describe("EmptyState", () => {
  it("renderiza título, descrição, kicker, ícone e ações", () => {
    const { container } = render(
      <EmptyState
        icon={<svg data-testid="icon" />}
        kicker="UNIVERSO / CONVERSAS"
        title="Você ainda não tem conversas."
        description="Crie uma conversa para começar a comunicação entre personagens."
        action={<button type="button">Criar</button>}
        secondaryAction={<button type="button">Cancelar</button>}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 2,
        name: "Você ainda não tem conversas.",
      }),
    ).toBeDefined();
    expect(screen.getByText("UNIVERSO / CONVERSAS")).toBeDefined();
    expect(screen.getByTestId("icon")).toBeDefined();
    expect(screen.getByRole("button", { name: "Criar" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Cancelar" })).toBeDefined();
    expect(container.querySelector('[aria-hidden="true"]')).toBeDefined();
  });

  it("usa barra de acento quando não há ícone", () => {
    const { container } = render(<EmptyState title="Sem dados" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Sem dados" }),
    ).toBeDefined();
    expect(container.querySelector('span[aria-hidden="true"]')).toBeDefined();
  });

  it("não exibe ações quando nenhuma é fornecida", () => {
    render(<EmptyState title="Sem dados" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});

describe("ErrorState", () => {
  it("renderiza título, descrição, detalhe e ação", () => {
    render(
      <ErrorState
        heading="h1"
        title="Personagem não encontrado"
        description="Não foi possível carregar o personagem."
        detail="HTTP 404"
        action={<button type="button">Voltar</button>}
      />,
    );
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Personagem não encontrado",
      }),
    ).toBeDefined();
    expect(
      screen.getByText("Não foi possível carregar o personagem."),
    ).toBeDefined();
    expect(screen.getByText("HTTP 404")).toBeDefined();
    expect(screen.getByRole("button", { name: "Voltar" })).toBeDefined();
  });

  it("usa h2 por padrão", () => {
    render(<ErrorState title="Dados indisponíveis" />);
    expect(
      screen.getByRole("heading", { level: 2, name: "Dados indisponíveis" }),
    ).toBeDefined();
  });

  it("repassa role quando fornecida", () => {
    render(<ErrorState role="alert" title="Atenção" />);
    expect(screen.getByRole("alert")).toBeDefined();
  });

  it("não define role por padrão", () => {
    render(<ErrorState title="Dados indisponíveis" />);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});