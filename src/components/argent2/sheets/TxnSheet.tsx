// Détail d'une opération (feuille sur téléphone, panneau à droite sur PC) : modifier montant, catégorie,
// compte, date, note ; supprimer. Les règles vivent dans screens/activity.ts (testées).
import { useState } from "preact/hooks";
import { readableOn } from "../../../lib/argent/color";
import { DAYS_LONG, MONTHS_LONG, parse } from "../../../lib/argent/dates";
import type { State, Txn } from "../../../lib/argent/model";
import { fmt, toAmount } from "../../../lib/argent/money";
import { state, update } from "../../../lib/argent/store";
import { canDelete, canEdit, deleteTxn, editTransfer, editTxn } from "../screens/activity-logic";
import { Icon } from "../ui/Icon";
import { Numpad } from "../ui/Numpad";
import { AccountPicker } from "./AddSheet";

export const accName = (s: State, id: string) => s.accounts.find((a) => a.id === id)?.name ?? "Compte supprimé";

/** Icône d'une opération : catégorie (couleur lisible sur fond clair), flèches pour un virement. */
export function txnIcon(s: State, t: Txn): { icon: string; color: string } {
  if (t.transferId) return { icon: "arrow-left-right", color: "var(--ag-ink)" };
  const c = s.categories.find((x) => x.id === t.categoryId);
  return c ? { icon: c.icon, color: readableOn(c.color) } : { icon: "ellipsis", color: "var(--ag-muted)" };
}

/** Badges en texte (pas seulement une couleur) : « prévu », « banque ». */
export function TxnBadges({ t }: { t: Txn }) {
  if (t.status === "prevu") return <span class="ag-badge">prévu</span>;
  if (t.status === "banque") return <span class="ag-badge ag-badge-bank">banque</span>;
  return null;
}

/** Version d'une opération (et de l'autre moitié d'un virement) : la clé du formulaire, qui repart à zéro si elle change ailleurs. */
export function txnVersion(s: State, id: string): string {
  const t = s.txns.find((x) => x.id === id);
  if (!t) return "absente";
  const pair = t.transferId ? s.txns.find((x) => x.transferId === t.transferId && x.id !== t.id) : undefined;
  return JSON.stringify([t, pair ?? null]);
}

/**
 * Après une suppression, le focus va sur la ligne suivante de la liste (sinon la précédente, sinon le titre
 * de la liste). Lancé après la fermeture de la feuille, qui rend d'abord le focus à son bouton d'ouverture.
 */
function focusNextRow() {
  const rows = [...document.querySelectorAll<HTMLElement>(".ag-act-row")];
  const i = rows.findIndex((el) => el.getAttribute("aria-current") === "true");
  const key = i < 0 ? null : (rows[i + 1] ?? rows[i - 1])?.dataset.key ?? null;
  setTimeout(() => {
    const el = (key && document.querySelector<HTMLElement>(`.ag-act-row[data-key="${CSS.escape(key)}"]`)) || document.getElementById("ag-act-heading");
    el?.focus({ preventScroll: false });
  }, 350);
}

const signed = (n: number) => (n > 0 ? `+${fmt(n)}` : fmt(n));
const plain = (n: number) => Math.abs(n).toFixed(2).replace(".", ",").replace(/,00$/, "");
const longDate = (day: string) => {
  const d = parse(day);
  return `${DAYS_LONG[d.getDay()]} ${d.getDate()} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};

function deleteHint(t: Txn): string {
  if (t.source === "journee") return "Ce jour ne comptera plus comme travaillé et ne reviendra pas.";
  if (t.transferId) return "Les deux côtés du virement seront supprimés.";
  if (t.refId) return "Seulement cette échéance : le paiement reste dans Planning.";
  return "L’opération sera supprimée.";
}

export function TxnDetail({ id, onDone }: { id: string; onDone: () => void }) {
  const s = state.value;
  const t = s.txns.find((x) => x.id === id);
  const pair = t?.transferId ? s.txns.find((x) => x.transferId === t.transferId && x.id !== t.id) : undefined;
  // Virement : on travaille toujours sur la sortie (from) et l'entrée (to).
  const from = pair && t ? (t.amount <= pair.amount ? t : pair) : t;
  const to = pair && t ? (from === t ? pair : t) : undefined;

  const [amount, setAmount] = useState("");
  const [editAmount, setEditAmount] = useState(false);
  const [categoryId, setCategoryId] = useState(t?.categoryId);
  const [accountId, setAccountId] = useState(from?.accountId ?? "");
  const [toId, setToId] = useState(to?.accountId ?? "");
  const [date, setDate] = useState(t?.date ?? "");
  const [note, setNote] = useState(t?.note ?? "");
  const [confirm, setConfirm] = useState(false);

  if (!t || !from) return <p class="ag-muted">Cette opération n’existe plus.</p>;

  const isTransfer = !!to;
  const bank = t.status === "banque" || to?.status === "banque";
  const can = canEdit(s, t);
  const newAmount = editAmount && toAmount(amount) > 0 ? toAmount(amount) : undefined;
  const shown = newAmount !== undefined ? (from.amount < 0 ? -newAmount : newAmount) : from.amount;
  const dirty =
    (newAmount !== undefined && newAmount !== Math.abs(from.amount)) ||
    (!isTransfer && categoryId !== t.categoryId) ||
    (can.account && accountId !== from.accountId) ||
    (can.account && isTransfer && toId !== to!.accountId) ||
    (can.date && date !== t.date && !!date) ||
    note.trim() !== (t.note ?? "");
  const ok = dirty && (!isTransfer || accountId !== toId);
  const cats = s.categories.filter((c) => c.kind === (from.amount < 0 ? "out" : "in"));
  const ic = txnIcon(s, t);
  const title = isTransfer ? `Virement ${accName(s, from.accountId)} → ${accName(s, to!.accountId)}` : t.label;

  const save = () => {
    if (!ok) return;
    if (isTransfer) {
      update((x) => editTransfer(x, t.transferId!, { amount: newAmount, fromId: accountId, toId, date, note }));
    } else {
      update((x) =>
        editTxn(x, t.id, { amount: newAmount, categoryId, accountId: can.account ? accountId : undefined, date: can.date ? date : undefined, note }),
      );
    }
    setEditAmount(false);
    onDone();
  };
  const removable = canDelete(s, t);
  const remove = () => {
    if (!removable) return;
    focusNextRow();
    update((x) => deleteTxn(x, t.id));
    onDone();
  };

  return (
    <form
      class="ag-form ag-txn-detail"
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
    >
      <div class="ag-detail-head">
        <span class="ag-txn-icon" style={{ color: ic.color }}>
          <Icon name={ic.icon} size={20} />
        </span>
        <div class="ag-detail-title">
          <h3>{title}</h3>
          <p class="ag-sub">
            {longDate(t.date)}
            {isTransfer ? "" : ` · ${accName(s, t.accountId)}`}
          </p>
          <span class="ag-badges">
            <TxnBadges t={t} />
            {t.source === "journee" && <span class="ag-badge">journée</span>}
            {(t.source === "fixe" || t.source === "dette") && <span class="ag-badge">{t.source === "fixe" ? "fixe" : "dette"}</span>}
          </span>
        </div>
      </div>

      <div class="ag-detail-amount">
        <p class={`ag-amount num-big${shown > 0 && !isTransfer ? " is-in" : ""}`} aria-live="polite">
          {isTransfer ? fmt(Math.abs(shown)) : signed(shown)}
        </p>
        {can.amount ? (
          <button
            type="button"
            class="ag-btn-text press"
            aria-expanded={editAmount}
            onClick={() => {
              setAmount("");
              setEditAmount(!editAmount);
            }}
          >
            <Icon name={editAmount ? "x" : "pencil"} size={16} />
            {editAmount ? "Garder le montant" : "Modifier le montant"}
          </button>
        ) : (
          <p class="ag-sub ag-center">Montant de la banque : il ne se modifie pas.</p>
        )}
      </div>
      {editAmount && (
        <div class="ag-detail-numpad">
          <p class="ag-sub ag-center" aria-live="polite">
            Nouveau montant : <span class="num">{amount || plain(from.amount)} €</span>
          </p>
          <Numpad value={amount} onChange={setAmount} />
        </div>
      )}

      {!isTransfer && (
        <fieldset class="ag-fieldset">
          <legend>Catégorie</legend>
          <div class="ag-chips">
            {cats.map((c) => (
              <button key={c.id} type="button" class="ag-chip ag-chip-cat press" aria-pressed={categoryId === c.id} onClick={() => setCategoryId(c.id)}>
                <span class="ag-chip-icon" style={{ color: readableOn(c.color) }}>
                  <Icon name={c.icon} size={16} />
                </span>
                {c.name}
              </button>
            ))}
          </div>
          {t.status === "banque" && categoryId !== t.categoryId && (
            <p class="ag-sub ag-hint">Les prochaines lignes « {t.label} » de la banque iront aussi dans cette catégorie.</p>
          )}
        </fieldset>
      )}

      {can.account ? (
        <>
          <AccountPicker
            label={isTransfer ? "Depuis" : "Compte"}
            value={accountId}
            onChange={(v) => {
              setAccountId(v);
              if (isTransfer && v === toId) setToId(s.accounts.find((a) => a.id !== v)?.id ?? "");
            }}
          />
          {isTransfer && <AccountPicker label="Vers" value={toId} onChange={setToId} exclude={accountId} />}
        </>
      ) : (
        <p class="ag-sub">
          {isTransfer ? `${accName(s, from.accountId)} → ${accName(s, to!.accountId)}` : `Compte : ${accName(s, t.accountId)}`}
        </p>
      )}

      <div class="ag-row2">
        <label class="ag-field">
          <span>Date</span>
          <input type="date" value={date} required disabled={!can.date} onInput={(e) => setDate((e.currentTarget as HTMLInputElement).value)} />
        </label>
        <label class="ag-field">
          <span>Note</span>
          <input type="text" value={note} maxLength={80} placeholder="Facultatif" onInput={(e) => setNote((e.currentTarget as HTMLInputElement).value)} />
        </label>
      </div>
      {bank ? (
        <p class="ag-sub ag-hint">Ligne de la banque : montant, date et compte sont ceux de l’extrait. Catégorie et note se modifient.</p>
      ) : (
        !can.date && <p class="ag-sub ag-hint">Journée de travail : la date ne change pas. Supprime-la si tu n’as pas travaillé.</p>
      )}

      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        Enregistrer
      </button>

      {!removable ? (
        <p class="ag-sub ag-center">Ligne de la banque : elle ne se supprime pas.</p>
      ) : confirm ? (
        <div class="ag-confirm" role="alert">
          <p>{deleteHint(t)}</p>
          <div class="ag-confirm-actions">
            <button type="button" class="ag-pill ag-pill-soft press" onClick={() => setConfirm(false)}>
              Annuler
            </button>
            <button type="button" class="ag-pill ag-pill-danger press" onClick={remove}>
              <Icon name="trash-2" size={18} />
              Oui, supprimer
            </button>
          </div>
        </div>
      ) : (
        <button type="button" class="ag-btn-text ag-btn-danger press" onClick={() => setConfirm(true)}>
          <Icon name="trash-2" size={18} />
          Supprimer
        </button>
      )}
    </form>
  );
}
