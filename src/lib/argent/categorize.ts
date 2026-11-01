import type { State } from "./model";
import type { StatementLine } from "./import/types";

// Les noms courts (action, base, cora, ores…) ne comptent qu'en mot entier : « Transaction » n'est pas Action.
const RULES: [RegExp, string][] = [
  [/lukoil|\besso\b|\bshell\b|\btotal ?energies\b|\bq8\b|texaco|dats ?24|\bgabriels\b|octa\+|\bpower\b|makro fuel/, "carburant"],
  [/delhaize|intermarch|colruyt|\baldi\b|\blidl\b|carrefour|\bspar\b|\bcora\b|\bokay\b|\bmatch\b|albert heijn|\baction\b/, "courses"],
  [/mcdonald|\bquick\b|burger|\bkfc\b|pizza|\bresto\b|snack|friterie|uber ?eats|deliveroo|takeaway|starbucks|boulangerie/, "resto"],
  [/path[eé]|kinepolis|cin[eé]ma|bowling|\bsteam\b|playstation|xbox|nintendo|roblox|\bticket/, "sorties"],
  [/netflix|spotify|disney|apple\.com|\bgoogle\b|amazon prime|proximus|\borange\b|telenet|\bbase\b|\bvoo\b|scarlet|openai|anthropic|\bclaude\b/, "abonnements"],
  [/pharma|m[eé]decin|docteur|dentiste|h[oô]pital|mutuelle|solidaris|mutualit/, "sante"],
  [/loyer|\bengie\b|luminus|\beneco\b|\bswde\b|\bores\b|vivaqua/, "logement"],
];

// Contrepartie qui ressemble à une société (forme juridique).
const COMPANY = /\b(llc|srl|sprl|sa|nv|bv|sas|ltd|gmbh|scomm)\b/;

// Clé d'apprentissage : signe + libellé en minuscules, espaces simplifiés.
export const normLabel = (label: string, amount: number): string =>
  (amount > 0 ? "+" : "-") + label.toLowerCase().replace(/\s+/g, " ").trim();

// Libellé d'un mouvement vers ou depuis une poche / l'épargne (« To pocket… », « Pocket Withdrawal »,
// « To EUR Savings »…) : toujours entre mes comptes.
export const INTERNAL_LABEL = /pocket|savings|coffre/i;

// Un mouvement entre mes propres comptes n'a pas de catégorie.
function isInternal(line: StatementLine, state: State): boolean {
  if (line.section !== "courant" || line.cash) return true;
  if (INTERNAL_LABEL.test(line.label)) return true;
  return !!line.iban && state.accounts.some((a) => a.iban === line.iban);
}

export function guessCategory(line: StatementLine, state: State): string | undefined {
  const chosen = state.learned[normLabel(line.label, line.amount)];
  if (chosen) return chosen;
  if (isInternal(line, state)) return undefined;
  const d = `${line.label} ${line.counterparty}`.toLowerCase();
  if (line.amount > 0) {
    if (COMPANY.test(d) || /int[eé]rim|payroll|salaire|wages|onem|mutuelle/.test(d)) return "salaire";
    if (line.iban || /payment from|transfer from/.test(d)) return "proches-in";
    return "autres-in";
  }
  for (const [re, cat] of RULES) if (re.test(d)) return cat;
  if (line.iban && /^(to |virement à )/i.test(line.label) && !COMPANY.test(d)) return "proches-out";
  return "autres-out";
}

export function learnCategory(state: State, label: string, amount: number, categoryId: string): State {
  return { ...state, learned: { ...state.learned, [normLabel(label, amount)]: categoryId } };
}
