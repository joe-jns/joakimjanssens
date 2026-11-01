import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { emptyState, type Txn } from "./model";
import { change, chartAxis, periodRange, periodSeries, spendSegments } from "./series";

let n = 0;
const tx = (date: string, amount: number, extra: Partial<Txn> = {}): Txn => ({
  id: `t${n++}`, accountId: "cbc", date, amount, label: "x", status: "manuel", source: "saisie", ...extra,
});
const withTxns = (txns: Txn[]) => ({ ...emptyState(), txns });
// Mercredi 14 octobre 2026.
const now = new Date(2026, 9, 14, 12);

describe("periodRange", () => {
  it("semaine du lundi au dimanche", () => {
    expect(periodRange("semaine", now)).toEqual({ start: "2026-10-12", end: "2026-10-18", label: "12/10" });
    expect(periodRange("semaine", now, -1).start).toBe("2026-10-05");
  });
  it("mois et année", () => {
    expect(periodRange("mois", now)).toEqual({ start: "2026-10-01", end: "2026-10-31", label: "oct." });
    expect(periodRange("mois", now, -10)).toEqual({ start: "2025-12-01", end: "2025-12-31", label: "déc." });
    expect(periodRange("annee", now, -1)).toEqual({ start: "2025-01-01", end: "2025-12-31", label: "2025" });
  });
});

describe("periodSeries", () => {
  it("range rentrées et dépenses par semaine, la dernière est la période en cours", () => {
    const s = periodSeries(withTxns([tx("2026-10-13", 50), tx("2026-10-13", -20), tx("2026-10-06", -7.5), tx("2026-01-01", -99)]), "semaine", now);
    expect(s).toHaveLength(6);
    expect(s[5]).toMatchObject({ start: "2026-10-12", income: 50, spending: 20 });
    expect(s[4]).toMatchObject({ start: "2026-10-05", income: 0, spending: 7.5 });
    expect(s.reduce((a, b) => a + b.spending, 0)).toBe(27.5);
  });
  it("ignore les virements", () => {
    const s = periodSeries(withTxns([tx("2026-10-13", -30, { transferId: "v" }), tx("2026-10-13", 30, { transferId: "v" })]), "mois", now);
    expect(s[5]).toMatchObject({ income: 0, spending: 0 });
  });
  it("compte une journée le jour de sa paie (jeudi suivant)", () => {
    // Vendredi 9 octobre → payée jeudi 15 octobre : semaine du 12, pas celle du 5.
    const s = periodSeries(withTxns([tx("2026-10-09", 100, { source: "journee", status: "prevu" })]), "semaine", now);
    expect(s[4].income).toBe(0);
    expect(s[5].income).toBe(100);
  });
  it("journée de fin septembre payée en octobre : comptée en octobre", () => {
    const s = periodSeries(withTxns([tx("2026-09-30", 100, { source: "journee" })]), "mois", now);
    expect(s[4]).toMatchObject({ label: "sept.", income: 0 });
    expect(s[5]).toMatchObject({ label: "oct.", income: 100 });
  });
  it("par année", () => {
    const s = periodSeries(withTxns([tx("2024-05-01", 10), tx("2026-02-01", -4)]), "annee", now, 3);
    expect(s.map((b) => b.label)).toEqual(["2024", "2025", "2026"]);
    expect(s[0].income).toBe(10);
    expect(s[2].spending).toBe(4);
  });
});

describe("limites de période", () => {
  it("dimanche : encore la semaine du lundi d'avant ; le lundi suivant n'en fait pas partie", () => {
    const sunday = new Date(2026, 10, 1, 23, 30); // dimanche 1er novembre, tard
    expect(periodRange("semaine", sunday)).toMatchObject({ start: "2026-10-26", end: "2026-11-01" });
    const s = periodSeries(withTxns([tx("2026-11-01", -3), tx("2026-11-02", -100), tx("2026-10-25", -7)]), "semaine", sunday);
    expect(s[5].spending).toBe(3);
    expect(s[4].spending).toBe(7);
  });
  it("semaine à cheval sur deux mois : un seul seau, libellé du lundi", () => {
    const s = periodSeries(withTxns([tx("2026-10-31", -5), tx("2026-11-01", -6)]), "semaine", new Date(2026, 9, 30));
    expect(s[5]).toMatchObject({ label: "26/10", start: "2026-10-26", end: "2026-11-01", spending: 11 });
  });
  it("passage d'année : semaine, mois et année d'avant", () => {
    const ny = new Date(2027, 0, 1, 10); // vendredi 1er janvier 2027
    expect(periodRange("semaine", ny)).toMatchObject({ start: "2026-12-28", end: "2027-01-03", label: "28/12" });
    expect(periodRange("semaine", ny, -1)).toMatchObject({ start: "2026-12-21", end: "2026-12-27" });
    expect(periodRange("mois", ny, -1)).toEqual({ start: "2026-12-01", end: "2026-12-31", label: "déc." });
    const s = periodSeries(withTxns([tx("2026-12-31", 20), tx("2027-01-02", -4)]), "semaine", ny);
    expect(s[5]).toMatchObject({ income: 20, spending: 4 });
    const m = periodSeries(withTxns([tx("2026-12-31", 20), tx("2027-01-02", -4)]), "mois", ny);
    expect(m[4]).toMatchObject({ label: "déc.", income: 20 });
    expect(m[5]).toMatchObject({ label: "janv.", spending: 4 });
  });
});

describe("changement d'heure (fin octobre, heure de Bruxelles)", () => {
  const tz = process.env.TZ;
  beforeAll(() => {
    process.env.TZ = "Europe/Brussels";
  });
  afterAll(() => {
    process.env.TZ = tz;
  });
  it("le dimanche 25 octobre 2026 (25 h) ne décale aucune borne", () => {
    expect(new Date(2026, 9, 24, 12).getTimezoneOffset()).not.toBe(new Date(2026, 9, 26, 12).getTimezoneOffset());
    const now = new Date(2026, 9, 28, 0, 30);
    expect(periodRange("semaine", now)).toMatchObject({ start: "2026-10-26", end: "2026-11-01" });
    expect(periodRange("semaine", now, -1)).toMatchObject({ start: "2026-10-19", end: "2026-10-25" });
    const ranges = [-5, -4, -3, -2, -1, 0].map((o) => periodRange("semaine", now, o));
    for (let i = 1; i < ranges.length; i++) expect(ranges[i].start > ranges[i - 1].end).toBe(true);
    const s = periodSeries(withTxns([tx("2026-10-25", -9), tx("2026-10-26", -1)]), "semaine", now);
    expect(s[4].spending).toBe(9);
    expect(s[5].spending).toBe(1);
  });
});

describe("change", () => {
  it("variation en %", () => {
    expect(change(108, 100)).toBe(8);
    expect(change(85, 100)).toBe(-15);
    expect(change(5, 0)).toBeUndefined();
  });
});

describe("spendSegments", () => {
  it("jusqu'à 8 catégories : un segment par catégorie, ids seuls", () => {
    const segs = spendSegments(withTxns([tx("2026-10-02", -30, { categoryId: "carburant" }), tx("2026-10-03", -10, { categoryId: "courses" })]), "2026-10");
    expect(segs.map((x) => x.ids)).toEqual([["carburant"], ["courses"]]);
    expect(segs[0]).toMatchObject({ name: "Carburant", amount: 30, share: 0.75 });
  });
  it("au-delà : « Autres » regroupe les plus petites ET autres-out, avec tous leurs ids", () => {
    const s0 = emptyState();
    const extra = [1, 2].map((i) => ({ id: `x${i}`, name: `X${i}`, icon: "gift", color: "#2A78D6", kind: "out" as const }));
    const ids = ["courses", "carburant", "resto", "sorties", "abonnements", "sante", "logement", "proches-out", "x1", "x2"];
    const txns = ids.map((id, i) => tx("2026-10-05", -(100 - i * 5), { categoryId: id }));
    txns.push(tx("2026-10-06", -500, { categoryId: "autres-out" }));
    const segs = spendSegments({ ...s0, categories: [...s0.categories, ...extra], txns }, "2026-10");
    expect(segs).toHaveLength(8);
    expect(segs.slice(0, 7).map((x) => x.ids[0])).toEqual(ids.slice(0, 7));
    const other = segs[7];
    expect(other.name).toBe("Autres");
    expect(other.ids.sort()).toEqual(["autres-out", "proches-out", "x1", "x2"].sort());
    expect(other.amount).toBe(500 + 65 + 60 + 55);
    expect(segs.reduce((a, x) => a + x.share, 0)).toBeCloseTo(1);
  });
});

describe("chartAxis", () => {
  it("arrondit le haut et le bas et gradue par pas ronds (600 / 300 / 0 / −150)", () => {
    expect(chartAxis(512.4, 160.8)).toEqual({ top: 600, bottom: 300, ticks: [600, 300, 0, -150, -300] });
    expect(chartAxis(560, 140)).toEqual({ top: 600, bottom: 150, ticks: [600, 300, 0, -150] });
  });
  it("sans rentrées : seulement des dépenses sous zéro", () => {
    const a = chartAxis(0, 80);
    expect(a.top).toBe(0);
    expect(a.ticks[0]).toBe(0);
    expect(a.bottom).toBeGreaterThanOrEqual(80);
    expect(a.ticks[a.ticks.length - 1]).toBe(-a.bottom);
  });
  it("tout à zéro : un axe par défaut", () => {
    expect(chartAxis(0, 0)).toEqual({ top: 100, bottom: 0, ticks: [100, 50, 0] });
  });
  it("les graduations encadrent toujours les valeurs", () => {
    for (const [i, o] of [[1234, 987], [5, 3], [99, 1000], [2400, 0]]) {
      const a = chartAxis(i, o);
      expect(a.top).toBeGreaterThanOrEqual(i);
      expect(a.bottom).toBeGreaterThanOrEqual(o);
      expect(a.ticks).toContain(0);
    }
  });
});

describe("prévus couverts par l'ancre", () => {
  const anchored = (txns: Txn[]) => {
    const s = withTxns(txns);
    s.accounts = s.accounts.map((a) => (a.id === "cbc" ? { ...a, anchor: { date: "2026-10-10", balance: 0 } } : a));
    return s;
  };
  it("periodSeries ignore un prévu daté au plus tard à l'ancre (une journée compte au jour de sa paie)", () => {
    const s = anchored([
      tx("2026-10-08", -40, { status: "prevu", source: "fixe" }),
      tx("2026-10-08", -10, { status: "banque", source: "import" }),
      tx("2026-10-01", 100, { status: "prevu", source: "journee" }), // paie le 8/10 ≤ ancre
      tx("2026-10-12", -6, { status: "prevu", source: "fixe" }),
    ]);
    const b = periodSeries(s, "mois", now, 1)[0];
    expect(b).toMatchObject({ income: 0, spending: 16 });
  });
  it("spendSegments suit la même règle", () => {
    const s = anchored([
      tx("2026-10-08", -40, { status: "prevu", source: "fixe", categoryId: "logement" }),
      tx("2026-10-12", -6, { status: "prevu", source: "fixe", categoryId: "sante" }),
    ]);
    expect(spendSegments(s, "2026-10").map((x) => x.ids[0])).toEqual(["sante"]);
  });
});
