// Paiement fixe : créer ou modifier (sens, libellé, montant, fréquence, prochaine date, compte, catégorie), supprimer.
// Un nouveau fixe part d'aujourd'hui (`since`) ; une modification vaut pour les échéances à venir.
import { useState } from "preact/hooks";
import { readableOn } from "../../../lib/argent/color";
import type { Every } from "../../../lib/argent/dates";
import { round2, toAmount } from "../../../lib/argent/money";
import { state, update, refreshAuto } from "../../../lib/argent/store";
import { deleteRecurring, nextOccurrence, saveRecurring } from "../screens/plan-logic";
import { Icon } from "../ui/Icon";
import { AccountPicker } from "./AddSheet";
import { DateField, DeleteButton, EveryPicker, MoneyField, TextField } from "./fields";

export const amountText = (n: number) => (n ? String(round2(Math.abs(n))).replace(".", ",") : "");

export function RecurringSheet({ id, today, onDone }: { id?: string; today: string; onDone: () => void }) {
  const s = state.value;
  // Instantané à l'ouverture : après une suppression, la feuille garde l'élément pendant sa fermeture.
  const [r] = useState(() => (id ? s.recurring.find((x) => x.id === id) : undefined));
  const firstShown = r ? nextOccurrence(r, today) : today;
  const [kind, setKind] = useState<"out" | "in">(r && r.amount > 0 ? "in" : "out");
  const [label, setLabel] = useState(r?.label ?? "");
  const [amount, setAmount] = useState(amountText(r?.amount ?? 0));
  const [every, setEvery] = useState<Every>(r?.every ?? "month");
  const [first, setFirst] = useState(firstShown);
  const [accountId, setAccountId] = useState(r?.accountId ?? s.accounts.find((a) => a.kind === "courant")?.id ?? s.accounts[0]?.id ?? "");
  const [categoryId, setCategoryId] = useState<string | undefined>(r?.categoryId);

  const value = Math.abs(toAmount(amount));
  const ok = !!label.trim() && value > 0 && !!first && !!accountId;
  const cats = s.categories.filter((c) => c.kind === kind);

  const pickKind = (k: "out" | "in") => {
    setKind(k);
    setCategoryId(undefined);
  };

  const save = () => {
    if (!ok) return;
    // Date inchangée : on garde la série d'origine (le « 31 » d'un mois reste le 31).
    const f = r && first === firstShown && every === r.every ? r.first : first;
    update((x) => saveRecurring(x, { id, label, amount: kind === "out" ? -value : value, every, first: f, accountId, categoryId }, today));
    refreshAuto(new Date());
    onDone();
  };

  return (
    <form
      class="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div class="ag-seg" role="group" aria-label="Sens">
        <button type="button" aria-pressed={kind === "out"} onClick={() => pickKind("out")}>
          Dépense
        </button>
        <button type="button" aria-pressed={kind === "in"} onClick={() => pickKind("in")}>
          Rentrée
        </button>
      </div>
      <TextField label="Libellé" value={label} onChange={setLabel} placeholder="Loyer, abonnement…" required />
      <div class="ag-row2 ag-row2-even">
        <MoneyField label="Montant" value={amount} onChange={setAmount} required />
        <DateField label={r ? "Prochaine date" : "Première date"} value={first} onChange={setFirst} required />
      </div>
      <EveryPicker value={every} onChange={setEvery} />
      <AccountPicker label="Compte" value={accountId} onChange={setAccountId} />
      <fieldset class="ag-fieldset">
        <legend>Catégorie</legend>
        <div class="ag-chips">
          {cats.map((c) => (
            <button key={c.id} type="button" class="ag-chip ag-chip-cat press" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}>
              <span class="ag-chip-icon" style={{ color: readableOn(c.color) }}>
                <Icon name={c.icon} size={16} />
              </span>
              {c.name}
            </button>
          ))}
        </div>
      </fieldset>
      {r && <p class="ag-sub">Les changements valent pour les prochaines échéances ; celles déjà passées restent comme elles sont.</p>}
      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        {r ? "Enregistrer" : "Ajouter le paiement fixe"}
      </button>
      {r && (
        <DeleteButton
          label="Supprimer ce paiement fixe"
          warning="Plus rien n’arrivera ensuite. Les opérations déjà passées restent dans l’historique."
          onConfirm={() => {
            update((x) => deleteRecurring(x, r.id));
            onDone();
          }}
        />
      )}
    </form>
  );
}
