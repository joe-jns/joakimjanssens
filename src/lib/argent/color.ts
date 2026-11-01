// Contrastes WCAG : choisir l'encre ou le blanc sur une couleur, assombrir une couleur trop claire sur un fond.
export const INK = "#151314";
export const WHITE = "#FFFFFF";
/** Fond des cartes (jeton --ag-card) : les couleurs posées dessus se règlent sur lui. */
export const CARD = "#F3F1F0";

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "");
  const f = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(f.slice(i, i + 2), 16)) as [number, number, number];
};
const toHex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("").toUpperCase()}`;

/** Luminance relative (WCAG 2.x). */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Texte ou icône posé SUR cette couleur : l'encre ou le blanc, celui qui contraste le plus. */
export const onColor = (bg: string): string => (contrast(bg, INK) >= contrast(bg, WHITE) ? INK : WHITE);

/** Mélange `hex` vers `to` (t = 0 : inchangé, 1 : `to`). */
export function mix(hex: string, to: string, t: number): string {
  const a = rgb(hex);
  const b = rgb(to);
  return toHex(a.map((v, i) => v + (b[i] - v) * t));
}

/** La couleur, assombrie vers l'encre juste ce qu'il faut pour atteindre `min` sur le fond `bg` (icônes : 3:1). */
export function readableOn(hex: string, bg = WHITE, min = 3): string {
  for (let t = 0; t <= 1.0001; t += 0.05) {
    const c = mix(hex, INK, t);
    if (contrast(c, bg) >= min) return c;
  }
  return INK;
}
