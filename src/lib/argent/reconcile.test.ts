import { describe, expect, it } from "vitest";
import { accountBalance, spendByCategory } from "./balance";
import cbcItems from "./import/fixtures/cbc-items.json";
import { parseCbc } from "./import/cbc";
import type { PdfItem } from "./import/types";
import type { StatementLine, Statement } from "./import/types";
import { emptyState, type State, type Txn } from "./model";
import { applyKnownPayroll, reconcile } from "./reconcile";
import { materializeSchedule } from "./schedule";
import { syncWorkdays } from "./workdays";

// Données inventées (dépôt public).
const IBAN = "BE00 0000 0000 0101";
let n = 0;
const line = (date: string, amount: number, extra: Partial<StatementLine> = {}): StatementLine => ({
  key: `revolut:courant:${++n}`, date, amount, label: "LIBELLE", counterparty: "", iban: "", section: "courant", balance: null, ...extra,
});
const stmt = (lines: StatementLine[]): Statement => ({ bank: "revolut", iban: IBAN, owner: "ALEX EXEMPLE", firstName: "ALEX", lines });
const manual = (date: string, amount: number, extra: Partial<Txn> = {}): Txn => ({
  id: crypto.randomUUID(), accountId: "revolut", date, amount, label: "Saisie", status: "manuel", source: "saisie", ...extra,
});
const withTxns = (txns: Txn[]): State => ({ ...emptyState(), txns });

describe("reconcile", () => {
  it("même extrait importé 2 fois → 2e fois tout est déjà là", () => {
    const st = stmt([line("2026-10-02", -12.5, { label: "LIDL" }), line("2026-10-03", 30, { label: "Payment from X", balance: 17.5 })]);
    const first = reconcile(emptyState(), st);
    expect(first.report).toEqual({ added: 2, linked: 0, replacedDays: 0, already: 0, skipped: 0 });
    const second = reconcile(first.state, st);
    expect(second.report).toEqual({ added: 0, linked: 0, replacedDays: 0, already: 2, skipped: 0 });
    expect(second.state.txns).toHaveLength(2);
  });

  it("ligne ajoutée : banque, import, catégorie devinée, clé gardée ; IBAN posé sur le compte courant", () => {
    const l = line("2026-10-02", -12.5, { label: "LIDL" });
    const { state } = reconcile(emptyState(), stmt([l]));
    expect(state.txns[0]).toMatchObject({ accountId: "revolut", amount: -12.5, status: "banque", source: "import", categoryId: "courses", bankKey: l.key });
    expect(state.accounts.find((a) => a.id === "revolut")?.iban).toBe("BE00000000000101");
  });

  it("dépense manuelle -40 le 3 + ligne -40,20 le 4 → reliée, montant -40,20", () => {
    const m = manual("2026-10-03", -40, { categoryId: "sorties", note: "anniv" });
    const l = line("2026-10-04", -40.2);
    const { state, report } = reconcile(withTxns([m]), stmt([l]));
    expect(report).toMatchObject({ added: 0, linked: 1 });
    expect(state.txns).toHaveLength(1);
    expect(state.txns[0]).toMatchObject({ id: m.id, amount: -40.2, date: "2026-10-04", bankKey: l.key, status: "banque", categoryId: "sorties", note: "anniv" });
  });

  it("deux manuelles -10 le même jour + une ligne -10 → une reliée, l'autre intacte", () => {
    const a = manual("2026-10-06", -10);
    const b = manual("2026-10-06", -10);
    const { state, report } = reconcile(withTxns([a, b]), stmt([line("2026-10-06", -10)]));
    expect(report).toMatchObject({ added: 0, linked: 1 });
    expect(state.txns.filter((t) => t.status === "banque")).toHaveLength(1);
    const rest = state.txns.filter((t) => t.status === "manuel");
    expect(rest).toHaveLength(1);
    expect([a, b]).toContainEqual(rest[0]);
    expect(state.txns).toHaveLength(2);
  });

  it("pas de liaison hors tolérance (signe, montant, jours, autre compte)", () => {
    const txns = [
      manual("2026-10-06", 10),
      manual("2026-10-06", -20),
      manual("2026-10-12", -10),
      manual("2026-10-06", -10, { accountId: "cbc" }),
    ];
    const { report } = reconcile(withTxns(txns), stmt([line("2026-10-06", -10)]));
    expect(report).toMatchObject({ added: 1, linked: 0 });
  });

  it("la plus proche en date l'emporte, puis en montant", () => {
    const far = manual("2026-10-02", -50);
    const near = manual("2026-10-05", -51);
    const nearer = manual("2026-10-05", -50.5);
    const { state } = reconcile(withTxns([far, near, nearer]), stmt([line("2026-10-06", -50)]));
    expect(state.txns.find((t) => t.status === "banque")?.id).toBe(nearer.id);
  });

  it("manuelle sans ligne → intacte", () => {
    const m = manual("2026-10-20", -7, { categoryId: "resto" });
    const { state } = reconcile(withTxns([m]), stmt([line("2026-10-02", -99)]));
    expect(state.txns.find((t) => t.id === m.id)).toEqual(m);
  });

  it("paie de l'employeur le jeudi 15 → journées du 5 au 9 remplacées, solde = montant réel", () => {
    const s0: State = { ...emptyState(), work: { ...emptyState().work, start: "2026-10-05", accountId: "revolut", payer: "interim exemple" } };
    const s1 = syncWorkdays(s0, new Date(2026, 9, 9, 21));
    expect(s1.txns.filter((t) => t.source === "journee")).toHaveLength(5);
    expect(accountBalance(s1, "revolut", "2026-10-15")).toBe(500);

    const pay = line("2026-10-15", 487.3, { label: "Payment from INTERIM EXEMPLE", counterparty: "Interim Exemple", balance: 487.3 });
    const { state, report } = reconcile(s1, stmt([pay]));
    expect(report).toEqual({ added: 1, linked: 0, replacedDays: 5, already: 0, skipped: 0 });
    expect(state.txns.filter((t) => t.source === "journee")).toHaveLength(0);
    expect(state.txns[0]).toMatchObject({ amount: 487.3, status: "banque", source: "import", categoryId: "salaire", bankKey: pay.key });
    expect(state.work.paidWeeks).toContain("2026-10-05");
    expect(accountBalance(state, "revolut", "2026-10-15")).toBe(487.3);
    // syncWorkdays ne recrée pas la semaine payée.
    expect(syncWorkdays(state, new Date(2026, 9, 9, 21)).txns.filter((t) => t.source === "journee")).toHaveLength(0);
  });

  it("paie : les journées d'une autre semaine restent", () => {
    const s0: State = { ...emptyState(), work: { ...emptyState().work, start: "2026-10-05", accountId: "revolut", payer: "INTERIM EXEMPLE" } };
    const s1 = syncWorkdays(s0, new Date(2026, 9, 13, 21));
    const { state, report } = reconcile(s1, stmt([line("2026-10-15", 500, { counterparty: "INTERIM EXEMPLE SA" })]));
    expect(report.replacedDays).toBe(5);
    expect(state.txns.filter((t) => t.source === "journee").map((t) => t.date)).toEqual(["2026-10-12", "2026-10-13"]);
  });

  it("paie : sans nom d'employeur, aucune rentrée n'est prise pour la paie", () => {
    const s0: State = { ...emptyState(), work: { ...emptyState().work, start: "2026-10-05", accountId: "revolut", payer: "  " } };
    const s1 = syncWorkdays(s0, new Date(2026, 9, 9, 21));
    const { state, report } = reconcile(s1, stmt([line("2026-10-15", 500, { counterparty: "INTERIM EXEMPLE" })]));
    expect(emptyState().work.payer).toBe("");
    expect(report.replacedDays).toBe(0);
    expect(state.work.paidWeeks).toEqual([]);
    expect(state.txns.filter((t) => t.source === "journee")).toHaveLength(5);
  });

  it("ancre posée au dernier solde, par section, seulement si plus récente", () => {
    const st = stmt([
      line("2026-10-02", -10, { balance: 90 }),
      line("2026-10-08", -5, { balance: 85 }),
      line("2026-10-08", 20, { section: "epargne", label: "From EUR", balance: 220 }),
      line("2026-10-09", -1, { balance: null }),
    ]);
    const { state } = reconcile(emptyState(), st);
    expect(state.accounts.find((a) => a.id === "revolut")?.anchor).toEqual({ date: "2026-10-08", balance: 85 });
    expect(state.accounts.find((a) => a.id === "revolut-epargne")?.anchor).toEqual({ date: "2026-10-08", balance: 220 });

    const newer: State = {
      ...emptyState(),
      accounts: emptyState().accounts.map((a) => (a.id === "revolut" ? { ...a, anchor: { date: "2026-10-30", balance: 1 } } : a)),
    };
    expect(reconcile(newer, st).state.accounts.find((a) => a.id === "revolut")?.anchor).toEqual({ date: "2026-10-30", balance: 1 });
  });

  it("virement vers l'épargne : les deux lignes partagent un transferId", () => {
    const st = stmt([
      line("2026-10-10", -50, { label: "To EUR Savings" }),
      line("2026-10-10", 50, { section: "epargne", label: "From EUR" }),
      line("2026-10-11", -25, { label: "To ALEX EXEMPLE", counterparty: "ALEX EXEMPLE" }),
      line("2026-10-11", -8, { label: "To Sam", counterparty: "Sam Ami" }),
    ]);
    const { state } = reconcile(emptyState(), st);
    const out = state.txns.find((t) => t.amount === -50)!;
    const into = state.txns.find((t) => t.amount === 50)!;
    expect(into.accountId).toBe("revolut-epargne");
    expect(out.transferId).toBeTruthy();
    expect(into.transferId).toBe(out.transferId);
    expect(state.txns.find((t) => t.amount === -25)?.transferId).toBeTruthy();
    expect(state.txns.find((t) => t.amount === -8)?.transferId).toBeUndefined();
  });

  it("compte épargne manquant → créé", () => {
    const s: State = { ...emptyState(), accounts: emptyState().accounts.filter((a) => a.id !== "revolut-epargne") };
    const { state } = reconcile(s, stmt([line("2026-10-10", 5, { section: "poche" })]));
    const acc = state.accounts.find((a) => a.bank === "revolut" && a.kind === "epargne");
    expect(acc).toBeTruthy();
    expect(state.txns[0].accountId).toBe(acc!.id);
  });

  it("ne modifie pas l'état d'entrée", () => {
    const m = manual("2026-10-03", -40);
    const s = withTxns([m]);
    const snap = JSON.stringify(s);
    reconcile(s, stmt([line("2026-10-04", -40.2, { balance: 10 })]));
    expect(JSON.stringify(s)).toBe(snap);
  });
});

describe("reconcile — corrections", () => {
  it("échéance reliée à une autre date → pas recréée par materializeSchedule", () => {
    const s0: State = {
      ...emptyState(),
      recurring: [{ id: "r1", label: "Loyer", amount: -500, every: "month", first: "2026-10-05", accountId: "revolut", categoryId: "logement" }],
    };
    const s1 = materializeSchedule(s0, "2026-10-05");
    const { state, report } = reconcile(s1, stmt([line("2026-10-03", -500, { label: "To PROPRIO" })]));
    expect(report.linked).toBe(1);
    expect(state.dismissed).toContain("r1|2026-10-05");
    const s2 = materializeSchedule(state, "2026-10-06");
    const rent = s2.txns.filter((t) => t.refId === "r1");
    expect(rent).toHaveLength(1);
    expect(rent[0]).toMatchObject({ date: "2026-10-03", amount: -500, status: "banque", categoryId: "logement" });
    expect(accountBalance(s2, "revolut", "2026-10-06")).toBe(-500);
  });

  it("poche + épargne vers le même compte : ancre = somme des derniers soldes, date la plus récente", () => {
    const st = stmt([
      line("2026-10-04", 30, { section: "poche", balance: 130 }),
      line("2026-10-06", 10, { section: "poche", balance: 140 }),
      line("2026-10-08", 20, { section: "epargne", balance: 1020 }),
    ]);
    const { state } = reconcile(emptyState(), st);
    expect(state.accounts.find((a) => a.id === "revolut-epargne")?.anchor).toEqual({ date: "2026-10-08", balance: 1160 });
  });

  it("deux lignes de même clé dans un extrait → les deux ajoutées, puis déjà là au 2e import", () => {
    const l = line("2026-10-07", -3, { key: "revolut:courant:dup" });
    const st = stmt([l, { ...l }]);
    const first = reconcile(emptyState(), st);
    expect(first.report).toMatchObject({ added: 2, already: 0 });
    expect(first.state.txns.map((t) => t.bankKey)).toEqual(["revolut:courant:dup", "revolut:courant:dup#2"]);
    expect(reconcile(first.state, st).report).toMatchObject({ added: 0, already: 2 });
  });

  it("prénom du titulaire : mot entier seulement", () => {
    const st = stmt([
      line("2026-10-11", -25, { counterparty: "Alex Exemple" }),
      line("2026-10-11", -9, { counterparty: "Alexandre Tiers" }),
    ]);
    const { state } = reconcile(emptyState(), st);
    expect(state.txns.find((t) => t.amount === -25)?.transferId).toBeTruthy();
    expect(state.txns.find((t) => t.amount === -9)?.transferId).toBeUndefined();
  });

  it("miroir à 2 jours près ; la moitié déjà ajoutée perd sa catégorie", () => {
    const st = stmt([
      line("2026-10-10", -50, { label: "To EUR Savings" }),
      line("2026-10-12", 50, { section: "epargne", label: "From EUR" }),
      line("2026-10-20", -70, { label: "To EUR Savings" }),
      line("2026-10-23", 70, { section: "epargne", label: "From EUR" }),
    ]);
    const { state } = reconcile(emptyState(), st);
    const out = state.txns.find((t) => t.amount === -50)!;
    const into = state.txns.find((t) => t.amount === 50)!;
    expect(into.transferId).toBe(out.transferId);
    expect(out.categoryId).toBeUndefined();
    const far = state.txns.find((t) => t.amount === 70)!;
    expect(far.transferId).not.toBe(state.txns.find((t) => t.amount === -70)?.transferId);
  });

  it("« To pocket… », « Pocket Withdrawal », « … Savings » : toujours internes, sans catégorie", () => {
    const st = stmt([
      line("2026-10-14", -30, { label: "To pocket EUR Vacances" }),
      line("2026-10-15", 20, { label: "Pocket Withdrawal" }),
      line("2026-10-16", -15, { label: "To EUR Instant Access Savings" }),
    ]);
    const { state } = reconcile(emptyState(), st);
    for (const t of state.txns) {
      expect(t.transferId, t.label).toBeTruthy();
      expect(t.categoryId, t.label).toBeUndefined();
    }
    expect(spendByCategory(state, "2026-10")).toEqual([]);
  });

  it("miroir = ligne elle-même interne : une dépense ordinaire de même montant n'est pas reprise", () => {
    const st = stmt([
      line("2026-10-14", -40, { label: "LIDL" }),
      line("2026-10-14", 40, { section: "poche", label: "From EUR" }),
    ]);
    const { state } = reconcile(emptyState(), st);
    const shop = state.txns.find((t) => t.label === "LIDL")!;
    expect(shop.transferId).toBeUndefined();
    expect(shop.categoryId).toBe("courses");
    expect(state.txns.find((t) => t.amount === 40)?.transferId).toBeTruthy();
  });

  it("IBAN comparé normalisé", () => {
    const s: State = {
      ...emptyState(),
      accounts: [...emptyState().accounts, { id: "autre", name: "Autre", kind: "courant", bank: "revolut", iban: "be00000000000101", color: "#000" }],
    };
    const { state } = reconcile(s, stmt([line("2026-10-02", -1)]));
    expect(state.txns[0].accountId).toBe("autre");
  });
});

describe("reconcile — extrait CBC", () => {
  const cbc = parseCbc(cbcItems as PdfItem[])!;
  // Mon compte Revolut connu par son IBAN ; données inventées.
  const base = (): State => ({
    ...emptyState(),
    accounts: emptyState().accounts.map((a) => (a.id === "revolut" ? { ...a, iban: "BE00000000000101" } : a)),
  });
  const cashLine = (extra: Partial<StatementLine> = {}): StatementLine => ({
    key: "cbc:0303:2031-09-07|2031-09-07|-65|1a2b3c", date: "2031-09-07", amount: -65, label: "Retrait d'espèces", counterparty: "",
    iban: "", section: "courant", balance: null, cash: true, ...extra,
  });
  const cbcStmt = (lines: StatementLine[]): Statement => ({
    bank: "cbc", iban: "BE00000000000303", owner: "EXEMPLE ALEX", firstName: "ALEX", lines,
  });

  it("importFrom : lignes d'avant ignorées (comptées), ancre = solde de fin quand même", () => {
    const { state, report } = reconcile({ ...base(), importFrom: "2031-09-06" }, cbc);
    expect(report.skipped).toBe(2);
    expect(state.txns.some((t) => t.date < "2031-09-06")).toBe(false);
    expect(state.accounts.find((a) => a.id === "cbc")?.anchor).toEqual({ date: "2031-09-16", balance: 1775.8 });
    expect(accountBalance(state, "cbc", "2031-09-30")).toBe(1775.8);
  });

  it("sans importFrom : tout est importé", () => {
    const { report } = reconcile(base(), cbc);
    expect(report).toMatchObject({ skipped: 0, added: 10 });
  });

  it("retrait d'espèces → miroir +X sur « liquide », même transferId, pas une dépense", () => {
    const { state } = reconcile(base(), cbc);
    const out = state.txns.find((t) => t.accountId === "cbc" && t.amount === -65)!;
    const into = state.txns.find((t) => t.accountId === "liquide")!;
    expect(out.transferId).toBeTruthy();
    expect(into).toMatchObject({ amount: 65, date: "2031-09-07", transferId: out.transferId });
    expect(out.categoryId).toBeUndefined();
    const spent = spendByCategory(state, "2031-09").reduce((s, c) => s + c.amount, 0);
    expect(Math.round(spent * 100) / 100).toBe(Math.round((9.42 + 41.77 + 18.6 + 18.6 + 4.49) * 100) / 100);
  });

  it("retrait : une entrée manuelle +X sur liquide à ±4 jours est reliée, pas de doublon", () => {
    const hand: Txn = { ...manual("2031-09-09", 65, { categoryId: "autres-in" }), accountId: "liquide" };
    const { state } = reconcile({ ...base(), txns: [hand] }, cbcStmt([cashLine()]));
    const liq = state.txns.filter((t) => t.accountId === "liquide");
    expect(liq).toHaveLength(1);
    expect(liq[0].id).toBe(hand.id);
    expect(liq[0].categoryId).toBeUndefined();
    expect(liq[0].transferId).toBe(state.txns.find((t) => t.accountId === "cbc")!.transferId);
    expect(accountBalance(state, "liquide", "2031-09-30")).toBe(65);
  });

  it("retrait relié à une dépense manuelle -X : perd sa catégorie, devient virement vers liquide", () => {
    const hand = manual("2031-09-07", -65, { accountId: "cbc", categoryId: "sorties" });
    const { state, report } = reconcile({ ...base(), txns: [hand] }, cbcStmt([cashLine()]));
    expect(report.linked).toBe(1);
    const out = state.txns.find((t) => t.id === hand.id)!;
    expect(out.categoryId).toBeUndefined();
    expect(out.transferId).toBeTruthy();
    expect(state.txns.find((t) => t.accountId === "liquide")).toMatchObject({ amount: 65, transferId: out.transferId });
    expect(spendByCategory(state, "2031-09")).toEqual([]);
  });

  it("prénom = dernier mot du titulaire : un membre de la famille partageant le NOM n'est pas interne", () => {
    const { state } = reconcile(base(), cbc);
    const fam = state.txns.find((t) => t.label === "Virement à Exemple Marie")!;
    expect(fam.transferId).toBeUndefined();
    expect(fam.categoryId).toBe("proches-out");
    expect(state.txns.find((t) => t.label === "Virement à Alex Exemple")?.transferId).toBeTruthy();
    expect(state.txns.find((t) => t.label === "Virement de Alex Exemple")?.transferId).toBeTruthy();
  });

  it("un ami qui partage seulement le prénom n'est pas interne ; prénom + nom (dans le désordre) l'est", () => {
    const l = (amount: number, counterparty: string, n: number): StatementLine => ({
      key: `cbc:0303:x|${n}`, date: "2031-09-20", amount, label: `Virement à ${counterparty}`, counterparty,
      iban: `BE00000000000${700 + n}`, section: "courant", balance: null,
    });
    const { state } = reconcile(emptyState(), cbcStmt([l(-11.11, "ALEX DURAND", 1), l(-22.22, "EXEMPLE ALEX", 2)]));
    expect(state.txns.find((t) => t.amount === -11.11)?.transferId).toBeUndefined();
    expect(state.txns.find((t) => t.amount === -22.22)?.transferId).toBeTruthy();
  });

  it("signature = prénom + nom de famille (bouts opposés du titulaire), pas les prénoms du milieu", () => {
    const l = (amount: number, counterparty: string, n: number): StatementLine => ({
      key: `revolut:courant:sig-${n}`, date: "2031-09-21", amount, label: `To ${counterparty}`, counterparty,
      iban: `BE00000000000${800 + n}`, section: "courant", balance: null,
    });
    const rev: Statement = {
      bank: "revolut", iban: "BE00000000000101", owner: "ALEX MARIE J EXEMPLE", firstName: "ALEX",
      lines: [l(-31.31, "EXEMPLE ALEX", 1), l(-32.32, "ALEX AUTRE", 2), l(-33.33, "MARIE EXEMPLE", 3)],
    };
    const { state } = reconcile(emptyState(), rev);
    expect(state.txns.find((t) => t.amount === -31.31)?.transferId).toBeTruthy();
    expect(state.txns.find((t) => t.amount === -32.32)?.transferId).toBeUndefined();
    expect(state.txns.find((t) => t.amount === -33.33)?.transferId).toBeUndefined();
    const cbcSt = cbcStmt([{ ...l(-34.34, "ALEX EXEMPLE", 4), key: "cbc:0303:sig|4" }]);
    expect(reconcile(emptyState(), cbcSt).state.txns[0].transferId).toBeTruthy();
  });

  it("paie employeur → salaire ; réimport → tout déjà là", () => {
    const first = reconcile({ ...base(), importFrom: "2031-09-06" }, cbc);
    expect(first.state.txns.find((t) => t.amount === 1234.56)?.categoryId).toBe("salaire");
    const again = reconcile(first.state, cbc);
    expect(again.report).toEqual({ added: 0, linked: 0, replacedDays: 0, already: 8, skipped: 2 });
    expect(again.state.txns).toHaveLength(first.state.txns.length);
  });

  it("CBC : ancre = solde de la dernière ligne de l'extrait même si sa date (achat) est plus ancienne", () => {
    const l = (date: string, amount: number, balance: number, n: number): StatementLine => ({
      key: `cbc:x|${n}`, date, amount, label: "X", counterparty: "", iban: "", section: "courant", balance,
    });
    const st = cbcStmt([l("2031-09-20", -10, 90, 1), l("2031-09-19", -5, 85, 2)]);
    expect(reconcile(emptyState(), st).state.accounts.find((a) => a.id === "cbc")?.anchor).toEqual({ date: "2031-09-20", balance: 85 });
  });
});

describe("paie : rattrapage quand l'employeur est saisi après l'import", () => {
  const start = (payer: string): State => ({ ...emptyState(), work: { ...emptyState().work, start: "2026-10-05", accountId: "revolut", payer } });
  const pays = () => [
    line("2026-10-15", 480, { label: "Payment from INTERIM EXEMPLE", counterparty: "Interim Exemple", key: "revolut:courant:pay1" }),
    line("2026-10-22", 490, { label: "Payment from INTERIM EXEMPLE", counterparty: "Interim Exemple", key: "revolut:courant:pay2" }),
    line("2026-10-20", -30, { label: "Boulangerie", key: "revolut:courant:shop" }),
  ];
  const journees = (s: State) => s.txns.filter((t) => t.source === "journee").map((t) => t.date);

  it("réimport après avoir saisi l'employeur : lignes déjà là, journées des semaines payées retirées", () => {
    const s1 = syncWorkdays(start(""), new Date(2026, 9, 23, 21));
    const first = reconcile(s1, stmt(pays())).state;
    expect(journees(first)).toHaveLength(15);
    const named = { ...first, work: { ...first.work, payer: "interim exemple" } };
    const { state, report } = reconcile(named, stmt(pays()));
    expect(report).toMatchObject({ added: 0, linked: 0, already: 3, replacedDays: 10 });
    expect(journees(state)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(state.work.paidWeeks.sort()).toEqual(["2026-10-05", "2026-10-12"]);
    // Idempotent.
    const again = reconcile(state, stmt(pays()));
    expect(again.report.replacedDays).toBe(0);
    expect(again.state.txns).toEqual(state.txns);
  });

  it("applyKnownPayroll : saisir l'employeur suffit, sans réimporter ; 2e appel sans effet", () => {
    const s1 = syncWorkdays(start(""), new Date(2026, 9, 23, 21));
    const imported = reconcile(s1, stmt(pays())).state;
    const named = { ...imported, work: { ...imported.work, payer: "Interim Exemple" } };
    const fixed = applyKnownPayroll(named);
    expect(journees(fixed)).toEqual(["2026-10-19", "2026-10-20", "2026-10-21", "2026-10-22", "2026-10-23"]);
    expect(fixed.work.paidWeeks.sort()).toEqual(["2026-10-05", "2026-10-12"]);
    // Le reste ne bouge pas : mêmes opérations hors journées ; solde = vraies paies + achat, puis la semaine
    // pas encore payée le jour de sa paie estimée (jeudi 29).
    expect(fixed.txns.filter((t) => t.source !== "journee")).toEqual(named.txns.filter((t) => t.source !== "journee"));
    expect(accountBalance(named, "revolut", "2026-10-23")).toBe(1940);
    expect(accountBalance(fixed, "revolut", "2026-10-23")).toBe(480 + 490 - 30);
    expect(accountBalance(fixed, "revolut", "2026-10-29")).toBe(480 + 490 - 30 + 500);
    expect(applyKnownPayroll(fixed)).toEqual(fixed);
  });

  it("applyKnownPayroll : sans employeur, ou rentrée saisie à la main, rien ne change", () => {
    const s1 = syncWorkdays(start(""), new Date(2026, 9, 16, 21));
    const imported = reconcile(s1, stmt(pays().slice(0, 1))).state;
    expect(applyKnownPayroll(imported)).toEqual(imported);
    const hand = { ...s1, work: { ...s1.work, payer: "interim exemple" }, txns: [...s1.txns, manual("2026-10-15", 480, { label: "Interim Exemple" })] };
    expect(journees(applyKnownPayroll(hand))).toHaveLength(10);
  });
});
