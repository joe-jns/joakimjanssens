// Planning : paie à la journée, paiements fixes, dettes (demi-jauge « % remboursé », « libre le … »),
// objectifs (barres, « Mettre de côté ») et prévision « Combien j'aurai le… ».
// PC : listes à gauche, prévision à droite. Les feuilles sont rendues par App (PlanSheets), au niveau des autres.
import { pendingPay } from "../../../lib/argent/balance";
import { CARD, readableOn } from "../../../lib/argent/color";
import { iso } from "../../../lib/argent/dates";
import { fmt, round2 } from "../../../lib/argent/money";
import { state } from "../../../lib/argent/store";
import { lastPlanSheet, openPlanSheet, planSheet, type PlanSheet } from "../nav";
import { AsideSheet, GoalSheet } from "../sheets/GoalSheet";
import { DebtSheet } from "../sheets/DebtSheet";
import { ForecastPanel } from "../sheets/ForecastSheet";
import { PaySheet } from "../sheets/PaySheet";
import { RecurringSheet } from "../sheets/RecurringSheet";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { dayLong, dayShort, debtInfo, debtsSummary, everyLabel, goalProgress, monthYear, nextOccurrence, perMonth } from "./plan-logic";
import type { State } from "../../../lib/argent/model";

const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const pct = (x: number) => `${Math.round(x * 100)} %`;
const open = openPlanSheet;

function AddLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" class="ag-link ag-plan-add press" onClick={onClick} aria-label={label}>
      + Ajouter
    </button>
  );
}

export function Meter({ value, color, label }: { value: number; color: string; label: string }) {
  const v = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div class="ag-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={label}>
      <span style={{ width: `${v}%`, background: color }} />
    </div>
  );
}

/* ---------- Paie ---------- */
function PayCard({ s, today }: { s: State; today: string }) {
  const w = s.work;
  const acc = s.accounts.find((a) => a.id === (w.accountId ?? "cbc"))?.name;
  const pend = pendingPay(s, today);
  return (
    <section class="ag-card ag-plan-card ag-plan-pay" aria-labelledby="ag-pay-title">
      <div class="ag-card-head">
        <h2 id="ag-pay-title">Paie</h2>
        <button type="button" class="ag-link press" onClick={() => open({ kind: "pay" })}>
          {w.start ? "Modifier" : "Régler"}
        </button>
      </div>
      {w.start ? (
        <>
          <p class="ag-plan-pay-amount">
            <span class="num-big">{fmt(w.dayAmount)}</span> <span class="ag-sub ag-inline">par jour travaillé</span>
          </p>
          <p class="ag-sub">
            {acc ? `Sur ${acc} · ` : ""}depuis le {dayLong(w.start)}
            {w.end ? ` · jusqu’au ${dayLong(w.end)}` : ""}
            {w.skipped.length ? ` · ${w.skipped.length} jour${w.skipped.length > 1 ? "s" : ""} non travaillé${w.skipped.length > 1 ? "s" : ""}` : ""}
          </p>
          {pend.next && (
            <p class="ag-plan-pending">
              <span>À recevoir {dayShort(pend.next)}</span>
              <span class="num is-in">{signed(pend.amount)}</span>
            </p>
          )}
        </>
      ) : (
        <>
          <p class="ag-muted">Indique ton salaire à la journée : chaque jour travaillé s’ajoute tout seul, la paie arrive le jeudi suivant.</p>
          <button type="button" class="ag-pill ag-pill-primary press ag-plan-cta" onClick={() => open({ kind: "pay" })}>
            Régler ma paie
          </button>
        </>
      )}
    </section>
  );
}

/* ---------- Paiements fixes ---------- */
function FixesCard({ s, today }: { s: State; today: string }) {
  const list = s.recurring.map((r) => ({ r, next: nextOccurrence(r, today) })).sort((a, b) => a.next.localeCompare(b.next));
  const month = round2(s.recurring.reduce((a, r) => a + perMonth(r), 0));
  return (
    <section class="ag-card ag-plan-card ag-plan-fixes" aria-labelledby="ag-fixes-title">
      <div class="ag-card-head">
        <div>
          <h2 id="ag-fixes-title">Paiements fixes</h2>
          {list.length > 0 && <p class="ag-sub num">≈ {signed(month)} par mois</p>}
        </div>
        <AddLink label="Ajouter un paiement fixe" onClick={() => open({ kind: "recurring" })} />
      </div>
      {list.length ? (
        <ul class="ag-plan-list">
          {list.map(({ r, next }) => {
            const c = s.categories.find((x) => x.id === r.categoryId);
            const acc = s.accounts.find((a) => a.id === r.accountId)?.name;
            return (
              <li key={r.id}>
                <button type="button" class="ag-plan-row press" onClick={() => open({ kind: "recurring", id: r.id })}>
                  <span class="ag-txn-icon" style={{ color: c ? readableOn(c.color) : "var(--ag-muted)" }}>
                    <Icon name={c?.icon ?? "repeat"} size={18} />
                  </span>
                  <span class="ag-txn-main">
                    <span class="ag-txn-label">{r.label}</span>
                    <span class="ag-txn-sub">
                      {next === today ? "Aujourd’hui" : dayShort(next)} · {everyLabel(r.every).toLowerCase()}
                      {acc ? ` · ${acc}` : ""}
                    </span>
                  </span>
                  <span class={`num ag-txn-amount${r.amount > 0 ? " is-in" : ""}`}>{signed(r.amount)}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="ag-muted">Loyer, abonnements, assurance : ajoute ce qui revient à date fixe.</p>
      )}
    </section>
  );
}

/* ---------- Dettes ---------- */
export function Gauge({ value }: { value: number }) {
  const v = Math.max(0, Math.min(1, value));
  const d = "M 14 100 A 86 86 0 0 1 186 100";
  return (
    <svg class="ag-gauge" viewBox="0 0 200 108" aria-hidden="true">
      <path d={d} fill="none" stroke="var(--ag-line)" stroke-width="22" />
      {v > 0 && <path d={d} fill="none" stroke="var(--ag-rose-vif)" stroke-width="22" pathLength={100} stroke-dasharray={`${v * 100} 100`} />}
    </svg>
  );
}

function DebtsCard({ s, today }: { s: State; today: string }) {
  const sum = debtsSummary(s, today);
  return (
    <section class="ag-card ag-plan-card ag-plan-debts" aria-labelledby="ag-debts-title">
      <div class="ag-card-head">
        <h2 id="ag-debts-title">Dettes</h2>
        <AddLink label="Ajouter une dette" onClick={() => open({ kind: "debt" })} />
      </div>
      {s.debts.length ? (
        <>
          <div class="ag-gauge-wrap">
            <Gauge value={sum.pct} />
            <p class="ag-gauge-text">
              <span class="num-big">{pct(sum.pct)}</span>
              <span class="ag-sub">remboursé</span>
            </p>
          </div>
          <p class="ag-plan-free">
            {sum.free ? (
              <>
                Libre le <strong>{dayLong(sum.free)}</strong>
              </>
            ) : (
              "Tout est remboursé"
            )}
          </p>
          <p class="ag-sub ag-center">
            Reste {fmt(sum.left)} sur {fmt(sum.whole)}
          </p>
          <ul class="ag-plan-list">
            {s.debts.map((d) => {
              const i = debtInfo(d, today);
              return (
                <li key={d.id}>
                  <button type="button" class="ag-plan-item press" onClick={() => open({ kind: "debt", id: d.id })}>
                    <span class="ag-plan-item-head">
                      <span class="ag-txn-label">{d.label}</span>
                      <span class="num">
                        {fmt(i.left)} <span class="ag-sub ag-inline">/ {fmt(i.whole)}</span>
                      </span>
                    </span>
                    <Meter value={i.pct} color="var(--ag-rose-vif)" label={`${d.label} : ${pct(i.pct)} remboursé`} />
                    <span class="ag-txn-sub">
                      {i.done
                        ? "Remboursée"
                        : `${fmt(d.amount)} ${everyLabel(d.every).toLowerCase()}${i.next ? ` · prochaine ${dayShort(i.next.date)}` : ""}${i.end ? ` · fin ${monthYear(i.end)}` : ""}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <p class="ag-muted">Un prêt, une facture étalée : l’échéancier montre quand tu seras libre.</p>
      )}
    </section>
  );
}

/* ---------- Objectifs ---------- */
function GoalsCard({ s, today }: { s: State; today: string }) {
  return (
    <section class="ag-card ag-plan-card ag-plan-goals" aria-labelledby="ag-goals-title">
      <div class="ag-card-head">
        <h2 id="ag-goals-title">Objectifs</h2>
        <AddLink label="Ajouter un objectif" onClick={() => open({ kind: "goal" })} />
      </div>
      {s.goals.length ? (
        <ul class="ag-plan-list ag-plan-goal-list">
          {s.goals.map((g) => {
            const p = goalProgress(s, g, today);
            const color = readableOn(g.color, CARD);
            const acc = s.accounts.find((a) => a.id === g.accountId)?.name ?? "Compte supprimé";
            return (
              <li key={g.id} class="ag-plan-goal">
                <button type="button" class="ag-plan-item press" onClick={() => open({ kind: "goal", id: g.id })} aria-label={`Modifier l’objectif ${g.name}`}>
                  <span class="ag-plan-item-head">
                    <span class="ag-plan-goal-name">
                      <span style={{ color }}>
                        <Icon name={g.icon} size={18} />
                      </span>
                      <span class="ag-txn-label">{g.name}</span>
                    </span>
                    <span class="num">
                      {fmt(p.saved)} <span class="ag-sub ag-inline">/ {fmt(g.target)}</span>
                    </span>
                  </span>
                  <Meter value={p.pct} color={color} label={`${g.name} : ${pct(p.pct)}`} />
                  <span class="ag-txn-sub">
                    {p.rest
                      ? `Encore ${fmt(p.rest)}${g.date ? ` d’ici ${monthYear(g.date)}` : ""}${p.perMonth ? ` · ≈ ${fmt(p.perMonth)} par mois` : ""}`
                      : "Atteint"}{" "}
                    · {acc}
                  </span>
                </button>
                <button type="button" class="ag-pill ag-pill-soft ag-plan-aside press" onClick={() => open({ kind: "aside", id: g.id })}>
                  <Icon name="piggy-bank" size={18} />
                  Mettre de côté<span class="ag-sr-only"> pour {g.name}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="ag-muted">Un objectif est lié à un compte d’épargne : y mettre de l’argent est un virement, ton total ne bouge pas.</p>
      )}
    </section>
  );
}

export function Plan({ now }: { now: Date }) {
  const s = state.value;
  const today = iso(now);
  return (
    <div class="ag-plan">
      <div class="ag-plan-main">
        <PayCard s={s} today={today} />
        <FixesCard s={s} today={today} />
        <div class="ag-plan-pair">
          <DebtsCard s={s} today={today} />
          <GoalsCard s={s} today={today} />
        </div>
      </div>
      <div class="ag-plan-side">
        <ForecastPanel now={now} today={today} />
      </div>
    </div>
  );
}

const TITLES: Record<PlanSheet["kind"], [string, string]> = {
  pay: ["Ma paie", "Ma paie"],
  recurring: ["Nouveau paiement fixe", "Paiement fixe"],
  debt: ["Nouvelle dette", "Dette"],
  goal: ["Nouvel objectif", "Objectif"],
  aside: ["Mettre de côté", "Mettre de côté"],
};

/** Feuilles du Planning, rendues par App au niveau des autres feuilles (le reste de l'appli devient inerte). */
export function PlanSheets({ now }: { now: Date }) {
  const cur = planSheet.value;
  // La dernière feuille reste affichée le temps de l'animation de fermeture ; une clé neuve à chaque ouverture
  // (posée au moment d'ouvrir : le formulaire n'est monté qu'une fois).
  const last = lastPlanSheet.value;
  const today = iso(now);
  const close = () => (planSheet.value = null);
  const p = last?.p;
  const id = p && "id" in p ? p.id : undefined;
  const title = p ? TITLES[p.kind][id && p.kind !== "aside" ? 1 : 0] : "";
  const key = `${p?.kind}|${id ?? ""}|${last?.n ?? 0}`;
  return (
    <Sheet open={!!cur} onClose={close} title={title}>
      {p?.kind === "pay" && <PaySheet key={key} today={today} onDone={close} />}
      {p?.kind === "recurring" && <RecurringSheet key={key} id={id} today={today} onDone={close} />}
      {p?.kind === "debt" && <DebtSheet key={key} id={id} today={today} onDone={close} />}
      {p?.kind === "goal" && <GoalSheet key={key} id={id} today={today} onDone={close} />}
      {p?.kind === "aside" && id && <AsideSheet key={key} id={id} today={today} onDone={close} />}
    </Sheet>
  );
}
