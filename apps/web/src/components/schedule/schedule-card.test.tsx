import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduleCard } from "@/components/schedule/schedule-card";
import { ApiError } from "@/lib/api";
import type { Schedule } from "@/lib/schedule";
import { renderWithClient } from "@/test/render-with-client";

const apiMock = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
  put: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return {
    ...actual,
    get: apiMock.get,
    post: apiMock.post,
    patch: apiMock.patch,
    put: apiMock.put,
    remove: apiMock.remove,
  };
});

function makeSchedule(id: string, overrides: Partial<Schedule> = {}): Schedule {
  return {
    id,
    characterId: "c1",
    activity: "Treino de pneus duros",
    startsAt: "2026-09-05T17:00:00.000Z",
    endsAt: null,
    createdAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

let schedulesFixture: Schedule[];

beforeEach(() => {
  schedulesFixture = [
    makeSchedule("s1"),
    makeSchedule("s2", {
      activity: "Conferência de imprensa",
      startsAt: "2026-09-05T20:30:00.000Z",
      endsAt: "2026-09-05T21:00:00.000Z",
    }),
  ];

  apiMock.get.mockImplementation(async (path: string) => {
    if (path === "/api/characters/c1/schedule")
      return { schedules: schedulesFixture };
    throw new ApiError("Não encontrado", 404);
  });

  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.put.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("ScheduleCard", () => {
  it("renderiza a agenda como timeline com horário e atividade", async () => {
    const { container } = renderWithClient(<ScheduleCard characterId="c1" />);

    expect(await screen.findByText("Treino de pneus duros")).toBeDefined();
    expect(screen.getByText("Conferência de imprensa")).toBeDefined();

    const list = container.querySelector("ol");
    expect(list).not.toBeNull();
    expect(list!.textContent).toMatch(/\d{2} [A-Z]{3,}/);
    expect(list!.textContent).toMatch(/\d{2}:\d{2}/);
  });

  it("preserva a ordem cronológica retornada pela API", async () => {
    const { container } = renderWithClient(<ScheduleCard characterId="c1" />);

    expect(await screen.findByText("Treino de pneus duros")).toBeDefined();
    const list = container.querySelector("ol")!;
    const text = list.textContent ?? "";
    expect(text.indexOf("Treino de pneus duros")).toBeLessThan(
      text.indexOf("Conferência de imprensa"),
    );
  });

  it("exibe somente o término quando presente", async () => {
    renderWithClient(<ScheduleCard characterId="c1" />);

    expect(await screen.findByText("Treino de pneus duros")).toBeDefined();
    const ends = screen.getAllByText(/até /);
    expect(ends.length).toBe(1);
  });

  it("exibe estado vazio quando não há agendamentos", async () => {
    schedulesFixture = [];
    renderWithClient(<ScheduleCard characterId="c1" />);

    expect(
      await screen.findByText("Nenhuma atividade agendada."),
    ).toBeDefined();
  });

  it("abre a edição inline", async () => {
    renderWithClient(<ScheduleCard characterId="c1" />);

    const editButtons = await screen.findAllByRole("button", { name: /Editar/ });
    fireEvent.click(editButtons[0]);

    expect(screen.getByLabelText("Atividade")).toBeDefined();
    expect(screen.getByText("Salvar")).toBeDefined();
  });

  it("remove um agendamento após confirmação", async () => {
    renderWithClient(<ScheduleCard characterId="c1" />);

    const removeButtons = await screen.findAllByRole("button", {
      name: "Remover agendamento",
    });
    fireEvent.click(removeButtons[0]);

    expect(screen.getByRole("dialog")).toBeDefined();
    expect(screen.getByRole("button", { name: "Confirmar" })).toBeDefined();
  });
});
