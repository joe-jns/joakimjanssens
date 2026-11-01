// Objectif d'épargne : nom, icône, couleur, montant visé, date facultative, compte lié (par défaut l'épargne de la
// banque ; un compte « hors banque » seulement pour l'argent qui n'est sur aucun compte importé).
// « Mettre de côté » : virement d'un compte vers le compte de l'objectif (le total ne change pas).
import { useState } from "preact/hooks";
import { CARD, onColor, readableOn } from "../../../lib/argent/color";
import { fmt, toAmount } from "../../../lib/argent/money";
import { state, update } from "../../../lib/argent/store";
import { dayLong, defaultGoalAccount, deleteGoal, goalProgress, putAside, saveGoal } from "../screens/plan-logic";
import { CATEGORY_ICONS, Icon } from "../ui/Icon";
import { Numpad } from "../ui/Numpad";
import { AccountPicker } from "./AddSheet";
import { DateField, DeleteButton, MoneyField, TextField } from "./fields";
import { CATEGORY_COLORS } from "./palette";
import { amountText } from "./RecurringSheet";

const NEW = "";

export function GoalSheet({ id, today, onDone }: { id?: string; today: string; onDone: () => void }) {
  const s = state.value;
  // Instantané à l'ouverture : après une suppression, la feuille garde l'élément pendant sa fermeture.
  const [g] = useState(() => (id ? s.goals.find((x) => x.id === id) : undefined));
  const savings = s.accounts.filter((a) => a.kind !== "courant");
  const [name, setName] = useState(g?.name ?? "");
  const [icon, setIcon] = useState(g?.icon ?? "piggy-bank");
  const [color, setColor] = useState(g?.color ?? CATEGORY_COLORS[0]);
  const [target, setTarget] = useState(amountText(g?.target ?? 0));
  const [date, setDate] = useState(g?.date ?? "");
  const [accountId, setAccountId] = useState(() => g?.accountId ?? defaultGoalAccount(s));
  const [newAccount, setNewAccount] = useState("");

  const nTarget = Math.abs(toAmount(target));
  const ok = !!name.trim() && nTarget > 0;

  const save = () => {
    if (!ok) return;
    update((x) => saveGoal(x, { id, name, icon, color, target: nTarget, date: date || undefined, accountId, newAccount }));
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
      <TextField label="Nom de l’objectif" value={name} onChange={setName} placeholder="Vacances, voiture…" required />
      <div class="ag-row2 ag-row2-even">
        <MoneyField label="Montant visé" value={target} onChange={setTarget} required />
        <DateField label="Pour le (facultatif)" value={date} onChange={setDate} min={today} />
      </div>
      <fieldset class="ag-fieldset">
        <legend>Compte de l’objectif</legend>
        <div class="ag-chips">
          {savings.map((a) => (
            <button key={a.id} type="button" class="ag-chip press" aria-pressed={accountId === a.id} onClick={() => setAccountId(a.id)}>
              {a.name}
            </button>
          ))}
          <button type="button" class="ag-chip press" aria-pressed={accountId === NEW} onClick={() => setAccountId(NEW)}>
            <Icon name="plus" size={16} />
            Argent hors banque (tirelire, liquide…)
          </button>
        </div>
        <p class="ag-sub ag-hint">L’argent mis de côté va sur ce compte : le solde de l’objectif, c’est son solde.</p>
      </fieldset>
      {accountId === NEW && (
        <>
          <p class="ag-sub ag-hint" role="note">
            À n’utiliser que pour de l’argent qui n’est sur aucun compte bancaire importé. Pour une poche ou un livret de
            ta banque, choisis son compte d’épargne : sinon l’argent serait compté deux fois après l’import.
          </p>
          <TextField label="Nom du compte hors banque" value={newAccount} onChange={setNewAccount} placeholder={name.trim() || "Tirelire, enveloppe…"} />
        </>
      )}
      <fieldset class="ag-fieldset">
        <legend>Couleur</legend>
        <div class="ag-swatches">
          {CATEGORY_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              class="ag-swatch press"
              style={{ background: c, color: onColor(c) }}
              aria-pressed={color.toLowerCase() === c.toLowerCase()}
              aria-label={`Couleur ${c}`}
              onClick={() => setColor(c)}
            >
              {color.toLowerCase() === c.toLowerCase() && <Icon name="check" size={16} strokeWidth={2.5} />}
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
              aria-pressed={icon === ic}
              aria-label={`Icône ${ic}`}
              style={icon === ic ? { background: color, color: onColor(color) } : { color: readableOn(color, CARD) }}
              onClick={() => setIcon(ic)}
            >
              <Icon name={ic} size={20} />
            </button>
          ))}
        </div>
      </fieldset>
      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        {g ? "Enregistrer" : "Créer l’objectif"}
      </button>
      {g && (
        <DeleteButton
          label="Supprimer cet objectif"
          warning="L’objectif disparaît ; son compte et l’argent dessus restent."
          onConfirm={() => {
            update((x) => deleteGoal(x, g.id));
            onDone();
          }}
        />
      )}
    </form>
  );
}

export function AsideSheet({ id, today, onDone }: { id: string; today: string; onDone: () => void }) {
  const s = state.value;
  const g = s.goals.find((x) => x.id === id);
  const sources = s.accounts.filter((a) => a.id !== g?.accountId);
  const [amount, setAmount] = useState("");
  const [from, setFrom] = useState(sources.find((a) => a.kind === "courant")?.id ?? sources[0]?.id ?? "");
  if (!g) return <p class="ag-muted">Cet objectif n’existe plus.</p>;
  const p = goalProgress(s, g, today);
  const value = toAmount(amount);
  const ok = value > 0 && !!from;
  const accName = s.accounts.find((a) => a.id === g.accountId)?.name ?? "";
  return (
    <form
      class="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        update((x) => putAside(x, g.id, from, value, today));
        onDone();
      }}
    >
      <p class="ag-center ag-muted">
        {g.name} : {fmt(p.saved)} sur {fmt(g.target)}
        {p.rest ? ` · encore ${fmt(p.rest)}${g.date ? ` d’ici le ${dayLong(g.date)}` : ""}` : " · atteint"}
      </p>
      <p class="ag-amount num-big" aria-live="polite">
        {amount || "0"} €
      </p>
      <Numpad value={amount} onChange={setAmount} />
      <AccountPicker label="Depuis" value={from} onChange={setFrom} exclude={g.accountId} />
      <p class="ag-sub">Virement vers « {accName} » : ton total ne change pas.</p>
      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        {ok ? `Mettre ${fmt(value)} de côté` : "Mettre de côté"}
      </button>
    </form>
  );
}
