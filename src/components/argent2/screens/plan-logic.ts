// Règles du Planning (pures, testées) : paie, paiements fixes, dettes, objectifs.
//
// Choix (modification et suppression) :
// - Les échéances passées d'un fixe ou d'une dette sont déjà des opérations « prévues » (materializeSchedule) :
//   c'est de l'historique. Supprimer un fixe / une dette les garde et arrête seulement les suivantes.
// - Modifier un fixe vaut pour les échéances à venir : `since` passe à aujourd'hui, les opérations déjà créées
//   gardent leur montant.
// - Modifier le montant, la fréquence, la date ou le reste d'une dette relance son échéancier depuis la prochaine
//   échéance : reste et « déjà remboursé » sont ceux saisis, les tranches passées ne bougent pas. Si la date et la
//   fréquence ne changent pas, la série garde son jour d'origine (voir saveDebt).
// - Modifier un fixe ou une dette retire ses échéances « prévues » d'aujourd'hui (ou après) qui ne sont plus dans
//   le nouvel échéancier ; une échéance déjà reliée à la banque ne bouge jamais.
// - Changer les réglages de la paie recalcule les journées « prévues » (montant, compte, période) ; les journées
//   remplacées par la vraie paie de la banque n'existent plus et ne reviennent pas (semaines payées). Le nom de
//   l'employeur saisi après l'import suffit : la paie déjà importée est reconnue sans réimporter.
import { accountBalance, transfer } from "../../../lib/argent/balance";
import { addDays, isWorkday, MONTHS_LONG, MONTHS_SHORT, nthDate, parse, DAYS_SHORT, type Every } from "../../../lib/argent/dates";
import type { Account, Debt, Goal, Recurring, State, Work } from "../../../lib/argent/model";
import { round2 } from "../../../lib/argent/money";
import { applyKnownPayroll } from "../../../lib/argent/reconcile";
import { debtLeft, debtSchedule, pruneSchedule } from "../../../lib/argent/schedule";
import { skipDays, syncWorkdays, unskipDay } from "../../../lib/argent/workdays";

export const EVERY: { id: Every; label: string; short: string }[] = [
  { id: "month", label: "Chaque mois", short: "Mois" },
  { id: "2weeks", label: "Toutes les 2 semaines", short: "2 semaines" },
  { id: "week", label: "Chaque semaine", short: "Semaine" },
];
export const everyLabel = (e: Every) => EVERY.find((x) => x.id === e)!.label;

const later = (a: string | undefined, b: string) => (a && a > b ? a : b);

/* ---------- Dates lisibles ---------- */
export const dayShort = (d: string) => {
  const x = parse(d);
  return `${DAYS_SHORT[x.getDay()]} ${x.getDate()} ${MONTHS_SHORT[x.getMonth()]}`;
};
export const dayLong = (d: string) => {
  const x = parse(d);
  return `${x.getDate()} ${MONTHS_LONG[x.getMonth()]} ${x.getFullYear()}`;
};
export const monthYear = (d: string) => {
  const x = parse(d);
  return `${MONTHS_SHORT[x.getMonth()]} ${x.getFullYear()}`;
};
/** Jours entiers de `a` à `b` (b après a : positif). */
export const daysBetween = (a: string, b: string) => Math.round((parse(b).getTime() - parse(a).getTime()) / 86400000);

/* ---------- Paie ---------- */

/** Applique de nouveaux réglages de paie et recalcule les journées prévues (montant, compte, période). */
export function saveWork(s: State, patch: Partial<Work>, now: Date): State {
  const work: Work = { ...s.work, ...patch, dayAmount: round2(patch.dayAmount ?? s.work.dayAmount) };
  if (!work.end) delete work.end;
  if (!work.start) delete work.start;
  const out = (d: string) => !work.start || d < work.start || (!!work.end && d > work.end);
  const txns = s.txns
    .filter((t) => !(t.source === "journee" && t.status === "prevu" && out(t.date)))
    .map((t) =>
      t.source === "journee" && t.status === "prevu"
        ? { ...t, amount: work.dayAmount, accountId: work.accountId ?? t.accountId }
        : t,
    );
  // Employeur saisi (ou corrigé) après l'import : la paie déjà là remplace les journées de ses semaines.
  return syncWorkdays(applyKnownPayroll({ ...s, work, txns }), now);
}

/** Jours ouvrés (lundi–vendredi) de `from` à `to` inclus, dans l'ordre. */
export function workdaysIn(from: string, to: string): string[] {
  if (!from || !to) return [];
  const [a, b] = from <= to ? [from, to] : [to, from];
  const out: string[] = [];
  for (let d = a; d <= b && out.length < 400; d = addDays(d, 1)) if (isWorkday(d)) out.push(d);
  return out;
}

export const skipRange = (s: State, from: string, to: string): State => skipDays(s, workdaysIn(from, to));

/** Remet des jours non travaillés (puis recrée les journées écoulées). */
export function unskip(s: State, days: string[], now: Date): State {
  return syncWorkdays(days.reduce(unskipDay, s), now);
}

/** Jours non travaillés groupés en plages de jours ouvrés qui se suivent (vendredi → lundi compris). */
export function skippedRanges(days: string[]): { from: string; to: string; days: string[] }[] {
  const sorted = [...new Set(days)].sort();
  const out: { from: string; to: string; days: string[] }[] = [];
  for (const d of sorted) {
    const last = out[out.length - 1];
    // Le jour suit la plage s'il est le premier jour ouvré après sa fin.
    if (last && workdaysIn(addDays(last.to, 1), d).length === 1) {
      last.to = d;
      last.days.push(d);
    } else out.push({ from: d, to: d, days: [d] });
  }
  return out;
}

/* ---------- Paiements fixes ---------- */
export type RecurringDraft = { id?: string; label: string; amount: number; every: Every; first: string; accountId: string; categoryId?: string };

/** Prochaine échéance, aujourd'hui compris. */
export function nextOccurrence(r: { first: string; every: Every }, today: string): string {
  for (let n = 0; n < 2000; n++) {
    const d = nthDate(r, n);
    if (d >= today) return d;
  }
  return r.first;
}

export function saveRecurring(s: State, d: RecurringDraft, today: string): State {
  const label = d.label.trim();
  const amount = round2(d.amount);
  if (!label || !amount || !d.first || !d.accountId) return s;
  const fields = { label, amount, every: d.every, first: d.first, accountId: d.accountId, categoryId: d.categoryId };
  if (!d.id) return { ...s, recurring: [...s.recurring, { id: crypto.randomUUID(), ...fields, since: today }] };
  const next = { ...s, recurring: s.recurring.map((r): Recurring => (r.id === d.id ? { ...r, ...fields, since: later(r.since, today) } : r)) };
  return pruneSchedule(next, "fixe", d.id, today).state;
}

/** Retire le fixe ; ses opérations déjà créées restent (historique), plus rien n'arrive ensuite. */
export const deleteRecurring = (s: State, id: string): State => ({ ...s, recurring: s.recurring.filter((r) => r.id !== id) });

/** Montant ramené au mois (pour un total « par mois »). */
export const perMonth = (r: { amount: number; every: Every }) =>
  round2(r.every === "month" ? r.amount : (r.amount * 52) / (r.every === "week" ? 12 : 24));

/* ---------- Dettes ---------- */
export type DebtInfo = { left: number; whole: number; repaid: number; pct: number; end?: string; next?: { date: string; amount: number }; done: boolean };

export function debtInfo(d: Debt, today: string): DebtInfo {
  const sched = debtSchedule(d);
  const left = Math.max(0, debtLeft(d, today));
  const whole = round2((d.paid ?? 0) + d.total);
  const repaid = round2(whole - left);
  return {
    left,
    whole,
    repaid,
    pct: whole > 0 ? Math.min(1, repaid / whole) : 1,
    end: sched[sched.length - 1]?.date,
    next: sched.find((p) => p.date > today),
    done: left <= 0,
  };
}

/** Toutes les dettes : reste, total, % remboursé, date où tout est payé (« libre le … »). */
export function debtsSummary(s: State, today: string) {
  const infos = s.debts.map((d) => ({ d, i: debtInfo(d, today) }));
  const left = round2(infos.reduce((a, x) => a + x.i.left, 0));
  const whole = round2(infos.reduce((a, x) => a + x.i.whole, 0));
  const ends = infos.filter((x) => !x.i.done && x.i.end).map((x) => x.i.end!);
  return {
    left,
    whole,
    pct: whole > 0 ? Math.min(1, (whole - left) / whole) : 0,
    free: ends.length ? ends.sort()[ends.length - 1] : undefined,
    open: infos.filter((x) => !x.i.done).map((x) => x.d.label),
  };
}

/** `left` = reste à rembourser à partir de `first` ; `paid` = déjà remboursé avant. */
export type DebtDraft = { id?: string; label: string; left: number; paid: number; amount: number; every: Every; first: string; accountId: string };

/** Valeurs de départ du formulaire pour une dette existante (prochaine échéance, reste aujourd'hui). */
export function debtDraft(d: Debt, today: string): DebtDraft {
  const i = debtInfo(d, today);
  return { id: d.id, label: d.label, left: i.left, paid: i.repaid, amount: d.amount, every: d.every, first: i.next?.date ?? d.first, accountId: d.accountId };
}

export function saveDebt(s: State, d: DebtDraft, today: string): State {
  const label = d.label.trim();
  const amount = round2(Math.abs(d.amount));
  const left = round2(Math.abs(d.left));
  const paid = round2(Math.max(0, d.paid || 0));
  if (!label || !amount || !d.first || !d.accountId) return s;
  if (!d.id) {
    if (!left) return s;
    const debt: Debt = { id: crypto.randomUUID(), label, total: left, amount, every: d.every, first: d.first, accountId: d.accountId, since: today };
    if (paid) debt.paid = paid;
    return { ...s, debts: [...s.debts, debt] };
  }
  const old = s.debts.find((x) => x.id === d.id);
  if (!old) return s;
  const was = debtDraft(old, today);
  const same = was.left === left && was.paid === paid && was.amount === amount && was.every === d.every && was.first === d.first;
  // Date et fréquence inchangées : la série garde son ancre (le « 31 » reste le 31, pas de glissement vers le 28).
  // L'échéancier repart alors de l'ancienne première date, avec les k tranches passées au nouveau montant comptées
  // dans `total` et retirées de `paid` (qui peut devenir négatif) : reste aujourd'hui et total remboursé sont les mêmes.
  let first = d.first;
  let total = left;
  let paidOut = paid;
  if (!same && was.first === d.first && old.every === d.every) {
    let k = 0;
    while (k < 2000 && nthDate(old, k) <= today) k++;
    first = old.first;
    total = round2(left + k * amount);
    paidOut = round2(paid - k * amount);
  }
  const next: Debt = same
    ? { ...old, label, accountId: d.accountId }
    : { ...old, label, accountId: d.accountId, total, paid: paidOut || undefined, amount, every: d.every, first, since: later(old.since, today) };
  const pruned = pruneSchedule({ ...s, debts: s.debts.map((x) => (x.id === d.id ? next : x)) }, "dette", d.id, today);
  // Échéance du jour retirée (date repoussée) : le formulaire la comptait dans « déjà remboursé ». Si ces champs
  // n'ont pas été touchés, elle revient dans le reste à rembourser.
  const back = round2(pruned.removed.filter((t) => t.date <= today).reduce((a, t) => a - t.amount, 0));
  if (back && was.left === left && was.paid === paid) {
    next.total = round2(next.total + back);
    next.paid = round2((next.paid ?? 0) - back) || undefined;
  }
  if (next.paid === undefined) delete next.paid;
  return { ...pruned.state, debts: pruned.state.debts.map((x) => (x.id === d.id ? next : x)) };
}

/**
 * Champ « Prochaine échéance » d'une dette modifiée : pas avant aujourd'hui, mais seulement si la dette court encore
 * et que la date a été changée (une dette terminée garde sa date passée et reste renommable).
 */
export function debtDateRule(was: string | undefined, first: string, today: string, done: boolean): { min?: string; first: string } {
  // Nouvelle dette : la prochaine échéance ne peut pas être passée (sinon elle compterait comme déjà payée ;
  // ce qui est déjà payé se met dans « Déjà payé »).
  if (done || (was && first === was)) return { first };
  return { min: today, first: first < today ? today : first };
}

/** Retire la dette ; ses tranches déjà créées restent (historique). */
export const deleteDebt = (s: State, id: string): State => ({ ...s, debts: s.debts.filter((d) => d.id !== id) });

/* ---------- Objectifs ---------- */
export const SAVINGS_COLOR = "#75706E";

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "epargne";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/**
 * Compte proposé pour un objectif : le compte d'épargne de la banque (`revolut-epargne` s'il existe, sinon le
 * premier compte d'épargne). L'argent mis de côté y arrive aussi par l'extrait : il n'est compté qu'une fois.
 * Vide s'il n'y en a aucun.
 */
export const defaultGoalAccount = (s: State): string =>
  (s.accounts.find((a) => a.id === "revolut-epargne") ?? s.accounts.find((a) => a.kind === "epargne"))?.id ?? "";

/**
 * `accountId` vide : un compte « hors banque » est créé (tirelire, liquide… nom `newAccount`, sinon celui de
 * l'objectif). Seulement pour de l'argent qui n'est sur aucun compte bancaire importé.
 */
export type GoalDraft = { id?: string; name: string; icon: string; color: string; target: number; date?: string; accountId: string; newAccount: string };

export function saveGoal(s: State, d: GoalDraft): State {
  const name = d.name.trim();
  const target = round2(Math.abs(d.target));
  if (!name || !target) return s;
  let accounts = s.accounts;
  let accountId = d.accountId;
  if (!accountId || !accounts.some((a) => a.id === accountId)) {
    const accName = d.newAccount.trim() || name;
    accountId = slug(accName, new Set(accounts.map((a) => a.id)));
    const acc: Account = { id: accountId, name: accName, kind: "epargne", color: SAVINGS_COLOR };
    accounts = [...accounts, acc];
  }
  const fields = { name, icon: d.icon, color: d.color, target, accountId, ...(d.date ? { date: d.date } : {}) };
  if (!d.id) return { ...s, accounts, goals: [...s.goals, { id: crypto.randomUUID(), ...fields }] };
  return {
    ...s,
    accounts,
    goals: s.goals.map((g): Goal => {
      if (g.id !== d.id) return g;
      const { date: _drop, ...rest } = g;
      return { ...rest, ...fields };
    }),
  };
}

/** Retire l'objectif ; son compte et son argent restent. */
export const deleteGoal = (s: State, id: string): State => ({ ...s, goals: s.goals.filter((g) => g.id !== id) });

export function goalProgress(s: State, g: Goal, today: string) {
  const saved = accountBalance(s, g.accountId, today);
  const rest = round2(Math.max(0, g.target - saved));
  const months = g.date && g.date > today ? Math.max(1, Math.ceil(daysBetween(today, g.date) / 30.44)) : 0;
  return {
    saved,
    rest,
    pct: g.target > 0 ? Math.max(0, Math.min(1, saved / g.target)) : 0,
    perMonth: months && rest ? round2(rest / months) : 0,
  };
}

/** « Mettre de côté » : virement d'un compte vers le compte de l'objectif (le total ne bouge pas). */
export function putAside(s: State, goalId: string, fromId: string, amount: number, date: string): State {
  const g = s.goals.find((x) => x.id === goalId);
  const a = round2(Math.abs(amount));
  if (!g || !a || fromId === g.accountId || !s.accounts.some((x) => x.id === fromId)) return s;
  const next = transfer(s, fromId, g.accountId, a, date);
  const added = new Set(next.txns.slice(s.txns.length).map((t) => t.id));
  return { ...next, txns: next.txns.map((t) => (added.has(t.id) ? { ...t, note: g.name } : t)) };
}
