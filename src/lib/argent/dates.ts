export type Every = "month" | "week" | "2weeks";

// Dates en « AAAA-MM-JJ » locales : elles se comparent comme du texte. Jamais toISOString (UTC).
export const iso = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const parse = (s: string): Date => {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
};

export const addDays = (s: string, n: number): string => {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
};

// Lundi à vendredi.
export const isWorkday = (s: string): boolean => parse(s).getDay() % 6 !== 0;

// Jour de paie : le jeudi de la semaine suivante.
export const payday = (s: string): string => addDays(s, 10 - ((parse(s).getDay() + 6) % 7));

// Date de la n-ième occurrence (n = 0 : la première). Au mois, le jour est gardé (le 31 tombe le 30 ou le 28).
export const nthDate = (r: { first: string; every: Every }, n: number): string => {
  if (r.every !== "month") return addDays(r.first, n * (r.every === "week" ? 7 : 14));
  const f = parse(r.first);
  const last = new Date(f.getFullYear(), f.getMonth() + n + 1, 0).getDate();
  return iso(new Date(f.getFullYear(), f.getMonth() + n, Math.min(f.getDate(), last)));
};

export const todayIso = (now: Date = new Date()): string => iso(now);

// Lundi (AAAA-MM-JJ) de la semaine qui contient ce jour.
export const mondayOf = (day: string): string => addDays(day, -((parse(day).getDay() + 6) % 7));

// Noms français, indexés par getMonth() / getDay().
export const MONTHS_LONG = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
export const MONTHS_SHORT = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
export const DAYS_LONG = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
export const DAYS_SHORT = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
