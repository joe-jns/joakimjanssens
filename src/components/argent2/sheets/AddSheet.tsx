// Ajout rapide : sens (dépense / rentrée / virement), montant au pavé numérique, catégorie, compte, date, note.
// Une saisie est enregistrée « manuel » / « saisie » ; un virement passe par transfer() (deux lignes liées).
import { useState } from "preact/hooks";
import { transfer } from "../../../lib/argent/balance";
import { todayIso } from "../../../lib/argent/dates";
import type { State, Txn } from "../../../lib/argent/model";
import { readableOn } from "../../../lib/argent/color";
import { round2, toAmount } from "../../../lib/argent/money";
import { state, update } from "../../../lib/argent/store";
import type { AddPreset } from "../nav";
import { Icon } from "../ui/Icon";
import { Numpad } from "../ui/Numpad";
import { CategoryManager } from "./CategorySheet";

type Kind = "out" | "in" | "transfer";
const KINDS: { id: Kind; label: string; verb: string }[] = [
  { id: "out", label: "Dépense", verb: "Ajouter la dépense" },
  { id: "in", label: "Rentrée", verb: "Ajouter la rentrée" },
  { id: "transfer", label: "Virement", verb: "Faire le virement" },
];

/** Construit l'état après la saisie (pur, testable). */
export function addEntry(
  s: State,
  e: { kind: Kind; amount: number; categoryId?: string; accountId: string; toAccountId?: string; date: string; note: string },
): State {
  const a = round2(Math.abs(e.amount));
  if (!a) return s;
  if (e.kind === "transfer") {
    if (!e.toAccountId || e.toAccountId === e.accountId) return s;
    const next = transfer(s, e.accountId, e.toAccountId, a, e.date);
    if (!e.note.trim()) return next;
    const added = new Set(next.txns.slice(s.txns.length).map((t) => t.id));
    return { ...next, txns: next.txns.map((t) => (added.has(t.id) ? { ...t, note: e.note.trim() } : t)) };
  }
  const cat = s.categories.find((c) => c.id === e.categoryId);
  const note = e.note.trim();
  const t: Txn = {
    id: crypto.randomUUID(),
    accountId: e.accountId,
    date: e.date,
    amount: e.kind === "out" ? -a : a,
    label: note || cat?.name || (e.kind === "out" ? "Dépense" : "Rentrée"),
    categoryId: cat?.id ?? (e.kind === "out" ? "autres-out" : "autres-in"),
    status: "manuel",
    source: "saisie",
    ...(note ? { note } : {}),
  };
  return { ...s, txns: [...s.txns, t] };
}

export function AccountPicker({ label, value, onChange, exclude }: { label: string; value: string; onChange: (id: string) => void; exclude?: string }) {
  return (
    <fieldset class="ag-fieldset">
      <legend>{label}</legend>
      <div class="ag-chips">
        {state.value.accounts
          .filter((a) => a.id !== exclude)
          .map((a) => (
            <button key={a.id} type="button" class="ag-chip press" aria-pressed={value === a.id} onClick={() => onChange(a.id)}>
              {a.name}
            </button>
          ))}
      </div>
    </fieldset>
  );
}

export function AddSheet({ onDone, preset }: { onDone: () => void; preset?: AddPreset | null }) {
  const accounts = state.value.accounts;
  const from0 = preset?.fromAccountId && accounts.some((a) => a.id === preset.fromAccountId) ? preset.fromAccountId : accounts[0]?.id ?? "";
  const to0 =
    preset?.toAccountId && preset.toAccountId !== from0 && accounts.some((a) => a.id === preset.toAccountId)
      ? preset.toAccountId
      : accounts.find((a) => a.id !== from0)?.id ?? "";
  const [view, setView] = useState<"add" | "cats">("add");
  const [kind, setKind] = useState<Kind>(preset?.kind ?? "out");
  const [amount, setAmount] = useState("");
  const [categoryId, setCategoryId] = useState<string | undefined>();
  const [accountId, setAccountId] = useState(from0);
  const [toAccountId, setToAccountId] = useState(to0);
  const [date, setDate] = useState(todayIso());
  const [note, setNote] = useState("");

  if (view === "cats") return <CategoryManager onBack={() => setView("add")} />;

  const value = toAmount(amount);
  const isTransfer = kind === "transfer";
  const ok = value > 0 && !!accountId && !!date && (!isTransfer || (!!toAccountId && toAccountId !== accountId));
  const cats = state.value.categories.filter((c) => c.kind === (kind === "in" ? "in" : "out"));

  const pickKind = (k: Kind) => {
    setKind(k);
    setCategoryId(undefined);
    if (k === "transfer" && toAccountId === accountId) setToAccountId(accounts.find((a) => a.id !== accountId)?.id ?? "");
  };

  const save = () => {
    if (!ok) return;
    update((s) => addEntry(s, { kind, amount: value, categoryId, accountId, toAccountId, date, note }));
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
        {KINDS.map((k) => (
          <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => pickKind(k.id)}>
            {k.label}
          </button>
        ))}
      </div>
      <p class="ag-amount num-big" aria-live="polite">
        {kind === "out" && value > 0 ? "−" : ""}
        {amount || "0"} €
      </p>

      {!isTransfer && (
        <fieldset class="ag-fieldset">
          <legend>Catégorie</legend>
          <div class="ag-chips">
            {cats.map((c) => (
              <button
                key={c.id}
                type="button"
                class="ag-chip ag-chip-cat press"
                aria-pressed={categoryId === c.id}
                onClick={() => setCategoryId(categoryId === c.id ? undefined : c.id)}
              >
                <span class="ag-chip-icon" style={{ color: readableOn(c.color) }}>
                  <Icon name={c.icon} size={16} />
                </span>
                {c.name}
              </button>
            ))}
            <button type="button" class="ag-chip ag-chip-ghost press" onClick={() => setView("cats")}>
              <Icon name="tags" size={16} />
              Gérer
            </button>
          </div>
        </fieldset>
      )}

      <Numpad value={amount} onChange={setAmount} />

      <AccountPicker label={isTransfer ? "Depuis" : "Compte"} value={accountId} onChange={(id) => {
        setAccountId(id);
        if (id === toAccountId) setToAccountId(accounts.find((a) => a.id !== id)?.id ?? "");
      }} />
      {isTransfer && <AccountPicker label="Vers" value={toAccountId} onChange={setToAccountId} exclude={accountId} />}

      <div class="ag-row2">
        <label class="ag-field">
          <span>Date</span>
          <input type="date" value={date} required onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="ag-field">
          <span>Note</span>
          <input type="text" value={note} maxLength={80} placeholder="Facultatif" onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>

      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        {KINDS.find((k) => k.id === kind)!.verb}
      </button>
    </form>
  );
}
