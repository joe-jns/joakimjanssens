import type { Every } from "./dates";

export type { Every };
export type AccountKind = "courant" | "epargne" | "liquide";
export type Account = {
  id: string;
  name: string;
  kind: AccountKind;
  bank?: "revolut" | "cbc";
  iban?: string;
  color: string;
  anchor?: { date: string; balance: number };
};
export type Category = { id: string; name: string; icon: string; color: string; kind: "out" | "in" };
export type TxnStatus = "manuel" | "prevu" | "banque";
export type TxnSource = "journee" | "fixe" | "dette" | "import" | "saisie";
export type Txn = {
  id: string;
  accountId: string;
  date: string;
  amount: number;
  label: string;
  categoryId?: string;
  status: TxnStatus;
  source: TxnSource;
  refId?: string;
  bankKey?: string;
  transferId?: string;
  note?: string;
};
export type Recurring = {
  id: string;
  label: string;
  amount: number;
  every: Every;
  first: string;
  accountId: string;
  categoryId?: string;
  since?: string;
};
export type Debt = {
  id: string;
  label: string;
  // Reste à rembourser à partir de `first` (l'échéancier part de là).
  total: number;
  amount: number;
  every: Every;
  first: string;
  accountId: string;
  since?: string;
  // Déjà remboursé avant `first` (saisi à la création, ou cumulé quand une modification relance l'échéancier).
  paid?: number;
};
export type Goal = {
  id: string;
  name: string;
  icon: string;
  color: string;
  target: number;
  date?: string;
  accountId: string;
};
export type Work = {
  dayAmount: number;
  start?: string;
  end?: string;
  skipped: string[];
  // Lundis (AAAA-MM-JJ) des semaines dont la paie est déjà arrivée de la banque.
  paidWeeks: string[];
  accountId?: string;
  payer: string;
};
export type State = {
  v: 2;
  accounts: Account[];
  categories: Category[];
  txns: Txn[];
  recurring: Recurring[];
  debts: Debt[];
  goals: Goal[];
  work: Work;
  learned: Record<string, string>;
  dismissed: string[];
  // Date (AAAA-MM-JJ) à partir de laquelle les lignes d'extrait sont importées ; avant : ignorées.
  importFrom?: string;
};

// Couleurs du design validé : comptes CBC rose vif, Revolut encre, épargne et liquide neutres ;
// catégories sur les 8 teintes fixes de la palette (comme la maquette : Proches violet, Carburant orange,
// Sorties bleu, Courses vert, Resto jaune…), « Autres » en gris.
export function emptyState(): State {
  return {
    v: 2,
    accounts: [
      { id: "cbc", name: "CBC", kind: "courant", bank: "cbc", color: "#D9447F" },
      { id: "revolut", name: "Revolut", kind: "courant", bank: "revolut", color: "#151314" },
      { id: "revolut-epargne", name: "Revolut épargne", kind: "epargne", bank: "revolut", color: "#75706E" },
      { id: "liquide", name: "Liquide", kind: "liquide", color: "#C9C2BF" },
    ],
    categories: [
      { id: "courses", name: "Courses", icon: "shopping-basket", color: "#1BAF7A", kind: "out" },
      { id: "carburant", name: "Carburant", icon: "fuel", color: "#EB6834", kind: "out" },
      { id: "resto", name: "Resto & snacks", icon: "utensils", color: "#EDA100", kind: "out" },
      { id: "sorties", name: "Sorties", icon: "party-popper", color: "#2A78D6", kind: "out" },
      { id: "abonnements", name: "Abonnements", icon: "repeat", color: "#7FB0EA", kind: "out" },
      { id: "sante", name: "Santé", icon: "heart-pulse", color: "#E34948", kind: "out" },
      { id: "logement", name: "Logement", icon: "house", color: "#008300", kind: "out" },
      { id: "proches-out", name: "Proches", icon: "users", color: "#6E5BD0", kind: "out" },
      { id: "autres-out", name: "Autres", icon: "ellipsis", color: "#A39D9A", kind: "out" },
      { id: "salaire", name: "Salaire", icon: "briefcase", color: "#14935F", kind: "in" },
      { id: "proches-in", name: "Proches", icon: "users", color: "#6E5BD0", kind: "in" },
      { id: "autres-in", name: "Autres rentrées", icon: "plus", color: "#A39D9A", kind: "in" },
    ],
    txns: [],
    recurring: [],
    debts: [],
    goals: [],
    work: { dayAmount: 100, skipped: [], paidWeeks: [], payer: "" },
    learned: {},
    dismissed: [],
  };
}
