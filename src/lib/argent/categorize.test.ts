import { describe, expect, it } from "vitest";
import { guessCategory, learnCategory } from "./categorize";
import type { StatementLine } from "./import/types";
import { emptyState } from "./model";

const line = (label: string, amount: number, extra: Partial<StatementLine> = {}): StatementLine => ({
  key: "k", date: "2026-10-01", amount, label, counterparty: "", iban: "", section: "courant", balance: null, ...extra,
});

describe("guessCategory", () => {
  const s = emptyState();
  it("LUKOIL = carburant", () => expect(guessCategory(line("LUKOIL", -25), s)).toBe("carburant"));
  it("entrée avec IBAN = proches", () =>
    expect(guessCategory(line("Payment from X", 10, { iban: "BE00000000000002" }), s)).toBe("proches-in"));
  it("poche = pas de catégorie", () => expect(guessCategory(line("From Main", 50, { section: "poche" }), s)).toBeUndefined());
  it("Q8 = carburant ; Apple.com Bill = abonnements", () => {
    expect(guessCategory(line("Q8 0001 Station Test", -41.77), s)).toBe("carburant");
    expect(guessCategory(line("Apple.com Bill", -4.49), s)).toBe("abonnements");
  });
  it("virement CBC vers une personne = proches", () =>
    expect(guessCategory(line("Virement à Durand Lea", -18.6, { iban: "BE00000000000606" }), s)).toBe("proches-out"));
  it("virement vers une société = pas proches", () => {
    expect(guessCategory(line("Virement à Proprio Immo Srl", -25, { counterparty: "PROPRIO IMMO SRL", iban: "BE00000000000707" }), s)).toBe("autres-out");
    expect(guessCategory(line("To Atelier Ltd", -25, { counterparty: "Atelier Ltd", iban: "BE00000000000708" }), s)).toBe("autres-out");
  });
  it("retrait d'espèces = pas de catégorie", () =>
    expect(guessCategory(line("Retrait d'espèces", -65, { cash: true }), s)).toBeUndefined());
  it("une correction apprise gagne sur la règle", () => {
    const l = learnCategory(s, "  LUKOIL ", -1, "autres-out");
    expect(guessCategory(line("LUKOIL", -25), l)).toBe("autres-out");
    expect(guessCategory(line("LUKOIL", -25), s)).toBe("carburant");
  });
});

describe("salaire : mots génériques, aucun nom d'agence", () => {
  const s = emptyState();
  it("intérim / payroll / wages / salaire → salaire", () => {
    for (const label of ["Virement de Interim Exemple", "Intérim Exemple", "Payroll Exemple", "Wages", "Salaire octobre"])
      expect(guessCategory(line(label, 400), s)).toBe("salaire");
  });
});

describe("règles courtes : mots entiers seulement", () => {
  const s = emptyState();
  it("un mot qui en contient un autre ne déclenche pas la règle", () => {
    for (const label of ["Transaction Exemple", "Database Hosting", "Corail Boutique", "Stores Exemple", "Powerade Shop", "Orangerie Exemple", "Matching Gifts", "Espresso Bar Exemple", "Rinaldi Exemple", "Voodoo Lounge", "Basel Shop"])
      expect(guessCategory(line(label, -10), s), label).toBe("autres-out");
  });
  it("le mot seul déclenche toujours la règle", () => {
    expect(guessCategory(line("ACTION 1234 Ville-Exemple", -10), s)).toBe("courses");
    expect(guessCategory(line("Cora Ville-Exemple", -10), s)).toBe("courses");
    expect(guessCategory(line("Match Exemple", -10), s)).toBe("courses");
    expect(guessCategory(line("Spar Exemple", -10), s)).toBe("courses");
    expect(guessCategory(line("Aldi 42", -10), s)).toBe("courses");
    expect(guessCategory(line("Power Ville-Exemple", -10), s)).toBe("carburant");
    expect(guessCategory(line("Esso Exemple", -10), s)).toBe("carburant");
    expect(guessCategory(line("ORES Facture", -10), s)).toBe("logement");
    expect(guessCategory(line("Orange Belgium", -10), s)).toBe("abonnements");
    expect(guessCategory(line("BASE Mobile", -10), s)).toBe("abonnements");
    expect(guessCategory(line("Gabriels Ville-Exemple", -10), s)).toBe("carburant");
  });
});
