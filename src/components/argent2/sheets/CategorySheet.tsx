// Catégories : créer, renommer, supprimer ; choisir une icône lucide et une couleur de la palette validée.
import { useState } from "preact/hooks";
import type { Category, State } from "../../../lib/argent/model";
import { state, update } from "../../../lib/argent/store";
import { CATEGORY_ICONS, Icon } from "../ui/Icon";
import { CATEGORY_COLORS } from "./palette";
import { CARD, onColor, readableOn } from "../../../lib/argent/color";

export { CATEGORY_COLORS };

const FALLBACK = { out: "autres-out", in: "autres-in" } as const;
const PROTECTED = new Set<string>(Object.values(FALLBACK));

type Draft = { id?: string; name: string; icon: string; color: string; kind: "out" | "in" };

function slug(name: string, taken: Set<string>): string {
  const base =
    name
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "categorie";
  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}

/** Retire une catégorie ; ses opérations, fixes et règles apprises passent dans « Autres » du même sens. */
export function deleteCategory(s: State, id: string): State {
  const cat = s.categories.find((c) => c.id === id);
  if (!cat || PROTECTED.has(id)) return s;
  const to = FALLBACK[cat.kind];
  const learned = Object.fromEntries(Object.entries(s.learned).map(([k, v]) => [k, v === id ? to : v]));
  return {
    ...s,
    categories: s.categories.filter((c) => c.id !== id),
    txns: s.txns.map((t) => (t.categoryId === id ? { ...t, categoryId: to } : t)),
    recurring: s.recurring.map((r) => (r.categoryId === id ? { ...r, categoryId: to } : r)),
    learned,
  };
}

function saveCategory(s: State, d: Draft): State {
  const name = d.name.trim();
  if (d.id) return { ...s, categories: s.categories.map((c) => (c.id === d.id ? { ...c, name, icon: d.icon, color: d.color } : c)) };
  const id = slug(name, new Set(s.categories.map((c) => c.id)));
  const cat: Category = { id, name, icon: d.icon, color: d.color, kind: d.kind };
  // Nouvelle catégorie avant « Autres » de son sens.
  const i = s.categories.findIndex((c) => c.id === FALLBACK[d.kind]);
  const categories = [...s.categories];
  categories.splice(i < 0 ? categories.length : i, 0, cat);
  return { ...s, categories };
}

/** Message d'erreur si le nom est vide ou déjà pris par une autre catégorie du même sens. */
export function nameError(s: State, d: { id?: string; name: string; kind: "out" | "in" }): string | null {
  const name = d.name.trim().toLocaleLowerCase("fr");
  if (!name) return "Donne un nom à la catégorie.";
  const twin = s.categories.find((c) => c.id !== d.id && c.kind === d.kind && c.name.trim().toLocaleLowerCase("fr") === name);
  return twin ? `« ${twin.name} » existe déjà dans les ${d.kind === "out" ? "dépenses" : "rentrées"}.` : null;
}

function Editor({ draft, onDone }: { draft: Draft; onDone: () => void }) {
  const [d, setD] = useState(draft);
  const [confirm, setConfirm] = useState(false);
  const [touched, setTouched] = useState(false);
  const set = (p: Partial<Draft>) => setD({ ...d, ...p });
  const canDelete = d.id && !PROTECTED.has(d.id);
  const error = nameError(state.value, d);
  return (
    <form
      class="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        setTouched(true);
        if (error) return;
        update((s) => saveCategory(s, d));
        onDone();
      }}
    >
      {!d.id && (
        <div class="ag-seg" role="group" aria-label="Sens de la catégorie">
          <button type="button" aria-pressed={d.kind === "out"} onClick={() => set({ kind: "out" })}>
            Dépense
          </button>
          <button type="button" aria-pressed={d.kind === "in"} onClick={() => set({ kind: "in" })}>
            Rentrée
          </button>
        </div>
      )}
      <label class="ag-field">
        <span>Nom</span>
        <input
          type="text"
          value={d.name}
          maxLength={32}
          aria-invalid={touched && !!error}
          aria-describedby="ag-cat-name-error"
          onInput={(e) => {
            setTouched(true);
            set({ name: (e.currentTarget as HTMLInputElement).value });
          }}
        />
      </label>
      <p id="ag-cat-name-error" class="ag-field-error" role="alert">
        {touched && error ? error : ""}
      </p>
      <fieldset class="ag-fieldset">
        <legend>Couleur</legend>
        <div class="ag-swatches">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              class="ag-swatch press"
              style={{ background: c, color: onColor(c) }}
              aria-pressed={d.color.toLowerCase() === c.toLowerCase()}
              aria-label={`Couleur ${c}`}
              onClick={() => set({ color: c })}
            >
              {d.color.toLowerCase() === c.toLowerCase() && <Icon name="check" size={16} strokeWidth={2.5} />}
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset class="ag-fieldset">
        <legend>Icône</legend>
        <div class="ag-icon-grid">
          {CATEGORY_ICONS.map((ic) => (
            <button
              key={ic}
              type="button"
              class="ag-icon-pick press"
              aria-pressed={d.icon === ic}
              aria-label={`Icône ${ic}`}
              style={d.icon === ic ? { background: d.color, color: onColor(d.color) } : { color: readableOn(d.color, CARD) }}
              onClick={() => set({ icon: ic })}
            >
              <Icon name={ic} size={20} />
            </button>
          ))}
        </div>
      </fieldset>
      <button type="submit" class="ag-btn-full press" disabled={!!error}>
        {d.id ? "Enregistrer" : "Créer la catégorie"}
      </button>
      {canDelete && (
        <button
          type="button"
          class="ag-btn-text press"
          onClick={() => {
            if (!confirm) return setConfirm(true);
            update((s) => deleteCategory(s, d.id!));
            onDone();
          }}
        >
          <Icon name="trash-2" size={18} />
          {confirm ? "Confirmer : ses opérations iront dans « Autres »" : "Supprimer la catégorie"}
        </button>
      )}
    </form>
  );
}

/** Liste et édition des catégories. `onBack` affiche un bouton retour (depuis la feuille d'ajout). */
export function CategoryManager({ onBack }: { onBack?: () => void }) {
  const [editing, setEditing] = useState<Draft | null>(null);
  const cats = state.value.categories;
  if (editing) return <Editor key={editing.id ?? "new"} draft={editing} onDone={() => setEditing(null)} />;
  const group = (kind: "out" | "in", title: string) => (
    <section class="ag-cat-group" aria-label={title}>
      <h3>{title}</h3>
      <ul>
        {cats
          .filter((c) => c.kind === kind)
          .map((c) => (
            <li key={c.id}>
              <button type="button" class="ag-cat-row press" onClick={() => setEditing({ ...c })}>
                <span class="ag-cat-dot" style={{ color: readableOn(c.color, CARD) }}>
                  <Icon name={c.icon} size={18} />
                </span>
                <span class="ag-cat-name">{c.name}</span>
                <Icon name="pencil" size={16} class="ag-muted-icon" />
              </button>
            </li>
          ))}
      </ul>
    </section>
  );
  return (
    <div class="ag-form">
      {onBack && (
        <button type="button" class="ag-btn-text ag-btn-left press" onClick={onBack}>
          ← Retour à l’ajout
        </button>
      )}
      {group("out", "Dépenses")}
      {group("in", "Rentrées")}
      <button
        type="button"
        class="ag-pill ag-pill-soft press ag-pill-block"
        onClick={() => setEditing({ name: "", icon: "shopping-bag", color: CATEGORY_COLORS[0], kind: "out" })}
      >
        <Icon name="plus" size={18} />
        Nouvelle catégorie
      </button>
    </div>
  );
}
