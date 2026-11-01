// Accueil (design validé du 2026-10-31) : graphe du solde, trois chiffres, paie de la semaine,
// à payer bientôt, dépenses du mois (barre segmentée), historique. Premier lancement : carte d'accueil.
import { useState } from "preact/hooks";
import { accountBalance, effectiveDate, totalBalance } from "../../../lib/argent/balance";
import { addDays, DAYS_LONG, DAYS_SHORT as DAYS, isWorkday, iso, mondayOf, MONTHS_LONG, MONTHS_SHORT, parse, payday } from "../../../lib/argent/dates";
import { readableOn } from "../../../lib/argent/color";
import type { State, Txn } from "../../../lib/argent/model";
import { fmt, round2 } from "../../../lib/argent/money";
import { upcoming } from "../../../lib/argent/schedule";
import { change, periodSeries, spendSegments, type Bucket, type Period } from "../../../lib/argent/series";
import { refreshAuto, state, update } from "../../../lib/argent/store";
import { skipDays, unskipDay } from "../../../lib/argent/workdays";
import { categoryFilter, go, openSheet } from "../nav";
import { Icon } from "../ui/Icon";
import { SegBar, sharePct } from "../ui/SegBar";

export const PERIODS: { id: Period; short: string; long: string }[] = [
  { id: "semaine", short: "Sem.", long: "Semaine" },
  { id: "mois", short: "Mois", long: "Mois" },
  { id: "annee", short: "An", long: "Année" },
];

export const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
export const ofMonth = (m: number) => (/^[aeiouy]/.test(MONTHS_LONG[m]) ? `d’${MONTHS_LONG[m]}` : `de ${MONTHS_LONG[m]}`);

export function relDay(day: string, today: string): string {
  if (day === today) return "Aujourd’hui";
  if (day === addDays(today, -1)) return "Hier";
  if (day === addDays(today, 1)) return "Demain";
  const d = parse(day);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}

/** « 2 527,30 € » → gros « 2 527 » + petit « ,30 € ». */
export function BigMoney({ value }: { value: number }) {
  const s = fmt(value);
  const i = s.lastIndexOf(",");
  if (i < 0) return <span class="num-big ag-big">{s}</span>;
  return (
    <span class="num-big ag-big">
      {s.slice(0, i)}
      <span class="ag-big-cents">{s.slice(i)}</span>
    </span>
  );
}

/* ---------- Graphe du solde ---------- */
function BalanceChart({ s, today, period, setPeriod, buckets }: { s: State; today: string; period: Period; setPeriod: (p: Period) => void; buckets: Bucket[] }) {
  const [sel, setSel] = useState<number | null>(null);
  const current = buckets.length - 1;
  const active = sel ?? current;
  const maxIn = Math.max(0, ...buckets.map((b) => b.income));
  const maxOut = Math.max(0, ...buckets.map((b) => b.spending));
  const span = maxIn + maxOut || 1;
  const H = 168;
  const top = maxIn + maxOut ? (maxIn / span) * H : H / 2;
  const h = (v: number) => (v > 0 ? Math.max(3, (v / span) * H) : 0);
  const b = buckets[active];
  return (
    <section class="ag-card ag-home-chart" aria-label="Graphe du solde">
      <div class="ag-chart-head">
        <div>
          <p class="ag-label ag-phone-only">Tout mon argent</p>
          <BigMoney value={totalBalance(s, today)} />
          <p class="ag-label ag-pc-only">Tout mon argent, ce soir</p>
        </div>
        <div class="ag-seg ag-seg-sm" role="group" aria-label="Période">
          {PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              aria-pressed={period === p.id}
              onClick={() => {
                setPeriod(p.id);
                setSel(null);
              }}
            >
              <span class="ag-phone-only">{p.short}</span>
              <span class="ag-pc-only">{p.long}</span>
            </button>
          ))}
        </div>
      </div>
      <div class="ag-bars" style={{ height: `${H}px` }}>
        <div class="ag-bars-zero" style={{ top: `${top}px` }} aria-hidden="true" />
        {buckets.map((x, i) => (
          <button
            key={x.start}
            type="button"
            class="ag-bar-col"
            data-active={i === active ? "" : undefined}
            aria-pressed={i === active}
            aria-label={`${x.label} : rentrées ${fmt(x.income)}, dépenses ${fmt(x.spending)}`}
            onClick={() => setSel(i)}
          >
            <span class="ag-bar ag-bar-in" style={{ top: `${top - h(x.income)}px`, height: `${h(x.income)}px` }} />
            <span class="ag-bar ag-bar-out" style={{ top: `${top + 2}px`, height: `${h(x.spending)}px` }} />
          </button>
        ))}
      </div>
      <div class="ag-bar-labels" aria-hidden="true">
        {buckets.map((x, i) => (
          <span key={x.start} data-active={i === active ? "" : undefined}>
            {x.label}
          </span>
        ))}
      </div>
      <div class="ag-chart-foot">
        <span class="ag-legend">
          <i style={{ background: "var(--ag-in)" }} /> Rentrées
        </span>
        <span class="ag-legend">
          <i style={{ background: "var(--ag-out)" }} /> Dépenses
        </span>
        <span class="ag-chart-detail num" aria-live="polite">
          {b.label} : {signed(b.income)} / {fmt(b.spending ? -b.spending : 0)}
        </span>
      </div>
    </section>
  );
}

/* ---------- Trois chiffres ---------- */
/** Total des comptes d'épargne ce soir, et ce qui y est entré (ou sorti) entre `start` et `end`. */
export function savings(s: State, today: string, start: string, end: string): { saved: number; delta: number } {
  const list = s.accounts.filter((a) => a.kind === "epargne");
  const saved = round2(list.reduce((t, a) => t + accountBalance(s, a.id, today), 0));
  const ids = new Set(list.map((a) => a.id));
  const delta = round2(
    s.txns.filter((t) => ids.has(t.accountId) && effectiveDate(t) >= start && effectiveDate(t) <= end && effectiveDate(t) <= today).reduce((x, t) => x + t.amount, 0),
  );
  return { saved, delta };
}

export function Trend({ pct, good, text }: { pct?: number; good: boolean; text?: string }) {
  if (pct === undefined && !text) return <p class="ag-trend">—</p>;
  const up = text ? !text.startsWith("−") && !text.startsWith("-") : pct! >= 0;
  return (
    <p class={`ag-trend num ${good ? "is-good" : "is-bad"}`}>
      <Icon name={up ? "arrow-up-right" : "arrow-down-right"} size={14} strokeWidth={2} />
      {text ?? `${pct! > 0 ? "+" : ""}${pct} %`}
    </p>
  );
}

function Figures({ s, today, buckets, period }: { s: State; today: string; buckets: Bucket[]; period: Period }) {
  const cur = buckets[buckets.length - 1];
  const prev = buckets[buckets.length - 2];
  const { saved, delta: savedDelta } = savings(s, today, cur.start, cur.end);
  const inPct = change(cur.income, prev?.income ?? 0);
  const outPct = change(cur.spending, prev?.spending ?? 0);
  const vs = period === "semaine" ? "vs semaine d’avant" : period === "mois" ? `vs ${prev?.label ?? ""}` : "vs année d’avant";
  return (
    <section class="ag-figures" aria-label="Chiffres de la période">
      <div class="ag-card ag-figure">
        <p class="ag-label">Rentré</p>
        <p class="num ag-figure-value">{fmt(cur.income)}</p>
        <Trend pct={inPct} good={(inPct ?? 0) >= 0} />
        <p class="ag-figure-vs ag-pc-only">{vs}</p>
      </div>
      <div class="ag-card ag-figure">
        <p class="ag-label">Dépensé</p>
        <p class="num ag-figure-value">{fmt(cur.spending)}</p>
        <Trend pct={outPct} good={(outPct ?? 0) <= 0} />
        <p class="ag-figure-vs ag-pc-only">{vs}</p>
      </div>
      <div class="ag-card ag-figure">
        <p class="ag-label">De côté</p>
        <p class="num ag-figure-value">{fmt(saved)}</p>
        <Trend good={savedDelta >= 0} text={savedDelta ? signed(savedDelta) : undefined} />
        <p class="ag-figure-vs ag-pc-only">sur la période</p>
      </div>
    </section>
  );
}

/* ---------- Paie de la semaine ---------- */
export function WeekPay({ s, today, now }: { s: State; today: string; now: Date }) {
  const { work } = s;
  if (!work.start) {
    return (
      <section class="ag-card ag-home-pay" aria-label="Paie de la semaine">
        <div class="ag-card-head">
          <h2>Paie de la semaine</h2>
        </div>
        <p class="ag-muted">Indique ton salaire à la journée pour voir ta paie arriver.</p>
        <button type="button" class="ag-link press" onClick={() => go("planning")}>
          Régler ma paie dans Planning
        </button>
      </section>
    );
  }
  const monday = mondayOf(today);
  const paid = work.paidWeeks.includes(monday);
  const skipped = new Set(work.skipped);
  const byDay = new Map<string, number>();
  for (const t of s.txns) if (t.source === "journee") byDay.set(t.date, (byDay.get(t.date) ?? 0) + t.amount);
  const createdToday = now.getHours() >= 20;
  const days = [0, 1, 2, 3, 4].map((i) => {
    const d = addDays(monday, i);
    const inRange = d >= work.start! && (!work.end || d <= work.end) && isWorkday(d);
    const off = skipped.has(d);
    const has = byDay.get(d);
    const future = d > today || (d === today && !createdToday);
    const amount = off || !inRange ? 0 : has ?? (future && !paid ? work.dayAmount : 0);
    return { d, inRange, off, amount };
  });
  const total = round2(days.reduce((a, x) => a + x.amount, 0));
  const pd = parse(payday(monday));
  const payLabel = `${paid ? "Reçue" : "Versée"} ${DAYS_LONG[pd.getDay()]} ${pd.getDate()} ${MONTHS_LONG[pd.getMonth()]}`;

  const toggle = (d: string, off: boolean) => {
    if (off) {
      update((x) => unskipDay(x, d));
      refreshAuto(new Date());
    } else update((x) => skipDays(x, [d]));
  };

  return (
    <section class="ag-card ag-home-pay" aria-label="Paie de la semaine">
      <div class="ag-card-head">
        <div>
          <h2>Paie de la semaine</h2>
          <p class="ag-sub">{payLabel}</p>
        </div>
        <p class="num ag-head-amount">{signed(total)}</p>
      </div>
      <div class="ag-days">
        {days.map(({ d, inRange, off }) => {
          const dt = parse(d);
          const name = `${DAYS_LONG[dt.getDay()]} ${dt.getDate()} ${MONTHS_LONG[dt.getMonth()]}`;
          return (
            <button
              key={d}
              type="button"
              class="ag-day press"
              data-off={off ? "" : undefined}
              disabled={!inRange || paid}
              aria-pressed={inRange && !off}
              aria-label={name}
              title={!inRange ? "Hors période de travail" : off ? "Pas travaillé : toucher pour remettre" : "Travaillé : toucher pour retirer"}
              onClick={() => toggle(d, off)}
            >
              <span>{DAYS[dt.getDay()].replace(".", "")}</span>
              <span class="num">{dt.getDate()}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/* ---------- À payer bientôt ---------- */
export function DueSoon({ s, today, title = "À payer dans 15 jours" }: { s: State; today: string; title?: string }) {
  const list = upcoming(s, today, 15).filter((u) => u.kind !== "paie" && u.amount < 0);
  const total = round2(list.reduce((a, u) => a + u.amount, 0));
  const short = (day: string) => {
    const d = parse(day);
    return `${DAYS[d.getDay()]} ${d.getDate()}`;
  };
  return (
    <button type="button" class="ag-due press" onClick={() => go("planning")} aria-label={`${title} : ${fmt(total)}. Voir le planning`}>
      <span class="ag-due-text">
        <span class="ag-due-title">{title}</span>
        <span class="ag-due-sub">{list.length ? list.slice(0, 4).map((u) => `${u.label} ${short(u.date)}`).join(" · ") : "Rien de prévu"}</span>
      </span>
      <span class="num-big ag-due-total">{fmt(total)}</span>
    </button>
  );
}

/* ---------- Dépenses du mois ---------- */
function MonthSpend({ s, today }: { s: State; today: string }) {
  const month = today.slice(0, 7);
  const segs = spendSegments(s, month);
  const total = round2(segs.reduce((a, r) => a + r.amount, 0));
  const open = (ids: string[]) => {
    categoryFilter.value = ids;
    go("activite");
  };
  return (
    <section class="ag-card ag-home-spend" aria-label="Dépenses du mois">
      <div class="ag-card-head">
        <h2>Dépenses {ofMonth(parse(today).getMonth())}</h2>
        <p class="num ag-head-amount">{fmt(total)}</p>
      </div>
      {segs.length ? (
        <>
          <SegBar segs={segs} onOpen={open} />
          <ul class="ag-seg-legend">
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
      <button type="button" class="ag-link press" onClick={() => openSheet("categories")}>
        Gérer les catégories
      </button>
    </section>
  );
}

/* ---------- Historique ---------- */
export function History({ s, today }: { s: State; today: string }) {
  const list = s.txns
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.date <= today)
    .sort((a, b) => b.t.date.localeCompare(a.t.date) || b.i - a.i)
    .slice(0, 5)
    .map(({ t }) => t);
  const acc = (id: string) => s.accounts.find((a) => a.id === id)?.name ?? "";
  const iconOf = (t: Txn) => {
    if (t.transferId) return { icon: "arrow-left-right", color: "var(--ag-ink)" };
    const c = s.categories.find((x) => x.id === t.categoryId);
    return c ? { icon: c.icon, color: readableOn(c.color) } : { icon: "ellipsis", color: "var(--ag-muted)" };
  };
  return (
    <section class="ag-card ag-home-history" aria-label="Historique">
      <div class="ag-card-head">
        <h2>Historique</h2>
        <button type="button" class="ag-link press" onClick={() => go("activite")}>
          Tout voir
        </button>
      </div>
      {list.length ? (
        <ul class="ag-txns">
          {list.map((t) => {
            const ic = iconOf(t);
            const sub = `${relDay(t.date, today)} · ${t.status === "prevu" ? "prévu" : acc(t.accountId)}`;
            return (
              <li key={t.id}>
                <span class="ag-txn-icon" style={{ color: ic.color }}>
                  <Icon name={ic.icon} size={18} />
                </span>
                <span class="ag-txn-main">
                  <span class="ag-txn-label" title={t.label}>
                    {t.label}
                  </span>
                  <span class="ag-txn-sub" title={sub}>
                    {sub}
                  </span>
                </span>
                <span class={`num ag-txn-amount${t.amount > 0 ? " is-in" : ""}`}>{t.amount > 0 ? `+${fmt(t.amount)}` : fmt(t.amount)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p class="ag-muted">Aucune opération pour l’instant.</p>
      )}
    </section>
  );
}

/* ---------- Premier lancement ---------- */
export function FirstRun({ s }: { s: State }) {
  const paySet = !!s.work.start;
  return (
    <section class="ag-card ag-first" aria-label="Pour commencer">
      <h2>Bienvenue</h2>
      <p class="ag-muted">Rien n’est encore enregistré. Deux étapes pour que l’accueil se remplisse :</p>
      <ol class="ag-steps">
        <li>
          <button type="button" class="ag-step press" onClick={() => go("planning")}>
            <span class="ag-step-n num" data-done={paySet ? "" : undefined}>{paySet ? <Icon name="check" size={16} strokeWidth={2.5} /> : "1"}</span>
            <span class="ag-step-text">
              <span>Régler ma paie à la journée</span>
              <span class="ag-sub">Dans Planning : montant par jour et date de début.</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        </li>
        <li>
          <button type="button" class="ag-step press" onClick={() => go("comptes")}>
            <span class="ag-step-n num">2</span>
            <span class="ag-step-text">
              <span>Importer un extrait de compte</span>
              <span class="ag-sub">Dans Comptes : le solde et les opérations se remplissent.</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        </li>
      </ol>
      <button type="button" class="ag-link press" onClick={() => openSheet("add")}>
        Ou ajouter une opération à la main
      </button>
    </section>
  );
}

export function Home({ now }: { now: Date }) {
  const s = state.value;
  const today = iso(now);
  const [period, setPeriod] = useState<Period>("semaine");
  const firstRun = !s.txns.length && !s.recurring.length && !s.debts.length && !s.accounts.some((a) => a.anchor);
  if (firstRun) {
    return (
      <div class="ag-home ag-home-first">
        <FirstRun s={s} />
        {s.work.start && <WeekPay s={s} today={today} now={now} />}
      </div>
    );
  }
  const buckets = periodSeries(s, period, now, period === "annee" ? 4 : 6);
  return (
    <div class="ag-home">
      <BalanceChart s={s} today={today} period={period} setPeriod={setPeriod} buckets={buckets} />
      <Figures s={s} today={today} buckets={buckets} period={period} />
      <WeekPay s={s} today={today} now={now} />
      <DueSoon s={s} today={today} />
      <MonthSpend s={s} today={today} />
      <History s={s} today={today} />
    </div>
  );
}
