import { describe, expect, it } from "vitest";
import items from "./fixtures/cbc-items.json";
import revolutItems from "./fixtures/revolut-items.json";
import { parseCbc } from "./cbc";
import { parseRevolut } from "./revolut";
import type { PdfItem } from "./types";

// Fixture inventée au format mesuré d'un extrait CBC (2 pages, 10 opérations).
const st = parseCbc(items as PdfItem[])!;

describe("parseCbc", () => {
  it("lit la banque, l'IBAN normalisé, le titulaire et le prénom (dernier mot)", () => {
    expect(st.bank).toBe("cbc");
    expect(st.iban).toBe("BE00000000000303");
    expect(st.owner).toBe("EXEMPLE ALEX");
    expect(st.firstName).toBe("ALEX");
  });

  it("10 lignes lues, montants signés, section courant", () => {
    expect(st.lines).toHaveLength(10);
    expect(st.lines.map((l) => l.amount)).toEqual([47.13, -9.42, -65, 1234.56, -183.4, -41.77, -18.6, -18.6, 23.05, -4.49]);
    expect(st.lines.every((l) => l.section === "courant")).toBe(true);
  });

  it("date d'achat pour les cartes, date comptable sinon", () => {
    expect(st.lines.map((l) => l.date)).toEqual([
      "2031-09-02", "2031-09-03", "2031-09-07", "2031-09-09", "2031-09-09",
      "2031-09-11", "2031-09-13", "2031-09-13", "2031-09-15", "2031-09-16",
    ]);
  });

  it("libellés lisibles", () => {
    expect(st.lines.map((l) => l.label)).toEqual([
      "Virement de Dupont Marie",
      "Boulangerie Du Coin",
      "Retrait d'espèces",
      "Virement de Interim Exemple",
      "Virement à Alex Exemple",
      "Q8 0001 Station Test",
      "Virement à Exemple Marie",
      "Virement à Durand Lea",
      "Virement de Alex Exemple",
      "Apple.com Bill",
    ]);
  });

  it("contrepartie = nom, IBAN normalisé ; la communication sur 2 lignes ne pollue pas le nom", () => {
    expect(st.lines[0]).toMatchObject({ counterparty: "DUPONT MARIE", iban: "BE00000000000202" });
    expect(st.lines[3]).toMatchObject({ counterparty: "INTERIM EXEMPLE", iban: "BE00000000000404" });
    expect(st.lines[4]).toMatchObject({ counterparty: "ALEX EXEMPLE", iban: "BE00000000000101" });
    expect(st.lines[7]).toMatchObject({ counterparty: "DURAND LEA", iban: "BE00000000000606" });
    expect(st.lines[1]).toMatchObject({ counterparty: "", iban: "" });
  });

  it("retrait d'espèces marqué cash", () => {
    expect(st.lines[2].cash).toBe(true);
    expect(st.lines.filter((l) => l.cash)).toHaveLength(1);
  });

  it("soldes recalculés depuis le « Solde au » de départ, retombent sur le solde final", () => {
    expect(st.lines[0].balance).toBe(859.47);
    expect(st.lines[1].balance).toBe(850.05);
    expect(st.lines.at(-1)!.balance).toBe(1775.8);
  });

  it("solde final incohérent → balance null pour la période", () => {
    const bad = (items as PdfItem[]).map((i) => (i.s === "1.775,80 +" ? { ...i, s: "1.775,81 +" } : i));
    expect(parseCbc(bad)!.lines.every((l) => l.balance === null)).toBe(true);
  });

  it("clé cbc:<4 derniers de l'IBAN>:<date comptable>|<valeur>|<montant>|<empreinte du détail>, sans le n°", () => {
    expect(st.lines[1].key).toMatch(/^cbc:0303:2031-09-04\|2031-09-04\|-9\.42\|[a-z0-9]+$/);
    expect(st.lines[5].key).toMatch(/^cbc:0303:2031-09-11\|2031-09-14\|-41\.77\|[a-z0-9]+$/);
    // Deux virements de même date et montant vers deux personnes : détails différents → clés différentes.
    expect(st.lines[6].key).not.toBe(st.lines[7].key);
    expect(st.lines[7].key).not.toContain("#");
    expect(new Set(st.lines.map((l) => l.key)).size).toBe(10);
  });

  it("la clé ne dépend pas du n° d'opération de l'extrait", () => {
    const renum = (items as PdfItem[]).map((i) => (/^\d{3} \d{2}-\d{2}-\d{4}$/.test(i.s) ? { ...i, s: `9${i.s.slice(1)}` } : i));
    expect(parseCbc(renum)!.lines.map((l) => l.key)).toEqual(st.lines.map((l) => l.key));
  });

  it("la clé suit le détail (normalisé) : casse et espaces n'y changent rien", () => {
    const loud = (items as PdfItem[]).map((i) => (i.s === "DURAND LEA" ? { ...i, s: "Durand   Lea" } : i));
    expect(parseCbc(loud)!.lines[7].key).toBe(st.lines[7].key);
    const other = (items as PdfItem[]).map((i) => (i.s === "DURAND LEA" ? { ...i, s: "DURAND LEO" } : i));
    expect(parseCbc(other)!.lines[7].key).not.toBe(st.lines[7].key);
  });

  it("doublon exact (même détail) → suffixe #2", () => {
    const same: Record<string, string> = {
      "BE00 0000 0000 0606": "BE00 0000 0000 0505",
      "BANQUIER BENEFICIAIRE: GKCCBEBBXXX": "BANQUIER BENEFICIAIRE: CREGBEBBXXX",
      "DURAND LEA": "EXEMPLE MARIE",
      "LOYER PARTAGE SEPTEMBRE": "WERO EXEMPLE MARIE",
      "A 05.03 HEURES": "A 11.14",
      "PAR CBC MOBILE": "PAR WERO",
    };
    const twin = (items as PdfItem[])
      .filter((i) => i.s !== "ET CHARGES COMMUNES")
      .map((i) => (same[i.s] ? { ...i, s: same[i.s] } : i));
    const lines = parseCbc(twin)!.lines;
    expect(lines[7].key).toBe(`${lines[6].key}#2`);
  });

  it("aucun avertissement sur un extrait propre ; montant illisible → opération comptée dans warnings", () => {
    expect(st.warnings).toEqual([]);
    const bad = (items as PdfItem[]).map((i) => (i.s === "41,77 -" ? { ...i, s: "41,77" } : i));
    const res = parseCbc(bad)!;
    expect(res.lines).toHaveLength(9);
    expect(res.warnings).toHaveLength(1);
    expect(res.warnings![0]).toContain("006");
    expect(res.lines.every((l) => l.balance === null)).toBe(true);
  });

  it("rend null si ce n'est pas un extrait CBC", () => {
    expect(parseCbc([])).toBeNull();
    expect(parseCbc(revolutItems as PdfItem[])).toBeNull();
  });

  it("Revolut : prénom = premier mot", () => expect(parseRevolut(revolutItems as PdfItem[])!.firstName).toBe("JEAN"));
});
