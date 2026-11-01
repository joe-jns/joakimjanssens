import { expect, test } from "vitest";
import { addDays, isWorkday, iso, nthDate, parse, payday, todayIso } from "./dates";

test("payday : lundi 2026-10-05 → jeudi 2026-10-15", () => expect(payday("2026-10-05")).toBe("2026-10-15"));
test("payday : vendredi 2026-10-09 → jeudi 2026-10-15", () => expect(payday("2026-10-09")).toBe("2026-10-15"));
test("iso garde la date locale à 23 h 30", () => expect(iso(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31"));
test("nthDate mensuel le 31 → 30 novembre", () =>
  expect(nthDate({ first: "2026-10-31", every: "month" }, 1)).toBe("2026-11-30"));
test("nthDate mensuel : le jour est retrouvé après un mois court", () =>
  expect(nthDate({ first: "2026-01-31", every: "month" }, 2)).toBe("2026-03-31"));
test("nthDate semaine et quinzaine", () => {
  expect(nthDate({ first: "2026-10-05", every: "week" }, 2)).toBe("2026-10-19");
  expect(nthDate({ first: "2026-10-05", every: "2weeks" }, 2)).toBe("2026-11-02");
});
test("addDays traverse les mois", () => expect(addDays("2026-10-31", 1)).toBe("2026-11-01"));
test("parse puis iso est neutre", () => expect(iso(parse("2026-02-28"))).toBe("2026-02-28"));
test("isWorkday : vendredi oui, samedi non", () => {
  expect(isWorkday("2026-10-09")).toBe(true);
  expect(isWorkday("2026-10-10")).toBe(false);
  expect(isWorkday("2026-10-11")).toBe(false);
});
test("todayIso", () => expect(todayIso(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31"));
