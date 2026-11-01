import { addDays, isWorkday, iso, mondayOf } from "./dates";
import type { State, Txn } from "./model";


// Ajoute une journée « prévue » pour chaque jour travaillé écoulé (le jour même dès 20 h). Identifiant
// stable « journee:<date> » : deux appareils créent la même ligne, la synchro ne la double pas.
export function syncWorkdays(state: State, now: Date): State {
  const { work } = state;
  if (!work.start) return state;
  const today = iso(now);
  let last = now.getHours() >= 20 ? today : addDays(today, -1);
  if (work.end && work.end < last) last = work.end;

  const have = new Set(state.txns.filter((t) => t.source === "journee").map((t) => t.date));
  const skipped = new Set(work.skipped);
  const paid = new Set(work.paidWeeks);
  const added: Txn[] = [];
  for (let d = work.start; d <= last; d = addDays(d, 1)) {
    if (!isWorkday(d) || have.has(d) || skipped.has(d) || paid.has(mondayOf(d))) continue;
    added.push({
      id: `journee:${d}`,
      accountId: work.accountId ?? "cbc",
      date: d,
      amount: work.dayAmount,
      label: "Journée",
      categoryId: "salaire",
      status: "prevu",
      source: "journee",
    });
  }
  if (!added.length) return state;
  return { ...state, txns: [...state.txns, ...added] };
}

// Retire ces journées et les mémorise pour ne jamais les recréer.
export function skipDays(state: State, days: string[]): State {
  const set = new Set(days);
  return {
    ...state,
    txns: state.txns.filter((t) => !(t.source === "journee" && set.has(t.date))),
    work: { ...state.work, skipped: [...new Set([...state.work.skipped, ...days])] },
  };
}

export function unskipDay(state: State, day: string): State {
  return { ...state, work: { ...state.work, skipped: state.work.skipped.filter((d) => d !== day) } };
}
