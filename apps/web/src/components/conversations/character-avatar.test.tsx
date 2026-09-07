import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CharacterAvatar, GroupAvatar } from "./character-avatar";

describe("CharacterAvatar", () => {
  it("renderiza imagem quando imageUrl existe (decorativa)", () => {
    const { container } = render(
      <CharacterAvatar name="Alicya" imageUrl="/a.png" size="sm" />,
    );
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("alt")).toBe("");
  });

  it("faz fallback para a inicial quando não há imagem", () => {
    const { container } = render(<CharacterAvatar name="Alicya" imageUrl={null} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("A");
  });

  it("trata nome vazio no fallback", () => {
    const { container } = render(<CharacterAvatar name="" imageUrl={null} />);
    expect(container.textContent).toBe("?");
  });
});

describe("GroupAvatar", () => {
  it("usa ícone coletivo (não uma imagem de personagem)", () => {
    const { container } = render(<GroupAvatar />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("svg")).not.toBeNull();
  });
});