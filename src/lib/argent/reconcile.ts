import { guessCategory, INTERNAL_LABEL } from "./categorize";
import { addDays, isWorkday, parse } from "./dates";
import type { Statement, StatementLine } from "./import/types";
import type { Account, State, Txn } from "./model";
import { round2 } from "./money";

export type ReconcileReport = { added: number; linked: number; replacedDays: number; already: number; skipped: number };

const BANK_NAME: Record<Statement["bank"], string> = { revolut: "Revolut", cbc: "CBC" };
const cleanIban = (s?: string): string => (s ?? "").replace(/\s+/g, "").toUpperCase();
const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const mondayOf =(day: string): string => addDays(day, -((parse(day).getDay() + 6) % 7));
const dayGap = (a: string, b: string): number => Math.abs(Math.round((parse(a).getTime() - parse(b).getTime()) / 864e5));

// Fusionne un extrait bancaire dans l'état sans compter deux fois. Fonction pure.
export function reconcile(state: State, st: Statement): { state: State; report: ReconcileReport } {
  const report: ReconcileReport = { added: 0, linked: 0, replacedDays: 0, already: 0, skipped: 0 };
  const accounts: Account[] = state.accounts.map((a) => ({ ...a }));
  let txns: Txn[] = state.txns.slice();
  const paidWeeks = new Set(state.work.paidWeeks);

  // 1. Comptes cibles : courant (par IBAN, sinon celui de la banque) et épargne de la banque.
  const stIban = cleanIban(st.iban);
  let courant =
    (stIban && accounts.find((a) => cleanIban(a.iban) === stIban)) ||
    accounts.find((a) => a.bank === st.bank && a.kind === "courant");
  if (!courant) {
    courant = { id: st.bank, name: BANK_NAME[st.bank], kind: "courant", bank: st.bank, color: "#7b8794" };
    accounts.push(courant);
  }
  if (!courant.iban && stIban) courant.iban = stIban;
  const courantAcc = courant;
  let epargneAcc: Account | undefined;
  const accountFor = (line: StatementLine): Account => {
    if (line.section === "courant") return courantAcc;
    epargneAcc ??= accounts.find((a) => a.bank === st.bank && a.kind === "epargne");
    if (!epargneAcc) {
      epargneAcc = { id: `${st.bank}-epargne`, name: `${BANK_NAME[st.bank]} épargne`, kind: "epargne", bank: st.bank, color: "#2c9a7a" };
      accounts.push(epargneAcc);
    }
    return epargneAcc;
  };

  // Clés déjà présentes avant cet import ; une clé répétée dans l'extrait reçoit un suffixe #2, #3…
  const known = new Set(txns.map((t) => t.bankKey).filter(Boolean));
  const keyCount = new Map<string, number>();
  const dismissed = new Set(state.dismissed ?? []);
  const ownIbans = new Set(accounts.map((a) => cleanIban(a.iban)).filter(Boolean));
  // Mon nom : prénom ET nom de famille, mots entiers, dans n'importe quel ordre. Le nom de famille est le mot
  // du titulaire à l'autre bout que le prénom (Revolut « PRÉNOM … NOM », CBC « NOM PRÉNOM ») ; les prénoms
  // du milieu ne comptent pas. Un parent (même nom) ou un ami (même prénom) n'est donc pas « moi ».
  const ownerWords = st.owner.trim().split(/\s+/).filter(Boolean);
  const first = st.firstName.trim();
  const same = (a = "", b = "") => a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
  const family =
    ownerWords.length < 2 ? "" :
    same(ownerWords[0], first) ? ownerWords.at(-1)! :
    same(ownerWords.at(-1), first) ? ownerWords[0] :
    st.bank === "cbc" ? ownerWords[0] : ownerWords.at(-1)!;
  const ownWords = [...new Set([first, family].filter((w) => w.length > 1))];
  const nameRes = ownWords.map((w) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(w)}($|[^\\p{L}\\p{N}])`, "iu"));
  const payer = state.work.payer.trim().toLowerCase();
  const isInternal = (line: StatementLine): boolean =>
    line.section !== "courant" ||
    INTERNAL_LABEL.test(line.label) ||
    (!!line.iban && ownIbans.has(cleanIban(line.iban))) ||
    (nameRes.length > 0 && nameRes.every((re) => re.test(line.counterparty)));

  // Dernière ligne à solde connu, par compte puis par section, et date la plus récente vue.
  // CBC : l'ordre de l'extrait fait foi (une carte porte sa date d'achat, parfois plus ancienne).
  const lastBySection = new Map<string, Map<StatementLine["section"], StatementLine>>();
  const maxDate = new Map<string, string>();
  const liquideAcc = (): Account => {
    let acc = accounts.find((a) => a.kind === "liquide");
    if (!acc) {
      acc = { id: "liquide", name: "Liquide", kind: "liquide", color: "#C9C2BF" };
      accounts.push(acc);
    }
    return acc;
  };
  // Retrait : crédite « liquide » de +X. Une saisie manuelle +X sur liquide (±4 jours, pas encore
  // reliée) est réutilisée plutôt que doublée. Rend le transferId commun aux deux moitiés.
  const creditCash = (date: string, x: number, label: string): string => {
    const liq = liquideAcc();
    const transferId = crypto.randomUUID();
    let mi = -1;
    let gap = Infinity;
    txns.forEach((t, i) => {
      if (t.accountId !== liq.id || t.bankKey || t.transferId || t.source === "journee" || round2(t.amount) !== x) return;
      const d = dayGap(t.date, date);
      if (d <= 4 && d < gap) {
        mi = i;
        gap = d;
      }
    });
    if (mi >= 0) {
      const { categoryId: _drop, ...rest } = txns[mi];
      txns[mi] = { ...rest, transferId };
    } else {
      txns.push({
        id: crypto.randomUUID(), accountId: liq.id, date, amount: x, label, status: "banque", source: "import", transferId,
      });
    }
    return transferId;
  };

  for (const line of st.lines) {
    const acc = accountFor(line);
    if (line.balance !== null) {
      const bySection = lastBySection.get(acc.id) ?? new Map();
      lastBySection.set(acc.id, bySection);
      const prev = bySection.get(line.section);
      if (!prev || st.bank === "cbc" || line.date >= prev.date) bySection.set(line.section, line);
      const md = maxDate.get(acc.id);
      if (!md || line.date > md) maxDate.set(acc.id, line.date);
    }

    const seenTimes = (keyCount.get(line.key) ?? 0) + 1;
    keyCount.set(line.key, seenTimes);
    const key = seenTimes === 1 ? line.key : `${line.key}#${seenTimes}`;

    // 1b. Avant la date de début d'import : ignorée (l'ancre, elle, reste appliquée).
    if (state.importFrom && line.date < state.importFrom) {
      report.skipped++;
      continue;
    }

    // 2. Déjà importée (lors d'un import précédent).
    if (known.has(key)) {
      report.already++;
      continue;
    }
    const amount = round2(line.amount);
    const base: Txn = {
      id: crypto.randomUUID(), accountId: acc.id, date: line.date, amount, label: line.label,
      status: "banque", source: "import", bankKey: key,
    };

    // 3. Paie : remplace les journées de la semaine précédente.
    const text = `${line.label} ${line.counterparty}`.toLowerCase();
    if (amount > 0 && payer && text.includes(payer)) {
      const monday = addDays(mondayOf(line.date), -7);
      const days = new Set([0, 1, 2, 3, 4].map((i) => addDays(monday, i)).filter(isWorkday));
      const before = txns.length;
      txns = txns.filter((t) => !(t.source === "journee" && days.has(t.date)));
      report.replacedDays += before - txns.length;
      paidWeeks.add(monday);
      txns.push({ ...base, categoryId: "salaire" });
      report.added++;
      continue;
    }

    // 4. Relier à une saisie proche (même compte, même signe, montant et date voisins).
    const tol = Math.max(1, Math.abs(amount) * 0.05);
    let best = -1;
    let bestScore: [number, number] = [Infinity, Infinity];
    txns.forEach((t, i) => {
      if (t.status === "banque" || t.bankKey || t.source === "journee" || t.accountId !== acc.id) return;
      if (Math.sign(t.amount) !== Math.sign(amount)) return;
      const da = Math.abs(t.amount - amount);
      const dd = dayGap(t.date, line.date);
      if (da > tol + 1e-9 || dd > 4) return;
      if (dd < bestScore[0] || (dd === bestScore[0] && da < bestScore[1])) {
        best = i;
        bestScore = [dd, da];
      }
    });
    if (best >= 0) {
      const old = txns[best];
      // Une échéance déplacée ne doit pas être recréée à sa date d'origine.
      if (old.refId && old.date !== line.date) dismissed.add(`${old.refId}|${old.date}`);
      txns[best] = { ...old, amount, date: line.date, bankKey: key, status: "banque" };
      // Retrait relié à une dépense saisie à la main : ce n'est pas une dépense, l'argent va sur « liquide ».
      if (line.cash && amount < 0 && !old.transferId) {
        const { categoryId: _drop, ...rest } = txns[best];
        txns[best] = { ...rest, transferId: creditCash(line.date, -amount, line.label) };
      }
      report.linked++;
      continue;
    }

    // 5. Ajouter ; un mouvement entre mes comptes partage son transferId avec la ligne miroir.
    const txn: Txn = { ...base };
    // Retrait d'espèces : virement interne vers le compte « liquide ».
    if (line.cash && amount < 0) {
      txn.transferId = creditCash(line.date, -amount, line.label);
      txns.push(txn);
      report.added++;
      continue;
    }
    const internal = isInternal(line);
    // Un mouvement entre mes comptes n'a pas de catégorie.
    const categoryId = internal ? undefined : guessCategory(line, { ...state, accounts });
    if (categoryId) txn.categoryId = categoryId;
    if (internal) {
      // Ligne miroir : autre compte, montant opposé, à 2 jours près (la plus proche), et elle-même interne :
      // une ligne interne reçoit toujours un transferId, on cherche donc une moitié encore seule.
      let mi = -1;
      let gap = Infinity;
      txns.forEach((t, i) => {
        if (t.accountId === acc.id || round2(t.amount) !== round2(-amount)) return;
        if (!t.transferId || txns.some((u) => u !== t && u.transferId === t.transferId)) return;
        const d = dayGap(t.date, line.date);
        if (d <= 2 && d < gap) {
          mi = i;
          gap = d;
        }
      });
      txn.transferId = mi >= 0 ? txns[mi].transferId : crypto.randomUUID();
    }
    txns.push(txn);
    report.added++;
  }

  // 7. Ancres : somme des derniers soldes des sections du compte, datée de la plus récente.
  for (const acc of accounts) {
    const bySection = lastBySection.get(acc.id);
    if (!bySection?.size) continue;
    const date = maxDate.get(acc.id) ?? "";
    let balance = 0;
    for (const l of bySection.values()) balance += l.balance ?? 0;
    if (!acc.anchor || date > acc.anchor.date) acc.anchor = { date, balance: round2(balance) };
  }

  return {
    state: { ...state, accounts, txns, work: { ...state.work, paidWeeks: [...paidWeeks] }, dismissed: [...dismissed] },
    report,
  };
}
