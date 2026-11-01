// Règles pures de l'écran Comptes, de l'import d'extraits et des réglages (testées à part).
import { accountBalance } from "../../../lib/argent/balance";
import { addDays, iso, parse } from "../../../lib/argent/dates";
import { parseCbc } from "../../../lib/argent/import/cbc";
import { parseRevolut } from "../../../lib/argent/import/revolut";
import type { PdfItem, Statement } from "../../../lib/argent/import/types";
import { emptyState, type Account, type AccountKind, type State, type Txn } from "../../../lib/argent/model";
import { round2 } from "../../../lib/argent/money";
import { reconcile, type ReconcileReport } from "../../../lib/argent/reconcile";
import { dayLong } from "./plan-logic";

/* ---------- Comptes ---------- */
export const KIND_LABEL: Record<AccountKind, string> = { courant: "Compte courant", epargne: "Épargne", liquide: "Liquide" };
const KIND_COLOR: Record<AccountKind, string> = { courant: "#151314", epargne: "#75706E", liquide: "#C9C2BF" };

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "compte";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

export function addAccount(s: State, name: string, kind: AccountKind): State {
  const n = name.trim().slice(0, 30);
  if (!n) return s;
  const id = slug(n, new Set(s.accounts.map((a) => a.id)));
  const acc: Account = { id, name: n, kind, color: KIND_COLOR[kind] };
  return { ...s, accounts: [...s.accounts, acc] };
}

export function renameAccount(s: State, id: string, name: string): State {
  const n = name.trim().slice(0, 30);
  if (!n) return s;
  return { ...s, accounts: s.accounts.map((a) => (a.id === id ? { ...a, name: n } : a)) };
}

/**
 * Soldes de fin de journée sur le dernier mois glissant (30 jours jusqu'à aujourd'hui inclus) : la petite courbe
 * a toujours de quoi se dessiner, même le 1er du mois.
 */
export function monthSpark(s: State, accountId: string, today: string, days = 30): number[] {
  const out: number[] = [];
  for (let d = addDays(today, 1 - days); d <= today; d = addDays(d, 1)) out.push(accountBalance(s, accountId, d));
  return out;
}

/** Chemin SVG (viewBox 0 0 w h) d'une série ; plate au milieu si tout est égal. */
export function sparkPath(values: number[], w: number, h: number): string {
  if (!values.length) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const step = values.length > 1 ? w / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const y = span ? h - 2 - ((v - min) / span) * (h - 4) : h / 2;
      return `${i ? "L" : "M"}${(i * step).toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");
}

export const anchorText = (a: Account): string =>
  a.anchor ? `Calé sur l’extrait du ${dayLong(a.anchor.date)}` : a.bank ? "Pas encore d’extrait importé" : "Tenu à la main";

/** Compte calé sur un extrait : son solde se corrige en réimportant, pas à la main. */
export const anchoredFixText = (a: Account): string =>
  a.anchor ? `Calé sur l’extrait du ${dayLong(a.anchor.date)} : réimporte un extrait pour le mettre à jour.` : "";

export const CORRECTION_LABEL = "Correction du solde";

/**
 * « Corriger le solde » d'un compte sans extrait (liquide, épargne tenue à la main) : `real` = ce qu'il y a vraiment
 * ce soir. Ajoute une seule opération datée d'aujourd'hui pour l'écart, marquée `correction` : elle change le solde
 * et rien d'autre (ni dans Activité, ni dans les dépenses ou les rentrées). Écart nul, compte
 * calé sur un extrait, compte inconnu ou montant illisible : état inchangé.
 */
export function correctBalance(s: State, accountId: string, real: number, today: string): State {
  const acc = s.accounts.find((a) => a.id === accountId);
  if (!acc || acc.anchor || !Number.isFinite(real)) return s;
  const diff = round2(real - accountBalance(s, accountId, today));
  if (!diff) return s;
  const txn: Txn = {
    id: crypto.randomUUID(), accountId, date: today, amount: diff, label: CORRECTION_LABEL,
    status: "manuel", source: "saisie", correction: true,
  };
  return { ...s, txns: [...s.txns, txn] };
}

/* ---------- Import d'extraits ---------- */
/**
 * Essaie Revolut puis CBC. Un extrait CBC peut citer « Revolut » (virement vers Revolut) : on garde
 * la lecture qui trouve des opérations, et Revolut seulement s'il en trouve.
 */
export function parseStatement(items: PdfItem[]): Statement | null {
  const rev = parseRevolut(items);
  if (rev && rev.lines.length) return rev;
  const cbc = parseCbc(items);
  if (cbc) return cbc;
  return rev;
}

export const BANK_LABEL: Record<Statement["bank"], string> = { revolut: "Revolut", cbc: "CBC" };

export type ImportOutcome =
  | { ok: true; state: State; bank: string; report: ReconcileReport; text: string; anchors: { name: string; date: string; balance: number }[]; warnings: string[] }
  | { ok: false; text: string };

export const PAY_NOT_RECOGNIZED = "Ta paie n’est pas reconnue : indique le nom de ton employeur dans Planning › Paie : les semaines déjà payées se corrigent toutes seules.";

/**
 * Paie à la journée réglée mais sans nom d'employeur : la vraie paie de l'extrait ne remplace pas les journées
 * estimées (comptées deux fois). On la soupçonne si une même contrepartie verse de l'argent sur au moins deux jeudis
 * différents, ou si un libellé de rentrée parle de « semaine ».
 */
export function payNotRecognized(s: State, st: Statement): boolean {
  if (!s.work.start || s.work.payer.trim()) return false;
  const thursdays = new Map<string, Set<string>>();
  for (const l of st.lines) {
    if (l.amount <= 0 || l.section !== "courant" || l.cash) continue;
    if (/semaine/i.test(`${l.label} ${l.counterparty}`)) return true;
    const who = l.counterparty.trim().toLowerCase();
    if (!who || parse(l.date).getDay() !== 4) continue;
    const days = thursdays.get(who) ?? new Set<string>();
    days.add(l.date);
    thursdays.set(who, days);
    if (days.size >= 2) return true;
  }
  return false;
}

export const UNKNOWN_FILE = "Ce fichier n’est pas un extrait Revolut ou CBC reconnu. Rien n’a été changé.";
export const FAILED_FILE = "Ce fichier n’a pas pu être traité. Rien n’a été changé.";

/**
 * Lecture + rapprochement d'un extrait déjà lu (items PDF), sans toucher au stockage : l'appelant enregistre
 * `state` seulement si ok. Toute erreur (lecteur ou rapprochement) donne un échec propre, l'état reste intact.
 */
export function importItems(s: State, items: PdfItem[]): ImportOutcome {
  try {
    const st = parseStatement(items);
    if (!st) return { ok: false, text: UNKNOWN_FILE };
    const { state, report } = reconcile(s, st);
    return {
      ok: true,
      state,
      bank: BANK_LABEL[st.bank],
      report,
      text: reportText(report, s.importFrom),
      anchors: movedAnchors(s, state),
      warnings: [...(st.warnings ?? []), ...(payNotRecognized(s, st) ? [PAY_NOT_RECOGNIZED] : [])],
    };
  } catch (e) {
    console.error(e);
    return { ok: false, text: FAILED_FILE };
  }
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`;

/** « 3 ajoutées · 1 reliée · 5 journées remplacées · 2 déjà là · 23 ignorées avant le 5 octobre 2026 ». */
export function reportText(r: ReconcileReport, importFrom?: string): string {
  const parts: string[] = [];
  if (r.added) parts.push(plural(r.added, "ajoutée", "ajoutées"));
  if (r.linked) parts.push(plural(r.linked, "reliée", "reliées"));
  if (r.replacedDays) parts.push(plural(r.replacedDays, "journée remplacée", "journées remplacées"));
  if (r.already) parts.push(`${r.already} déjà là`);
  if (r.skipped) parts.push(`${plural(r.skipped, "ignorée", "ignorées")}${importFrom ? ` avant le ${dayLong(importFrom)}` : ""}`);
  if (!parts.length) return "Aucune opération dans cet extrait";
  if (!r.added && !r.linked && !r.replacedDays) parts.unshift("Rien de nouveau");
  return parts.join(" · ");
}

export function sumReports(list: ReconcileReport[]): ReconcileReport {
  const t: ReconcileReport = { added: 0, linked: 0, replacedDays: 0, already: 0, skipped: 0 };
  for (const r of list) for (const k of Object.keys(t) as (keyof ReconcileReport)[]) t[k] += r[k];
  return t;
}

/** Comptes dont le solde a été recalé par l'import (ancre nouvelle ou plus récente). */
export function movedAnchors(before: State, after: State): { name: string; date: string; balance: number }[] {
  const out: { name: string; date: string; balance: number }[] = [];
  for (const a of after.accounts) {
    if (!a.anchor) continue;
    const old = before.accounts.find((b) => b.id === a.id)?.anchor;
    if (!old || old.date !== a.anchor.date || old.balance !== a.anchor.balance) out.push({ name: a.name, ...a.anchor });
  }
  return out;
}

/** Date de début d'import : vide = aucune limite. */
export function setImportFrom(s: State, date: string): State {
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return s;
  if (!date) {
    const { importFrom: _drop, ...rest } = s;
    return rest as State;
  }
  return { ...s, importFrom: date };
}

/* ---------- Sauvegarde JSON ---------- */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Taille maximale d'une sauvegarde lue (5 Mo). */
export const BACKUP_MAX = 5 * 1024 * 1024;
export const backupName = (now: Date) => `argent-sauvegarde-${iso(now)}.json`;

/** Lit une sauvegarde ; rend l'état complet (champs manquants par défaut) ou un message d'erreur. */
export function parseBackup(text: string): { state: State } | { error: string } {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    return { error: "Ce fichier n’est pas une sauvegarde lisible (JSON invalide)." };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.v !== 2 || !Array.isArray(raw.accounts) || !Array.isArray(raw.txns)) {
    return { error: "Ce fichier n’est pas une sauvegarde de l’appli Argent." };
  }
  const base = emptyState();
  const out: any = { ...base, ...raw };
  for (const k of Object.keys(base) as (keyof State)[]) if (Array.isArray(base[k]) && !Array.isArray(out[k])) out[k] = base[k];
  const w = raw.work && typeof raw.work === "object" && !Array.isArray(raw.work) ? raw.work : {};
  out.work = { ...base.work, ...w };
  for (const k of Object.keys(base.work) as (keyof State["work"])[]) if (Array.isArray(base.work[k]) && !Array.isArray(out.work[k])) out.work[k] = base.work[k];
  if (!out.learned || typeof out.learned !== "object" || Array.isArray(out.learned)) out.learned = {};
  if (typeof out.importFrom !== "string" || !DAY.test(out.importFrom)) delete out.importFrom;
  const named = (x: any) => !!x && typeof x === "object" && typeof x.id === "string" && !!x.id && typeof x.name === "string";
  if (!out.accounts.length) return { error: "Sauvegarde abîmée : aucun compte." };
  if (!out.accounts.every(named)) return { error: "Sauvegarde abîmée : un compte est illisible." };
  if (!out.categories.every(named)) return { error: "Sauvegarde abîmée : une catégorie est illisible." };
  const badTxn = out.txns.findIndex(
    (t: any) =>
      !t || typeof t !== "object" || typeof t.id !== "string" || typeof t.accountId !== "string" ||
      typeof t.date !== "string" || !DAY.test(t.date) || typeof t.amount !== "number" || !Number.isFinite(t.amount),
  );
  if (badTxn >= 0) return { error: `Sauvegarde abîmée : l’opération n° ${badTxn + 1} est illisible. Rien n’a été changé.` };
  return { state: out as State };
}
