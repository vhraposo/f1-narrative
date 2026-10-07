import { describe, expect, it } from "vitest";

import {
  isAvailabilityOpen,
  resolveEffectiveAvailability,
  resolveEffectiveAvailabilityStatus,
} from "./availability.policy.js";

const REFERENCE = new Date("2026-10-01T12:00:00.000Z");

describe("availability.policy (F12 - presença efetiva)", () => {
  it("sem registro é considerado disponível", () => {
    expect(isAvailabilityOpen(null, REFERENCE)).toBe(true);
    expect(resolveEffectiveAvailabilityStatus(undefined, REFERENCE)).toBeNull();
    expect(resolveEffectiveAvailability(null, REFERENCE)).toBeNull();
  });

  it("status sem janela é mantido como persistido", () => {
    const view = resolveEffectiveAvailability(
      { status: "BUSY", reason: "treino", until: null },
      REFERENCE,
    );
    expect(view).toEqual({ status: "BUSY", reason: "treino", until: null });
    expect(isAvailabilityOpen({ status: "BUSY", until: null }, REFERENCE)).toBe(false);
  });

  it("janela futura mantém o status", () => {
    const until = new Date("2026-10-01T13:00:00.000Z");
    expect(
      resolveEffectiveAvailabilityStatus({ status: "OFFLINE", until }, REFERENCE),
    ).toBe("OFFLINE");
  });

  it("janela expirada deriva AVAILABLE e limpa reason/until", () => {
    const until = new Date("2026-10-01T11:00:00.000Z");
    const view = resolveEffectiveAvailability(
      { status: "OFFLINE", reason: "descanso", until },
      REFERENCE,
    );
    expect(view).toEqual({ status: "AVAILABLE", reason: null, until: null });
    expect(
      isAvailabilityOpen({ status: "OFFLINE", reason: "descanso", until }, REFERENCE),
    ).toBe(true);
  });

  it("expira exatamente no instante de referência", () => {
    expect(
      resolveEffectiveAvailabilityStatus({ status: "SLEEPING", until: REFERENCE }, REFERENCE),
    ).toBe("AVAILABLE");
  });

  it("sem data de referência a janela não é avaliada", () => {
    const until = new Date("2026-10-01T11:00:00.000Z");
    expect(resolveEffectiveAvailabilityStatus({ status: "OFFLINE", until }, null)).toBe(
      "OFFLINE",
    );
  });

  it("isAvailabilityOpen aceita AVAILABLE e RACE_WEEKEND", () => {
    expect(isAvailabilityOpen({ status: "AVAILABLE", until: null }, REFERENCE)).toBe(true);
    expect(isAvailabilityOpen({ status: "RACE_WEEKEND", until: null }, REFERENCE)).toBe(true);
    for (const status of ["BUSY", "TRAINING", "TRAVELING", "SLEEPING", "OFFLINE"] as const) {
      expect(isAvailabilityOpen({ status, until: null }, REFERENCE)).toBe(false);
    }
  });
});
