// Lit une saisie : « 12,50 », « 12.5 », « 1.200 », « 1 200,50 », « -3 ». Illisible → 0. Arrondi au centime.
// Une seule virgule = décimale ; points ET virgule = les points sont des milliers ; « 1.200 » (groupes de
// trois chiffres) = milliers.
export const toAmount = (input: string): number => {
  let s = input.trim().replace(/[\s\u00a0\u202f]/g, "");
  if (s.includes(".") && s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if (/^[-+]?\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  else s = s.replace(",", ".");
  const n = s ? Number(s) : 0;
  return Number.isFinite(n) ? round2(n) : 0;
};

const money = new Intl.NumberFormat("fr-BE", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });
export const fmt = (n: number): string => money.format(n).replace(",00", "");

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;
