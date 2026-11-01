// Synchro PC ↔ téléphone : tout est chiffré ici avec le code, le serveur ne garde qu'un bloc illisible.
import { signal } from "@preact/signals";
import { KEY, bus, reload, refreshAuto, state } from "./store";
import type { State, Txn } from "./model";

export const KEYS = [KEY]; // ce qui voyage
export type Cfg = { code: string; synced: number };
export type Remote = { v: number; data: string };
export type SyncStatus = { enabled: boolean; code?: string; lastOk?: number; message?: string };

const API = "/argent-sync.php";
// Espace propre à la v2 (réglages, « à envoyer », saisies en attente, identifiant serveur) : jamais celui de
// l'ancienne version, qui écraserait ou effacerait les données de l'autre.
const CFG_KEY = "argent:sync:v2";
const DIRTY_KEY = "argent:sync:v2:dirty";
const PENDING_KEY = "argent:sync:v2:pending";
const FOREIGN = "Données d’une autre version ignorées.";
const enc = new TextEncoder();

/** Dépendances remplaçables (tests). */
export const deps = {
  fetch: (...a: Parameters<typeof fetch>) => globalThis.fetch(...a),
  now: () => Date.now(),
  online: () => (globalThis.navigator ? globalThis.navigator.onLine !== false : true),
  debounce: 1500,
  origin: () => globalThis.location?.origin ?? "",
};

const ls = () => globalThis.localStorage;
function read<T>(k: string, d: T): T {
  try {
    return JSON.parse(ls().getItem(k) || "") ?? d;
  } catch {
    return d;
  }
}
function write(k: string, v: unknown) {
  try {
    if (v === null) ls().removeItem(k);
    else ls().setItem(k, typeof v === "string" ? v : JSON.stringify(v));
  } catch {}
}

let cfg: Cfg | null = null;
let dirty = false;
let lastOk = 0;
let busy = false;
let edits = 0; // compteur de modifications locales : détecte une édition faite pendant un envoi
let notice: string | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
// Saisies créées ici depuis la dernière synchro réussie (ids) : gardées si le distant gagne sans elles.
let pending: string[] = [];
// Saisies connues au dernier passage : une nouvelle saisie est celle qui n'y est pas.
let seenSaisies = new Set<string>();

export const syncStatus = signal<SyncStatus>({ enabled: false });
function publish(message?: string) {
  syncStatus.value = { enabled: !!cfg, code: cfg?.code, lastOk: lastOk || undefined, message: message ?? notice };
}
const setDirty = (v: boolean) => write(DIRTY_KEY, (dirty = v));
const setCfg = (c: Cfg | null) => write(CFG_KEY, (cfg = c));
const setPending = (ids: string[]) => write(PENDING_KEY, (pending = ids).length ? ids : null);
const saisieIds = (s: State) => s.txns.filter((t) => t.source === "saisie").map((t) => t.id);
/** Oublie les saisies en attente (l'état d'ici est pris pour référence). */
function resetPending() {
  setPending([]);
  seenSaisies = new Set(saisieIds(state.value));
}

// --- Code, identifiant et clé de chiffrement ---
const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
export const newCode = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => ALPHA[b % ALPHA.length])
    .join("")
    .replace(/(.{4})(?!$)/g, "$1-");
export const clean = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(.{4})(?!$)/g, "$1-");
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

const cache = new Map<string, { id: string; key: CryptoKey }>();
export async function deriveKey(code: string) {
  if (cache.has(code)) return cache.get(code)!;
  const id = hex(await crypto.subtle.digest("SHA-256", enc.encode(`argent-id-v2:${code}`)));
  const base = await crypto.subtle.importKey("raw", enc.encode(code), "PBKDF2", false, ["deriveKey"]);
  const key = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("argent-sync-v1"), iterations: 200000, hash: "SHA-256" },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  const s = { id, key };
  cache.set(code, s);
  return s;
}
export async function seal(code: string, text: string) {
  const { key } = await deriveKey(code);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(text)));
  const out = new Uint8Array(12 + ct.length);
  out.set(iv);
  out.set(ct, 12);
  // btoa par morceaux : un gros bloc ferait déborder la pile.
  let s = "";
  for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function open(code: string, data: string) {
  const { key } = await deriveKey(code);
  const raw = unb64(data);
  const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv: raw.subarray(0, 12) }, key, raw.subarray(12));
  return new TextDecoder().decode(pt);
}

// --- Échanges avec le serveur ---
const snapshot = () => JSON.stringify(Object.fromEntries(KEYS.map((k) => [k, ls().getItem(k)])));
/** Bloc déchiffré d'une donnée v2, sinon null (autre version, forme inattendue) : on n'y touche pas. */
function parseRemote(text: string): Record<string, string> | null {
  try {
    const all = JSON.parse(text);
    if (!all || typeof all !== "object" || typeof all[KEY] !== "string") return null;
    const st = JSON.parse(all[KEY]);
    if (!st || typeof st !== "object" || Array.isArray(st) || st.v !== 2) return null;
    return all;
  } catch {
    return null;
  }
}
const url = async (code: string) => `${API}?id=${(await deriveKey(code)).id}`;

async function fetchRemote(code: string): Promise<Remote | null> {
  const r = await deps.fetch(await url(code), { cache: "no-store" });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(String(r.status));
  return (await r.json()) as Remote;
}

// Règle « le distant gagne » : si la version distante n'est pas celle qu'on connaît, on la prend, à une
// exception près : les saisies faites ici depuis la dernière synchro réussie (absentes du distant) sont
// remises dedans, puis renvoyées. Les autres modifications locales pas encore envoyées sont écrasées
// (choix assumé, on prévient l'utilisateur). Rend true s'il faut renvoyer.
async function takeRemote(remote: Remote, warn = true): Promise<boolean> {
  const code = cfg?.code;
  if (!code) return false;
  const plain = await open(code, remote.data);
  if (!cfg || cfg.code !== code) return false; // synchro arrêtée (ou changée) pendant le déchiffrement
  const all = parseRemote(plain);
  if (!all) {
    notice = FOREIGN;
    return false;
  }
  const remoteState = JSON.parse(all[KEY]) as State;
  const remoteTxns: Txn[] = Array.isArray(remoteState.txns) ? remoteState.txns : [];
  const there = new Set(remoteTxns.map((t) => t.id));
  const want = new Set(pending);
  const keep = state.value.txns.filter((t) => t.source === "saisie" && want.has(t.id) && !there.has(t.id));
  if (keep.length) all[KEY] = JSON.stringify({ ...remoteState, txns: [...remoteTxns, ...keep] });
  const dropped = warn && dirty;
  for (const k of KEYS) write(k, all[k] ?? null);
  setCfg({ ...cfg, synced: remote.v });
  reload();
  // Les saisies venues de l'autre appareil ne sont pas « nouvelles ici » ; restent en attente celles remises.
  seenSaisies = new Set(saisieIds(state.value));
  setPending(keep.map((t) => t.id));
  setDirty(keep.length > 0);
  refreshAuto(new Date());
  if (dropped)
    notice = keep.length
      ? "Les changements de l’autre appareil ont été repris ; tes nouvelles saisies sont gardées."
      : "Les changements de l’autre appareil ont été repris.";
  return keep.length > 0;
}

async function push(retry = true): Promise<void> {
  if (!cfg) return;
  const code = cfg.code;
  const v = Math.max(deps.now(), cfg.synced + 1);
  const seen = edits;
  const sent = pending.slice();
  const data = await seal(code, snapshot());
  if (!cfg || cfg.code !== code) return;
  const r = await deps.fetch(await url(code), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ v, base: cfg.synced, data }),
  });
  if (r.status === 409) {
    const body = (await r.json()) as Partial<Remote>;
    if (!cfg || cfg.code !== code) return; // synchro arrêtée pendant la lecture : on ne recrée rien
    // Espace vide sur le serveur (fichier disparu) : on repart de la version 0.
    if (typeof body.data !== "string") {
      setCfg({ ...cfg, synced: 0 });
      return retry ? push(false) : undefined;
    }
    if (await takeRemote(body as Remote)) schedule();
    return;
  }
  if (!r.ok) throw new Error(String(r.status));
  if (!cfg || cfg.code !== code) return; // synchro arrêtée pendant l'envoi : on ne recrée pas une config sans code
  setCfg({ ...cfg, synced: v });
  const gone = new Set(sent);
  setPending(pending.filter((id) => !gone.has(id)));
  // Une modification faite pendant l'envoi n'est pas dans ce bloc : on garde « à envoyer » et on replanifie.
  if (edits === seen) setDirty(false);
  else {
    setDirty(true);
    schedule();
  }
}

function schedule() {
  clearTimeout(timer);
  timer = setTimeout(syncNow, deps.debounce);
}

export async function syncNow(): Promise<void> {
  if (!cfg || busy || !deps.online()) return;
  busy = true;
  notice = undefined;
  try {
    const remote = await fetchRemote(cfg.code);
    if (!cfg) return; // synchro arrêtée pendant la réception
    if (remote && remote.v !== cfg.synced) {
      if (await takeRemote(remote)) await push();
    } else if (dirty || !remote) await push();
    if (!cfg) return;
    lastOk = deps.now();
    publish();
  } catch (e) {
    console.error(e);
    publish(e instanceof DOMException ? "Code incorrect pour ces données." : "Synchro impossible pour l’instant, nouvel essai plus tard.");
  } finally {
    busy = false;
  }
}

export async function enableSync(): Promise<void> {
  setCfg({ code: newCode(), synced: 0 });
  resetPending();
  setDirty(true);
  publish("Envoi…");
  await syncNow();
}

export async function joinSync(raw: string): Promise<void> {
  const code = clean(raw);
  if (code.length < 24) return publish("Ce code est trop court.");
  busy = true; // pendant la liaison, aucune synchro avec l'ancien code
  publish("Recherche…");
  try {
    const remote = await fetchRemote(code);
    if (!remote) return publish("Rien trouvé pour ce code. Vérifie-le sur l’autre appareil.");
    // Vérifie le code et la version avant de toucher aux données d'ici.
    if (!parseRemote(await open(code, remote.data))) return publish(FOREIGN);
    setCfg({ code, synced: 0 });
    resetPending(); // rejoindre remplace les données d'ici : rien à garder
    await takeRemote(remote, false);
    lastOk = deps.now();
    publish();
  } catch (e) {
    publish(e instanceof DOMException ? "Code incorrect." : "Pas de connexion, réessaie.");
  } finally {
    busy = false;
  }
}

export function stopSync(): void {
  clearTimeout(timer);
  setCfg(null);
  setDirty(false);
  setPending([]);
  publish("Synchro arrêtée sur cet appareil. Les données d’ici restent.");
}

export async function copyLink(): Promise<string | undefined> {
  if (!cfg) return;
  const link = `${deps.origin()}/argent/#sync=${cfg.code}`;
  try {
    await globalThis.navigator.clipboard.writeText(link);
    publish("Lien copié. Colle-le sur l’autre appareil.");
  } catch {
    publish(link);
  }
  return link;
}

function onSaved() {
  if (!cfg) return;
  // Nouvelles saisies d'ici : en attente jusqu'au prochain envoi réussi.
  const ids = saisieIds(state.value);
  const fresh = ids.filter((id) => !seenSaisies.has(id));
  seenSaisies = new Set(ids);
  if (fresh.length) setPending([...new Set([...pending, ...fresh])]);
  edits++;
  setDirty(true);
  schedule();
}

/** Renvoie true si une liaison a été lancée. */
function fromLink(): boolean {
  const code = /#sync=([a-z0-9-]+)/i.exec(location.hash)?.[1];
  if (!code) return false;
  history.replaceState(null, "", location.pathname);
  if (cfg && cfg.code === clean(code)) return false;
  void joinSync(code);
  return true;
}

let bound = false;
export function attachBus(): void {
  if (bound) return;
  bound = true;
  bus.addEventListener("argent:saved", onSaved);
}

let wired = false;
/** À appeler une fois côté navigateur. */
export function initSync(): void {
  cfg = read<Cfg | null>(CFG_KEY, null);
  dirty = read<boolean>(DIRTY_KEY, false);
  pending = read<string[]>(PENDING_KEY, []);
  if (!Array.isArray(pending)) pending = [];
  seenSaisies = new Set(saisieIds(state.value));
  publish();
  if (wired) return;
  wired = true;
  attachBus();
  window.addEventListener("storage", (e) => e.key === KEY && reload()); // autre onglet
  document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && syncNow());
  window.addEventListener("online", () => syncNow());
  setInterval(() => document.visibilityState === "visible" && syncNow(), 60000);
  window.addEventListener("hashchange", fromLink);
  if (!fromLink()) void syncNow();
}
