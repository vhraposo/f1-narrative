import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { CharacterCard } from "@/components/characters/character-card";
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
    number: 22,
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

describe("CharacterCard", () => {
  it("mostra a imagem quando disponível", () => {
    render(
      <CharacterCard
        character={makeCharacter({ imageUrl: "/face.jpg" })}
        onDelete={() => undefined}
        isDeleting={false}
      />,
    );
    expect(
      screen.getByRole("img", { name: "Alicya Kucharski" }).getAttribute("src"),
    ).toBe("/face.jpg");
  });

  it("usa a inicial como fallback sem imagem", () => {
    const { container } = render(
      <CharacterCard
        character={makeCharacter({ imageUrl: null })}
        onDelete={() => undefined}
        isDeleting={false}
      />,
    );
    const hidden = Array.from(container.querySelectorAll("[aria-hidden]"));
    expect(hidden.some((el) => el.textContent === "A")).toBe(true);
  });

  it("mostra nome, controle e metadata", () => {
    render(
      <CharacterCard
        character={makeCharacter({ controlledBy: "USER", gender: "Feminino" })}
        onDelete={() => undefined}
        isDeleting={false}
      />,
    );
    expect(
      screen.getByRole("heading", { name: "Alicya Kucharski" }),
    ).toBeDefined();
    expect(screen.getByText("Você")).toBeDefined();
    expect(screen.getByText(/Nascido\(a\) · 05\/09\/1995/)).toBeDefined();
    expect(screen.getByText(/Gênero · Feminino/)).toBeDefined();
    expect(screen.getByText(/Brasileira/)).toBeDefined();
  });

  it("mostra o perfil de piloto quando o personagem realmente o possui", () => {
    render(
      <CharacterCard
        character={makeCharacter()}
        driver={makeDriver()}
        onDelete={() => undefined}
        isDeleting={false}
      />,
    );
    expect(screen.getByText("#22")).toBeDefined();
    expect(screen.getByText("McLaren")).toBeDefined();
    expect(screen.getByText("Piloto")).toBeDefined();
  });

  it("não inventa perfil de piloto para personagem sem profile", () => {
    render(
      <CharacterCard
        character={makeCharacter()}
        driver={null}
        onDelete={() => undefined}
        isDeleting={false}
      />,
    );
    expect(screen.queryByText("Piloto")).toBeNull();
    expect(screen.queryByText("#22")).toBeNull();
  });

  it("o tile navega para o detalhe e as ações ficam fora do link principal", () => {
    const { container } = render(
      <CharacterCard
        character={makeCharacter()}
        onDelete={() => undefined}
        isDeleting={false}
      />,
    );
    expect(
      container.querySelector('a[href="/app/characters/c1"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('a[href="/app/characters/c1/edit"]'),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: /Excluir/ })).toBeDefined();
  });

  it("confirma a exclusão via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const onDelete = vi.fn();
    render(
      <CharacterCard
        character={makeCharacter()}
        onDelete={onDelete}
        isDeleting={false}
      />,
    );
    await user.click(screen.getByRole("button", { name: /Excluir/ }));
    expect(screen.getByText("Excluir personagem")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onDelete).toHaveBeenCalledWith(
      expect.objectContaining({ id: "c1" }),
    );
  });
});