import { describe, expect, it } from "vitest";
import items from "./fixtures/revolut-items.json";
import { parseRevolut } from "./revolut";
import type { PdfItem } from "./types";

const st = parseRevolut(items as PdfItem[])!;

describe("parseRevolut", () => {
  it("lit l'IBAN et le titulaire", () => {
    expect(st.bank).toBe("revolut");
    expect(st.iban).toBe("BE00000000000001");
    expect(st.owner).toBe("JEAN EXEMPLE");
  });
  it("6 lignes lues", () => expect(st.lines).toHaveLength(6));
  it("montants signés corrects", () => {
    expect(st.lines.map((l) => l.amount)).toEqual([-25, 120, -31.4, -50, 50, 0.12]);
    expect(st.lines[0].balance).toBe(975);
    expect(st.lines[0].date).toBe("2026-10-01");
  });
  it("clé = revolut:<section>:<Transaction Id>", () => {
    expect(st.lines[0].key).toBe("revolut:courant:tx-0001");
    expect(st.lines[4].key).toBe("revolut:poche:tx-0005");
    expect(st.lines[5].key).toBe("revolut:epargne:tx-0006");
  });
  it("libellé sur deux lignes recollé", () =>
    expect(st.lines[2].label).toBe("Carrefour Market Ville-Exemple Centre Exemple Avenue"));
  it("contrepartie et IBAN lus, pied de page ignoré", () => {
    expect(st.lines[1].counterparty).toBe("MARIE EXEMPLE");
    expect(st.lines[1].iban).toBe("BE00000000000002");
    expect(st.lines[3].label).toBe("To pocket Vacances");
  });
  it("rend null si ce n'est pas Revolut", () => expect(parseRevolut([])).toBeNull());
});
