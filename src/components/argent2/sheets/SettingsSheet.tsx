// Réglages : synchro chiffrée (activer, code, copier le lien, rejoindre, arrêter), sauvegarde JSON
// (exporter / importer avec confirmation) et « Tout effacer » (deux étapes).
import { useState } from "preact/hooks";
import { emptyState, type State } from "../../../lib/argent/model";
import { refreshAuto, state, update } from "../../../lib/argent/store";
import { copyLink, enableSync, joinSync, stopSync, syncNow, syncStatus } from "../../../lib/argent/sync";
import { BACKUP_MAX, backupName, parseBackup } from "../screens/accounts-logic";
import { Icon } from "../ui/Icon";

const hhmm = (t: number) => new Date(t).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });

function SyncBlock() {
  const st = syncStatus.value;
  const [code, setCode] = useState("");
  const [working, setWorking] = useState(false);
  const [flash, setFlash] = useState<{ text: string; error?: boolean } | null>(null);
  const act = async (fn: () => Promise<unknown> | void) => {
    setWorking(true);
    setFlash(null);
    try {
      await fn();
    } finally {
      setWorking(false);
    }
  };
  const copy = () =>
    act(async () => {
      await copyLink();
      const m = syncStatus.value.message ?? "";
      setFlash(m.startsWith("Lien copié") ? { text: "Lien copié" } : { text: "Copie impossible : sélectionne le lien ci-dessus", error: true });
    });
  const syncHere = () =>
    act(async () => {
      await syncNow();
      const s = syncStatus.value;
      setFlash(s.message ? { text: s.message, error: true } : { text: `Synchronisé à ${hhmm(s.lastOk ?? Date.now())}` });
    });
  const status = st.message ?? (st.enabled ? (st.lastOk ? `À jour à ${hhmm(st.lastOk)}.` : "En attente…") : "Les données restent sur cet appareil.");
  return (
    <section class="ag-card ag-set-block" aria-labelledby="ag-set-sync">
      <h3 id="ag-set-sync">Synchro avec un autre appareil</h3>
      <p class="ag-sub" role="status">
        {st.enabled ? "Active · " : ""}
        {status}
      </p>
      {st.enabled ? (
        <>
          <p class="ag-muted">Ton code (il ouvre tes données, garde-le pour toi) :</p>
          <p class="ag-set-code num">{st.code}</p>
          <div class="ag-set-row">
            <button type="button" class="ag-pill ag-pill-primary press" onClick={copy}>
              Copier le lien
            </button>
            <button type="button" class="ag-pill ag-pill-soft press" disabled={working} onClick={syncHere}>
              <Icon name="refresh-cw" size={16} />
              Synchroniser
            </button>
            <button type="button" class="ag-pill ag-pill-soft press" onClick={() => stopSync()}>
              Arrêter ici
            </button>
          </div>
          {flash && (
            <p class={`ag-flash${flash.error ? " is-error" : ""}`} role="status">
              {!flash.error && <Icon name="check" size={14} strokeWidth={2.5} />}
              {flash.text}
            </p>
          )}
          <p class="ag-sub">Ouvre le lien sur l’autre appareil (envoie-le-toi par message) : il récupère tout et reste à jour tout seul.</p>
        </>
      ) : (
        <>
          <button type="button" class="ag-pill ag-pill-primary press ag-set-cta" disabled={working} onClick={() => act(enableSync)}>
            Activer la synchro sur cet appareil
          </button>
          <form
            class="ag-set-join"
            onSubmit={(e) => {
              e.preventDefault();
              if (code.trim()) void act(() => joinSync(code));
            }}
          >
            <label class="ag-field">
              <span>J’ai déjà un code</span>
              <input
                type="text"
                value={code}
                autoComplete="off"
                autoCapitalize="off"
                spellcheck={false}
                placeholder="xxxx-xxxx-xxxx-xxxx-xxxx"
                onInput={(e) => setCode((e.currentTarget as HTMLInputElement).value)}
              />
            </label>
            <button type="submit" class="ag-pill ag-pill-soft press" disabled={working || !code.trim()}>
              Relier
            </button>
          </form>
          <p class="ag-sub">Relier remplace les données de cet appareil par celles de l’autre.</p>
        </>
      )}
    </section>
  );
}

function BackupBlock() {
  const [pending, setPending] = useState<{ state: State; name: string } | null>(null);
  const [msg, setMsg] = useState("");
  const exportJson = () => {
    const blob = new Blob([JSON.stringify(state.value, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = backupName(new Date());
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setMsg("Sauvegarde téléchargée.");
  };
  const pick = async (file?: File) => {
    if (!file) return;
    setPending(null);
    if (file.size > BACKUP_MAX) return setMsg("Fichier trop gros pour une sauvegarde (plus de 5 Mo). Rien n’a été changé.");
    let text: string;
    try {
      text = await file.text();
    } catch {
      return setMsg("Ce fichier n’a pas pu être lu. Rien n’a été changé.");
    }
    const r = parseBackup(text);
    if ("error" in r) {
      setPending(null);
      setMsg(r.error);
    } else {
      setMsg("");
      setPending({ state: r.state, name: file.name });
    }
  };
  return (
    <section class="ag-card ag-set-block" aria-labelledby="ag-set-backup">
      <h3 id="ag-set-backup">Sauvegarde</h3>
      <p class="ag-sub">Un fichier avec toutes tes données, à garder en lieu sûr (il n’est pas chiffré).</p>
      <div class="ag-set-row">
        <button type="button" class="ag-pill ag-pill-soft press" onClick={exportJson}>
          Exporter (JSON)
        </button>
        <label class="ag-pill ag-pill-soft press ag-set-file">
          Importer une sauvegarde
          <input
            class="ag-sr-only"
            type="file"
            accept="application/json,.json"
            onChange={(e) => {
              const input = e.currentTarget as HTMLInputElement;
              void pick(input.files?.[0]);
              input.value = "";
            }}
          />
        </label>
      </div>
      {pending && (
        <div class="ag-confirm" role="alertdialog" aria-label="Remplacer les données">
          <p>
            Remplacer toutes les données de cet appareil par « {pending.name} » ({pending.state.txns.length} opérations, {pending.state.accounts.length} comptes) ?
          </p>
          <div class="ag-confirm-actions">
            <button type="button" class="ag-pill ag-pill-soft press" onClick={() => setPending(null)}>
              Annuler
            </button>
            <button
              type="button"
              class="ag-pill ag-pill-danger press"
              onClick={() => {
                const next = pending.state;
                update(() => next);
                refreshAuto(new Date());
                setPending(null);
                setMsg("Sauvegarde importée.");
              }}
            >
              Remplacer
            </button>
          </div>
        </div>
      )}
      {msg && (
        <p class="ag-sub" role="status">
          {msg}
        </p>
      )}
    </section>
  );
}

function EraseBlock() {
  const [step, setStep] = useState(0);
  const [done, setDoneText] = useState("");
  const setDone = (t: string) => {
    setDoneText(t);
    setStep(3);
  };
  const synced = syncStatus.value.enabled;
  return (
    <section class="ag-card ag-set-block" aria-labelledby="ag-set-erase">
      <h3 id="ag-set-erase">Tout effacer</h3>
      {step === 0 && (
        <button type="button" class="ag-btn-text ag-btn-danger press" onClick={() => setStep(1)}>
          <Icon name="trash-2" size={18} />
          Tout effacer…
        </button>
      )}
      {step === 1 && (
        <div class="ag-confirm" role="alertdialog" aria-label="Tout effacer">
          <p>
            Comptes, opérations, paie, fixes, dettes, objectifs : tout repart de zéro
            {synced ? " (synchro active : tu pourras choisir d’effacer seulement cet appareil, ou aussi l’autre)" : " sur cet appareil"}. Exporte une sauvegarde avant si tu veux pouvoir revenir en arrière.
          </p>
          <div class="ag-confirm-actions">
            <button type="button" class="ag-pill ag-pill-soft press" onClick={() => setStep(0)}>
              Annuler
            </button>
            <button type="button" class="ag-pill ag-pill-danger press" onClick={() => setStep(2)}>
              Continuer
            </button>
          </div>
        </div>
      )}
      {step === 2 && (
        <div class="ag-confirm" role="alertdialog" aria-label="Confirmer l’effacement">
          <p>
            <strong>Dernière confirmation.</strong> Cette action ne peut pas être annulée.
            {synced ? " « Arrêter la synchro puis effacer » n’efface que cet appareil ; l’autre garde tout." : ""}
          </p>
          <div class="ag-confirm-actions">
            <button type="button" class="ag-pill ag-pill-soft press" onClick={() => setStep(0)}>
              Garder mes données
            </button>
            {synced && (
              <button
                type="button"
                class="ag-pill ag-pill-danger press"
                onClick={() => {
                  stopSync();
                  update(() => emptyState());
                  setDone("Synchro arrêtée et cet appareil effacé. L’autre appareil garde ses données.");
                }}
              >
                Arrêter la synchro puis effacer
              </button>
            )}
            <button
              type="button"
              class="ag-pill ag-pill-danger press"
              onClick={() => {
                update(() => emptyState());
                setDone(synced ? "Tout est effacé, ici et sur l’appareil synchronisé." : "Tout est effacé.");
              }}
            >
              {synced ? "Effacer partout" : "Oui, tout effacer"}
            </button>
          </div>
        </div>
      )}
      {step === 3 && (
        <p class="ag-flash" role="status">
          {done}
        </p>
      )}
    </section>
  );
}

export function SettingsSheet() {
  return (
    <div class="ag-settings">
      <SyncBlock />
      <BackupBlock />
      <EraseBlock />
    </div>
  );
}
