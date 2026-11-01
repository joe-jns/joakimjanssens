import { round2 } from "../money";
import type { PdfItem, Statement, StatementLine } from "./types";

// Extrait de compte CBC (PDF) : une opération = une ligne « n° date titre valeur montant »
// suivie de lignes de détail ; des lignes « Solde au … » encadrent chaque période.
const OP = /^(\d{3}) (\d{2})-(\d{2})-(\d{4})$/;
const SOLDE = /^Solde au \d{2}-\d{2}-\d{4}/;
const AMOUNT = /^(\d{1,3}(?:\.\d{3})*,\d{2}) ([+-])$/;
const IBAN_LINE = /^[A-Z]{2}\d{2}(?: [A-Z0-9]{1,4})+$/;
const DATE_TIME = /^(\d{2})-(\d{2})-(\d{4}) A \d{2}\.\d{2}/;
// Commerçant : « NOM VILLE » où le code postal est collé au pays (« BE0000 », « IEUNKNOWN »).
const MERCHANT = /^(.*?)\s+[A-Z]{2}(?:\d{3,6}|UNKNOWN)\s+\S/;
const BANKER = /^BANQUIER (?:DONNEUR D'ORDRE|BENEFICIAIRE):/;

const parseAmount = (s: string): number | null => {
  const m = AMOUNT.exec(s);
  if (!m) return null;
  const v = Number(m[1].replace(/\./g, "").replace(",", "."));
  return m[2] === "-" ? -v : v;
};
const titleCase = (s: string): string =>
  s.toLowerCase().replace(/(^|[\s\-/'(])(\p{L})/gu, (_, sep: string, c: string) => sep + c.toUpperCase());

type Row = { page: number; y: number; items: PdfItem[] };
type Op = { n: string; booked: string; value: string; title: string; amount: number; details: string[] };

// Date valeur « JJ-MM » : l'année est celle de la date comptable, sauf à cheval sur le Nouvel An.
function valueDate(raw: string, booked: string): string {
  const m = /^(\d{2})-(\d{2})$/.exec(raw);
  if (!m) return booked;
  let y = Number(booked.slice(0, 4));
  const bm = Number(booked.slice(5, 7));
  const vm = Number(m[2]);
  if (vm - bm > 6) y--;
  else if (bm - vm > 6) y++;
  return `${y}-${m[2]}-${m[1]}`;
}

// Empreinte courte et stable (FNV-1a 32 bits) du détail normalisé : casse et espaces ignorés.
function digest(details: string[]): string {
  const text = details.join(" ").toLowerCase().replace(/\s+/g, " ").trim();
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
  return (h >>> 0).toString(36);
}

function rows(items: PdfItem[]): Row[] {
  const out: Row[] = [];
  for (const it of items) {
    const last = out.at(-1);
    if (last && last.page === it.page && Math.abs(last.y - it.y) < 1.5) last.items.push(it);
    else out.push({ page: it.page, y: it.y, items: [it] });
  }
  return out;
}

function describe(op: Op): Pick<StatementLine, "label" | "counterparty" | "iban" | "date"> & { cash: boolean } {
  const d = op.details;
  const dt = d.map((s) => DATE_TIME.exec(s)).find(Boolean);
  const date = dt ? `${dt[3]}-${dt[2]}-${dt[1]}` : op.booked;
  if (/^RETRAIT D'ESP/.test(op.title)) return { label: "Retrait d'espèces", counterparty: "", iban: "", date, cash: true };
  if (/^VIREMENT/.test(op.title) || IBAN_LINE.test(d[0] ?? "")) {
    const iban = IBAN_LINE.test(d[0] ?? "") ? d[0].replace(/\s+/g, "") : "";
    const b = d.findIndex((s) => BANKER.test(s));
    const counterparty = (b >= 0 ? d[b + 1] : iban ? d[1] : d[0]) ?? "";
    const label = counterparty ? `${op.amount > 0 ? "Virement de" : "Virement à"} ${titleCase(counterparty)}` : titleCase(op.title);
    return { label, counterparty, iban, date: op.booked, cash: false };
  }
  if (/^PAIEMENT PAR/.test(op.title) && dt) {
    const line = d[d.findIndex((s) => DATE_TIME.test(s)) + 1] ?? "";
    const merchant = (MERCHANT.exec(line)?.[1] ?? line).trim();
    return { label: merchant ? titleCase(merchant) : titleCase(op.title), counterparty: "", iban: "", date, cash: false };
  }
  return { label: titleCase(op.title), counterparty: "", iban: "", date: op.booked, cash: false };
}

export function parseCbc(items: PdfItem[]): Statement | null {
  if (!items.some((i) => i.s === "Compte CBC" || /CREGBEBB/.test(i.s))) return null;
  const ibanItem = items.find((i) => /^IBAN [A-Z]{2}\d{2}/.test(i.s));
  const iban = ibanItem ? ibanItem.s.slice(5).replace(/\s*EUR$/, "").replace(/\s+/g, "") : "";
  const owner =
    items.find((i) => i.page === 1 && i.x < 80 && i.h >= 9.5 && i.s !== "Compte CBC" && /^[A-ZÀ-Ý' -]{3,}$/u.test(i.s))?.s ?? "";

  // Événements dans l'ordre de l'extrait : opérations et soldes.
  const events: ({ kind: "op"; op: Op } | { kind: "solde"; balance: number })[] = [];
  const headerY = new Map<number, number>();
  for (const it of items) if (it.s === "description" && it.h < 8.5) headerY.set(it.page, it.y);
  const warnings: string[] = [];
  let cur: Op | null = null;
  for (const row of rows(items)) {
    if (row.y < 80 || row.y >= (headerY.get(row.page) ?? 700) - 1) continue; // en-tête et pied de page
    const first = row.items[0];
    const amountOf = () => row.items.filter((i) => i.x >= 490).map((i) => parseAmount(i.s)).find((v) => v !== null) ?? null;
    const m = first.x < 80 && first.h >= 8.5 ? OP.exec(first.s) : null;
    if (m) {
      const amount = amountOf();
      const title = row.items.filter((i) => i.x >= 100 && i.x < 420).map((i) => i.s).join(" ");
      const booked = `${m[4]}-${m[3]}-${m[2]}`;
      const value = valueDate(row.items.find((i) => i.x >= 420 && i.x < 490)?.s ?? "", booked);
      cur = amount === null ? null : { n: m[1], booked, value, title, amount, details: [] };
      if (cur) events.push({ kind: "op", op: cur });
      else warnings.push(`Opération n° ${m[1]} du ${m[2]}-${m[3]}-${m[4]} ignorée : montant illisible`);
      continue;
    }
    const solde = row.items.find((i) => SOLDE.test(i.s));
    if (solde) {
      const balance = amountOf();
      if (balance !== null) events.push({ kind: "solde", balance });
      cur = null;
      continue;
    }
    if (!cur) continue;
    const text = row.items.filter((i) => i.x >= 100 && i.x < 420 && i.h >= 8.5).map((i) => i.s).join(" ");
    if (text) cur.details.push(text);
  }

  // Soldes : recalculés depuis le dernier « Solde au » ; une période qui ne retombe pas sur le
  // solde suivant (ou sans solde de clôture) perd ses soldes.
  const lines: StatementLine[] = [];
  const keyCount = new Map<string, number>();
  let running: number | null = null;
  let period: StatementLine[] = [];
  for (const ev of events) {
    if (ev.kind === "solde") {
      if (running !== null && round2(running) !== round2(ev.balance)) for (const l of period) l.balance = null;
      running = ev.balance;
      period = [];
      continue;
    }
    const { op } = ev;
    const { cash, ...desc } = describe(op);
    // Clé sans le n° d'opération (il change d'un extrait à l'autre) ; #2, #3… pour un doublon exact.
    const base = `cbc:${iban.slice(-4)}:${op.booked}|${op.value}|${op.amount}|${digest(op.details)}`;
    const k = (keyCount.get(base) ?? 0) + 1;
    keyCount.set(base, k);
    if (running !== null) running = round2(running + op.amount);
    const line: StatementLine = {
      key: k === 1 ? base : `${base}#${k}`, ...desc, amount: op.amount, section: "courant", balance: running,
    };
    if (cash) line.cash = true;
    lines.push(line);
    if (running !== null) period.push(line);
  }
  for (const l of period) l.balance = null;

  if (!lines.length) return null;
  const words = owner.trim().split(/\s+/);
  return { bank: "cbc", iban, owner, firstName: words.at(-1) ?? "", lines, warnings };
}
