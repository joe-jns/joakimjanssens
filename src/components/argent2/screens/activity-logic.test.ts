import { describe, expect, it } from "vitest";
import { transfer } from "../../../lib/argent/balance";
import { emptyState, type State, type Txn } from "../../../lib/argent/model";
import { materializeSchedule } from "../../../lib/argent/schedule";
import { syncWorkdays } from "../../../lib/argent/workdays";
import { applyFilters, buildRows, canEdit, countExcluded, dayTitle, deleteTxn, editTransfer, editTxn, groupDays, isExcluded, matchesSearch, setExcluded, takeDays } from "./activity-logic";

const tx = (p: Partial<Txn> & { id: string }): Txn => ({
  accountId: "cbc",
  date: "2026-10-20",
  amount: -10,
  label: "x",
  status: "manuel",
  source: "saisie",
  ...p,
});

function seed(): State {
  let s: State = {
    ...emptyState(),
    txns: [
      tx({ id: "a", date: "2026-10-20", amount: -40.03, label: "Lukoil Ville-Exemple", categoryId: "carburant", status: "banque", source: "import" }),
      tx({ id: "b", date: "2026-10-21", amount: -12.68, label: "Delhaize", categoryId: "courses", note: "pain et lait" }),
      tx({ id: "c", date: "2026-10-21", amount: 42.1, label: "De Sam", categoryId: "proches-in" }),
      tx({ id: "d", date: "2026-10-19", amount: -3, label: "Café" }),
    ],
  };
  s = transfer(s, "cbc", "revolut-epargne", 100, "2026-10-21");
  return s;
}

describe("buildRows", () => {
  it("un virement = une seule ligne (sortie + entrée), tri du plus récent au plus ancien", () => {
    const rows = buildRows(seed());
    expect(rows).toHaveLength(5);
    const tr = rows.find((r) => r.pair)!;
    expect(tr.txn.accountId).toBe("cbc");
    expect(tr.pair!.accountId).toBe("revolut-epargne");
    expect(rows.map((r) => r.date)).toEqual(["2026-10-21", "2026-10-21", "2026-10-21", "2026-10-20", "2026-10-19"]);
  });
  it("une moitié de virement seule reste une ligne normale", () => {
    const s = { ...emptyState(), txns: [tx({ id: "z", transferId: "t1" })] };
    expect(buildRows(s)).toHaveLength(1);
    expect(buildRows(s)[0].pair).toBeUndefined();
  });
});

describe("recherche et filtres", () => {
  const s = seed();
  const rows = buildRows(s);
  const ids = (f: Parameters<typeof applyFilters>[1]) => applyFilters(rows, f).map((r) => r.pair ? "virement" : r.txn.id);
  it("libellé sans accents, note, compte, montant", () => {
    expect(ids({ kind: "tout", cats: null, q: "sam" })).toEqual(["c"]);
    expect(ids({ kind: "tout", cats: null, q: "lait" })).toEqual(["b"]);
    expect(ids({ kind: "tout", cats: null, q: "épargne" })).toEqual(["virement"]);
    expect(ids({ kind: "tout", cats: null, q: "40,03" })).toEqual(["a"]);
    expect(ids({ kind: "tout", cats: null, q: "40" })).toEqual(["a"]);
    expect(ids({ kind: "tout", cats: null, q: "40.1" })).toEqual([]);
    expect(ids({ kind: "tout", cats: null, q: "100" })).toEqual(["virement"]);
  });
  it("plusieurs mots : tous doivent être présents", () => {
    expect(matchesSearch(rows.find((r) => r.txn.id === "b")!, "delhaize pain")).toBe(true);
    expect(matchesSearch(rows.find((r) => r.txn.id === "b")!, "delhaize essence")).toBe(false);
  });
  it("dépenses / rentrées excluent les virements ; catégorie (sans catégorie = autres-out)", () => {
    expect(ids({ kind: "depenses", cats: null, q: "" })).toEqual(["b", "a", "d"]);
    expect(ids({ kind: "rentrees", cats: null, q: "" })).toEqual(["c"]);
    expect(ids({ kind: "tout", cats: ["autres-out"], q: "" })).toEqual(["d"]);
    expect(ids({ kind: "tout", cats: ["courses", "carburant"], q: "" })).toEqual(["b", "a"]);
  });
  it("fixes : source fixe ou dette", () => {
    const s2 = { ...s, txns: [...s.txns, tx({ id: "f", source: "fixe", refId: "r", status: "prevu" }), tx({ id: "g", source: "dette", refId: "d1", status: "prevu" })] };
    expect(applyFilters(buildRows(s2), { kind: "fixes", cats: null, q: "" }).map((r) => r.txn.id).sort()).toEqual(["f", "g"]);
  });
});

describe("jours", () => {
  it("net du jour sans les virements, jours entiers", () => {
    const days = groupDays(buildRows(seed()));
    expect(days.map((d) => [d.day, d.net])).toEqual([
      ["2026-10-21", 29.42],
      ["2026-10-20", -40.03],
      ["2026-10-19", -3],
    ]);
    expect(takeDays(days, 2).map((d) => d.day)).toEqual(["2026-10-21"]);
    expect(takeDays(days, 4).map((d) => d.day)).toEqual(["2026-10-21", "2026-10-20"]);
  });
  it("titres relatifs", () => {
    expect(dayTitle("2026-11-01", "2026-11-01")).toBe("Aujourd’hui · dimanche 1 novembre");
    expect(dayTitle("2026-10-31", "2026-11-01")).toBe("Hier · samedi 31 octobre");
    expect(dayTitle("2026-10-20", "2026-11-01")).toBe("Mardi 20 octobre");
    expect(dayTitle("2025-12-31", "2026-11-01")).toBe("Mercredi 31 décembre 2025");
  });
});

describe("supprimer", () => {
  it("une journée ne revient pas après la resynchro", () => {
    let s: State = { ...emptyState(), work: { ...emptyState().work, start: "2026-10-26" } };
    const now = new Date(2026, 9, 30, 21);
    s = syncWorkdays(s, now);
    const j = s.txns.find((t) => t.date === "2026-10-28")!;
    s = deleteTxn(s, j.id);
    expect(s.work.skipped).toContain("2026-10-28");
    s = syncWorkdays(s, now);
    expect(s.txns.some((t) => t.date === "2026-10-28")).toBe(false);
    expect(s.txns).toHaveLength(4);
  });
  it("une échéance de fixe ne revient pas, le fixe reste", () => {
    let s: State = { ...emptyState(), recurring: [{ id: "loyer", label: "Loyer", amount: -650, every: "month", first: "2026-09-05", accountId: "cbc" }] };
    s = materializeSchedule(s, "2026-10-31");
    const oct = s.txns.find((t) => t.date === "2026-10-05")!;
    s = deleteTxn(s, oct.id);
    expect(s.dismissed).toContain("loyer|2026-10-05");
    s = materializeSchedule(s, "2026-10-31");
    expect(s.txns.map((t) => t.date)).toEqual(["2026-09-05"]);
    expect(s.recurring).toHaveLength(1);
  });
  it("une moitié de virement emporte l'autre", () => {
    const s = seed();
    const half = s.txns.find((t) => t.transferId && t.amount > 0)!;
    const out = deleteTxn(s, half.id);
    expect(out.txns.some((t) => t.transferId)).toBe(false);
    expect(out.txns).toHaveLength(4);
  });
  it("une ligne de la banque ne se supprime pas (ni un virement dont une moitié vient de la banque)", () => {
    const s = seed();
    expect(deleteTxn(s, "a")).toBe(s);
    const tid = s.txns.find((t) => t.transferId)!.transferId!;
    const s2 = { ...s, txns: s.txns.map((t) => (t.transferId === tid && t.amount > 0 ? { ...t, status: "banque" as const } : t)) };
    const out = s2.txns.find((t) => t.transferId === tid && t.amount < 0)!;
    expect(deleteTxn(s2, out.id)).toBe(s2);
  });
  it("échéance déplacée puis supprimée : rien n'est recréé pour le mois", () => {
    let s: State = { ...emptyState(), recurring: [{ id: "loyer", label: "Loyer", amount: -650, every: "month", first: "2026-10-05", accountId: "cbc" }] };
    s = materializeSchedule(s, "2026-10-31");
    const id = s.txns[0].id;
    s = editTxn(s, id, { date: "2026-10-07" });
    s = deleteTxn(s, id);
    expect(s.dismissed).toEqual(expect.arrayContaining(["loyer|2026-10-05", "loyer|2026-10-07"]));
    s = materializeSchedule(s, "2026-10-31");
    expect(s.txns.filter((t) => t.date.startsWith("2026-10"))).toHaveLength(0);
  });
  it("une opération normale disparaît, rien d'autre ne change", () => {
    const out = deleteTxn(seed(), "b");
    expect(out.txns.map((t) => t.id)).not.toContain("b");
    expect(out.dismissed).toEqual([]);
  });
});

describe("modifier", () => {
  it("montant : garde le sens ; celui d'une ligne bancaire ne change pas", () => {
    let s = editTxn(seed(), "b", { amount: 20 });
    expect(s.txns.find((t) => t.id === "b")!.amount).toBe(-20);
    s = editTxn(s, "a", { amount: 1 });
    expect(s.txns.find((t) => t.id === "a")!.amount).toBe(-40.03);
  });
  it("catégorie d'une ligne bancaire : apprise ; d'une saisie : pas apprise", () => {
    let s = editTxn(seed(), "a", { categoryId: "sorties" });
    expect(s.txns.find((t) => t.id === "a")!.categoryId).toBe("sorties");
    expect(s.learned["-lukoil ville-exemple"]).toBe("sorties");
    s = editTxn(s, "b", { categoryId: "resto" });
    expect(Object.keys(s.learned)).toHaveLength(1);
  });
  it("note vide retirée, compte et date changés", () => {
    const s = editTxn(seed(), "b", { note: "  ", accountId: "revolut", date: "2026-10-22" });
    const b = s.txns.find((t) => t.id === "b")!;
    expect(b.note).toBeUndefined();
    expect([b.accountId, b.date]).toEqual(["revolut", "2026-10-22"]);
  });
  it("échéance déplacée : la date d'origine n'est pas recréée ; journée : la date ne bouge pas", () => {
    let s: State = { ...emptyState(), recurring: [{ id: "net", label: "Netflix", amount: -13, every: "month", first: "2026-10-10", accountId: "cbc" }] };
    s = materializeSchedule(s, "2026-10-31");
    s = editTxn(s, s.txns[0].id, { date: "2026-10-12" });
    s = materializeSchedule(s, "2026-10-31");
    expect(s.txns.map((t) => t.date)).toEqual(["2026-10-12"]);
    const j = { ...emptyState(), txns: [tx({ id: "j", source: "journee", status: "prevu", amount: 100 })] };
    expect(editTxn(j, "j", { date: "2026-10-22", amount: 50 }).txns[0]).toMatchObject({ date: "2026-10-20", amount: 50 });
  });
  it("virement : les deux moitiés suivent", () => {
    const s0 = seed();
    const id = s0.txns.find((t) => t.transferId)!.transferId!;
    const s = editTransfer(s0, id, { amount: 60, toId: "revolut", date: "2026-10-23", note: "vacances" });
    const h = s.txns.filter((t) => t.transferId === id);
    expect(h.map((t) => [t.accountId, t.amount, t.date, t.note])).toEqual([
      ["cbc", -60, "2026-10-23", "vacances"],
      ["revolut", 60, "2026-10-23", "vacances"],
    ]);
    expect(editTransfer(s0, id, { toId: "cbc" })).toBe(s0);
  });
});

describe("ligne de la banque : date et compte verrouillés", () => {
  it("editTxn garde la date et le compte d'une ligne banque ; catégorie et note changent", () => {
    const s = editTxn(seed(), "a", { date: "2026-10-25", accountId: "revolut", categoryId: "sorties", note: "plein" });
    expect(s.txns.find((t) => t.id === "a")).toMatchObject({ date: "2026-10-20", accountId: "cbc", categoryId: "sorties", note: "plein" });
    expect(canEdit(s, s.txns.find((t) => t.id === "a")!)).toEqual({ amount: false, date: false, account: false, category: true });
  });
  it("virement dont une moitié vient de la banque : seule la note change", () => {
    const s0 = seed();
    const tid = s0.txns.find((t) => t.transferId)!.transferId!;
    const s1 = { ...s0, txns: s0.txns.map((t) => (t.transferId === tid && t.amount > 0 ? { ...t, status: "banque" as const } : t)) };
    const out = s1.txns.find((t) => t.transferId === tid && t.amount < 0)!;
    expect(canEdit(s1, out)).toMatchObject({ amount: false, date: false, account: false });
    const s2 = editTransfer(s1, tid, { amount: 60, fromId: "revolut", toId: "liquide", date: "2026-10-25", note: "épargne" });
    expect(s2.txns.filter((t) => t.transferId === tid).map((t) => [t.accountId, t.amount, t.date, t.note])).toEqual([
      ["cbc", -100, "2026-10-21", "épargne"],
      ["revolut-epargne", 100, "2026-10-21", "épargne"],
    ]);
  });
  it("saisie ordinaire : tout se modifie ; journée : la date non", () => {
    const s = seed();
    expect(canEdit(s, s.txns.find((t) => t.id === "b")!)).toEqual({ amount: true, date: true, account: true, category: true });
    expect(canEdit(s, tx({ id: "j", source: "journee", status: "prevu" })).date).toBe(false);
  });
});

describe("opérations non comptées", () => {
  const withExcluded = () => {
    const s = seed();
    return setExcluded(setExcluded(s, "b", true), s.txns.find((t) => t.transferId)!.id, true);
  };
  it("cachées par défaut, montrées sur demande, et comptées", () => {
    const rows = buildRows(withExcluded());
    expect(countExcluded(rows)).toBe(2);
    expect(applyFilters(rows, { kind: "tout", cats: null, q: "" }).some(isExcluded)).toBe(false);
    expect(applyFilters(rows, { kind: "tout", cats: null, q: "", excluded: true })).toHaveLength(rows.length);
  });
  it("la recherche les trouve quand elles sont montrées", () => {
    const rows = buildRows(withExcluded());
    expect(applyFilters(rows, { kind: "tout", cats: null, q: "delhaize" })).toHaveLength(0);
    expect(applyFilters(rows, { kind: "tout", cats: null, q: "delhaize", excluded: true }).map((r) => r.key)).toEqual(["b"]);
  });
  it("le net du jour les ignore", () => {
    const rows = applyFilters(buildRows(withExcluded()), { kind: "tout", cats: null, q: "", excluded: true });
    expect(groupDays(rows).find((x) => x.day === "2026-10-21")!.net).toBe(42.1);
  });
});
