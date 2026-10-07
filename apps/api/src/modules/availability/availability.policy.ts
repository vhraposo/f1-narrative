import type { AvailabilityStatus } from "@prisma/client";

// Presença de domínio (F12): CharacterAvailability é a INTENÇÃO persistida
// (status + janela `until`); o estado EFETIVO é derivado deterministicamente
// contra o relógio do engine (worldDate / data de referência). Não existe
// segundo armazenamento: um status temporário expirado volta a AVAILABLE, o
// mesmo default de "sem registro".
//
// `until` no passado é o único mecanismo de expiração; sem data de referência
// a janela não é avaliada (comportamento conservador e determinístico).

export type AvailabilityWindow = {
  readonly status: AvailabilityStatus;
  readonly reason?: string | null;
  readonly until: Date | null;
};

export type EffectiveAvailability = {
  readonly status: AvailabilityStatus;
  readonly reason: string | null;
  readonly until: Date | null;
};

export function resolveEffectiveAvailability(
  availability: AvailabilityWindow | null | undefined,
  referenceDate: Date | null | undefined,
): EffectiveAvailability | null {
  if (!availability) return null;

  const { until } = availability;
  if (until && referenceDate && referenceDate.getTime() >= until.getTime()) {
    return { status: "AVAILABLE", reason: null, until: null };
  }

  return {
    status: availability.status,
    reason: availability.reason ?? null,
    until: availability.until,
  };
}

export function resolveEffectiveAvailabilityStatus(
  availability: AvailabilityWindow | null | undefined,
  referenceDate: Date | null | undefined,
): AvailabilityStatus | null {
  return resolveEffectiveAvailability(availability, referenceDate)?.status ?? null;
}

export function isAvailabilityOpen(
  availability: AvailabilityWindow | null | undefined,
  referenceDate: Date | null | undefined,
): boolean {
  const status = resolveEffectiveAvailabilityStatus(availability, referenceDate);
  if (!status) return true;
  return status === "AVAILABLE" || status === "RACE_WEEKEND";
}
