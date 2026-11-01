import type { PdfItem, Statement, StatementLine } from "./types";

const MONTHS: Record<string, number> = {
  Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
};
const DATE = /^([A-Z][a-z]{2}) (\d{1,2}), (\d{4})$/;
const euros = (s: string) => Number(s.replace(/[€,\s]/g, ""));

type Cur = StatementLine & { id: string; page: number; y: number };

export function parseRevolut(items: PdfItem[]): Statement | null {
  if (!items.some((i) => /Revolut/.test(i.s))) return null;
  const iban = items.find((i) => i.page === 1 && /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(i.s))?.s ?? "";
  const owner = items.find((i) => i.page === 1 && i.h > 11 && i.x < 60 && /^[A-ZÀ-Ý' -]{5,}$/.test(i.s))?.s ?? "";
  const txs: Cur[] = [];
  let section: StatementLine["section"] | null = null;
  let cur: Cur | null = null;
  let outX = 335;
  let inX = 417;
  for (const it of items) {
    if (it.h > 11 && /transactions from/.test(it.s)) {
      section = /^Account/.test(it.s) ? "courant" : /Pocket/.test(it.s) ? "poche" : "epargne";
      cur = null;
      continue;
    }
    if (it.s === "Money out") outX = it.x;
    if (it.s === "Money in") inX = it.x;
    const m = it.x < 80 && it.h > 7 ? DATE.exec(it.s) : null;
    if (m && section) {
      const date = `${m[3]}-${String(MONTHS[m[1]]).padStart(2, "0")}-${m[2].padStart(2, "0")}`;
      cur = { key: "", id: "", section, date, label: "", amount: 0, balance: null, counterparty: "", iban: "", page: it.page, y: it.y };
      txs.push(cur);
      continue;
    }
    if (!cur || it.page !== cur.page || it.y < 110) continue;
    const sameRow = Math.abs(it.y - cur.y) < 1.5;
    if (sameRow && it.h > 7) {
      if (it.x >= 150 && it.x < outX - 5) cur.label += (cur.label ? " " : "") + it.s;
      else if (it.s.startsWith("€")) {
        if (it.x > inX + 60) cur.balance = euros(it.s);
        else cur.amount = it.x < (outX + inX) / 2 ? -euros(it.s) : euros(it.s);
      }
    } else if (it.y < cur.y && it.x >= 150 && it.x < outX - 5) {
      if (it.h > 7) cur.label += " " + it.s; // libellé sur deux lignes
      else if (it.h < 6) {
        const d = /^(Transaction Id|From|To): (.*)$/.exec(it.s);
        if (d?.[1] === "Transaction Id") cur.id = d[2];
        else if (d) {
          const [name, account] = d[2].split(/,\s*(?=[A-Z]{2}\d{2}[A-Z0-9]{10,})/);
          cur.counterparty = name.trim();
          cur.iban = account?.trim() ?? "";
        }
      }
    }
  }
  const lines = txs
    .filter((t) => t.label && t.amount)
    .map(({ id, page, y, ...t }) => ({
      ...t,
      key: `revolut:${t.section}:${id || `${t.date}|${t.label}|${t.amount}|${t.balance}`}`,
    }));
  return { bank: "revolut", iban, owner, firstName: owner.trim().split(/\s+/)[0] ?? "", lines };
}
