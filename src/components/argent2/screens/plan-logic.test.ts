import { describe, expect, it } from "vitest";
import { forecast, totalBalance, accountBalance } from "../../../lib/argent/balance";
import { emptyState, type Debt, type State } from "../../../lib/argent/model";
import { debtSchedule, materializeSchedule } from "../../../lib/argent/schedule";
import { reconcile } from "../../../lib/argent/reconcile";
import {
  debtDateRule,
  debtDraft,
  debtInfo,
  debtsSummary,
  defaultGoalAccount,
  deleteDebt,
  deleteRecurring,
  goalProgress,
  nextOccurrence,
  putAside,
  saveDebt,
  saveGoal,
  saveRecurring,
  saveWork,
  skippedRanges,
  skipRange,
  unskip,
  workdaysIn,
} from "./plan-logic";

const NOW = new Date(2026, 10, 1, 12); // dimanche 1er novembre 2026, midi
const TODAY = "2026-11-01";

const debt = (p: Partial<Debt> = {}): Debt => ({ id: "d", label: "Prêt", total: 1200, amount: 100, every: "month", first: "2026-11-05", accountId: "cbc", ...p });

describe("paie", () => {
  it("changer le montant, le compte et la période recalcule les journées prévues", () => {
    let s = saveWork(emptyState(), { start: "2026-10-19", dayAmount: 90, accountId: "cbc" }, NOW);
    expect(s.txns.filter((t) => t.source === "journee")).toHaveLength(10);
    s = saveWork(s, { dayAmount: 95.5, accountId: "revolut", start: "2026-10-26" }, NOW);
    const j = s.txns.filter((t) => t.source === "journee");
    expect(j).toHaveLength(5);
    expect(j.every((t) => t.amount === 95.5 && t.accountId === "revolut" && t.date >= "2026-10-26")).toBe(true);
    s = saveWork(s, { end: "2026-10-28" }, NOW);
    expect(s.txns.filter((t) => t.source === "journee").map((t) => t.date)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
    s = saveWork(s, { end: "" }, NOW);
    expect(s.work.end).toBeUndefined();
    expect(s.txns.filter((t) => t.source === "journee")).toHaveLength(5);
  });
  it("une plage de jours non travaillés retire ces journées (jours ouvrés seulement) et se remet", () => {
    let s = saveWork(emptyState(), { start: "2026-10-19", dayAmount: 80 }, NOW);
    s = skipRange(s, "2026-10-22", "2026-10-27");
    expect(s.work.skipped).toEqual(["2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"]);
    expect(s.txns.filter((t) => t.source === "journee")).toHaveLength(6);
    expect(skippedRanges(s.work.skipped)).toEqual([{ from: "2026-10-22", to: "2026-10-27", days: ["2026-10-22", "2026-10-23", "2026-10-26", "2026-10-27"] }]);
    s = unskip(s, ["2026-10-26", "2026-10-27"], NOW);
    expect(s.txns.filter((t) => t.source === "journee")).toHaveLength(8);
    expect(workdaysIn("2026-10-30", "2026-11-02")).toEqual(["2026-10-30", "2026-11-02"]);
  });
  it("plages séparées par un jour ouvré", () => {
    expect(skippedRanges(["2026-10-20", "2026-10-22"]).length).toBe(2);
  });
});

describe("paiements fixes", () => {
  it("un nouveau fixe part d'aujourd'hui : aucune échéance passée créée", () => {
    const s = saveRecurring(emptyState(), { label: " Loyer ", amount: -500, every: "month", first: "2026-09-03", accountId: "cbc" }, TODAY);
    expect(s.recurring[0]).toMatchObject({ label: "Loyer", since: TODAY });
    expect(materializeSchedule(s, TODAY).txns).toHaveLength(0);
    expect(nextOccurrence(s.recurring[0], TODAY)).toBe("2026-11-03");
  });
  it("modifier le montant vaut pour la suite ; supprimer garde l'historique", () => {
    let s = saveRecurring(emptyState(), { label: "Abo", amount: -10, every: "month", first: "2026-10-01", accountId: "cbc" }, "2026-10-01");
    s = materializeSchedule(s, "2026-10-01");
    const id = s.recurring[0].id;
    s = saveRecurring(s, { id, label: "Abo", amount: -12, every: "month", first: "2026-10-01", accountId: "cbc" }, TODAY);
    expect(s.recurring[0].since).toBe(TODAY);
    s = materializeSchedule(s, "2026-12-01");
    expect(s.txns.map((t) => [t.date, t.amount])).toEqual([["2026-10-01", -10], ["2026-11-01", -12], ["2026-12-01", -12]]);
    s = deleteRecurring(s, id);
    expect(s.recurring).toHaveLength(0);
    expect(s.txns).toHaveLength(3);
    expect(materializeSchedule(s, "2027-03-01").txns).toHaveLength(3);
  });
});

describe("dettes", () => {
  it("1200 € à 100 € par mois : 12 tranches, fin et « libre le » connus", () => {
    const i = debtInfo(debt(), TODAY);
    expect(i).toMatchObject({ left: 1200, whole: 1200, repaid: 0, end: "2027-10-05", done: false });
    expect(i.next).toEqual({ date: "2026-11-05", amount: 100 });
    const later = debtInfo(debt(), "2027-01-10");
    expect(later.left).toBe(900);
    expect(later.pct).toBeCloseTo(0.25);
  });
  it("« déjà remboursé » compte dans le pourcentage", () => {
    const i = debtInfo(debt({ paid: 300 }), TODAY);
    expect(i.whole).toBe(1500);
    expect(i.pct).toBeCloseTo(0.2);
  });
  it("résumé : reste total et date où tout est payé", () => {
    const s: State = { ...emptyState(), debts: [debt(), debt({ id: "e", label: "Autre", total: 150, amount: 50, first: "2026-11-10" })] };
    expect(debtsSummary(s, TODAY)).toMatchObject({ left: 1350, whole: 1350, free: "2027-10-05", open: ["Prêt", "Autre"] });
  });
  it("création avec since = aujourd'hui ; modifier la tranche relance l'échéancier sans toucher au passé", () => {
    let s = saveDebt(emptyState(), { label: "Prêt", left: 1200, paid: 0, amount: 100, every: "month", first: "2026-10-05", accountId: "cbc" }, "2026-10-01");
    expect(s.debts[0].since).toBe("2026-10-01");
    s = materializeSchedule(s, TODAY);
    expect(s.txns.map((t) => t.amount)).toEqual([-100]);
    const d = debtDraft(s.debts[0], TODAY);
    expect(d).toMatchObject({ left: 1100, paid: 100, first: "2026-11-05" });
    s = saveDebt(s, { ...d, amount: 200 }, TODAY);
    // Date inchangée : la série garde son ancre (1re date d'origine), reste et déjà remboursé identiques.
    expect(s.debts[0]).toMatchObject({ first: "2026-10-05", amount: 200, since: TODAY });
    const i = debtInfo(s.debts[0], TODAY);
    expect(i).toMatchObject({ left: 1100, whole: 1200, end: "2027-04-05" });
    s = materializeSchedule(s, "2026-11-05");
    expect(s.txns.map((t) => t.amount)).toEqual([-100, -200]);
  });
  it("tranche modifiée, date non touchée : pas de glissement du 31 vers le 28", () => {
    let s: State = { ...emptyState(), debts: [debt({ first: "2026-01-31", total: 3000, amount: 100 })] };
    const d = debtDraft(s.debts[0], TODAY); // 10 tranches passées (31 janv. → 31 oct.)
    expect(d).toMatchObject({ left: 2000, paid: 1000, first: "2026-11-30" });
    s = saveDebt(s, { ...d, amount: 250 }, TODAY);
    expect(debtDraft(s.debts[0], TODAY)).toMatchObject({ left: 2000, paid: 1000, first: "2026-11-30", amount: 250 });
    expect(debtSchedule(s.debts[0]).filter((p) => p.date > TODAY).slice(0, 4).map((p) => p.date)).toEqual(["2026-11-30", "2026-12-31", "2027-01-31", "2027-02-28"]);
    expect(debtInfo(s.debts[0], TODAY).end).toBe("2027-06-30");
  });
  it("date modifiée : l'échéancier repart de la nouvelle date", () => {
    let s: State = { ...emptyState(), debts: [debt({ first: "2026-10-05" })] };
    s = saveDebt(s, { ...debtDraft(s.debts[0], TODAY), first: "2026-11-20" }, TODAY);
    expect(s.debts[0]).toMatchObject({ first: "2026-11-20", total: 1100, paid: 100 });
  });
  it("dette terminée : renommable, sa date passée n'est pas bloquée", () => {
    let s: State = { ...emptyState(), debts: [debt({ first: "2026-01-05", total: 300 })] };
    const d = debtDraft(s.debts[0], TODAY);
    expect(debtInfo(s.debts[0], TODAY).done).toBe(true);
    expect(d.first).toBe("2026-01-05");
    const rule = debtDateRule(d.first, d.first, TODAY, true);
    expect(rule).toEqual({ first: "2026-01-05" });
    s = saveDebt(s, { ...d, label: "Ancien prêt", first: rule.first }, TODAY);
    expect(s.debts[0]).toMatchObject({ label: "Ancien prêt", first: "2026-01-05", total: 300 });
  });
  it("règle de date : min et rabot seulement si la dette court et que la date change", () => {
    expect(debtDateRule("2026-11-05", "2026-11-05", TODAY, false)).toEqual({ first: "2026-11-05" });
    expect(debtDateRule("2026-11-05", "2026-10-20", TODAY, false)).toEqual({ min: TODAY, first: TODAY });
    expect(debtDateRule("2026-11-05", "2026-12-01", TODAY, false)).toEqual({ min: TODAY, first: "2026-12-01" });
    expect(debtDateRule(undefined, "2026-10-20", TODAY, false)).toEqual({ first: "2026-10-20" });
  });
  it("renommer seulement ne relance rien ; supprimer garde les tranches passées", () => {
    let s: State = materializeSchedule({ ...emptyState(), debts: [debt({ first: "2026-10-05" })] }, TODAY);
    s = saveDebt(s, { ...debtDraft(s.debts[0], TODAY), label: "Prêt auto" }, TODAY);
    expect(s.debts[0]).toMatchObject({ label: "Prêt auto", total: 1200, first: "2026-10-05" });
    s = deleteDebt(s, "d");
    expect(s.txns).toHaveLength(1);
  });
});

describe("objectifs", () => {
  it("créer avec un nouveau compte d'épargne, mettre de côté 50 : total inchangé, objectif +50", () => {
    let s = saveGoal(emptyState(), { name: "Vacances", icon: "plane", color: "#2A78D6", target: 600, accountId: "", newAccount: "Poche vacances" });
    expect(s.accounts.at(-1)).toMatchObject({ id: "poche-vacances", name: "Poche vacances", kind: "epargne" });
    const g = s.goals[0];
    s = { ...s, accounts: s.accounts.map((a) => (a.id === "cbc" ? { ...a, anchor: { date: "2026-10-01", balance: 1000 } } : a)) };
    const before = totalBalance(s, TODAY);
    s = putAside(s, g.id, "cbc", 50, TODAY);
    expect(totalBalance(s, TODAY)).toBe(before);
    expect(accountBalance(s, "cbc", TODAY)).toBe(950);
    expect(goalProgress(s, g, TODAY)).toMatchObject({ saved: 50, rest: 550 });
    expect(s.txns.every((t) => t.note === "Vacances" && t.transferId)).toBe(true);
    expect(putAside(s, g.id, g.accountId, 50, TODAY)).toBe(s);
  });
  it("modifier retire la date si elle est vidée ; somme par mois si date", () => {
    let s = saveGoal(emptyState(), { name: "Pneus", icon: "car", color: "#EB6834", target: 300, date: "2027-03-01", accountId: "revolut-epargne", newAccount: "" });
    const g = s.goals[0];
    expect(goalProgress(s, g, TODAY).perMonth).toBe(75);
    s = saveGoal(s, { ...g, newAccount: "", date: undefined, target: 350 });
    expect(s.goals[0].date).toBeUndefined();
    expect(s.goals[0].target).toBe(350);
    expect(s.accounts).toHaveLength(emptyState().accounts.length);
  });
});

describe("objectif lié au compte d'épargne de la banque", () => {
  it("par défaut : revolut-epargne s'il existe, sinon le premier compte d'épargne", () => {
    expect(defaultGoalAccount(emptyState())).toBe("revolut-epargne");
    const s: State = {
      ...emptyState(),
      accounts: [
        ...emptyState().accounts.filter((a) => a.id !== "revolut-epargne"),
        { id: "livret", name: "Livret", kind: "epargne", bank: "cbc", color: "#000" },
      ],
    };
    expect(defaultGoalAccount(s)).toBe("livret");
    expect(defaultGoalAccount({ ...emptyState(), accounts: emptyState().accounts.filter((a) => a.kind !== "epargne") })).toBe("");
  });

  it("mettre de côté 50 puis importer l'extrait qui contient ce +50 : compté une seule fois", () => {
    let s = saveGoal(emptyState(), { name: "Vacances", icon: "plane", color: "#2A78D6", target: 600, accountId: defaultGoalAccount(emptyState()), newAccount: "" });
    expect(s.accounts).toHaveLength(emptyState().accounts.length);
    const g = s.goals[0];
    s = putAside(s, g.id, "revolut", 50, "2026-10-20");
    const before = totalBalance(s, TODAY);
    const { state } = reconcile(s, {
      bank: "revolut", iban: "BE00000000000101", owner: "ALEX EXEMPLE", firstName: "ALEX",
      lines: [
        { key: "revolut:courant:1", date: "2026-10-20", amount: -50, label: "To pocket EUR Vacances", counterparty: "", iban: "", section: "courant", balance: null },
        { key: "revolut:poche:1", date: "2026-10-20", amount: 50, label: "From EUR", counterparty: "", iban: "", section: "poche", balance: null },
      ],
    });
    expect(state.txns).toHaveLength(2);
    expect(totalBalance(state, TODAY)).toBe(before);
    expect(goalProgress(state, g, TODAY).saved).toBe(50);
    expect(accountBalance(state, "revolut-epargne", TODAY)).toBe(50);
  });
});

describe("prévision", () => {
  it("le total est la somme des lignes", () => {
    let s = saveWork(emptyState(), { start: "2026-10-19", dayAmount: 90 }, NOW);
    s = saveRecurring(s, { label: "Loyer", amount: -500, every: "month", first: "2026-11-03", accountId: "cbc" }, TODAY);
    s = { ...s, debts: [debt()] };
    const f = forecast(s, "2026-12-31", NOW);
    expect(f.rows.map((r) => r.label)).toEqual(["Aujourd'hui", "Paies", "Fixes", "Dettes"]);
    expect(f.total).toBeCloseTo(f.rows.reduce((a, r) => a + r.amount, 0), 2);
  });
});
