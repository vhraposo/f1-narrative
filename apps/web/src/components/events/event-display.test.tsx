import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { formatWorldDate, formatWorldDateLong } from "@/lib/event-format";

import { IMPORTANCE_SIGNAL_CLASS, ImportanceDot } from "./event-display";

const IMPORTANCE_VALUES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

describe("ImportanceDot", () => {
  it("mapeia cada importância para um sinal visual", () => {
    for (const value of IMPORTANCE_VALUES) {
      expect(IMPORTANCE_SIGNAL_CLASS[value]).toBeTruthy();
    }
  });

  it("marca visivelmente as importâncias", () => {
    expect(IMPORTANCE_SIGNAL_CLASS.CRITICAL).toContain("brand");
    expect(IMPORTANCE_SIGNAL_CLASS.HIGH).toContain("warning");
    expect(IMPORTANCE_SIGNAL_CLASS.MEDIUM).toContain("info");
    expect(IMPORTANCE_SIGNAL_CLASS.LOW).toContain("muted");
  });

  it("renderiza dot decorativo (aria-hidden)", () => {
    const { container } = render(<ImportanceDot importance="HIGH" />);
    expect(
      container.querySelector('span[aria-hidden="true"]'),
    ).not.toBeNull();
  });
});

describe("formatWorldDate", () => {
  it("formata a data do universo em padrão editorial (DD MÊS ANO)", () => {
    expect(formatWorldDate("2026-09-05T12:00:00.000Z")).toBe("05 SET 2026");
  });

  it("retorna null para data ausente", () => {
    expect(formatWorldDate(null)).toBeNull();
  });

  it("devolve o valor original quando a data é inválida", () => {
    expect(formatWorldDate("algo")).toBe("algo");
  });
});

describe("formatWorldDateLong", () => {
  it("formata a data do universo por extenso", () => {
    expect(formatWorldDateLong("2026-09-05T12:00:00.000Z")).toBe(
      "05 de setembro de 2026",
    );
  });

  it("retorna null para data ausente", () => {
    expect(formatWorldDateLong(null)).toBeNull();
  });
});