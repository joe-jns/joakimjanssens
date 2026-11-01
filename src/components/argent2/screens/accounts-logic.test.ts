import { describe, expect, it } from "vitest";
import cbcItems from "../../../lib/argent/import/fixtures/cbc-items.json";
import revolutItems from "../../../lib/argent/import/fixtures/revolut-items.json";
import type { PdfItem } from "../../../lib/argent/import/types";
import { emptyState, type State, type Txn } from "../../../lib/argent/model";
import { reconcile } from "../../../lib/argent/reconcile";
import { accountBalance, spendByCategory } from "../../../lib/argent/balance";
import {
  FAILED_FILE,
  PAY_NOT_RECOGNIZED,
  payNotRecognized,
  UNKNOWN_FILE,
  addAccount,
  importItems,
  anchorText,
  anchoredFixText,
  correctBalance,
  movedAnchors,
  monthSpark,
  parseBackup,
  parseStatement,
  renameAccount,
  reportText,
  setImportFrom,
  sparkPath,
  sumReports,
} from "./accounts-logic";

const tx = (p: Partial<Txn>): Txn => ({ id: crypto.randomUUID(), accountId: "cbc", date: "2026-11-01", amount: 0, label: "x", status: "manuel", source: "saisie", ...p });

describe("corriger le solde d'un compte tenu à la main", () => {
  const cash = (s: State) => s.txns.filter((t) => t.accountId === "liquide");
  it("liquide à 100, il reste 35 : une dépense « Correction du solde » de −65 aujourd'hui, comptée", () => {
    let s: State = { ...emptyState(), txns: [tx({ accountId: "liquide", date: "2026-10-20", amount: 100, label: "Retrait", status: "banque", source: "import", transferId: "t1" })] };
    s = correctBalance(s, "liquide", 35, "2026-11-01");
    expect(cash(s).at(-1)).toMatchObject({ accountId: "liquide", date: "2026-11-01", amount: -65, label: "Correction du solde", categoryId: "autres-out", status: "manuel", source: "saisie" });
    expect(cash(s).at(-1)!.excluded).toBeUndefined();
    expect(cash(s).at(-1)!.transferId).toBeUndefined();
    expect(accountBalance(s, "liquide", "2026-11-01")).toBe(35);
    expect(spendByCategory(s, "2026-11").find((x) => x.categoryId === "autres-out")?.amount).toBe(65);
  });
  it("plus d'argent que prévu : rentrée « autres-in » ; même montant : rien ne change", () => {
    let s = addAccount(emptyState(), "Tirelire", "epargne");
    s = correctBalance(s, "tirelire", 40.5, "2026-11-01");
    expect(s.txns).toHaveLength(1);
    expect(s.txns[0]).toMatchObject({ amount: 40.5, categoryId: "autres-in" });
    expect(correctBalance(s, "tirelire", 40.5, "2026-11-01")).toBe(s);
    const zero = correctBalance(s, "tirelire", 0, "2026-11-01");
    expect(accountBalance(zero, "tirelire", "2026-11-01")).toBe(0);
  });
  it("compte calé sur un extrait, compte inconnu ou montant illisible : rien ne change", () => {
    const s: State = { ...emptyState(), accounts: emptyState().accounts.map((a) => (a.id === "cbc" ? { ...a, anchor: { date: "2026-10-28", balance: 500 } } : a)) };
    expect(correctBalance(s, "cbc", 400, "2026-11-01")).toBe(s);
    expect(correctBalance(s, "nope", 400, "2026-11-01")).toBe(s);
    expect(correctBalance(s, "liquide", Number.NaN, "2026-11-01")).toBe(s);
    expect(anchoredFixText(s.accounts[0])).toBe("Calé sur l’extrait du 28 octobre 2026 : réimporte un extrait pour le mettre à jour.");
  });
});

describe("comptes", () => {
  it("ajouter un compte : id unique tiré du nom, type et couleur", () => {
    let s = addAccount(emptyState(), "  Poche vacances ", "epargne");
    s = addAccount(s, "Poche vacances", "epargne");
    const added = s.accounts.slice(-2);
    expect(added.map((a) => a.id)).toEqual(["poche-vacances", "poche-vacances-2"]);
    expect(added[0]).toMatchObject({ name: "Poche vacances", kind: "epargne" });
    expect(addAccount(emptyState(), "   ", "courant").accounts).toHaveLength(4);
  });

  it("renommer ; un nom vide ne change rien", () => {
    const s = renameAccount(emptyState(), "liquide", "Portefeuille");
    expect(s.accounts.find((a) => a.id === "liquide")!.name).toBe("Portefeuille");
    expect(renameAccount(s, "liquide", " ")).toBe(s);
  });

  it("petite courbe : un solde par jour sur 30 jours glissants", () => {
    const s: State = { ...emptyState(), txns: [tx({ date: "2026-11-02", amount: -10 }), tx({ date: "2026-11-03", amount: 25 })] };
    expect(monthSpark(s, "cbc", "2026-11-04", 4)).toEqual([0, -10, 15, 15]);
    const m = monthSpark(s, "cbc", "2026-11-01");
    expect(m).toHaveLength(30);
    expect(m.every((v) => v === 0)).toBe(true);
    expect(sparkPath([1, 1], 100, 20)).toBe("M0.0 10.0 L100.0 10.0");
    expect(sparkPath([0, 10], 100, 20)).toBe("M0.0 18.0 L100.0 2.0");
  });

  it("phrase d'ancre", () => {
    const [cbc, , , liquide] = emptyState().accounts;
    expect(anchorText(cbc)).toBe("Pas encore d’extrait importé");
    expect(anchorText(liquide)).toBe("Tenu à la main");
    expect(anchorText({ ...cbc, anchor: { date: "2026-10-31", balance: 1 } })).toBe("Calé sur l’extrait du 31 octobre 2026");
  });
});

describe("import", () => {
  it("reconnaît Revolut puis CBC ; un fichier inconnu donne null", () => {
    expect(parseStatement(revolutItems as PdfItem[])!.bank).toBe("revolut");
    expect(parseStatement(cbcItems as PdfItem[])!.bank).toBe("cbc");
    expect(parseStatement([{ page: 1, x: 10, y: 700, h: 10, s: "Facture" }])).toBeNull();
  });

  it("un extrait CBC qui cite « Revolut » reste lu comme CBC", () => {
    const items = [...(cbcItems as PdfItem[]), { page: 1, x: 300, y: 50, h: 6, s: "Revolut Bank UAB" }];
    expect(parseStatement(items)!.bank).toBe("cbc");
  });

  it("résumé en français, accords et date de début", () => {
    expect(reportText({ added: 3, linked: 1, replacedDays: 5, already: 2, skipped: 23 }, "2026-10-05")).toBe(
      "3 ajoutées · 1 reliée · 5 journées remplacées · 2 déjà là · 23 ignorées avant le 5 octobre 2026",
    );
    expect(reportText({ added: 1, linked: 0, replacedDays: 1, already: 0, skipped: 1 })).toBe("1 ajoutée · 1 journée remplacée · 1 ignorée");
    expect(reportText({ added: 0, linked: 0, replacedDays: 0, already: 6, skipped: 0 })).toBe("Rien de nouveau · 6 déjà là");
    expect(reportText({ added: 0, linked: 0, replacedDays: 0, already: 0, skipped: 0 })).toBe("Aucune opération dans cet extrait");
  });

  it("deux extraits d'un coup : total cumulé, réimport n'ajoute rien, soldes recalés", () => {
    const s0 = emptyState();
    const a = reconcile(s0, parseStatement(revolutItems as PdfItem[])!);
    const b = reconcile(a.state, parseStatement(cbcItems as PdfItem[])!);
    const total = sumReports([a.report, b.report]);
    expect(total.added).toBe(a.report.added + b.report.added);
    expect(total.added).toBeGreaterThan(0);
    expect(movedAnchors(s0, b.state).map((x) => x.name).sort()).toEqual(expect.arrayContaining(["CBC", "Revolut"]));
    const again = reconcile(reconcile(b.state, parseStatement(revolutItems as PdfItem[])!).state, parseStatement(cbcItems as PdfItem[])!);
    expect(again.state.txns).toHaveLength(b.state.txns.length);
    expect(movedAnchors(b.state, again.state)).toEqual([]);
  });

  it("date de début : posée, effacée, refusée si mal formée", () => {
    const s = setImportFrom(emptyState(), "2026-10-05");
    expect(s.importFrom).toBe("2026-10-05");
    expect("importFrom" in setImportFrom(s, "")).toBe(false);
    expect(setImportFrom(s, "05/10")).toBe(s);
  });
});

describe("sauvegarde", () => {
  it("relit un export et complète les champs manquants", () => {
    const s: State = { ...emptyState(), txns: [tx({ amount: -5 })], importFrom: "2026-10-05" };
    const back = parseBackup(JSON.stringify(s));
    expect("state" in back && back.state).toEqual(s);
    const partial = parseBackup(JSON.stringify({ v: 2, accounts: s.accounts, txns: [] }));
    expect("state" in partial && partial.state.work.payer).toBe(emptyState().work.payer);
  });

  it("refuse ce qui n'est pas une sauvegarde", () => {
    expect(parseBackup("pas du json")).toHaveProperty("error");
    expect(parseBackup(JSON.stringify({ v: 1, accounts: [], txns: [] }))).toHaveProperty("error");
    expect(parseBackup(JSON.stringify([1]))).toHaveProperty("error");
    expect(parseBackup(JSON.stringify({ v: 2, accounts: [null], txns: [] }))).toHaveProperty("error");
  });
});

describe("import robuste", () => {
  it("un extrait lu donne le nouvel état sans toucher à l'ancien", () => {
    const s = emptyState();
    const r = importItems(s, revolutItems as PdfItem[]);
    expect(r.ok && r.bank).toBe("Revolut");
    expect(r.ok && r.state.txns.length).toBeGreaterThan(0);
    expect(s.txns).toHaveLength(0);
  });
  it("fichier inconnu → message ; erreur pendant le rapprochement → échec propre", () => {
    expect(importItems(emptyState(), [])).toEqual({ ok: false, text: UNKNOWN_FILE });
    const broken = { ...emptyState(), work: undefined } as unknown as State;
    const r = importItems(broken, cbcItems as PdfItem[]);
    expect(r).toEqual({ ok: false, text: FAILED_FILE });
  });
});

describe("sauvegarde vérifiée en profondeur", () => {
  const ok = () => ({ ...emptyState(), txns: [tx({ amount: -5 })] });
  const err = (x: unknown) => "error" in parseBackup(JSON.stringify(x));
  it("refuse une opération mal formée", () => {
    expect(err({ ...ok(), txns: [{ ...tx({}), id: 3 }] })).toBe(true);
    expect(err({ ...ok(), txns: [tx({ date: "1/11/2026" })] })).toBe(true);
    expect(err({ ...ok(), txns: [{ ...tx({}), amount: "12" }] })).toBe(true);
    expect(err({ ...ok(), txns: [{ ...tx({}), amount: null }] })).toBe(true);
    expect(err({ ...ok(), txns: [{ ...tx({}), accountId: undefined }] })).toBe(true);
    expect(err({ ...ok(), txns: [null] })).toBe(true);
  });
  it("refuse comptes/catégories illisibles et zéro compte", () => {
    expect(err({ ...ok(), accounts: [] })).toBe(true);
    expect(err({ ...ok(), accounts: [{ id: "x" }] })).toBe(true);
    expect(err({ ...ok(), categories: [{ id: 1, name: "A" }] })).toBe(true);
    expect(err(ok())).toBe(false);
  });
  it("date de début mal formée : retirée, le reste est gardé", () => {
    const r = parseBackup(JSON.stringify({ ...ok(), importFrom: "demain" }));
    expect("state" in r && "importFrom" in r.state).toBe(false);
    expect("state" in r && r.state.txns).toHaveLength(1);
  });
  it("message en français", () => {
    const r = parseBackup(JSON.stringify({ ...ok(), txns: [tx({}), tx({ date: "x" })] }));
    expect("error" in r && r.error).toBe("Sauvegarde abîmée : l’opération n° 2 est illisible. Rien n’a été changé.");
  });
});

describe("paie non reconnue", () => {
  const l = (date: string, amount: number, counterparty: string, label = "Virement") => ({ key: date + counterparty + amount, date, amount, label, counterparty, iban: "", section: "courant" as const, balance: null });
  const st = (lines: ReturnType<typeof l>[]) => ({ bank: "cbc" as const, iban: "", owner: "ALEX EXEMPLE", firstName: "ALEX", lines });
  const work = (payer: string): State => ({ ...emptyState(), work: { ...emptyState().work, start: "2026-10-05", payer } });
  // 2026-10-15 et 2026-10-22 sont des jeudis.
  const twoThursdays = st([l("2026-10-15", 480, "INTERIM EXEMPLE"), l("2026-10-22", 495, "INTERIM EXEMPLE"), l("2026-10-16", 20, "Sam")]);
  it("même contrepartie sur deux jeudis, sans nom d'employeur : alerte", () => {
    expect(payNotRecognized(work(""), twoThursdays)).toBe(true);
    expect(payNotRecognized(work(" "), st([l("2026-10-14", 480, "AGENCE", "Paie semaine 41")]))).toBe(true);
  });
  it("pas d'alerte avec un employeur, sans paie réglée, ou sur un seul jeudi", () => {
    expect(payNotRecognized(work("interim exemple"), twoThursdays)).toBe(false);
    expect(payNotRecognized(emptyState(), twoThursdays)).toBe(false);
    expect(payNotRecognized(work(""), st([l("2026-10-15", 480, "INTERIM EXEMPLE"), l("2026-10-15", 10, "INTERIM EXEMPLE"), l("2026-10-22", -30, "INTERIM EXEMPLE")]))).toBe(false);
  });
});
