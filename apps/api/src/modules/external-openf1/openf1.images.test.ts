import { describe, expect, it } from "vitest";
import { normalizeF1HeadshotUrl } from "./openf1.images.js";

describe("normalizeF1HeadshotUrl", () => {
  it("converte rendition 1col da CDN F1 para alta resolução", () => {
    const url =
      "https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/1col/image.png";
    expect(normalizeF1HeadshotUrl(url)).toBe(
      "https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/2col-retina/image.png",
    );
  });

  it("não altera URL F1 já em alta resolução (estável)", () => {
    const url =
      "https://media.formula1.com/d_driver_fallback_image.png/content/dam/fom-website/drivers/A/ALEALB01_Alexander_Albon/alealb01.png.transform/2col-retina/image.png";
    expect(normalizeF1HeadshotUrl(url)).toBe(url);
  });

  it("não altera outras renditions da CDN F1", () => {
    const url = "https://media.formula1.com/x/y.png.transform/4col/image.png";
    expect(normalizeF1HeadshotUrl(url)).toBe(url);
  });

  it("preserva URLs externas desconhecidas", () => {
    const url = "https://img.test/avatar.png";
    expect(normalizeF1HeadshotUrl(url)).toBe(url);
    expect(normalizeF1HeadshotUrl("uploads/relative.png")).toBe(
      "uploads/relative.png",
    );
  });

  it("devolve null quando a entrada é null ou undefined", () => {
    expect(normalizeF1HeadshotUrl(null)).toBeNull();
    expect(normalizeF1HeadshotUrl(undefined)).toBeUndefined();
  });

  it("é determinística: mesma entrada, mesma saída", () => {
    const url = "https://media.formula1.com/a.png.transform/1col/image.png";
    expect(normalizeF1HeadshotUrl(url)).toBe(normalizeF1HeadshotUrl(url));
  });
});