// « Ne pas compter » une opération : jamais dans les statistiques ; hors du solde sauf une ligne de la banque.
import { describe, expect, it } from "vitest";
import { setExcluded } from "../../components/argent2/screens/activity-logic";
import { accountBalance, forecast, pendingPay, spendByCategory, totalBalance, transfer } from "./balance";
import type { Statement, StatementLine } from "./import/types";
import { emptyState, type State, type Txn } from "./model";
import { reconcile } from "./reconcile";
import { materializeSchedule, upcoming } from "./schedule";
import { periodSeries, spendSegments } from "./series";
import { syncWorkdays } from "./workdays";

const tx = (o: Partial<Txn>): Txn => ({ id: crypto.randomUUID(), accountId: "cbc", date: "2026-11-02", amount: -10, label: "x", status: "manuel", source: "saisie", ...o });
const base = (txns: Txn[] = []): State => {
  const s = emptyState();
  s.accounts = s.accounts.map((a) => (a.id === "cbc" ? { ...a, anchor: { date: "2026-10-31", balance: 1000 } } : a));
  return { ...s, txns };
};
const now = new Date(2026, 10, 10, 12);

describe("statistiques", () => {
  it("une dépense non comptée sort des catégories, de la barre et du graphe", () => {
    const keep = tx({ amount: -30, categoryId: "courses" });
    const drop = tx({ amount: -70, categoryId: "resto", excluded: true });
    const gain = tx({ amount: 50, categoryId: "proches-in", excluded: true });
    const s = base([keep, drop, gain]);
    expect(spendByCategory(s, "2026-11")).toEqual([{ categoryId: "courses", amount: 30, share: 1 }]);
    expect(spendSegments(s, "2026-11").map((x) => x.ids[0])).toEqual(["courses"]);
    const cur = periodSeries(s, "mois", now, 1)[0];
    expect(cur.spending).toBe(30);
    expect(cur.income).toBe(0);
  });
  it("une ligne de la banque non comptée sort aussi des statistiques", () => {
    const s = base([tx({ amount: -70, status: "banque", source: "import", excluded: true })]);
    expect(spendByCategory(s, "2026-11")).toEqual([]);
    expect(periodSeries(s, "mois", now, 1)[0].spending).toBe(0);
  });
});

describe("solde", () => {
  it("une saisie non comptée sort du solde (comme si elle n'existait pas)", () => {
    const s = base([tx({ amount: -70 }), tx({ amount: -30, excluded: true })]);
    expect(accountBalance(s, "cbc", "2026-11-30")).toBe(930);
    expect(totalBalance(s, "2026-11-30")).toBe(930);
  });
  it("une ligne de la banque non comptée reste dans le solde", () => {
    const s = base([tx({ amount: -70, status: "banque", source: "import", excluded: true })]);
    expect(accountBalance(s, "cbc", "2026-11-30")).toBe(930);
  });
  it("une échéance prévue non comptée sort du solde et de la prévision", () => {
    const p = tx({ date: "2026-11-15", amount: -200, status: "prevu", source: "fixe", refId: "r1", excluded: true });
    const s = base([p]);
    expect(accountBalance(s, "cbc", "2026-11-30")).toBe(1000);
    const f = forecast(s, "2026-11-30", now);
    expect(f.rows.find((r) => r.label === "Prévus")).toBeUndefined();
    expect(f.total).toBe(1000);
  });
  it("une journée non comptée : ni paie en attente, ni prévision, ni à venir", () => {
    const j = tx({ id: "journee:2026-11-06", date: "2026-11-06", amount: 100, status: "prevu", source: "journee", categoryId: "salaire", excluded: true });
    const s = base([j]);
    expect(pendingPay(s, "2026-11-10")).toEqual({ amount: 0 });
    expect(accountBalance(s, "cbc", "2026-11-30")).toBe(1000);
    expect(forecast(s, "2026-11-12", now).rows.find((r) => r.label === "Paies")).toBeUndefined();
    expect(upcoming(s, "2026-11-10", 7).filter((u) => u.kind === "paie")).toEqual([]);
  });
});

describe("setExcluded", () => {
  it("pose puis retire le drapeau, sans toucher aux autres", () => {
    const a = tx({ id: "a" });
    const b = tx({ id: "b" });
    let s = setExcluded(base([a, b]), "a", true);
    expect(s.txns.find((t) => t.id === "a")?.excluded).toBe(true);
    expect(s.txns.find((t) => t.id === "b")?.excluded).toBeUndefined();
    s = setExcluded(s, "a", false);
    expect("excluded" in s.txns.find((t) => t.id === "a")!).toBe(false);
  });
  it("une moitié de virement emporte l'autre", () => {
    const s0 = transfer(base(), "cbc", "revolut-epargne", 40, "2026-11-03");
    const before = totalBalance(s0, "2026-11-30");
    const s = setExcluded(s0, s0.txns[1].id, true);
    expect(s.txns.every((t) => t.excluded)).toBe(true);
    expect(totalBalance(s, "2026-11-30")).toBe(before);
    expect(accountBalance(s, "revolut-epargne", "2026-11-30")).toBe(40);
    expect(setExcluded(s, s.txns[0].id, false).txns.some((t) => t.excluded)).toBe(false);
  });
  it("virement moitié banque + moitié saisie : non compté, aucun solde ne bouge", () => {
    const tid = "t1";
    const s0 = base([
      tx({ id: "out", amount: -60, status: "banque", source: "import", bankKey: "k", transferId: tid }),
      tx({ id: "in", accountId: "liquide", amount: 60, transferId: tid }),
    ]);
    const at = "2026-11-30";
    const before = [totalBalance(s0, at), accountBalance(s0, "cbc", at), accountBalance(s0, "liquide", at)];
    const s = setExcluded(s0, "in", true);
    expect(s.txns.every((t) => t.excluded)).toBe(true);
    expect([totalBalance(s, at), accountBalance(s, "cbc", at), accountBalance(s, "liquide", at)]).toEqual(before);
    expect(before).toEqual([1000, 940, 60]);
  });
  it("une journée non comptée n'est pas recréée par syncWorkdays", () => {
    let s: State = { ...emptyState(), work: { ...emptyState().work, start: "2026-11-02" } };
    s = syncWorkdays(s, now);
    const n = s.txns.length;
    s = setExcluded(s, "journee:2026-11-03", true);
    const again = syncWorkdays(s, now);
    expect(again.txns).toHaveLength(n);
    expect(again.txns.find((t) => t.id === "journee:2026-11-03")?.excluded).toBe(true);
  });
  it("une échéance non comptée n'est pas recréée par materializeSchedule", () => {
    let s: State = {
      ...emptyState(),
      recurring: [{ id: "r1", label: "Loyer", amount: -500, every: "month", first: "2026-10-05", accountId: "cbc", categoryId: "logement" }],
    };
    s = materializeSchedule(s, "2026-11-10");
    s = setExcluded(s, "r1|2026-11-05", true);
    const again = materializeSchedule(s, "2026-11-10");
    expect(again.txns.filter((t) => t.refId === "r1")).toHaveLength(2);
    expect(again.txns.find((t) => t.id === "r1|2026-11-05")?.excluded).toBe(true);
  });
});

describe("rapprochement", () => {
  const line = (date: string, amount: number): StatementLine => ({
    key: `revolut:courant:${date}:${amount}`, date, amount, label: "LIDL", counterparty: "", iban: "", section: "courant", balance: null,
  });
  const stmt = (lines: StatementLine[]): Statement => ({ bank: "revolut", iban: "BE00 0000 0000 0101", owner: "ALEX EXEMPLE", firstName: "ALEX", lines });
  it("une saisie non comptée se relie à la ligne de la banque, qui reste non comptée", () => {
    const m = tx({ accountId: "revolut", date: "2026-11-02", amount: -25, excluded: true });
    const { state, report } = reconcile({ ...emptyState(), txns: [m] }, stmt([line("2026-11-03", -25)]));
    expect(report.linked).toBe(1);
    expect(state.txns).toHaveLength(1);
    expect(state.txns[0]).toMatchObject({ status: "banque", excluded: true });
    // Ligne de la banque : dans le solde, pas dans les dépenses.
    expect(accountBalance(state, "revolut", "2026-11-30")).toBe(-25);
    expect(spendByCategory(state, "2026-11")).toEqual([]);
  });
});
