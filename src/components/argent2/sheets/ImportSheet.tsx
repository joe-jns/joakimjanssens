// Import d'extraits PDF (Revolut, CBC), un ou plusieurs d'un coup (choix ou glisser-déposer), lus sur l'appareil.
// Chaque fichier passe dans l'ordre : lecture → Revolut puis CBC → rapprochement ; un résumé par fichier,
// puis le total. Un fichier en échec n'arrête pas les suivants. « Importer à partir du » règle state.importFrom.
// L'avancement et les résultats vivent hors du composant : fermer la feuille pendant un import ne perd rien,
// ils sont remontrés à la réouverture (jusqu'à la réouverture suivante, qui repart propre une fois l'import terminé).
import { signal } from "@preact/signals";
import { useEffect, useRef, useState } from "preact/hooks";
import { readPdfItems } from "../../../lib/argent/import/pdf";
import { fmt } from "../../../lib/argent/money";
import type { ReconcileReport } from "../../../lib/argent/reconcile";
import { state, update } from "../../../lib/argent/store";
import { FAILED_FILE, importItems, reportText, setImportFrom, sumReports } from "../screens/accounts-logic";
import { dayLong } from "../screens/plan-logic";
import { Icon } from "../ui/Icon";

type Result =
  | { name: string; ok: true; bank: string; report: ReconcileReport; text: string; anchors: string[]; warnings: string[] }
  | { name: string; ok: false; text: string };

const busy = signal<string | null>(null);
const results = signal<Result[]>([]);

const isPdf = (f: File) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

async function importOne(file: File): Promise<Result> {
  const name = file.name;
  if (!isPdf(file)) return { name, ok: false, text: "Ce n’est pas un PDF. Choisis l’extrait téléchargé depuis ta banque." };
  let items;
  try {
    items = await readPdfItems(file);
  } catch {
    return { name, ok: false, text: "Ce PDF n’a pas pu être lu (abîmé ou protégé par un mot de passe)." };
  }
  const r = importItems(state.value, items);
  if (!r.ok) return { name, ok: false, text: r.text };
  update(() => r.state);
  return {
    name,
    ok: true,
    bank: r.bank,
    report: r.report,
    text: r.text,
    anchors: r.anchors.map((a) => `${a.name} : ${fmt(a.balance)} au ${dayLong(a.date)}`),
    warnings: r.warnings,
  };
}

async function run(files: File[]) {
  if (busy.value || !files.length) return;
  results.value = [];
  try {
    for (const f of files) {
      busy.value = `Lecture de ${f.name}…`;
      let r: Result;
      try {
        r = await importOne(f);
      } catch (e) {
        console.error(e);
        r = { name: f.name, ok: false, text: FAILED_FILE };
      }
      results.value = [...results.value, r];
    }
  } finally {
    busy.value = null;
  }
}

function FromField() {
  const from = state.value.importFrom ?? "";
  return (
    <div class="ag-field">
      <label for="ag-import-from">Importer à partir du</label>
      <div class="ag-import-from">
        <input
          id="ag-import-from"
          type="date"
          value={from}
          onChange={(e) => {
            // Une date à moitié tapée arrive vide : on ne l'efface pas ; « Effacer » sert à ça.
            const v = (e.currentTarget as HTMLInputElement).value;
            if (v) update((s) => setImportFrom(s, v));
          }}
        />
        {from && (
          <button type="button" class="ag-pill ag-pill-soft press" onClick={() => update((s) => setImportFrom(s, ""))} aria-label="Effacer la date de début">
            Effacer
          </button>
        )}
      </div>
      <span class="ag-hint">{from ? `Les lignes avant le ${dayLong(from)} sont ignorées ; le solde reste calé sur l’extrait.` : "Vide : tout l’extrait est importé."}</span>
    </div>
  );
}

export function ImportSheet() {
  const [over, setOver] = useState(false);
  const depth = useRef(0); // dragenter/dragleave des enfants : on ne retire la surbrillance qu'en sortant vraiment
  // Un import terminé avant l'ouverture : on repart d'une feuille propre (un import en cours reste visible).
  useEffect(() => {
    if (!busy.value) results.value = [];
  }, []);
  const list = results.value;
  const working = busy.value;
  const done = list.filter((r): r is Extract<Result, { ok: true }> => r.ok);
  const total = sumReports(done.map((r) => r.report));

  return (
    <div class="ag-form ag-import">
      <p class="ag-muted">
        Revolut ou CBC, un ou plusieurs PDF d’un coup. Tout est lu sur cet appareil ; réimporter le même extrait n’ajoute rien.
      </p>

      <FromField />

      <label
        class="ag-drop press"
        data-over={over ? "" : undefined}
        data-busy={working ? "" : undefined}
        onDragEnter={(e) => {
          e.preventDefault();
          depth.current++;
          setOver(true);
        }}
        onDragOver={(e) => e.preventDefault()}
        onDragLeave={() => {
          depth.current = Math.max(0, depth.current - 1);
          if (!depth.current) setOver(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          depth.current = 0;
          setOver(false);
          void run([...(e.dataTransfer?.files ?? [])]);
        }}
      >
        <Icon name="file-up" size={28} />
        <span class="ag-drop-title">{working ?? "Choisir les extraits PDF"}</span>
        <span class="ag-sub ag-pc-only">ou les glisser ici</span>
        <input
          class="ag-sr-only"
          type="file"
          accept="application/pdf,.pdf"
          multiple
          disabled={!!working}
          aria-label="Choisir un ou plusieurs extraits PDF"
          onChange={(e) => {
            const input = e.currentTarget as HTMLInputElement;
            const files = [...(input.files ?? [])];
            input.value = ""; // le même fichier peut être rechoisi
            void run(files);
          }}
        />
      </label>

      <div aria-live="polite" class="ag-import-results">
        {list.map((r, i) => (
          <div key={i} class={`ag-import-result${r.ok ? "" : " is-error"}`}>
            <p class="ag-import-file">
              <Icon name={r.ok ? "check" : "x"} size={16} strokeWidth={2.25} />
              <span>
                {r.ok ? `Extrait ${r.bank}` : "Fichier non importé"}
                <span class="ag-sub">{r.name}</span>
              </span>
            </p>
            <p>{r.text}</p>
            {r.ok && r.anchors.map((a) => <p key={a} class="ag-sub">Solde calé · {a}</p>)}
            {r.ok && r.warnings.length > 0 && (
              <ul class="ag-import-warn">
                {r.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}
          </div>
        ))}
        {!working && list.length > 1 && (
          <p class="ag-import-total">
            <strong>Total</strong> ·{" "}
            {done.length
              ? `${done.length} extrait${done.length > 1 ? "s" : ""} importé${done.length > 1 ? "s" : ""} sur ${list.length} · ${reportText(total, state.value.importFrom)}`
              : "aucun extrait reconnu"}
          </p>
        )}
      </div>
    </div>
  );
}
