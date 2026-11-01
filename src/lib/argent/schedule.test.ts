import { describe, it, expect } from "vitest";
import { emptyState, type State } from "./model";
import { debtSchedule, debtLeft, materializeSchedule, upcoming } from "./schedule";

const debt = (total: number, amount: number, first = "2026-01-05") =>
  ({ id: "d1", label: "Prêt ami", total, amount, every: "month" as const, first, accountId: "cbc" });

describe("debtSchedule", () => {
  it("1200 / 100 par mois : 12 échéances, fin connue", () => {
    const s = debtSchedule(debt(1200, 100));
    expect(s).toHaveLength(12);
    expect(s[0].date).toBe("2026-01-05");
    expect(s[11].date).toBe("2026-12-05");
  });
  it("250 / 100 : 100, 100, 50", () => {
    expect(debtSchedule(debt(250, 100)).map((x) => x.amount)).toEqual([100, 100, 50]);
  });
  it("debtLeft", () => {
    expect(debtLeft(debt(250, 100), "2026-02-05")).toBe(50);
    expect(debtLeft(debt(250, 100), "2025-12-31")).toBe(250);
  });
});

describe("materializeSchedule", () => {
  const base = (): State => ({
    ...emptyState(),
    recurring: [{ id: "r1", label: "Loyer", amount: -500, every: "month", first: "2026-10-05", accountId: "cbc", categoryId: "logement" }],
    debts: [debt(250, 100, "2026-10-10")],
  });
  it("ajoute les échéances échues, dette négative", () => {
    const r = materializeSchedule(base(), "2026-11-12");
    const f = r.txns.filter((t) => t.source === "fixe");
    const d = r.txns.filter((t) => t.source === "dette");
    expect(f.map((t) => t.date)).toEqual(["2026-10-05", "2026-11-05"]);
    expect(f[0]).toMatchObject({ status: "prevu", refId: "r1", amount: -500, accountId: "cbc", categoryId: "logement" });
    expect(d.map((t) => [t.date, t.amount])).toEqual([["2026-10-10", -100], ["2026-11-10", -100]]);
  });
  it("idempotent et sans mutation", () => {
    const s = base();
    const a = materializeSchedule(s, "2026-11-12");
    const b = materializeSchedule(a, "2026-11-12");
    expect(b.txns).toEqual(a.txns);
    expect(s.txns).toHaveLength(0);
  });
});

describe("materializeSchedule : since et dismissed", () => {
  const rec = { id: "r1", label: "Loyer", amount: -500, every: "month" as const, first: "2026-01-05", accountId: "cbc" };
  it("pas de rattrapage avant since", () => {
    const r = materializeSchedule({ ...emptyState(), recurring: [{ ...rec, since: "2026-10-20" }] }, "2026-11-10");
    expect(r.txns.map((t) => t.date)).toEqual(["2026-11-05"]);
  });
  it("les suppressions retenues ne reviennent pas", () => {
    const r = materializeSchedule({ ...emptyState(), recurring: [rec], dismissed: ["r1|2026-10-05"] }, "2026-11-10");
    expect(r.txns.map((t) => t.date)).not.toContain("2026-10-05");
    expect(r.txns.map((t) => t.date)).toContain("2026-11-05");
  });
  it("dette since : échéances avant since ignorées", () => {
    const r = materializeSchedule({ ...emptyState(), debts: [{ ...debt(1200, 100), since: "2026-03-01" }] }, "2026-04-10");
    expect(r.txns.map((t) => t.date)).toEqual(["2026-03-05", "2026-04-05"]);
  });
  it("debtSchedule vide si amount <= 0", () => {
    expect(debtSchedule(debt(100, 0))).toEqual([]);
  });
});

describe("upcoming", () => {
  it("une opération saisie à l'avance est un paiement prévu une fois ; pas un virement, une correction ou une ligne non comptée", () => {
    const base = { accountId: "cbc", label: "Cadeaux", status: "manuel" as const, source: "saisie" as const };
    const s: State = {
      ...emptyState(),
      txns: [
        { ...base, id: "a", date: "2026-12-24", amount: -700 },
        { ...base, id: "b", date: "2026-12-20", amount: -50, transferId: "v" },
        { ...base, id: "c", date: "2026-12-21", amount: -5, correction: true },
        { ...base, id: "d", date: "2026-12-22", amount: -9, excluded: true },
        { ...base, id: "e", date: "2026-12-10", amount: -3 },
      ],
    };
    const u = upcoming(s, "2026-12-10", 15);
    expect(u).toEqual([{ date: "2026-12-24", label: "Cadeaux", amount: -700, kind: "ponctuel", refId: "a" }]);
    expect(upcoming(s, "2026-11-01", 15)).toEqual([]);
  });
  it("30 jours : fixe du 5 et paie du jeudi", () => {
    const s: State = {
      ...emptyState(),
      recurring: [{ id: "r1", label: "Loyer", amount: -500, every: "month", first: "2026-09-05", accountId: "cbc" }],
      txns: [
        { id: "a", accountId: "cbc", date: "2026-10-29", amount: 100, label: "Journée", status: "prevu", source: "journee" },
        { id: "b", accountId: "cbc", date: "2026-10-30", amount: 100, label: "Journée", status: "prevu", source: "journee" },
      ],
    };
    const u = upcoming(s, "2026-10-31", 30);
    expect(u.find((x) => x.kind === "fixe")).toMatchObject({ date: "2026-11-05", amount: -500, refId: "r1" });
    expect(u.find((x) => x.kind === "paie")).toMatchObject({ date: "2026-11-05", amount: 200 });
    expect(u.map((x) => x.date)).toEqual([...u.map((x) => x.date)].sort());
  });
});

describe("identifiants stables (synchro entre appareils)", () => {
  it("une échéance a pour id <refId>|<date>", () => {
    const s: State = {
      ...emptyState(),
      recurring: [{ id: "r1", label: "Abonnement", amount: -9, every: "month", first: "2026-09-03", accountId: "cbc" }],
      debts: [debt(250, 100, "2026-10-05")],
    };
    const out = materializeSchedule(s, "2026-10-10");
    expect(out.txns.map((t) => t.id).sort()).toEqual(["d1|2026-10-05", "r1|2026-09-03", "r1|2026-10-03"]);
    expect(materializeSchedule(s, "2026-10-10").txns.map((t) => t.id)).toEqual(out.txns.map((t) => t.id));
  });
});
