// Réglages de la paie à la journée : montant par jour, début, fin, compte, employeur ; jours non travaillés en plage.
// Enregistrer recalcule les journées prévues (plan-logic.ts saveWork). Retirer une plage agit tout de suite.
import { useState } from "preact/hooks";
import { fmt, toAmount } from "../../../lib/argent/money";
import { state, update } from "../../../lib/argent/store";
import { dayShort, saveWork, skippedRanges, skipRange, unskip, workdaysIn } from "../screens/plan-logic";
import { AccountPicker } from "./AddSheet";
import { DateField, MoneyField, TextField } from "./fields";
import { amountText } from "./RecurringSheet";

export function PaySheet({ today, onDone }: { today: string; onDone: () => void }) {
  const s = state.value;
  const w = s.work;
  const [amount, setAmount] = useState(amountText(w.dayAmount));
  const [start, setStart] = useState(w.start ?? "");
  const [end, setEnd] = useState(w.end ?? "");
  const [accountId, setAccountId] = useState(w.accountId ?? s.accounts.find((a) => a.kind === "courant")?.id ?? "");
  const [payer, setPayer] = useState(w.payer);
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);

  const n = toAmount(amount);
  // Un début est obligatoire : sans lui, toutes les journées prévues disparaîtraient sans prévenir.
  // Avec une date de début, le nom de l'employeur est obligatoire : sans lui, la vraie paie de l'extrait ne remplace
  // pas les journées estimées (comptées deux fois).
  const ok = n > 0 && !!start && !!payer.trim() && (!end || end >= start);
  const range = workdaysIn(from, to);
  const ranges = skippedRanges(w.skipped).reverse();

  return (
    <div class="ag-form">
      <form
        class="ag-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ok) return;
          update((x) => saveWork(x, { dayAmount: n, start, end, accountId, payer: payer.trim() }, new Date()));
          onDone();
        }}
      >
        <div class="ag-row2 ag-row2-even">
          <MoneyField label="Montant par jour travaillé" value={amount} onChange={setAmount} required />
          <TextField label="Nom de l’employeur" value={payer} onChange={setPayer} placeholder="Tel que sur l’extrait" required={!!start} />
        </div>
        <div class="ag-row2 ag-row2-even">
          <DateField label="Début" value={start} onChange={setStart} required />
          <DateField label="Fin (facultatif)" value={end} onChange={setEnd} min={start || undefined} />
        </div>
        <AccountPicker label="La paie arrive sur" value={accountId} onChange={setAccountId} />
        <p class="ag-sub">
          Nom de l’employeur : tel qu’il apparaît sur ton extrait, ex. le nom de ton agence d’intérim. Il sert à reconnaître la
          vraie paie, qui remplace alors les journées estimées. Une journée compte chaque lundi–vendredi à partir de 20 h ; la
          paie arrive le jeudi de la semaine suivante.
        </p>
        <button type="submit" class="ag-btn-full press" disabled={!ok}>
          Enregistrer la paie
        </button>
      </form>

      <section class="ag-plan-skip" aria-labelledby="ag-skip-title">
        <h3 id="ag-skip-title">Jours non travaillés</h3>
        <p class="ag-sub">Malade, congé, férié : ces jours ne rapportent rien.</p>
        <div class="ag-row2 ag-row2-even">
          <DateField label="Du" value={from} onChange={setFrom} />
          <DateField label="Au" value={to} onChange={setTo} min={from} />
        </div>
        <button
          type="button"
          class="ag-pill ag-pill-soft ag-pill-block press"
          disabled={!range.length}
          onClick={() => update((x) => skipRange(x, from, to))}
        >
          {range.length ? `Retirer ${range.length} jour${range.length > 1 ? "s" : ""} (−${fmt(range.length * (n || w.dayAmount))})` : "Aucun jour ouvré dans cette plage"}
        </button>
        {ranges.length > 0 && (
          <ul class="ag-plan-skips">
            {ranges.map((r) => (
              <li key={r.from}>
                <span>
                  {r.from === r.to ? dayShort(r.from) : `${dayShort(r.from)} → ${dayShort(r.to)}`}
                  <span class="ag-sub">{r.days.length} jour{r.days.length > 1 ? "s" : ""}</span>
                </span>
                <button type="button" class="ag-link press" onClick={() => update((x) => unskip(x, r.days, new Date()))}>
                  Remettre
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
