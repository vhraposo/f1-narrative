import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RelationshipCard } from "@/components/relationships/relationship-card";
import type { Relationship } from "@/lib/relationships";

function makeRelationship(
  overrides: Partial<Relationship> = {},
): Relationship {
  return {
    id: "r1",
    characterAId: "c1",
    characterBId: "c2",
    dimensions: { RIVALRY: "Alta" },
    characterA: {
      id: "c1",
      name: "Alicya Kucharski",
      nationality: "Brasileira",
      imageUrl: null,
    },
    characterB: {
      id: "c2",
      name: "Max Verstappen",
      nationality: "Holandês",
      imageUrl: "/max.jpg",
    },
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function renderCard(
  relationship: Relationship,
  overrides: { onEdit?: () => void; onRemove?: () => void } = {},
) {
  return render(
    <RelationshipCard
      relationship={relationship}
      onEdit={overrides.onEdit ?? (() => undefined)}
      onRemove={overrides.onRemove ?? (() => undefined)}
      isRemoving={false}
      removeError={null}
    />,
  );
}

describe("RelationshipCard", () => {
  it("mostra os dois lados da conexão", () => {
    renderCard(makeRelationship());

    expect(screen.getByText("Alicya Kucharski")).toBeDefined();
    expect(screen.getByText("Max Verstappen")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Max Verstappen" }).getAttribute("href"),
    ).toBe("/app/characters/c2");
  });

  it("expõe dimensões como metadata, não aplica semântica inventada", () => {
    renderCard(makeRelationship());

    expect(screen.getByText("RIVALRY")).toBeDefined();
    expect(screen.getByText("Alta")).toBeDefined();
  });

  it("sem dimensões: exibe estado vazio", () => {
    renderCard(makeRelationship({ dimensions: {} }));

    expect(screen.getByText("Sem dimensões definidas.")).toBeDefined();
  });

  it("as ações de editar e remover ficam fora da navegação dos personagens", () => {
    renderCard(makeRelationship());

    expect(screen.getByRole("button", { name: /Editar/ })).toBeDefined();
    expect(screen.getByRole("button", { name: /Remover/ })).toBeDefined();
  });

  it("confirma a remoção via ConfirmDialog", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    renderCard(makeRelationship(), { onRemove });

    await user.click(screen.getByRole("button", { name: /Remover/ }));
    expect(screen.getByText("Remover relacionamento")).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onRemove).toHaveBeenCalledWith(
      expect.objectContaining({ id: "r1" }),
    );
  });
});
