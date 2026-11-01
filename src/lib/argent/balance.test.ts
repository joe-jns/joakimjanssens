import { describe, expect, it } from "vitest";
import { accountBalance, effectiveDate, forecast, pendingPay, spendByCategory, totalBalance, transfer } from "./balance";
import { emptyState } from "./model";
import type { State, Txn } from "./model";

const tx = (o: Partial<Txn>): Txn => ({ id: crypto.randomUUID(), accountId: "cbc", date: "2026-11-02", amount: -10, label: "x", status: "manuel", source: "saisie", ...o });
const base = (): State => {
  const s = emptyState();
  s.accounts = s.accounts.map((a) => (a.id === "cbc" ? { ...a, anchor: { date: "2026-10-31", balance: 0 } } : a));
  return s;
};

describe("soldes", () => {
  it("ancre 0 au 31/10 + dépense -40 le 2/11 donne -40", () => {
    const s = { ...base(), txns: [tx({ amount: -40 }), tx({ date: "2026-10-30", amount: -99 })] };
    expect(accountBalance(s, "cbc", "2026-11-05")).toBe(-40);
  });
  it("sans ancre : tout jusqu'à at", () => {
    const s = { ...emptyState(), txns: [tx({ amount: 5, date: "2026-01-01" }), tx({ amount: 7, date: "2026-12-01" })] };
    expect(accountBalance(s, "cbc", "2026-11-01")).toBe(5);
  });
  it("journée du 6/11 pas dans le solde du 11/11, oui le 12/11", () => {
    const j = tx({ date: "2026-11-06", amount: 100, source: "journee", status: "prevu" });
    const s = { ...base(), txns: [j] };
    expect(effectiveDate(j)).toBe("2026-11-12");
    expect(totalBalance(s, "2026-11-11")).toBe(0);
    expect(totalBalance(s, "2026-11-12")).toBe(100);
    expect(pendingPay(s, "2026-11-11")).toEqual({ amount: 100, next: "2026-11-12" });
    expect(pendingPay(s, "2026-11-12")).toEqual({ amount: 0 });
  });
});

describe("dépenses et virements", () => {
  it("virement : total inchangé, absent de spendByCategory", () => {
    let s: State = { ...base(), txns: [tx({ amount: 50, date: "2026-11-01" })] };
    const before = totalBalance(s, "2026-11-30");
    s = transfer(s, "cbc", "revolut-epargne", 20, "2026-11-03");
    expect(totalBalance(s, "2026-11-30")).toBe(before);
    expect(accountBalance(s, "revolut-epargne", "2026-11-30")).toBe(20);
    expect(s.txns.filter((t) => t.transferId)).toHaveLength(2);
    expect(spendByCategory(s, "2026-11")).toEqual([]);
  });
  it("trie décroissant avec parts", () => {
    const s = { ...base(), txns: [tx({ amount: -30, categoryId: "courses" }), tx({ amount: -10, categoryId: "resto" }), tx({ amount: 99, categoryId: "salaire" }), tx({ amount: -5, date: "2026-12-01", categoryId: "resto" })] };
    expect(spendByCategory(s, "2026-11")).toEqual([
      { categoryId: "courses", amount: 30, share: 0.75 },
      { categoryId: "resto", amount: 10, share: 0.25 },
    ]);
  });
});

describe("forecast", () => {
  const now = new Date(2026, 10, 2, 10, 0); // lun 2/11
  it("total = somme des lignes ; journées à venir par paie", () => {
    const s = base();
    s.work = { ...s.work, start: "2026-10-26" };
    s.txns = [tx({ date: "2026-10-30", amount: 100, source: "journee", status: "prevu" }), tx({ date: "2026-11-10", amount: -15, status: "prevu" })];
    s.recurring = [{ id: "r1", label: "Abo", amount: -9.99, every: "month", first: "2026-11-15", accountId: "cbc" }];
    s.debts = [{ id: "d1", label: "Dette", total: 100, amount: 40, every: "month", first: "2026-11-10", accountId: "cbc" }];
    const f = forecast(s, "2026-11-19", now);
    // journée 30/10 -> paie 5/11 ; futures 2..6/11 (le 2 avant 20 h) -> 12/11 ; 9..13/11 -> 19/11 ; 16..19/11 -> 26/11 (later)
    const paies = f.rows.find((r) => r.label === "Paies")!;
    expect(paies.amount).toBe(1100); // 1 + 5 + 5 journées
    expect(f.later).toBe(400);
    expect(f.total).toBe(Math.round(f.rows.reduce((a, r) => a + r.amount, 0) * 100) / 100);
    expect(f.rows[0].label).toBe("Aujourd'hui");
    expect(f.rows.find((r) => r.label === "Fixes")!.amount).toBe(-9.99);
    expect(f.rows.find((r) => r.label === "Dettes")!.amount).toBe(-40);
    expect(f.rows.find((r) => r.label === "Prévus")!.amount).toBe(-15);
  });
  it("journée du jour : comptée avant 20 h, pas deux fois après la synchro", () => {
    const s = base();
    s.work = { ...s.work, start: "2026-11-02" };
    const avant = forecast(s, "2026-11-12", new Date(2026, 10, 2, 10, 0));
    expect(avant.rows.find((r) => r.label === "Paies")!.amount).toBe(500); // 2..6/11 -> paie 12/11
    const synced = { ...s, txns: [tx({ date: "2026-11-02", amount: 100, source: "journee", status: "prevu" })] };
    const apres = forecast(synced, "2026-11-12", new Date(2026, 10, 2, 21, 0));
    expect(apres.rows.find((r) => r.label === "Paies")!.amount).toBe(500); // 1 faite + 4 à venir
  });
});

describe("lignes prévues couvertes par l'ancre", () => {
  it("spendByCategory ignore un prévu daté au plus tard à l'ancre de son compte, garde la banque", () => {
    const s = {
      ...base(),
      txns: [
        tx({ date: "2026-10-20", amount: -30, status: "prevu", source: "fixe", categoryId: "logement" }),
        tx({ date: "2026-10-31", amount: -5, status: "prevu", source: "fixe", categoryId: "logement" }),
        tx({ date: "2026-10-20", amount: -12, status: "banque", source: "import", categoryId: "courses" }),
        tx({ date: "2026-10-25", amount: -8, status: "prevu", source: "fixe", categoryId: "sante", accountId: "revolut" }),
      ],
    };
    expect(spendByCategory(s, "2026-10").map((r) => [r.categoryId, r.amount])).toEqual([["courses", 12], ["sante", 8]]);
  });
});
