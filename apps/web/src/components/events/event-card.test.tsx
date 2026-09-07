import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { Event } from "@/lib/events";

import { EventCard } from "./event-card";

const baseEvent: Event = {
  id: "evt-1",
  type: "RACE_INCIDENT",
  importance: "HIGH",
  source: "USER_DEFINED",
  title: "Ultrapassagem em Interlagos",
  description: null,
  worldDate: "2026-09-05T12:00:00.000Z",
  payload: {},
  createdAt: "2026-09-01T00:00:00.000Z",
};

function renderCard(event: Event = baseEvent) {
  const onDelete = vi.fn();
  const view = render(
    <EventCard event={event} isDeleting={false} onDelete={onDelete} />,
  );
  return { onDelete, view };
}

describe("EventCard", () => {
  it("comunica importância com dot decorativo e rótulo textual", () => {
    renderCard();
    expect(screen.getByText("Alta")).toBeDefined();
    expect(screen.queryByText("Baixa")).toBeNull();
  });

  it("mostra tipo, origem e data do universo", () => {
    renderCard();
    expect(screen.getByText("Incidente de corrida")).toBeDefined();
    expect(screen.getByText("Definido pelo usuário")).toBeDefined();
    expect(screen.getByText("05 SET 2026")).toBeDefined();
  });

  it("liga o conteúdo ao detalhe e mantém o caminho de edição", () => {
    renderCard();
    const hrefs = screen
      .getAllByRole("link")
      .map((link) => (link as HTMLAnchorElement).getAttribute("href"));
    expect(hrefs).toContain("/app/events/evt-1");
    expect(hrefs).toContain("/app/events/evt-1/edit");
  });

  it("exclui por meio do diálogo de confirmação", async () => {
    const user = userEvent.setup();
    const { onDelete } = renderCard();
    await user.click(screen.getByRole("button", { name: /Excluir/i }));
    expect(
      screen.getByText(/Deseja excluir "Ultrapassagem em Interlagos"\?/),
    ).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Confirmar" }));
    expect(onDelete).toHaveBeenCalledWith(baseEvent);
  });

  it("oculta a data quando não há worldDate", () => {
    renderCard({ ...baseEvent, worldDate: null });
    expect(screen.queryByText(/2026/)).toBeNull();
  });
});