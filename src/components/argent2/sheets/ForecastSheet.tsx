// Prévision « Combien j'aurai le… » : une date (champ ou curseur), le total, et le calcul ligne par ligne
// (aujourd'hui, paies, prévus, fixes, dettes) tiré de forecast(). Chaque ligne se déplie sur son détail.
import { useState } from "preact/hooks";
import { forecast } from "../../../lib/argent/balance";
import { addDays, DAYS_LONG, MONTHS_LONG, parse } from "../../../lib/argent/dates";
import { fmt } from "../../../lib/argent/money";
import { state } from "../../../lib/argent/store";
import { dayShort, daysBetween } from "../screens/plan-logic";
import { Icon } from "../ui/Icon";

const MAX_DAYS = 365;
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const fullDay = (d: string) => {
  const x = parse(d);
  return `${DAYS_LONG[x.getDay()]} ${x.getDate()} ${MONTHS_LONG[x.getMonth()]} ${x.getFullYear()}`;
};
/** « 2026-11-05 Loyer : −500 € » → « jeu. 5 nov. Loyer : −500 € ». */
const prettyDetail = (s: string) => s.replace(/^(\d{4}-\d{2}-\d{2})/, (d) => dayShort(d));

export function ForecastPanel({ now, today }: { now: Date; today: string }) {
  const [target, setTarget] = useState(() => addDays(today, 30));
  const [open, setOpen] = useState<string | null>(null);
  const days = Math.max(0, daysBetween(today, target));
  const f = forecast(state.value, target, now);

  const setDays = (n: number) => setTarget(addDays(today, Math.max(1, Math.min(MAX_DAYS, n))));

  return (
    <section class="ag-card ag-plan-card ag-forecast" aria-labelledby="ag-forecast-title">
      <h2 id="ag-forecast-title">Combien j’aurai le…</h2>
      <div class="ag-forecast-pick">
        <label class="ag-field">
          <span class="ag-sr-only">Date</span>
          <input
            type="date"
            value={target}
            min={addDays(today, 1)}
            onInput={(e) => {
              const v = (e.currentTarget as HTMLInputElement).value;
              if (v && v > today) setTarget(v);
            }}
          />
        </label>
        <input
          type="range"
          class="ag-range"
          min={1}
          max={MAX_DAYS}
          step={1}
          value={Math.min(days, MAX_DAYS)}
          aria-label="Dans combien de jours"
          aria-valuetext={`Dans ${days} jours, ${fullDay(target)}`}
          style={{ "--fill": `${(Math.min(days, MAX_DAYS) / MAX_DAYS) * 100}%` }}
          onInput={(e) => setDays(Number((e.currentTarget as HTMLInputElement).value))}
        />
        <p class="ag-sub">
          Dans {days} jour{days > 1 ? "s" : ""}, {fullDay(target)}
        </p>
      </div>

      <p class="ag-forecast-total" aria-live="polite">
        <span class="num-big" data-testid="forecast-total">{fmt(f.total)}</span>
        <span class="ag-sub">sur tous mes comptes</span>
      </p>

      <ul class="ag-forecast-rows">
        {f.rows.map((r) => {
          const id = `ag-fc-${r.label.replace(/\W+/g, "-")}`;
          const isOpen = open === r.label;
          return (
            <li key={r.label}>
              <button type="button" class="ag-forecast-row press" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : r.label)}>
                <span class="ag-forecast-chev" data-open={isOpen ? "" : undefined}>
                  <Icon name="chevron-right" size={16} />
                </span>
                <span class="ag-forecast-label">{r.label}</span>
                <span class="ag-sub">{r.details.length > 1 ? `${r.details.length} lignes` : ""}</span>
                <span class={`num ag-forecast-amount${r.amount > 0 && r.label !== "Aujourd'hui" ? " is-in" : ""}`} data-testid="forecast-row">
                  {r.label === "Aujourd'hui" ? fmt(r.amount) : signed(r.amount)}
                </span>
              </button>
              <ul id={id} class="ag-forecast-details" hidden={!isOpen}>
                {r.details.map((d, i) => (
                  <li key={i}>{prettyDetail(d)}</li>
                ))}
              </ul>
            </li>
          );
        })}
        <li class="ag-forecast-sum">
          <span>Total</span>
          <span class="num">{fmt(f.total)}</span>
        </li>
      </ul>
      {f.later > 0 && (
        <p class="ag-sub">
          Pas compté : {fmt(f.later)} de journées gagnées d’ici là, versés après le {dayShort(target).replace(/\.$/, "")}.
        </p>
      )}
    </section>
  );
}
