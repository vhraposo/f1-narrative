import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiError } from "@/lib/api";
import type { DriverNumberBoard } from "@/lib/driver-numbers";
import { renderWithClient } from "@/test/render-with-client";
import { SeasonNumberPicker } from "@/components/drivers/season-number-picker";

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

const BOARD: DriverNumberBoard = {
  seasonId: "s1",
  championDriverProfileId: "other",
  numbers: [
    { number: 1, available: false, reason: "CHAMPION_ONLY", driverProfileId: null, driverName: null },
    { number: 10, available: false, reason: "NUMBER_ALREADY_USED", driverProfileId: "d9", driverName: "Alpha" },
    { number: 17, available: false, reason: "NUMBER_RESERVED", driverProfileId: null, driverName: null },
    { number: 44, available: true, reason: null, driverProfileId: null, driverName: null },
  ],
};

beforeEach(() => {
  apiMock.get.mockImplementation(async (path: string) => {
    if (path.startsWith("/api/seasons/s1/driver-numbers")) {
      return { board: BOARD };
    }
    throw new ApiError("Não encontrado", 404);
  });
  apiMock.put.mockImplementation(async () => ({
    number: { entryId: "e1", driverProfileId: "d1", number: 44 },
  }));
  apiMock.post.mockImplementation(async () => undefined);
  apiMock.patch.mockImplementation(async () => undefined);
  apiMock.remove.mockImplementation(async () => undefined);
});

describe("SeasonNumberPicker", () => {
  it("mostra os números e atribui um disponível pelo endpoint do domínio", async () => {
    const user = userEvent.setup();
    renderWithClient(
      <SeasonNumberPicker
        seasonId="s1"
        driverProfileId="d1"
        currentNumber={10}
      />,
    );

    expect(await screen.findByText(/Atual:/)).toBeDefined();
    await user.click(screen.getByRole("button", { name: "Número 44" }));

    expect(apiMock.put).toHaveBeenCalledWith(
      "/api/seasons/s1/drivers/d1/number",
      { number: 44 },
    );
  });

  it("desabilita #17 (reservado) e #1 (só campeão) com motivo", async () => {
    renderWithClient(
      <SeasonNumberPicker
        seasonId="s1"
        driverProfileId="d1"
        currentNumber={null}
      />,
    );

    await screen.findByText(/Atual:/);
    expect(
      (screen.getByRole("button", {
        name: /Número 17 — Reservado/,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: /Número 1 — Só o campeão/,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", {
        name: /Número 10 — Em uso: Alpha/,
      }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("mostra o erro de conflito retornado pela API", async () => {
    apiMock.put.mockImplementation(async () => {
      throw new ApiError("Número já utilizado por outro piloto nesta temporada.", 409);
    });
    const user = userEvent.setup();
    renderWithClient(
      <SeasonNumberPicker
        seasonId="s1"
        driverProfileId="d1"
        currentNumber={null}
      />,
    );

    await screen.findByText(/Atual:/);
    await user.click(screen.getByRole("button", { name: "Número 44" }));

    expect(
      (await screen.findByRole("alert")).textContent,
    ).toContain("Número já utilizado por outro piloto nesta temporada.");
  });
});
