// Dette : créer ou modifier (reste, tranche, fréquence, prochaine échéance, déjà remboursé, compte), supprimer.
// Aperçu en direct : nombre de tranches et date où elle est soldée. Changer les chiffres relance l'échéancier
// depuis la prochaine échéance ; les tranches passées ne bougent pas (voir plan-logic.ts).
import { useState } from "preact/hooks";
import type { Every } from "../../../lib/argent/dates";
import { fmt, toAmount } from "../../../lib/argent/money";
import { debtSchedule } from "../../../lib/argent/schedule";
import { refreshAuto, state, update } from "../../../lib/argent/store";
import { dayLong, debtDateRule, debtDraft, deleteDebt, saveDebt } from "../screens/plan-logic";
import { AccountPicker } from "./AddSheet";
import { DateField, DeleteButton, EveryPicker, MoneyField, TextField } from "./fields";
import { amountText } from "./RecurringSheet";

export function DebtSheet({ id, today, onDone }: { id?: string; today: string; onDone: () => void }) {
  const s = state.value;
  // Instantané à l'ouverture : après une suppression, la feuille garde l'élément pendant sa fermeture.
  const [d] = useState(() => (id ? s.debts.find((x) => x.id === id) : undefined));
  const init = d ? debtDraft(d, today) : undefined;
  const [label, setLabel] = useState(init?.label ?? "");
  const [left, setLeft] = useState(amountText(init?.left ?? 0));
  const [amount, setAmount] = useState(amountText(init?.amount ?? 0));
  const [paid, setPaid] = useState(amountText(init?.paid ?? 0));
  const [every, setEvery] = useState<Every>(init?.every ?? "month");
  const [first, setFirst] = useState(init?.first ?? today);
  const [accountId, setAccountId] = useState(init?.accountId ?? s.accounts.find((a) => a.kind === "courant")?.id ?? s.accounts[0]?.id ?? "");

  const nLeft = Math.abs(toAmount(left));
  const nAmount = Math.abs(toAmount(amount));
  const nPaid = Math.max(0, toAmount(paid));
  const done = !!init && init.left === 0;
  const ok = !!label.trim() && nAmount > 0 && !!first && !!accountId && (nLeft > 0 || done);
  const plan = nLeft > 0 && nAmount > 0 && first ? debtSchedule({ id: "", label: "", total: nLeft, amount: nAmount, every, first, accountId }) : [];
  const end = plan[plan.length - 1]?.date;
  const rule = debtDateRule(init?.first, first, today, done);

  const save = () => {
    if (!ok) return;
    update((x) => saveDebt(x, { id, label, left: nLeft, paid: nPaid, amount: nAmount, every, first: rule.first, accountId }, today));
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
      <TextField label="Nom de la dette" value={label} onChange={setLabel} placeholder="Prêt, facture étalée…" required />
      <div class="ag-row2 ag-row2-even">
        <MoneyField label={d ? "Reste à rembourser" : "Montant à rembourser"} value={left} onChange={setLeft} required={!done} />
        <MoneyField label="Par tranche" value={amount} onChange={setAmount} required />
      </div>
      <EveryPicker value={every} onChange={setEvery} />
      <div class="ag-row2 ag-row2-even">
        <DateField label="Prochaine échéance" value={first} onChange={setFirst} required min={rule.min} />
        <MoneyField label="Déjà remboursé" value={paid} onChange={setPaid} hint="Facultatif" />
      </div>
      <AccountPicker label="Payée depuis" value={accountId} onChange={setAccountId} />
      <p class="ag-plan-preview" aria-live="polite">
        {end ? (
          <>
            {plan.length} tranche{plan.length > 1 ? "s" : ""}
            {plan.length > 1 && plan[plan.length - 1].amount !== plan[0].amount ? ` (dernière : ${fmt(plan[plan.length - 1].amount)})` : ""} · libre le{" "}
            <strong>{dayLong(end)}</strong>
          </>
        ) : done ? (
          "Cette dette est remboursée."
        ) : (
          "Indique le montant et la tranche pour voir la date de fin."
        )}
      </p>
      {d && <p class="ag-sub">Changer les chiffres relance l’échéancier à partir de la prochaine échéance ; les tranches déjà passées restent.</p>}
      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        {d ? "Enregistrer" : "Ajouter la dette"}
      </button>
      {d && (
        <DeleteButton
          label="Supprimer cette dette"
          warning="Les prochaines tranches ne seront plus prévues. Celles déjà passées restent dans l’historique."
          onConfirm={() => {
            update((x) => deleteDebt(x, d.id));
            onDone();
          }}
        />
      )}
    </form>
  );
}
