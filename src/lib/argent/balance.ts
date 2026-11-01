import { addDays, isWorkday, iso, mondayOf, nthDate, payday } from "./dates";
import type { State, Txn } from "./model";
import { fmt, round2 } from "./money";
import { debtSchedule } from "./schedule";

// Jour où l'argent compte vraiment : la paie d'une journée arrive le jeudi suivant.
export const effectiveDate = (t: Txn): string => (t.source === "journee" ? payday(t.date) : t.date);

// Ligne prévue que l'ancre de son compte couvre déjà (le vrai solde de l'extrait la remplace) :
// ni dans le solde, ni dans les dépenses ou le graphe.
export function coveredByAnchor(state: State, t: Txn): boolean {
  if (t.status !== "prevu") return false;
  const from = state.accounts.find((a) => a.id === t.accountId)?.anchor?.date;
  return !!from && effectiveDate(t) <= from;
}

export function accountBalance(state: State, accountId: string, at: string): number {
  const acc = state.accounts.find((a) => a.id === accountId);
  const from = acc?.anchor?.date;
  let sum = acc?.anchor?.balance ?? 0;
  for (const t of state.txns) {
    if (t.accountId !== accountId) continue;
    const e = effectiveDate(t);
    if (e <= at && (!from || e > from)) sum += t.amount;
  }
  return round2(sum);
}

export const totalBalance = (state: State, at: string): number =>
  round2(state.accounts.reduce((s, a) => s + accountBalance(state, a.id, at), 0));

// Journées faites mais dont la paie n'est pas encore arrivée.
export function pendingPay(state: State, at: string): { amount: number; next?: string } {
  let amount = 0;
  let next: string | undefined;
  for (const t of state.txns) {
    if (t.source !== "journee") continue;
    const p = payday(t.date);
    if (p <= at) continue;
    amount += t.amount;
    if (!next || p < next) next = p;
  }
  return next ? { amount: round2(amount), next } : { amount: 0 };
}

export function spendByCategory(state: State, month: string): { categoryId: string; amount: number; share: number }[] {
  const by = new Map<string, number>();
  for (const t of state.txns) {
    if (t.transferId || t.amount >= 0 || !t.date.startsWith(month) || coveredByAnchor(state, t)) continue;
    const c = t.categoryId ?? "autres-out";
    by.set(c, (by.get(c) ?? 0) - t.amount);
  }
  const total = [...by.values()].reduce((a, b) => a + b, 0);
  return [...by]
    .map(([categoryId, v]) => ({ categoryId, amount: round2(v), share: total ? v / total : 0 }))
    .sort((a, b) => b.amount - a.amount);
}

export function transfer(state: State, fromId: string, toId: string, amount: number, date: string): State {
  const transferId = crypto.randomUUID();
  const a = round2(Math.abs(amount));
  const mk = (accountId: string, amt: number): Txn => ({
    id: crypto.randomUUID(), accountId, date, amount: amt, label: "Virement", status: "manuel", source: "saisie", transferId,
  });
  return { ...state, txns: [...state.txns, mk(fromId, -a), mk(toId, a)] };
}


// Journées que syncWorkdays créerait (aujourd'hui avant 20 h, sinon dès demain) jusqu'à `target` (mêmes règles).
function futureWorkdays(state: State, today: string, target: string, now: Date): string[] {
  const { work } = state;
  if (!work.start) return [];
  const have = new Set(state.txns.filter((t) => t.source === "journee").map((t) => t.date));
  const skipped = new Set(work.skipped);
  const paid = new Set(work.paidWeeks);
  const out: string[] = [];
  for (let d = now.getHours() < 20 ? today : addDays(today, 1); d <= target; d = addDays(d, 1)) {
    if (d < work.start || (work.end && d > work.end)) continue;
    if (!isWorkday(d) || have.has(d) || skipped.has(d) || paid.has(mondayOf(d))) continue;
    out.push(d);
  }
  return out;
}

export function forecast(state: State, target: string, now: Date): { total: number; rows: { label: string; amount: number; details: string[] }[]; later: number } {
  const today = iso(now);
  const rows: { label: string; amount: number; details: string[] }[] = [];
  const todayTotal = totalBalance(state, today);
  rows.push({
    label: "Aujourd'hui",
    amount: todayTotal,
    details: state.accounts.map((a) => `${a.name} : ${fmt(accountBalance(state, a.id, today))}`),
  });

  // Paies : journées faites (paie entre demain et target) + journées à venir.
  const pay = new Map<string, number>();
  let later = 0;
  const addPay = (day: string, amount: number) => {
    const p = payday(day);
    if (p > target) later += amount;
    else if (p > today) pay.set(p, (pay.get(p) ?? 0) + amount);
  };
  for (const t of state.txns) if (t.source === "journee") addPay(t.date, t.amount);
  for (const d of futureWorkdays(state, today, target, now)) addPay(d, state.work.dayAmount);
  if (pay.size) {
    const dates = [...pay.keys()].sort();
    rows.push({
      label: "Paies",
      amount: round2([...pay.values()].reduce((a, b) => a + b, 0)),
      details: dates.map((d) => `${d} : ${fmt(round2(pay.get(d)!))}`),
    });
  }

  const inWindow = (d: string) => d > today && d <= target;
  const prevus = state.txns.filter((t) => t.source !== "journee" && inWindow(t.date)).sort((a, b) => a.date.localeCompare(b.date));
  if (prevus.length) rows.push({ label: "Prévus", amount: round2(prevus.reduce((s, t) => s + t.amount, 0)), details: prevus.map((t) => `${t.date} ${t.label} : ${fmt(t.amount)}`) });

  const seen = new Set([...state.txns.filter((t) => t.refId).map((t) => `${t.refId}|${t.date}`), ...(state.dismissed ?? [])]);
  const fixes: { date: string; label: string; amount: number }[] = [];
  const dettes: { date: string; label: string; amount: number }[] = [];
  const ok = (refId: string, date: string, since?: string) => inWindow(date) && !(since && date < since) && !seen.has(`${refId}|${date}`);
  for (const r of state.recurring) {
    for (let n = 0; n < 1000; n++) {
      const date = nthDate(r, n);
      if (date > target) break;
      if (ok(r.id, date, r.since)) fixes.push({ date, label: r.label, amount: r.amount });
    }
  }
  for (const d of state.debts) {
    for (const p of debtSchedule(d, target)) if (ok(d.id, p.date, d.since)) dettes.push({ date: p.date, label: d.label, amount: -p.amount });
  }
  for (const [label, list] of [["Fixes", fixes], ["Dettes", dettes]] as const) {
    if (!list.length) continue;
    list.sort((a, b) => a.date.localeCompare(b.date));
    rows.push({ label, amount: round2(list.reduce((s, x) => s + x.amount, 0)), details: list.map((x) => `${x.date} ${x.label} : ${fmt(x.amount)}`) });
  }

  return { total: round2(rows.reduce((s, r) => s + r.amount, 0)), rows, later: round2(later) };
}
