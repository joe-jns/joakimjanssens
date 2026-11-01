// Petits champs partagés des feuilles du Planning : montant, date, fréquence, confirmation de suppression.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { Every } from "../../../lib/argent/dates";
import { EVERY } from "../screens/plan-logic";
import { Icon } from "../ui/Icon";

const val = (e: Event) => (e.currentTarget as HTMLInputElement).value;

/** Montant en euros au clavier : « 42,10 » ou « 42.10 ». */
export function MoneyField({ label, value, onChange, hint, required }: { label: string; value: string; onChange: (v: string) => void; hint?: string; required?: boolean }) {
  return (
    <label class="ag-field">
      <span>{label}</span>
      <span class="ag-money-input">
        <input
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          required={required}
          placeholder={hint ?? "0,00"}
          onInput={(e) => onChange(val(e).replace(/[^0-9,.\s-]/g, ""))}
        />
        <span aria-hidden="true">€</span>
      </span>
    </label>
  );
}

export function TextField({ label, value, onChange, placeholder, maxLength = 40, required }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; maxLength?: number; required?: boolean }) {
  return (
    <label class="ag-field">
      <span>{label}</span>
      <input type="text" value={value} maxLength={maxLength} required={required} placeholder={placeholder} onInput={(e) => onChange(val(e))} />
    </label>
  );
}

export function DateField({ label, value, onChange, required, min }: { label: string; value: string; onChange: (v: string) => void; required?: boolean; min?: string }) {
  return (
    <label class="ag-field">
      <span>{label}</span>
      <input type="date" value={value} required={required} min={min} onInput={(e) => onChange(val(e))} />
    </label>
  );
}

export function EveryPicker({ value, onChange }: { value: Every; onChange: (e: Every) => void }) {
  return (
    <fieldset class="ag-fieldset">
      <legend>Fréquence</legend>
      <div class="ag-seg ag-seg-sm" role="group" aria-label="Fréquence">
        {EVERY.map((x) => (
          <button key={x.id} type="button" aria-pressed={value === x.id} onClick={() => onChange(x.id)}>
            {x.short}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

/** Bouton « Supprimer » qui demande une confirmation avant d'agir. */
export function DeleteButton({ label, warning, onConfirm }: { label: string; warning: ComponentChildren; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  const confirm = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (ask) confirm.current?.focus();
  }, [ask]);
  if (!ask) {
    return (
      <button type="button" class="ag-btn-text ag-btn-danger press" onClick={() => setAsk(true)}>
        <Icon name="trash-2" size={18} />
        {label}
      </button>
    );
  }
  return (
    <div class="ag-confirm" role="alertdialog" aria-label={label}>
      <p>{warning}</p>
      <div class="ag-confirm-actions">
        <button type="button" class="ag-pill ag-pill-soft press" onClick={() => setAsk(false)}>
          Annuler
        </button>
        <button ref={confirm} type="button" class="ag-pill ag-pill-danger press" onClick={onConfirm}>
          Supprimer
        </button>
      </div>
    </div>
  );
}
