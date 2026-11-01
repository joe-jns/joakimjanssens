import { describe, expect, it } from "vitest";
import { CATEGORY_COLORS } from "../../components/argent2/sheets/palette";
import { contrast, INK, luminance, mix, onColor, readableOn, WHITE } from "./color";

describe("contrastes", () => {
  it("luminance et rapport WCAG de référence", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1);
    expect(luminance("#000000")).toBe(0);
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 1);
  });
  it("onColor : encre sur les teintes claires, blanc sur les foncées", () => {
    expect(onColor("#EDA100")).toBe(INK);
    expect(onColor("#7FB0EA")).toBe(INK);
    expect(onColor("#A39D9A")).toBe(INK);
    expect(onColor("#6E5BD0")).toBe(WHITE);
    expect(onColor("#151314")).toBe(WHITE);
  });
  it("onColor : au moins 3:1 (icônes) sur toute la palette, et le meilleur des deux", () => {
    for (const c of CATEGORY_COLORS) {
      const best = Math.max(contrast(c, INK), contrast(c, WHITE));
      expect(contrast(c, onColor(c))).toBe(best);
      expect(best).toBeGreaterThanOrEqual(3);
    }
  });
  it("readableOn : 3:1 sur blanc et sur la carte, couleur gardée si déjà lisible", () => {
    for (const c of CATEGORY_COLORS) {
      expect(contrast(readableOn(c), WHITE)).toBeGreaterThanOrEqual(3);
      expect(contrast(readableOn(c, "#F3F1F0"), "#F3F1F0")).toBeGreaterThanOrEqual(3);
    }
    expect(readableOn("#6E5BD0")).toBe("#6E5BD0");
    expect(readableOn("#EDA100")).not.toBe("#EDA100");
  });
  it("mix", () => {
    expect(mix("#FFFFFF", "#000000", 0.5)).toBe("#808080");
  });
});
