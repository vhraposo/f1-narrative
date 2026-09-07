import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CharacterIdentity } from "@/components/characters/character-identity";
import type { Character } from "@/lib/characters";
import type { Driver } from "@/lib/driver-profiles";

function makeCharacter(overrides: Partial<Character> = {}): Character {
  return {
    id: "c1",
    name: "Alicya Kucharski",
    nationality: "Brasileira",
    gender: null,
    birthDate: "1995-09-05T12:00:00.000Z",
    imageUrl: null,
    biography: null,
    dna: {},
    controlledBy: "AI",
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
    team: { id: "t1", name: "McLaren", shortName: "MCL", color: "#ff8000" },
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

describe("CharacterIdentity", () => {
  it("é o único h1 da página e mostra controle + metadata", () => {
    render(
      <CharacterIdentity
        character={makeCharacter({ controlledBy: "USER" })}
      />,
    );
    expect(
      screen.getByRole("heading", { level: 1, name: "Alicya Kucharski" }),
    ).toBeDefined();
    expect(screen.getByText("Personagem · Você")).toBeDefined();
    expect(screen.getByText(/Nascido\(a\) · 05\/09\/1995/)).toBeDefined();
  });

  it("usa imagem quando disponível com alt do nome", () => {
    render(
      <CharacterIdentity
        character={makeCharacter({ imageUrl: "/face.jpg" })}
      />,
    );
    expect(
      screen
        .getByRole("img", { name: "Alicya Kucharski" })
        .getAttribute("src"),
    ).toBe("/face.jpg");
  });

  it("mostra o perfil de piloto apenas quando existe", () => {
    const { rerender } = render(
      <CharacterIdentity
        character={makeCharacter()}
        driver={makeDriver()}
      />,
    );
    expect(screen.getByText("#81")).toBeDefined();
    expect(screen.getByText("McLaren")).toBeDefined();
    expect(screen.getByText("Piloto")).toBeDefined();

    rerender(<CharacterIdentity character={makeCharacter()} driver={null} />);
    expect(screen.queryByText("Piloto")).toBeNull();
    expect(screen.queryByText("#81")).toBeNull();
  });

  it("oferece ação de edição para o personagem", () => {
    render(<CharacterIdentity character={makeCharacter()} />);
    expect(
      screen.getByRole("link", { name: /Editar personagem/ }).getAttribute("href"),
    ).toBe("/app/characters/c1/edit");
  });
});