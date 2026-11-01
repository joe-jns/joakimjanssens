export type PdfItem = { page: number; x: number; y: number; h: number; s: string };
export type StatementLine = {
  key: string;
  date: string;
  amount: number;
  label: string;
  counterparty: string;
  iban: string;
  section: "courant" | "poche" | "epargne";
  balance: number | null;
  // Retrait d'espèces : l'argent passe sur le compte « liquide », ce n'est pas une dépense.
  cash?: boolean;
};
export type Statement = {
  bank: "revolut" | "cbc";
  iban: string;
  owner: string;
  // Prénom du titulaire (Revolut : premier mot ; CBC écrit NOM puis prénom : dernier mot).
  firstName: string;
  lines: StatementLine[];
  // Problèmes de lecture à montrer (ex. opération sautée car montant illisible).
  warnings?: string[];
};
