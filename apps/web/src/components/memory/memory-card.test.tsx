import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { MemoryCard } from "@/components/memory/memory-card";
import type { Memory } from "@/lib/memories";

function makeMemory(overrides: Partial<Memory> = {}): Memory {
  return {
    id: "m1",
    eventId: null,
    importance: "HIGH",
    source: "USER_DEFINED",
    content: "O incidente de Monza mudou a temporada.",
    summary: "Incident at Monza",
    context: null,
    emotionalImpact: 8,
    createdAt: "2026-09-05T12:00:00.000Z",
    updatedAt: "2026-09-05T12:00:00.000Z",
    participants: [
      {
        id: "c1",
        name: "Alicya Kucharski",
        nationality: "Brasileira",
        imageUrl: null,
        controlledBy: "AI",
        userId: null,
      },
    ],
    ...overrides,
  };
}

describe("MemoryCard", () => {
  it("exibe resumo como título, conteúdo, importância e data", () => {
    render(
      <MemoryCard
        memory={makeMemory()}
        isDeleting={false}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const heading = screen.getByRole("heading", { name: "Incident at Monza" });
    expect(heading).toBeDefined();
    expect(
      screen.getByText("O incidente de Monza mudou a temporada."),
    ).toBeDefined();
    expect(screen.getByText("Alta")).toBeDefined();
    expect(screen.getByText("Memória")).toBeDefined();
  });

  it("exibe origem como registro direto quando não há evento vinculado", () => {
    render(
      <MemoryCard
        memory={makeMemory()}
        isDeleting={false}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(screen.getByText(/registro direto/)).toBeDefined();
  });

  it("vincula participante ao personagem", () => {
    render(
      <MemoryCard
        memory={makeMemory()}
        isDeleting={false}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: "Alicya Kucharski" });
    expect(link.getAttribute("href")).toBe("/app/characters/c1");
  });

  it("exibe evento de origem como link quando vinculado", () => {
    const memory = makeMemory({ eventId: "ev1" });
    render(
      <MemoryCard
        memory={memory}
        eventTitle="Grande Prêmio de Monza"
        isDeleting={false}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    const link = screen.getByRole("link", { name: "Grande Prêmio de Monza" });
    expect(link.getAttribute("href")).toBe("/app/events/ev1");
  });

  it("usa título de fallback quando não há resumo", () => {
    render(
      <MemoryCard
        memory={makeMemory({ summary: null })}
        isDeleting={false}
        onDelete={vi.fn()}
        onOpen={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Memória" }),
    ).toBeDefined();
  });

  it("abre e confirma a exclusão", () => {
    const onDelete = vi.fn();
    const onOpen = vi.fn();
    render(
      <MemoryCard
        memory={makeMemory()}
        isDeleting={false}
        onDelete={onDelete}
        onOpen={onOpen}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /Abrir/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /Excluir/ }));
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });
});
