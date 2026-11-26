import { describe, expect, it } from "vitest";

import { speakerColorClass, speakerColorPaletteSize } from "./speaker-color";

describe("speaker color (determinístico)", () => {
  it("1) mesmo characterId produz sempre a mesma cor", () => {
    const first = speakerColorClass("clx-antonelli");
    const second = speakerColorClass("clx-antonelli");
    expect(second).toBe(first);
  });

  it("2) cores são estáveis independentemente da ordem de chamada", () => {
    const ids = ["a-1", "b-2", "c-3", "d-4", "e-5"];
    const forward = ids.map((id) => speakerColorClass(id));
    const backward = [...ids].reverse().map((id) => speakerColorClass(id)).reverse();
    expect(backward).toEqual(forward);
  });

  it("3) distribui personagens distintos em cores distintas na prática", () => {
    const ids = Array.from({ length: 30 }, (_, index) => `character-${index}`);
    const colors = new Set(ids.map((id) => speakerColorClass(id)));
    expect(colors.size).toBeGreaterThanOrEqual(10);
    expect(colors.size).toBeLessThanOrEqual(speakerColorPaletteSize());
  });

  it("4) sem characterId usa o tratamento neutro (não é cor de speaker)", () => {
    expect(speakerColorClass(null)).toBe("text-brand");
    expect(speakerColorClass(undefined)).toBe("text-brand");
  });
});
