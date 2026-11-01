import { expect, test } from "vitest";
import { fmt, round2, toAmount } from "./money";

test("toAmount virgule", () => expect(toAmount("12,50")).toBe(12.5));
test("toAmount point", () => expect(toAmount("12.5")).toBe(12.5));
test("toAmount négatif", () => expect(toAmount("-3")).toBe(-3));
test("toAmount vide ou illisible", () => {
  expect(toAmount("")).toBe(0);
  expect(toAmount("abc")).toBe(0);
});
test("fmt", () => expect(fmt(1200).replace(/\s/g, " ")).toBe("1 200 €"));
test("fmt garde les centimes utiles", () => expect(fmt(12.5).replace(/\s/g, " ")).toBe("12,50 €"));
test("round2", () => expect(round2(0.1 + 0.2)).toBe(0.3));
test("toAmount milliers et décimales (formats belges)", () => {
  expect(toAmount("1.200")).toBe(1200);
  expect(toAmount("1.200,50")).toBe(1200.5);
  expect(toAmount("1 200,50")).toBe(1200.5);
  expect(toAmount("1\u202f200,50")).toBe(1200.5);
  expect(toAmount("12,50")).toBe(12.5);
  expect(toAmount("12.5")).toBe(12.5);
  expect(toAmount("1,234")).toBe(1.23);
  expect(toAmount("-1.200,5")).toBe(-1200.5);
  expect(toAmount("1.234.567")).toBe(1234567);
});
