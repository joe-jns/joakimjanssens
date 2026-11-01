// Activité : opérations groupées par jour (net du jour), recherche, filtres (sens, fixes, catégorie).
// Toucher une ligne ouvre son détail : feuille sur téléphone (rendue par App), panneau à droite sur PC.
import { useEffect, useMemo, useState } from "preact/hooks";
import { iso } from "../../../lib/argent/dates";
import { fmt } from "../../../lib/argent/money";
import type { State } from "../../../lib/argent/model";
import { state } from "../../../lib/argent/store";
import { categoryFilter, query, txnId } from "../nav";
import { accName, TxnBadges, TxnDetail, txnIcon, txnVersion } from "../sheets/TxnSheet";
import { Icon } from "../ui/Icon";
import { useWide } from "../ui/useWide";
import { applyFilters, buildRows, dayTitle, groupDays, takeDays, type Kind, type Row } from "./activity-logic";

const KINDS: { id: Kind; label: string }[] = [
  { id: "tout", label: "Tout" },
  { id: "depenses", label: "Dépenses" },
  { id: "rentrees", label: "Rentrées" },
  { id: "fixes", label: "Fixes" },
];
const STEP = 150;
const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));

function RowItem({ s, r, selected }: { s: State; r: Row; selected: boolean }) {
  const t = r.txn;
  const ic = txnIcon(s, t);
  const cat = s.categories.find((c) => c.id === t.categoryId)?.name;
  const label = r.pair ? `Virement ${accName(s, t.accountId)} → ${accName(s, r.pair.accountId)}` : t.label;
  const sub = r.pair ? (t.note ?? "Entre mes comptes") : [accName(s, t.accountId), cat].filter(Boolean).join(" · ");
  const amount = r.pair ? fmt(Math.abs(t.amount)) : signed(t.amount);
  return (
    <li>
      <button
        type="button"
        class="ag-act-row"
        data-key={r.key}
        aria-current={selected ? "true" : undefined}
        onClick={() => (txnId.value = t.id)}
      >
        <span class="ag-txn-icon" style={{ color: ic.color }}>
          <Icon name={ic.icon} size={18} />
        </span>
        <span class="ag-txn-main">
          <span class="ag-txn-label">{label}</span>
          <span class="ag-txn-sub">
            <TxnBadges t={t} />
            <span class="ag-txn-sub-text">{sub}</span>
          </span>
        </span>
        <span class={`num ag-txn-amount${!r.pair && t.amount > 0 ? " is-in" : ""}`}>{amount}</span>
      </button>
    </li>
  );
}

export function Activity({ now }: { now: Date }) {
  const s = state.value;
  const today = iso(now);
  const wide = useWide();
  const [kind, setKind] = useState<Kind>("tout");
  const [limit, setLimit] = useState(STEP);
  const cats = categoryFilter.value;
  const q = query.value;
  // La liste suit la recherche avec un court délai (frappe fluide sur quelques milliers de lignes).
  const [dq, setDq] = useState(q);
  useEffect(() => {
    if (!q.trim()) return setDq(q);
    const timer = setTimeout(() => setDq(q), 150);
    return () => clearTimeout(timer);
  }, [q]);
  const sel = txnId.value;

  // Le filtre posé par l'accueil vaut pour cette visite ; on le retire en quittant l'écran.
  useEffect(
    () => () => {
      categoryFilter.value = null;
      txnId.value = null;
    },
    [],
  );
  useEffect(() => setLimit(STEP), [kind, cats, dq]);

  const rows = useMemo(() => buildRows(s), [s.txns, s.accounts, s.categories]);
  const shown = useMemo(() => applyFilters(rows, { kind, cats, q: dq }), [rows, kind, cats, dq]);
  const days = useMemo(() => groupDays(shown), [shown]);
  const visible = takeDays(days, limit);
  const visibleCount = visible.reduce((n, d) => n + d.rows.length, 0);

  // Le détail sélectionné : la ligne (un virement est choisi par l'une ou l'autre moitié).
  const selRow = sel ? rows.find((r) => r.txn.id === sel || r.pair?.id === sel) : undefined;
  const catName = (id: string) => s.categories.find((c) => c.id === id)?.name ?? id;
  const filterLabel = cats ? (cats.length === 1 ? catName(cats[0]) : `Autres (${cats.length} catégories)`) : "";
  const anyFilter = kind !== "tout" || !!cats || !!dq.trim();
  const reset = () => {
    setKind("tout");
    categoryFilter.value = null;
    query.value = "";
  };

  return (
    <div class="ag-act" data-detail={wide ? "" : undefined}>
      <div class="ag-act-list">
        <label class="ag-search ag-act-search ag-phone-only">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Libellé, note, montant…"
            aria-label="Chercher une opération"
            value={q}
            onInput={(e) => (query.value = (e.currentTarget as HTMLInputElement).value)}
          />
        </label>

        <div class="ag-seg ag-seg-sm ag-act-kinds" role="group" aria-label="Type d’opérations">
          {KINDS.map((k) => (
            <button key={k.id} type="button" aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
              {k.label}
            </button>
          ))}
        </div>

        <div class="ag-act-cats" role="group" aria-label="Catégorie">
          {s.categories.map((c) => {
            const on = !!cats && cats.length === 1 && cats[0] === c.id;
            return (
              <button
                key={c.id}
                type="button"
                class="ag-chip ag-chip-sm press"
                aria-pressed={on}
                onClick={() => (categoryFilter.value = on ? null : [c.id])}
              >
                <i class="ag-dot" style={{ background: c.color }} aria-hidden="true" />
                {c.name}
                {c.kind === "in" && s.categories.some((o) => o.kind === "out" && o.name === c.name) ? " (rentrées)" : ""}
              </button>
            );
          })}
        </div>

        <h2 id="ag-act-heading" class="ag-sr-only" tabIndex={-1}>
          Opérations
        </h2>
        <div class="ag-act-status">
          <p class="ag-sub" aria-live="polite">
            {shown.length} opération{shown.length > 1 ? "s" : ""}
            {anyFilter ? " trouvée" + (shown.length > 1 ? "s" : "") : ""}
          </p>
          {cats && (
            <button type="button" class="ag-chip ag-chip-sm ag-chip-active press" onClick={() => (categoryFilter.value = null)} aria-label={`Retirer le filtre ${filterLabel}`}>
              {filterLabel}
              <Icon name="x" size={14} strokeWidth={2} />
            </button>
          )}
        </div>

        {visible.length ? (
          <>
            {visible.map((d) => (
              <section key={d.day} class="ag-act-day" aria-labelledby={`ag-day-${d.day}`}>
                <header class="ag-act-dayhead">
                  <h3 id={`ag-day-${d.day}`}>{dayTitle(d.day, today)}</h3>
                  <span>
                    {anyFilter && <span class="ag-act-net-note">net affiché </span>}
                    <span class={`num${d.net > 0 ? " is-in" : ""}`}>{d.net ? signed(d.net) : fmt(0)}</span>
                  </span>
                </header>
                <ul class="ag-act-rows">
                  {d.rows.map((r) => (
                    <RowItem key={r.key} s={s} r={r} selected={!!selRow && selRow.key === r.key} />
                  ))}
                </ul>
              </section>
            ))}
            {visibleCount < shown.length && (
              <button type="button" class="ag-pill ag-pill-soft ag-pill-block press" onClick={() => setLimit(limit + STEP)}>
                Afficher plus ({shown.length - visibleCount} restantes)
              </button>
            )}
          </>
        ) : (
          <div class="ag-card ag-empty ag-act-empty">
            <p>{rows.length ? "Aucune opération ne correspond." : "Aucune opération pour l’instant."}</p>
            {anyFilter && (
              <button type="button" class="ag-link press" onClick={reset}>
                Tout effacer
              </button>
            )}
          </div>
        )}
      </div>

      {wide && (
        <aside class="ag-card ag-act-detail" aria-label="Détail de l’opération">
          {selRow ? (
            <TxnDetail
              key={`${selRow.key}|${txnVersion(s, selRow.txn.id)}`}
              id={selRow.txn.id}
              onDone={() => {
                // Enregistré : le détail reste ouvert ; supprimé : il se ferme.
                if (!state.value.txns.some((t) => t.id === selRow.txn.id)) txnId.value = null;
              }}
            />
          ) : (
            <p class="ag-muted">Choisis une opération pour voir son détail et la modifier.</p>
          )}
        </aside>
      )}
    </div>
  );
}
