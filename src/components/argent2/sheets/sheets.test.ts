import { describe, expect, it } from "vitest";
import { emptyState, type Txn } from "../../../lib/argent/model";
import { addEntry } from "./AddSheet";
import { deleteCategory, nameError } from "./CategorySheet";

const base = { accountId: "cbc", date: "2026-10-20", note: "" };

describe("addEntry", () => {
  it("dépense : montant négatif, manuel / saisie, libellé = catégorie", () => {
    const s = addEntry(emptyState(), { ...base, kind: "out", amount: 40, categoryId: "carburant" });
    expect(s.txns).toHaveLength(1);
    expect(s.txns[0]).toMatchObject({ amount: -40, label: "Carburant", categoryId: "carburant", status: "manuel", source: "saisie" });
  });
  it("rentrée sans catégorie : « Autres rentrées », note gardée", () => {
    const s = addEntry(emptyState(), { ...base, kind: "in", amount: 12.5, note: " remboursement " });
    expect(s.txns[0]).toMatchObject({ amount: 12.5, categoryId: "autres-in", label: "remboursement", note: "remboursement" });
  });
  it("virement : deux lignes liées, rien si même compte ou montant nul", () => {
    const s = addEntry(emptyState(), { ...base, kind: "transfer", amount: 25, toAccountId: "revolut-epargne" });
    expect(s.txns.map((t) => [t.accountId, t.amount])).toEqual([["cbc", -25], ["revolut-epargne", 25]]);
    expect(s.txns[0].transferId).toBe(s.txns[1].transferId);
    expect(addEntry(emptyState(), { ...base, kind: "transfer", amount: 25, toAccountId: "cbc" }).txns).toHaveLength(0);
    expect(addEntry(emptyState(), { ...base, kind: "out", amount: 0 }).txns).toHaveLength(0);
  });
});

describe("deleteCategory", () => {
  it("passe les opérations, fixes et règles dans « Autres » du même sens", () => {
    const t: Txn = { id: "a", accountId: "cbc", date: "2026-10-01", amount: -5, label: "x", categoryId: "sorties", status: "manuel", source: "saisie" };
    const s0 = { ...emptyState(), txns: [t], learned: { cine: "sorties" }, recurring: [{ id: "r", label: "r", amount: -1, every: "month" as const, first: "2026-10-01", accountId: "cbc", categoryId: "sorties" }] };
    const s = deleteCategory(s0, "sorties");
    expect(s.categories.some((c) => c.id === "sorties")).toBe(false);
    expect(s.txns[0].categoryId).toBe("autres-out");
    expect(s.recurring[0].categoryId).toBe("autres-out");
    expect(s.learned.cine).toBe("autres-out");
  });
  it("« Autres » ne se supprime pas", () => {
    const s0 = emptyState();
    expect(deleteCategory(s0, "autres-out")).toBe(s0);
  });
});

describe("nameError", () => {
  it("refuse un nom vide ou déjà pris dans le même sens, accepte le même nom dans l'autre sens", () => {
    const s = emptyState();
    expect(nameError(s, { name: "  ", kind: "out" })).toMatch(/nom/);
    expect(nameError(s, { name: "carburant ", kind: "out" })).toMatch(/existe déjà/);
    expect(nameError(s, { name: "Carburant", kind: "in" })).toBeNull();
    expect(nameError(s, { id: "carburant", name: "Carburant", kind: "out" })).toBeNull();
  });
});
