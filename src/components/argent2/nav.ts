// Navigation de l'appli : onglet courant, feuille ouverte, recherche. Partagé par la coquille et les écrans.
import { signal } from "@preact/signals";

export type Tab = "accueil" | "activite" | "planning" | "comptes";
export const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: "accueil", label: "Accueil", icon: "house" },
  { id: "activite", label: "Activité", icon: "arrow-left-right" },
  { id: "planning", label: "Planning", icon: "calendar" },
  { id: "comptes", label: "Comptes", icon: "landmark" },
];

export type SheetName = "add" | "import" | "settings" | "categories";

export const tab = signal<Tab>("accueil");
export const sheet = signal<SheetName | null>(null);
export const query = signal("");
/**
 * Filtre de catégories posé depuis l'accueil (barre segmentée des dépenses) pour l'écran Activité.
 * - null : aucun filtre, tout est montré ;
 * - [id] : une seule catégorie ;
 * - [id, id, …] : plusieurs catégories (le segment « Autres » qui regroupe les petites).
 * Activité montre les opérations dont `categoryId` est dans la liste (sans catégorie = "autres-out"),
 * et remet le signal à null quand on retire le filtre.
 */
export const categoryFilter = signal<string[] | null>(null);

export function go(t: Tab): void {
  if (tab.value === t) return;
  tab.value = t;
  globalThis.scrollTo?.({ top: 0 });
}
export const openSheet = (s: SheetName) => (sheet.value = s);
export const closeSheet = () => (sheet.value = null);

/** Opération ouverte dans Activité (id ; pour un virement, l'id d'une de ses moitiés). */
export const txnId = signal<string | null>(null);

/**
 * Feuille du Planning ouverte (rendue par App, au niveau des autres feuilles) :
 * paie, fixe, dette, objectif (sans id : création) ou « mettre de côté » pour un objectif.
 */
export type PlanSheet =
  | { kind: "pay" }
  | { kind: "recurring"; id?: string }
  | { kind: "debt"; id?: string }
  | { kind: "goal"; id?: string }
  | { kind: "aside"; id: string };
export const planSheet = signal<PlanSheet | null>(null);
/** Dernière feuille ouverte et son numéro d'ouverture : gardée pendant l'animation de fermeture, clé du formulaire. */
export const lastPlanSheet = signal<{ p: PlanSheet; n: number } | null>(null);
export function openPlanSheet(p: PlanSheet): void {
  lastPlanSheet.value = { p, n: (lastPlanSheet.value?.n ?? 0) + 1 };
  planSheet.value = p;
}

/**
 * Feuille d'ajout pré-réglée (actions Virement / Épargner des comptes) ; null = saisie ordinaire.
 * Lue à l'ouverture de la feuille, remise à null à sa fermeture.
 */
export type AddPreset = { kind: "transfer"; fromAccountId?: string; toAccountId?: string };
export const addPreset = signal<AddPreset | null>(null);

/** Feuille compte : `id` = renommer ce compte ; sans id = ajouter un compte. */
export const accountSheet = signal<{ id?: string } | null>(null);
