// Écran Activité, partie pure (testée) : lignes (un virement = une ligne), recherche, filtres, jours,
// et les règles de modification / suppression d'une opération.
import { learnCategory } from "../../../lib/argent/categorize";
import { addDays, DAYS_LONG, MONTHS_LONG, parse } from "../../../lib/argent/dates";
import type { State, Txn } from "../../../lib/argent/model";
import { round2 } from "../../../lib/argent/money";
import { skipDays } from "../../../lib/argent/workdays";

/** Une ligne de la liste. Un virement entre mes comptes : `txn` = la sortie, `pair` = l'entrée. */
export type Row = { key: string; date: string; txn: Txn; pair?: Txn; /** Texte de recherche, déjà replié (sans accents, minuscules). */ text: string };
export type Kind = "tout" | "depenses" | "rentrees" | "fixes";
export type Filters = { kind: Kind; cats: string[] | null; q: string };
export type Day = { day: string; net: number; rows: Row[] };

export const isTransfer = (r: Row): boolean => !!r.pair;
/** Catégorie d'une opération ; sans catégorie : « Autres » du même sens (comme la barre des dépenses). */
export const catOf = (t: Txn): string => t.categoryId ?? (t.amount < 0 ? "autres-out" : "autres-in");

/** Toutes les opérations, la plus récente en haut ; les deux moitiés d'un virement deviennent une seule ligne. */
export function buildRows(s: State): Row[] {
  const halves = new Map<string, Txn[]>();
  for (const t of s.txns) if (t.transferId) halves.set(t.transferId, [...(halves.get(t.transferId) ?? []), t]);
  const out: { r: Row; i: number }[] = [];
  s.txns.forEach((t, i) => {
    const h = t.transferId ? halves.get(t.transferId)! : null;
    if (h && h.length === 2) {
      const from = h[0].amount <= h[1].amount ? h[0] : h[1];
      if (t !== from) return;
      const pair = from === h[0] ? h[1] : h[0];
      out.push({ r: { key: t.transferId!, date: t.date, txn: from, pair, text: rowText(s, from, pair) }, i });
    } else out.push({ r: { key: t.id, date: t.date, txn: t, text: rowText(s, t) }, i });
  });
  return out.sort((a, b) => b.r.date.localeCompare(a.r.date) || b.i - a.i).map((x) => x.r);
}

const fold = (x: string) => x.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Un montant tapé dans la recherche : « 40 » trouve 40,00 et 40,03 ; « 40,0 » ou « 40.03 » cherche les décimales. */
function amountMatches(q: string, amount: number): boolean {
  const m = /^[-+−]?\s*(\d+)(?:[.,](\d{0,2}))?\s*€?$/.exec(q.trim());
  if (!m) return false;
  const [int, dec] = Math.abs(amount).toFixed(2).split(".");
  if (m[1] !== int) return false;
  return m[2] === undefined || dec.startsWith(m[2]);
}

export function rowText(s: State, txn: Txn, pair?: Txn): string {
  const acc = (id: string) => s.accounts.find((a) => a.id === id)?.name ?? "";
  const cat = s.categories.find((c) => c.id === txn.categoryId)?.name ?? "";
  const parts = [txn.label, txn.note ?? "", acc(txn.accountId), cat];
  if (pair) parts.push(acc(pair.accountId), pair.note ?? "", "virement");
  return fold(parts.join(" "));
}

/** Recherche sur le texte replié de la ligne (calculé une fois par buildRows) et sur le montant. */
export function matchesSearch(r: Row, q: string): boolean {
  const words = fold(q).trim();
  if (!words) return true;
  if (amountMatches(words, r.txn.amount)) return true;
  return words.split(/\s+/).every((w) => r.text.includes(w));
}

export function matchesFilters(r: Row, f: Pick<Filters, "kind" | "cats">): boolean {
  const t = r.txn;
  if (f.kind === "depenses" && (r.pair || t.amount >= 0)) return false;
  if (f.kind === "rentrees" && (r.pair || t.amount <= 0)) return false;
  if (f.kind === "fixes" && t.source !== "fixe" && t.source !== "dette") return false;
  if (f.cats && (r.pair || !f.cats.includes(catOf(t)))) return false;
  return true;
}

export const applyFilters = (rows: Row[], f: Filters): Row[] => rows.filter((r) => matchesFilters(r, f) && matchesSearch(r, f.q));

/** Regroupe par jour (dans l'ordre reçu), avec le net du jour ; un virement entre mes comptes compte 0. */
export function groupDays(rows: Row[]): Day[] {
  const days: Day[] = [];
  for (const r of rows) {
    let d = days[days.length - 1];
    if (!d || d.day !== r.date) days.push((d = { day: r.date, net: 0, rows: [] }));
    d.rows.push(r);
    if (!r.pair) d.net = round2(d.net + r.txn.amount);
  }
  return days;
}

/** Les jours entiers à montrer pour au moins `limit` lignes (on ne coupe jamais un jour). */
export function takeDays(days: Day[], limit: number): Day[] {
  const out: Day[] = [];
  let n = 0;
  for (const d of days) {
    if (n >= limit) break;
    out.push(d);
    n += d.rows.length;
  }
  return out;
}

const cap = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);
export function dayTitle(day: string, today: string): string {
  const d = parse(day);
  const long = `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]}${day.slice(0, 4) !== today.slice(0, 4) ? ` ${d.getFullYear()}` : ""}`;
  if (day === today) return `Aujourd’hui · ${long}`;
  if (day === addDays(today, -1)) return `Hier · ${long}`;
  if (day === addDays(today, 1)) return `Demain · ${long}`;
  return cap(long);
}

/* ---------- Modifier / supprimer ---------- */

const dismiss = (s: State, t: Txn): string[] => (t.refId ? [...new Set([...(s.dismissed ?? []), `${t.refId}|${t.date}`])] : s.dismissed);

/**
 * Une ligne venue de la banque ne se supprime pas : le prochain import la recréerait.
 * Un virement dont une des moitiés vient de la banque non plus.
 */
export function canDelete(s: State, t: Txn): boolean {
  if (t.status === "banque") return false;
  if (t.transferId && s.txns.some((x) => x.transferId === t.transferId && x.status === "banque")) return false;
  return true;
}

/**
 * Supprime une opération :
 * - une journée passe par skipDays (le jour n'est jamais recréé) ;
 * - une échéance de fixe ou de dette est mémorisée dans `dismissed` (jamais recréée), le fixe reste ;
 * - une moitié de virement emporte l'autre ;
 * - une ligne de la banque est refusée (état rendu tel quel).
 * Une échéance déplacée dans Activité a déjà laissé sa date d'origine dans `dismissed` (editTxn).
 */
export function deleteTxn(s: State, id: string): State {
  const t = s.txns.find((x) => x.id === id);
  if (!t || !canDelete(s, t)) return s;
  if (t.source === "journee") return skipDays(s, [t.date]);
  if (t.transferId) return { ...s, txns: s.txns.filter((x) => x.transferId !== t.transferId) };
  return { ...s, txns: s.txns.filter((x) => x.id !== id), dismissed: dismiss(s, t) };
}

export type Patch = { amount?: number; categoryId?: string; accountId?: string; date?: string; note?: string };

/** Ligne venue de la banque, ou virement dont une des moitiés vient de la banque. */
const fromBank = (s: State, t: Txn): boolean =>
  t.status === "banque" || (!!t.transferId && s.txns.some((x) => x.transferId === t.transferId && x.status === "banque"));

/**
 * Ce qui peut changer sur cette opération. Venue de la banque : montant, date et compte sont ceux de
 * l'extrait (seules la catégorie et la note changent). Une journée garde sa date.
 */
export function canEdit(s: State, t: Txn) {
  const bank = fromBank(s, t);
  return {
    amount: !bank,
    date: !bank && t.source !== "journee",
    account: !bank,
    category: !t.transferId,
  };
}

/**
 * Modifie une opération (pas un virement : voir editTransfer).
 * Le montant garde son sens ; montant, date et compte d'une ligne bancaire ne changent pas. La date d'une
 * journée ne change pas.
 * Une échéance déplacée laisse sa date d'origine dans `dismissed`. Une catégorie changée sur une ligne
 * bancaire est apprise (learnCategory) pour les prochains imports.
 */
export function editTxn(s: State, id: string, patch: Patch): State {
  const t = s.txns.find((x) => x.id === id);
  if (!t || t.transferId) return s;
  const can = canEdit(s, t);
  const next: Txn = { ...t };
  if (can.amount && patch.amount !== undefined) {
    const a = round2(Math.abs(patch.amount));
    if (a) next.amount = t.amount < 0 ? -a : a;
  }
  if (can.date && patch.date) next.date = patch.date;
  if (can.account && patch.accountId && s.accounts.some((a) => a.id === patch.accountId)) next.accountId = patch.accountId;
  if (patch.categoryId && s.categories.some((c) => c.id === patch.categoryId)) next.categoryId = patch.categoryId;
  if (patch.note !== undefined) {
    const n = patch.note.trim();
    if (n) next.note = n;
    else delete next.note;
  }
  let out: State = {
    ...s,
    txns: s.txns.map((x) => (x.id === id ? next : x)),
    dismissed: next.date !== t.date ? dismiss(s, t) : s.dismissed,
  };
  if (t.status === "banque" && next.categoryId && next.categoryId !== t.categoryId) {
    out = learnCategory(out, t.label, t.amount, next.categoryId);
  }
  return out;
}

/** Modifie un virement (les deux moitiés) : montant, comptes, date, note — seulement la note s'il vient de la banque. */
export function editTransfer(s: State, transferId: string, p: { amount?: number; fromId?: string; toId?: string; date?: string; note?: string }): State {
  const h = s.txns.filter((x) => x.transferId === transferId);
  if (h.length !== 2) return s;
  const from = h[0].amount <= h[1].amount ? h[0] : h[1];
  const bank = h.some((x) => x.status === "banque");
  const fromId = (!bank && p.fromId) || from.accountId;
  const toId = (!bank && p.toId) || (from === h[0] ? h[1] : h[0]).accountId;
  if (fromId === toId) return s;
  const a = !bank && p.amount ? round2(Math.abs(p.amount)) : Math.abs(from.amount);
  const note = p.note?.trim();
  return {
    ...s,
    txns: s.txns.map((x) => {
      if (x.transferId !== transferId) return x;
      const isFrom = x === from;
      const y: Txn = { ...x, accountId: isFrom ? fromId : toId, date: (!bank && p.date) || x.date };
      if (!bank) y.amount = isFrom ? -a : a;
      if (note !== undefined) {
        if (note) y.note = note;
        else delete y.note;
      }
      return y;
    }),
  };
}
