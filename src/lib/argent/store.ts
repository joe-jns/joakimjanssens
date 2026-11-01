import { signal } from "@preact/signals";
import { emptyState, type State } from "./model";
import { syncWorkdays } from "./workdays";
import { materializeSchedule } from "./schedule";
import { todayIso } from "./dates";

export const KEY = "argent:v2";

/** Canal des événements (« argent:saved ») ; aussi relayé sur window quand il existe. */
export const bus = new EventTarget();

function load(): State {
  const base = emptyState();
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return base;
    // Les champs absents d'une ancienne sauvegarde prennent leur valeur par défaut.
    const out: any = { ...base, ...saved };
    // Contrôle léger de la forme : un tableau attendu qui n'en est pas un reprend son défaut.
    for (const k of Object.keys(base) as (keyof State)[]) {
      if (Array.isArray(base[k]) && !Array.isArray(out[k])) out[k] = base[k];
    }
    const w = saved.work && typeof saved.work === "object" && !Array.isArray(saved.work) ? saved.work : {};
    out.work = { ...base.work, ...w };
    for (const k of Object.keys(base.work) as (keyof State["work"])[]) {
      if (Array.isArray(base.work[k]) && !Array.isArray(out.work[k])) out.work[k] = base.work[k];
    }
    return out as State;
  } catch {
    return base;
  }
}

export const state = signal<State>(load());

/** Relit le stockage dans le signal (après une synchro, ou en test). */
export function reload(): void {
  state.value = load();
}

function emit(): void {
  bus.dispatchEvent(new Event("argent:saved"));
  const w = (globalThis as any).window;
  if (w?.dispatchEvent) w.dispatchEvent(new Event("argent:saved"));
}

/** Problème d'enregistrement à montrer (mémoire du navigateur pleine…) ; null quand tout va bien. */
export const saveError = signal<string | null>(null);

function persist(s: State): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(s));
    saveError.value = null;
  } catch (e) {
    const quota = e instanceof DOMException && (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED");
    saveError.value = quota
      ? "Mémoire du navigateur pleine : la dernière modification n’est pas enregistrée. Exporte une sauvegarde puis libère de la place."
      : "Enregistrement impossible dans ce navigateur : la dernière modification sera perdue à la fermeture.";
  }
}

export function update(fn: (s: State) => State): void {
  const next = fn(state.value);
  state.value = next;
  persist(next);
  emit();
}

/** Journées de travail + échéances automatiques, jusqu'à aujourd'hui. */
export function refreshAuto(now: Date): void {
  const before = state.value;
  const next = materializeSchedule(syncWorkdays(before, now), todayIso(now));
  if (JSON.stringify(next) === JSON.stringify(before)) return;
  update(() => next);
}
