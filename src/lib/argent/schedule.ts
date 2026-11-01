import { addDays, nthDate, payday } from "./dates";
import type { Debt, Recurring, State, Txn } from "./model";
import { round2 } from "./money";

export type Upcoming = {
  date: string;
  label: string;
  amount: number;
  kind: "fixe" | "dette" | "paie";
  refId?: string;
};

const CAP = 1000;

// Échéances d'une dette jusqu'à zéro (dernière tranche partielle), éventuellement jusqu'à `to` inclus.
export function debtSchedule(d: Debt, to = "9999-12-31"): { date: string; amount: number }[] {
  const pays: { date: string; amount: number }[] = [];
  if (d.amount <= 0) return pays;
  let left = d.total;
  for (let n = 0; left > 0.004 && n < CAP; n++) {
    const date = nthDate(d, n);
    if (date > to) break;
    const amount = round2(Math.min(d.amount, left));
    pays.push({ date, amount });
    left = round2(left - amount);
  }
  return pays;
}

export function debtLeft(d: Debt, at: string): number {
  return round2(d.total - debtSchedule(d, at).reduce((s, x) => s + x.amount, 0));
}

// Dates d'un paiement fixe dans ]from, to].
function recurringDates(r: Recurring, from: string, to: string): string[] {
  const out: string[] = [];
  for (let n = 0; n < CAP; n++) {
    const date = nthDate(r, n);
    if (date > to) break;
    if (date > from) out.push(date);
  }
  return out;
}

// Identifiant stable « <refId>|<date> » : deux appareils créent la même échéance, la synchro ne la double pas.
export function materializeSchedule(state: State, today: string): State {
  const seen = new Set([...state.txns.filter((t) => t.refId).map((t) => `${t.refId}|${t.date}`), ...(state.dismissed ?? [])]);
  const added: Txn[] = [];
  const add = (source: "fixe" | "dette", refId: string, date: string, amount: number, label: string, accountId: string, since: string | undefined, categoryId?: string) => {
    if (since && date < since) return;
    if (seen.has(`${refId}|${date}`)) return;
    seen.add(`${refId}|${date}`);
    added.push({ id: `${refId}|${date}`, accountId, date, amount, label, categoryId, status: "prevu", source, refId });
  };
  for (const r of state.recurring) {
    for (const date of recurringDates(r, "", today)) add("fixe", r.id, date, r.amount, r.label, r.accountId, r.since, r.categoryId);
  }
  for (const d of state.debts) {
    for (const p of debtSchedule(d, today)) add("dette", d.id, p.date, -p.amount, d.label, d.accountId, d.since);
  }
  return added.length ? { ...state, txns: [...state.txns, ...added] } : { ...state, txns: [...state.txns] };
}

// Ce qui arrive dans les `days` prochains jours (aujourd'hui exclu), trié par date.
export function upcoming(state: State, today: string, days: number): Upcoming[] {
  const to = addDays(today, days);
  const out: Upcoming[] = [];
  for (const r of state.recurring) {
    for (const date of recurringDates(r, today, to)) out.push({ date, label: r.label, amount: r.amount, kind: "fixe", refId: r.id });
  }
  for (const d of state.debts) {
    for (const p of debtSchedule(d, to)) if (p.date > today) out.push({ date: p.date, label: d.label, amount: -p.amount, kind: "dette", refId: d.id });
  }
  const pay = new Map<string, number>();
  for (const t of state.txns) {
    if (t.source !== "journee" || t.status !== "prevu") continue;
    const p = payday(t.date);
    if (p > today && p <= to) pay.set(p, round2((pay.get(p) ?? 0) + t.amount));
  }
  for (const [date, amount] of pay) out.push({ date, label: "Paie", amount, kind: "paie" });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}
