import { describe, it, expect } from "vitest";
import { emptyState, type State } from "./model";
import { syncWorkdays, skipDays, unskipDay } from "./workdays";

const withWork = (w: Partial<State["work"]>): State => {
  const s = emptyState();
  return { ...s, work: { ...s.work, ...w } };
};
const days = (s: State) => s.txns.filter((t) => t.source === "journee").map((t) => t.date).sort();

describe("syncWorkdays", () => {
  it("aucune journée sans work.start", () => {
    expect(syncWorkdays(emptyState(), new Date(2026, 9, 29, 21)).txns).toHaveLength(0);
  });

  it("jeudi 19 h 59 : pas la journée du jour", () => {
    const r = syncWorkdays(withWork({ start: "2026-10-26" }), new Date(2026, 9, 29, 19, 59));
    expect(days(r)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
  });

  it("jeudi 20 h 00 : journée du jour ajoutée", () => {
    const r = syncWorkdays(withWork({ start: "2026-10-26" }), new Date(2026, 9, 29, 20, 0));
    expect(days(r)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"]);
    const t = r.txns[0];
    expect(t).toMatchObject({ status: "prevu", source: "journee", amount: 100, label: "Journée", categoryId: "salaire", accountId: "cbc" });
    expect(t.id).toBeTruthy();
  });

  it("utilise work.accountId et dayAmount", () => {
    const r = syncWorkdays(withWork({ start: "2026-10-26", end: "2026-10-26", accountId: "revolut", dayAmount: 80 }), new Date(2026, 9, 30, 21));
    expect(r.txns[0]).toMatchObject({ accountId: "revolut", amount: 80 });
  });

  it("rouvert 10 jours plus tard : toutes les journées lun–ven, aucune en double", () => {
    const s0 = withWork({ start: "2026-10-05" });
    const a = syncWorkdays(s0, new Date(2026, 9, 5, 21));
    expect(days(a)).toEqual(["2026-10-05"]);
    const b = syncWorkdays(a, new Date(2026, 9, 15, 21));
    expect(days(b)).toEqual([
      "2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09",
      "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15",
    ]);
    expect(syncWorkdays(b, new Date(2026, 9, 15, 21)).txns).toHaveLength(b.txns.length);
  });

  it("jour retiré jamais recréé", () => {
    const s = syncWorkdays(withWork({ start: "2026-10-26" }), new Date(2026, 9, 29, 21));
    const k = skipDays(s, ["2026-10-27"]);
    expect(days(k)).not.toContain("2026-10-27");
    expect(k.work.skipped).toContain("2026-10-27");
    expect(days(syncWorkdays(k, new Date(2026, 9, 30, 21)))).not.toContain("2026-10-27");
  });

  it("unskipDay retire de skipped, la journée revient à la synchro suivante", () => {
    const s = skipDays(withWork({ start: "2026-10-26" }), ["2026-10-27"]);
    const u = unskipDay(s, "2026-10-27");
    expect(u.work.skipped).not.toContain("2026-10-27");
    expect(days(syncWorkdays(u, new Date(2026, 9, 28, 21)))).toContain("2026-10-27");
  });

  it("work.end respecté", () => {
    const r = syncWorkdays(withWork({ start: "2026-10-26", end: "2026-10-27" }), new Date(2026, 9, 30, 21));
    expect(days(r)).toEqual(["2026-10-26", "2026-10-27"]);
  });

  it("semaine déjà payée par la banque : pas de journée", () => {
    const r = syncWorkdays(withWork({ start: "2026-10-05", paidWeeks: ["2026-10-05"] }), new Date(2026, 9, 14, 21));
    expect(days(r)).toEqual(["2026-10-12", "2026-10-13", "2026-10-14"]);
  });

  it("ne mute pas l'état reçu", () => {
    const s = withWork({ start: "2026-10-26" });
    const copy = JSON.stringify(s);
    syncWorkdays(s, new Date(2026, 9, 29, 21));
    skipDays(s, ["2026-10-27"]);
    expect(JSON.stringify(s)).toBe(copy);
  });
});

describe("identifiants stables (synchro entre appareils)", () => {
  it("une journée a pour id journee:<date>, le même sur deux appareils", () => {
    const a = syncWorkdays(withWork({ start: "2026-10-26" }), new Date(2026, 9, 27, 21));
    const b = syncWorkdays(withWork({ start: "2026-10-26" }), new Date(2026, 9, 27, 21));
    expect(a.txns.map((t) => t.id)).toEqual(["journee:2026-10-26", "journee:2026-10-27"]);
    expect(b.txns.map((t) => t.id)).toEqual(a.txns.map((t) => t.id));
  });
});
