// Séries par période pour le graphe de l'accueil : rentrées au-dessus de zéro, dépenses en dessous.
// Les virements entre comptes ne comptent pas ; une journée de travail compte le jour de sa paie ; une ligne
// prévue que l'ancre de son compte couvre déjà ne compte plus, une opération « non comptée » non plus.
import { counted, coveredByAnchor, effectiveDate, spendByCategory } from "./balance";
import { addDays, iso, mondayOf, MONTHS_SHORT, parse } from "./dates";
import type { State } from "./model";
import { round2 } from "./money";

export type Period = "semaine" | "mois" | "annee";
export type Bucket = { label: string; start: string; end: string; income: number; spending: number };



/** Bornes (incluses) de la période qui contient `now`, décalée de `offset` périodes (−1 : la précédente). */
export function periodRange(period: Period, now: Date, offset = 0): { start: string; end: string; label: string } {
  if (period === "semaine") {
    const start = addDays(mondayOf(iso(now)), 7 * offset);
    const d = parse(start);
    return { start, end: addDays(start, 6), label: `${d.getDate()}/${d.getMonth() + 1}` };
  }
  if (period === "mois") {
    const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const last = new Date(first.getFullYear(), first.getMonth() + 1, 0);
    return { start: iso(first), end: iso(last), label: MONTHS_SHORT[first.getMonth()] };
  }
  const y = now.getFullYear() + offset;
  return { start: `${y}-01-01`, end: `${y}-12-31`, label: String(y) };
}

/** `count` périodes, de la plus ancienne à celle qui contient `now` (la dernière). */
export function periodSeries(state: State, period: Period, now: Date, count = 6): Bucket[] {
  const buckets: Bucket[] = [];
  for (let i = count - 1; i >= 0; i--) buckets.push({ ...periodRange(period, now, -i), income: 0, spending: 0 });
  const first = buckets[0].start;
  // Seulement ce qui a déjà eu lieu : une paie attendue jeudi prochain n'est pas encore « rentrée ».
  const end = buckets[buckets.length - 1].end;
  const today = iso(now);
  const last = end < today ? end : today;
  for (const t of state.txns) {
    if (t.transferId || !counted(t) || coveredByAnchor(state, t)) continue;
    const d = effectiveDate(t);
    if (d < first || d > last) continue;
    const b = buckets.find((x) => d >= x.start && d <= x.end);
    if (!b) continue;
    if (t.amount >= 0) b.income += t.amount;
    else b.spending -= t.amount;
  }
  for (const b of buckets) {
    b.income = round2(b.income);
    b.spending = round2(b.spending);
  }
  return buckets;
}

/** Variation en % de `cur` par rapport à `prev` ; rien quand la période d'avant est vide. */
export function change(cur: number, prev: number): number | undefined {
  if (!prev) return undefined;
  return Math.round(((cur - prev) / prev) * 100);
}

export type Segment = { ids: string[]; name: string; color: string; amount: number; share: number };
const OTHER = "autres-out";
const GREY = "#A39D9A";

/**
 * Dépenses du mois par catégorie pour la barre segmentée. Au-delà de `max` segments, les plus petites
 * catégories et « Autres » lui-même se regroupent dans un dernier segment « Autres » qui garde tous leurs ids
 * (l'écran Activité filtre alors sur cette liste).
 */
export function spendSegments(state: State, month: string, max = 8): Segment[] {
  const cat = (id: string) => state.categories.find((c) => c.id === id);
  const segs: Segment[] = spendByCategory(state, month).map((r) => ({
    ids: [r.categoryId],
    name: cat(r.categoryId)?.name ?? "Autres",
    color: cat(r.categoryId)?.color ?? GREY,
    amount: r.amount,
    share: r.share,
  }));
  if (segs.length <= max) return segs;
  const keep = segs.filter((x) => x.ids[0] !== OTHER).slice(0, max - 1);
  const rest = segs.filter((x) => !keep.includes(x));
  return [
    ...keep,
    {
      ids: rest.flatMap((x) => x.ids),
      name: "Autres",
      color: GREY,
      amount: round2(rest.reduce((a, x) => a + x.amount, 0)),
      share: rest.reduce((a, x) => a + x.share, 0),
    },
  ];
}

/** Pas « rond » (1, 2, 2,5, 3, 5 × 10ⁿ) proche de `raw`. */
function niceStep(raw: number): number {
  const p = 10 ** Math.floor(Math.log10(raw));
  const m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 3 ? 3 : m <= 5 ? 5 : 10) * p;
}

/**
 * Axe du graphe : `top` (≥ plus grosse rentrée) et `bottom` (≥ plus grosse dépense, en positif) arrondis,
 * graduations de haut en bas (zéro compris). Trois pas environ au-dessus de zéro ; en dessous, des demi-pas.
 */
export function chartAxis(maxIn: number, maxOut: number): { top: number; bottom: number; ticks: number[] } {
  const span = Math.max(maxIn, maxOut, 0);
  if (!span) return { top: 100, bottom: 0, ticks: [100, 50, 0] };
  const step = niceStep((maxIn || maxOut) / 2);
  const top = maxIn > 0 ? Math.ceil(maxIn / step) * step : 0;
  const half = step / 2;
  const bottom = maxOut > 0 ? Math.ceil(maxOut / half) * half : 0;
  const ticks: number[] = [];
  for (let v = top; v > 0; v -= step) ticks.push(v);
  ticks.push(0);
  const down = bottom > step ? step : half;
  for (let v = down; v <= bottom; v += down) ticks.push(-v);
  if (bottom && ticks[ticks.length - 1] !== -bottom) ticks.push(-bottom);
  return { top, bottom, ticks };
}
