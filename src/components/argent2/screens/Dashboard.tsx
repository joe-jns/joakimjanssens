// Accueil PC (≥ 1024 px), tableau de bord dense du design validé (2026-10-31) :
// rangée A graphe du solde + colonne de chiffres du mois ; rangée B paie de la semaine + à payer dans les 15 jours ;
// rangée C analyse des dépenses, dettes (demi-jauge), objectifs ; colonne droite Mes comptes + historique.
// Le téléphone garde `Home`. Les blocs communs viennent de Home, Plan et Accounts.
import { useMemo, useState } from "preact/hooks";
import { totalBalance } from "../../../lib/argent/balance";
import { CARD, readableOn } from "../../../lib/argent/color";
import { iso, MONTHS_LONG, MONTHS_SHORT, parse } from "../../../lib/argent/dates";
import type { State } from "../../../lib/argent/model";
import { fmt } from "../../../lib/argent/money";
import { change, chartAxis, periodSeries, spendSegments, type Bucket, type Period } from "../../../lib/argent/series";
import { state } from "../../../lib/argent/store";
import { categoryFilter, go, openPlanSheet } from "../nav";
import { SegBar, sharePct } from "../ui/SegBar";
import { AccountsCard } from "./Accounts";
import { BigMoney, DueSoon, History, Home, PERIODS, Trend, WeekPay, savings, signed } from "./Home";
import { Gauge, Meter } from "./Plan";
import { debtsSummary, goalProgress, monthYear } from "./plan-logic";

const H = 156; // hauteur de la zone des barres (px)
const noDot = (s: string) => s.replace(".", "");
const minus = (n: number) => (n ? fmt(-n) : fmt(0));
const axisNum = new Intl.NumberFormat("fr-BE", { maximumFractionDigits: 0 });

/** Étiquette sous la barre (« 27 oct ») et titre de la bulle (« Sem. du 27 oct »). */
function names(b: Bucket, period: Period): { short: string; long: string } {
  const d = parse(b.start);
  if (period === "semaine") {
    const short = `${d.getDate()} ${noDot(MONTHS_SHORT[d.getMonth()])}`;
    return { short, long: `Sem. du ${short}` };
  }
  if (period === "mois") {
    const m = MONTHS_LONG[d.getMonth()];
    return { short: noDot(MONTHS_SHORT[d.getMonth()]), long: `${m.charAt(0).toUpperCase()}${m.slice(1)} ${d.getFullYear()}` };
  }
  return { short: b.label, long: `Année ${b.label}` };
}

/* ---------- Rangée A : graphe du solde ---------- */
function PeriodChart({ s, today, period, setPeriod, buckets }: { s: State; today: string; period: Period; setPeriod: (p: Period) => void; buckets: Bucket[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const n = buckets.length;
  const current = n - 1;
  const chosen = sel ?? current;
  const shown = hover ?? chosen;
  const axis = chartAxis(Math.max(0, ...buckets.map((b) => b.income)), Math.max(0, ...buckets.map((b) => b.spending)));
  const range = axis.top + axis.bottom || 1;
  const y = (v: number) => ((axis.top - v) / range) * H;
  const zero = y(0);
  const tall = (v: number) => (v > 0 ? Math.max(3, (v / range) * H) : 0);
  const b = buckets[shown];
  const bubbleTop = Math.max(0, Math.min(H - 64, zero - tall(b.income)));
  const right = shown >= n / 2; // la bulle se place à gauche des barres de droite, à droite des autres

  const onKey = (e: KeyboardEvent, i: number) => {
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0 || to >= n) return;
    e.preventDefault();
    setSel(to); // la sélection suit le focus (un seul arrêt de tabulation : la barre choisie)
    const btns = (e.currentTarget as HTMLElement).parentElement!.querySelectorAll<HTMLButtonElement>(".ag-bar-col");
    btns[to]?.focus();
  };

  return (
    <section class="ag-card ag-dash-chart" aria-label="Graphe du solde">
      <div class="ag-chart-head">
        <div>
          <BigMoney value={totalBalance(s, today)} />
          <p class="ag-label">Tout mon argent, ce soir</p>
        </div>
        <div class="ag-dash-chart-tools">
          <div class="ag-seg ag-seg-sm" role="group" aria-label="Période">
            {PERIODS.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-pressed={period === p.id}
                onClick={() => {
                  setPeriod(p.id);
                  setSel(null);
                  setHover(null);
                }}
              >
                {p.long}
              </button>
            ))}
          </div>
          <p class="ag-dash-legend">
            <span class="ag-legend">
              <i style={{ background: "var(--ag-in)" }} /> Rentrées
            </span>
            <span class="ag-legend">
              <i style={{ background: "var(--ag-out)" }} /> Dépenses
            </span>
          </p>
        </div>
      </div>
      <div class="ag-dash-plot">
        <div class="ag-dash-axis" style={{ height: `${H}px` }} aria-hidden="true">
          {axis.ticks.map((v) => (
            <span key={v} style={{ top: `${y(v)}px` }}>
              {v < 0 ? `−${axisNum.format(-v)}` : axisNum.format(v)}
            </span>
          ))}
        </div>
        <div class="ag-dash-bars-wrap">
          <div class="ag-bars" style={{ height: `${H}px` }} role="group" aria-label="Rentrées et dépenses par période" onMouseLeave={() => setHover(null)}>
            <div class="ag-bars-zero" style={{ top: `${zero - 1}px` }} aria-hidden="true" />
            {buckets.map((x, i) => (
              <button
                key={x.start}
                type="button"
                class="ag-bar-col"
                tabIndex={i === chosen ? 0 : -1}
                data-active={i === chosen ? "" : undefined}
                data-shown={i === shown ? "" : undefined}
                aria-pressed={i === chosen}
                aria-label={`${names(x, period).long} : rentrées ${signed(x.income)}, dépenses ${minus(x.spending)}`}
                onClick={() => setSel(i)}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                onKeyDown={(e) => onKey(e, i)}
              >
                <span class="ag-bar ag-bar-in" style={{ top: `${zero - tall(x.income)}px`, height: `${tall(x.income)}px` }} />
                <span class="ag-bar ag-bar-out" style={{ top: `${zero + 2}px`, height: `${tall(x.spending)}px` }} />
              </button>
            ))}
            <div
              class="ag-dash-bubble num"
              aria-hidden="true"
              style={{
                top: `${bubbleTop}px`,
                left: right ? `calc(${(shown / n) * 100}% - 4px)` : `calc(${((shown + 1) / n) * 100}% + 4px)`,
                transform: right ? "translateX(-100%)" : undefined,
              }}
            >
              <span class="ag-dash-bubble-title">{names(b, period).long}</span>
              <span>{signed(b.income)}</span>
              <span>{minus(b.spending)}</span>
            </div>
          </div>
          <div class="ag-bar-labels" aria-hidden="true">
            {buckets.map((x, i) => (
              <span key={x.start} data-active={i === chosen ? "" : undefined}>
                {names(x, period).short}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/* ---------- Rangée A : colonne de chiffres du mois ---------- */
function MonthFigures({ s, today, now }: { s: State; today: string; now: Date }) {
  const [prev, cur] = useMemo(() => periodSeries(s, "mois", now, 2), [s.txns, today]);
  const month = MONTHS_LONG[now.getMonth()];
  const before = MONTHS_LONG[(now.getMonth() + 11) % 12];
  const { saved, delta } = savings(s, today, cur.start, cur.end);
  const inPct = change(cur.income, prev.income);
  const outPct = change(cur.spending, prev.spending);
  const pctText = (p?: number) => (p === undefined ? undefined : `${p > 0 ? "+" : ""}${p} % vs ${before}`);
  return (
    <section class="ag-card ag-dash-figures" aria-labelledby="ag-dash-figures-title">
      <h2 id="ag-dash-figures-title" class="ag-dash-figures-title">
        Ce mois · {month}
      </h2>
      <div>
        <p class="ag-label">Rentré</p>
        <p class="num ag-dash-figure">{fmt(cur.income)}</p>
        <Trend good={(inPct ?? 0) >= 0} text={pctText(inPct)} />
      </div>
      <div>
        <p class="ag-label">Dépensé</p>
        <p class="num ag-dash-figure">{fmt(cur.spending)}</p>
        <Trend good={(outPct ?? 0) <= 0} text={pctText(outPct)} />
      </div>
      <div>
        <p class="ag-label">Mis de côté en tout</p>
        <p class="num ag-dash-figure">{fmt(saved)}</p>
        <Trend good={delta >= 0} text={delta ? `${signed(delta)} ce mois` : undefined} />
      </div>
    </section>
  );
}

/* ---------- Rangée C : analyse des dépenses ---------- */
function SpendAnalysis({ s, today }: { s: State; today: string }) {
  const segs = useMemo(() => spendSegments(s, today.slice(0, 7)), [s.txns, s.categories, today]);
  const total = segs.reduce((a, r) => a + r.amount, 0);
  const m = MONTHS_LONG[parse(today).getMonth()];
  const open = (ids: string[]) => {
    categoryFilter.value = ids;
    go("activite");
  };
  return (
    <section class="ag-card ag-dash-block ag-dash-spend" aria-labelledby="ag-dash-spend-title">
      <div class="ag-card-head">
        <h2 id="ag-dash-spend-title">Analyse des dépenses</h2>
        <span class="ag-label">{m.charAt(0).toUpperCase() + m.slice(1)}</span>
      </div>
      <p class="num ag-dash-figure">{fmt(total)}</p>
      {segs.length ? (
        <>
          <SegBar segs={segs} onOpen={open} />
          <ul class="ag-dash-legend-list">
            {segs.map((x) => (
              <li key={x.ids.join()}>
                <button type="button" class="press" onClick={() => open(x.ids)}>
                  <i style={{ background: x.color }} />
                  <span>{x.name}</span>
                  <span class="num">{sharePct(x.share)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p class="ag-muted">Aucune dépense ce mois-ci.</p>
      )}
    </section>
  );
}

/* ---------- Rangée C : dettes ---------- */
function DebtsBlock({ s, today }: { s: State; today: string }) {
  const sum = debtsSummary(s, today);
  return (
    <section class="ag-card ag-dash-block ag-dash-debts" aria-labelledby="ag-dash-debts-title">
      <div class="ag-card-head">
        <h2 id="ag-dash-debts-title">Dettes</h2>
        {s.debts.length > 0 && <span class="ag-dash-free">{sum.free ? `Libre en ${monthYear(sum.free)}` : "Tout est remboursé"}</span>}
      </div>
      {s.debts.length ? (
        <button type="button" class="ag-dash-debts-body press" onClick={() => go("planning")} aria-label={`Dettes : ${sharePct(sum.pct)} remboursé, reste ${fmt(sum.left)}. Voir le planning`}>
          <span class="ag-gauge-wrap">
            <Gauge value={sum.pct} />
            <span class="ag-gauge-text">
              <span class="num-big">{sharePct(sum.pct)}</span>
              <span class="ag-sub">remboursé</span>
            </span>
          </span>
          <span class="ag-sub ag-center">
            Reste {fmt(sum.left)}
            {sum.open.length ? ` · ${sum.open.join(", ")}` : ""}
          </span>
        </button>
      ) : (
        <>
          <p class="ag-muted">Un prêt, une facture étalée : l’échéancier montre quand tu seras libre.</p>
          <button type="button" class="ag-link press" onClick={() => openPlanSheet({ kind: "debt" })}>
            + Ajouter une dette
          </button>
        </>
      )}
    </section>
  );
}

/* ---------- Rangée C : objectifs ---------- */
function GoalsBlock({ s, today }: { s: State; today: string }) {
  return (
    <section class="ag-card ag-dash-block ag-dash-goals" aria-labelledby="ag-dash-goals-title">
      <div class="ag-card-head">
        <h2 id="ag-dash-goals-title">Objectifs</h2>
        <button type="button" class="ag-link press" onClick={() => openPlanSheet({ kind: "goal" })} aria-label="Ajouter un objectif">
          + Ajouter
        </button>
      </div>
      {s.goals.length ? (
        <ul class="ag-dash-goal-list">
          {s.goals.map((g) => {
            const p = goalProgress(s, g, today);
            const color = readableOn(g.color, CARD);
            return (
              <li key={g.id}>
                <button type="button" class="ag-dash-goal press" onClick={() => openPlanSheet({ kind: "goal", id: g.id })} aria-label={`Objectif ${g.name} : ${fmt(p.saved)} sur ${fmt(g.target)}`}>
                  <span class="ag-plan-item-head">
                    <span class="ag-txn-label">{g.name}</span>
                    <span class="num ag-dash-goal-amount">
                      {fmt(p.saved).replace(/\s*€/, "")} / {fmt(g.target)}
                    </span>
                  </span>
                  <Meter value={p.pct} color={color} label={`${g.name} : ${sharePct(p.pct)}`} />
                  <span class="ag-txn-sub">{p.rest ? `Encore ${fmt(p.rest)}${g.date ? ` d’ici ${MONTHS_LONG[parse(g.date).getMonth()]}` : ""}` : "Atteint"}</span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="ag-muted">Un objectif est lié à un compte d’épargne : y mettre de l’argent ne change pas ton total.</p>
      )}
    </section>
  );
}

export function Dashboard({ now }: { now: Date }) {
  const s = state.value;
  const today = iso(now);
  const [period, setPeriod] = useState<Period>("semaine");
  const firstRun = !s.txns.length && !s.recurring.length && !s.debts.length && !s.accounts.some((a) => a.anchor);
  if (firstRun) return <Home now={now} />;
  return <Board s={s} now={now} today={today} period={period} setPeriod={setPeriod} />;
}

function Board({ s, now, today, period, setPeriod }: { s: State; now: Date; today: string; period: Period; setPeriod: (p: Period) => void }) {
  const buckets = useMemo(() => periodSeries(s, period, now, period === "annee" ? 4 : 6), [s.txns, period, today]);
  return (
    <div class="ag-home ag-dash">
      <div class="ag-dash-main">
        <div class="ag-dash-row ag-dash-a">
          <PeriodChart s={s} today={today} period={period} setPeriod={setPeriod} buckets={buckets} />
          <MonthFigures s={s} today={today} now={now} />
        </div>
        <div class="ag-dash-row ag-dash-b">
          <WeekPay s={s} today={today} now={now} />
          <DueSoon s={s} today={today} title="À payer dans les 15 jours" />
        </div>
        <div class="ag-dash-row ag-dash-c">
          <SpendAnalysis s={s} today={today} />
          <DebtsBlock s={s} today={today} />
          <GoalsBlock s={s} today={today} />
        </div>
      </div>
      <div class="ag-dash-side">
        <AccountsCard s={s} today={today} />
        <History s={s} today={today} />
      </div>
    </div>
  );
}
