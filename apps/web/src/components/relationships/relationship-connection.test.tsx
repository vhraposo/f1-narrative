import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { RelationshipConnection } from "@/components/relationships/relationship-connection";

const ALICE = {
  id: "c1",
  name: "Alicya Kucharski",
  nationality: "Brasileira",
  imageUrl: null,
};

const MAX = {
  id: "c2",
  name: "Max Verstappen",
  nationality: "Holandês",
  imageUrl: "/max.jpg",
};

describe("RelationshipConnection", () => {
  it("mostra os dois personagens da conexão", () => {
    render(<RelationshipConnection a={ALICE} b={MAX} />);

    expect(screen.getByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("Max Verstappen")).toBeDefined();
    expect(screen.getByText("Brasileira")).toBeDefined();
    expect(screen.getByText("Holandês")).toBeDefined();
  });

  it("links cada personagem para a sua ficha", () => {
    render(<RelationshipConnection a={ALICE} b={MAX} />);

    expect(
      screen
        .getByRole("link", { name: "Alicya Kucharski" })
        .getAttribute("href"),
    ).toBe("/app/characters/c1");
    expect(
      screen.getByRole("link", { name: "Max Verstappen" }).getAttribute("href"),
    ).toBe("/app/characters/c2");
  });

  it("usa a imagem quando disponível e o inicial como fallback", () => {
    const { container } = render(<RelationshipConnection a={ALICE} b={MAX} />);

    const img = container.querySelector("img") as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).toBe("/max.jpg");

    const hidden = Array.from(container.querySelectorAll("[aria-hidden]"));
    expect(hidden.some((el) => el.textContent === "A")).toBe(true);
  });

  it("apresenta as dimensões como metadata editorial", () => {
    render(
      <RelationshipConnection
        a={ALICE}
        b={MAX}
        dimensions={{ RIVALRY: "Alta", confianca: 80 }}
      />,
    );

    expect(screen.getByText("RIVALRY")).toBeDefined();
    expect(screen.getByText("Alta")).toBeDefined();
    expect(screen.getByText("confianca")).toBeDefined();
    expect(screen.getByText("80")).toBeDefined();
  });

  it("sem dimensões: estado vazio explícito", () => {
    render(<RelationshipConnection a={ALICE} b={MAX} />);

    expect(screen.getByText("Sem dimensões definidas.")).toBeDefined();
  });
});
