// Comptes : une carte par compte (solde, petite courbe du mois, « calé sur l'extrait du … »), ajouter /
// renommer, corriger le solde d'un compte tenu à la main, actions Ajouter / Virement / Épargner / Importer. `AccountsCard` est le bloc « Mes comptes »
// de l'accueil PC (deux cartes pleines pour les comptes courants, lignes pour les autres).
import { useEffect, useState } from "preact/hooks";
import { accountBalance, totalBalance } from "../../../lib/argent/balance";
import { INK, WHITE, contrast } from "../../../lib/argent/color";
import { iso } from "../../../lib/argent/dates";
import type { Account, AccountKind, State } from "../../../lib/argent/model";
import { fmt, toAmount } from "../../../lib/argent/money";
import { state, update } from "../../../lib/argent/store";
import { accountSheet, addPreset, openSheet } from "../nav";
import { MoneyField, TextField } from "../sheets/fields";
import { Icon } from "../ui/Icon";
import { Sheet } from "../ui/Sheet";
import { dayLong } from "./plan-logic";
import { KIND_LABEL, addAccount, anchoredFixText, anchorText, correctBalance, monthSpark, renameAccount, sparkPath } from "./accounts-logic";

const SPARK_W = 120;
const SPARK_H = 32;

/**
 * Texte sur la couleur pleine d'un compte : blanc comme la maquette (rose vif 4,1:1, encre 18:1), encre si le blanc
 * passe sous 3:1 (couleur claire). Les textes de ces cartes sont grands (≥ 18 px) : le seuil 3:1 s'applique.
 */
const onColor = (hex: string) => (contrast(hex, WHITE) >= 3 ? WHITE : INK);

function firstOf(s: State, kind: AccountKind) {
  return s.accounts.find((a) => a.kind === kind);
}

/* ---------- Actions ---------- */
function startTransfer(save: boolean) {
  const s = state.value;
  const from = firstOf(s, "courant")?.id;
  addPreset.value = { kind: "transfer", fromAccountId: from, toAccountId: save ? firstOf(s, "epargne")?.id : undefined };
  openSheet("add");
}

function Actions() {
  const items = [
    { icon: "plus", label: "Ajouter", run: () => openSheet("add") },
    { icon: "arrow-left-right", label: "Virement", run: () => startTransfer(false) },
    { icon: "piggy-bank", label: "Épargner", run: () => startTransfer(true) },
    { icon: "file-up", label: "Importer", run: () => openSheet("import") },
  ];
  return (
    <div class="ag-acc-actions">
      {items.map((x) => (
        <button key={x.label} type="button" class="ag-acc-action press" onClick={x.run}>
          <span class="ag-acc-action-icon">
            <Icon name={x.icon} size={20} />
          </span>
          {x.label}
        </button>
      ))}
    </div>
  );
}

function Spark({ values, color }: { values: number[]; color: string }) {
  const d = sparkPath(values, SPARK_W, SPARK_H);
  if (values.length < 2) return null;
  return (
    <svg class="ag-spark" viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} preserveAspectRatio="none" aria-hidden="true">
      <path d={d} fill="none" stroke={color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke" />
    </svg>
  );
}

/* ---------- Écran Comptes ---------- */
function AccountCard({ s, a, today }: { s: State; a: Account; today: string }) {
  const filled = a.kind === "courant";
  const fg = filled ? onColor(a.color) : "var(--ag-ink)";
  const bal = accountBalance(s, a.id, today);
  const spark = monthSpark(s, a.id, today);
  const delta = spark.length ? bal - spark[0] : 0;
  return (
    <li class={`ag-acc-card${filled ? " is-filled" : ""}`} style={filled ? { background: a.color, color: fg } : undefined}>
      <div class="ag-acc-card-head">
        <div>
          <h2>{a.name}</h2>
          <p class="ag-acc-kind">{KIND_LABEL[a.kind]}</p>
        </div>
        <button type="button" class="ag-icon-btn ag-acc-edit press" aria-label={`Modifier ${a.name}`} onClick={() => (accountSheet.value = { id: a.id })}>
          <Icon name="pencil" size={18} />
        </button>
      </div>
      <p class="num-big ag-acc-balance">{fmt(bal)}</p>
      <div class="ag-acc-foot">
        <div class="ag-acc-anchor-col">
          <p class="ag-acc-anchor">{anchorText(a)}</p>
          {!a.anchor && (
            <button type="button" class="ag-link ag-acc-fix press" onClick={() => (accountSheet.value = { id: a.id, fix: true })}>
              Corriger le solde<span class="ag-sr-only"> de {a.name}</span>
            </button>
          )}
        </div>
        <div class="ag-acc-trend">
          <Spark values={spark} color={filled ? fg : "var(--ag-rose-vif)"} />
          {spark.length > 1 && (
            <span class="num ag-acc-delta">
              {delta > 0 ? "+" : ""}
              {fmt(delta)} en 30 jours
            </span>
          )}
        </div>
      </div>
    </li>
  );
}

export function Accounts({ now }: { now: Date }) {
  const s = state.value;
  const today = iso(now);
  return (
    <div class="ag-accounts">
      <section class="ag-card ag-acc-total" aria-label="Total">
        <div>
          <p class="ag-label">Tout mon argent, ce soir</p>
          <p class="num-big ag-acc-total-value">{fmt(totalBalance(s, today))}</p>
        </div>
        <Actions />
      </section>
      <ul class="ag-acc-grid" aria-label="Mes comptes">
        {s.accounts.map((a) => (
          <AccountCard key={a.id} s={s} a={a} today={today} />
        ))}
        <li>
          <button type="button" class="ag-acc-new press" onClick={() => (accountSheet.value = {})}>
            <Icon name="plus" size={20} />
            Ajouter un compte
          </button>
        </li>
      </ul>
      <section class="ag-card ag-acc-import">
        <div>
          <h2>Extraits de compte</h2>
          <p class="ag-muted">
            Importe tes extraits PDF Revolut et CBC (plusieurs d’un coup) : les opérations s’ajoutent et les soldes se calent.
            {s.importFrom ? ` Lignes ignorées avant le ${dayLong(s.importFrom)}.` : ""}
          </p>
        </div>
        <button type="button" class="ag-pill ag-pill-primary press" onClick={() => openSheet("import")}>
          <Icon name="file-up" size={18} />
          Importer un extrait
        </button>
      </section>
    </div>
  );
}

/* ---------- Bloc « Mes comptes » de l'accueil PC ---------- */
export function AccountsCard({ s, today }: { s: State; today: string }) {
  const filled = s.accounts.filter((a) => a.kind === "courant").slice(0, 2);
  const rest = s.accounts.filter((a) => !filled.includes(a));
  return (
    <section class="ag-card ag-home-accounts" aria-labelledby="ag-myacc-title">
      <div class="ag-card-head">
        <h2 id="ag-myacc-title">Mes comptes</h2>
        <button type="button" class="ag-link press" onClick={() => (accountSheet.value = {})}>
          + Compte
        </button>
      </div>
      <div class="ag-myacc-cards">
        {filled.map((a) => (
          <div key={a.id} class="ag-myacc-card" style={{ background: a.color, color: onColor(a.color) }}>
            <span>{a.name}</span>
            <span class="num">{fmt(accountBalance(s, a.id, today))}</span>
          </div>
        ))}
      </div>
      <ul class="ag-myacc-lines">
        {rest.map((a) => (
          <li key={a.id}>
            <span>{a.name}</span>
            <span class="num">{fmt(accountBalance(s, a.id, today))}</span>
          </li>
        ))}
      </ul>
      <Actions />
    </section>
  );
}

/* ---------- Corriger le solde (compte sans extrait) ---------- */
function FixBalance({ acc, heading, onDone }: { acc: Account; heading?: boolean; onDone: () => void }) {
  const today = iso(new Date());
  const [value, setValue] = useState("");
  const s = state.value;
  if (acc.anchor)
    return (
      <div class="ag-form">
        {heading && <h3 class="ag-acc-fix-title">Solde</h3>}
        <p class="ag-sub">{anchoredFixText(acc)}</p>
      </div>
    );
  const titleId = `ag-fix-${acc.id}`;
  const now = accountBalance(s, acc.id, today);
  const typed = /\d/.test(value);
  const diff = typed ? Math.round((toAmount(value) - now) * 100) / 100 : 0;
  return (
    <form
      class="ag-form"
      aria-labelledby={heading ? titleId : undefined}
      aria-label={heading ? undefined : "Corriger le solde"}
      onSubmit={(e) => {
        e.preventDefault();
        if (!diff) return;
        update((x) => correctBalance(x, acc.id, toAmount(value), today));
        onDone();
      }}
    >
      {heading && (
        <h3 id={titleId} class="ag-acc-fix-title">
          Corriger le solde
        </h3>
      )}
      <p class="ag-sub">
        Dans l’appli : <span class="num">{fmt(now)}</span>. Indique ce qu’il y a vraiment aujourd’hui : l’écart devient une
        opération « Correction du solde » datée d’aujourd’hui, comptée dans tes dépenses ou tes rentrées.
      </p>
      <MoneyField label="Montant réel aujourd’hui" value={value} onChange={setValue} required />
      <p class="ag-sub" aria-live="polite">
        {!typed ? "" : diff ? `Écart : ${diff > 0 ? "+" : ""}${fmt(diff)} (${diff < 0 ? "dépense « Autres »" : "rentrée « Autres rentrées »"})` : "Rien à corriger : c’est déjà le bon montant."}
      </p>
      <button type="submit" class="ag-btn-full press" disabled={!diff}>
        Corriger le solde
      </button>
    </form>
  );
}

/* ---------- Feuille ajouter / renommer ---------- */
const KINDS: AccountKind[] = ["courant", "epargne", "liquide"];

function AccountForm({ id, fix, onDone }: { id?: string; fix?: boolean; onDone: () => void }) {
  const acc = id ? state.value.accounts.find((a) => a.id === id) : undefined;
  if (acc && fix) return <FixBalance acc={acc} onDone={onDone} />;
  return (
    <div class="ag-form">
      <NameForm acc={acc} onDone={onDone} />
      {acc && (
        <section class="ag-acc-fix-block">
          <FixBalance acc={acc} heading onDone={onDone} />
        </section>
      )}
    </div>
  );
}

function NameForm({ acc, onDone }: { acc?: Account; onDone: () => void }) {
  const [name, setName] = useState(acc?.name ?? "");
  const [kind, setKind] = useState<AccountKind>("epargne");
  const ok = !!name.trim();
  return (
    <form
      class="ag-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ok) return;
        update((s) => (acc ? renameAccount(s, acc.id, name) : addAccount(s, name, kind)));
        onDone();
      }}
    >
      <TextField label="Nom du compte" value={name} onChange={setName} maxLength={30} required placeholder="Ex. Poche vacances" />
      {acc ? (
        <p class="ag-sub">
          {KIND_LABEL[acc.kind]} · {anchorText(acc)}
        </p>
      ) : (
        <fieldset class="ag-fieldset">
          <legend>Type</legend>
          <div class="ag-seg ag-seg-sm" role="group" aria-label="Type de compte">
            {KINDS.map((k) => (
              <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)}>
                {KIND_LABEL[k]}
              </button>
            ))}
          </div>
        </fieldset>
      )}
      <button type="submit" class="ag-btn-full press" disabled={!ok}>
        {acc ? "Renommer" : "Ajouter le compte"}
      </button>
    </form>
  );
}

export function AccountSheets() {
  const cur = accountSheet.value;
  // Garde le dernier contenu pendant l'animation de fermeture ; un formulaire neuf à chaque ouverture.
  const [last, setLast] = useState<{ id?: string; fix?: boolean; run: number } | null>(null);
  useEffect(() => {
    if (cur) setLast((l) => ({ id: cur.id, fix: cur.fix, run: (l?.run ?? 0) + 1 }));
  }, [cur]);
  const close = () => (accountSheet.value = null);
  const shown = cur ?? last;
  return (
    <Sheet open={!!cur} onClose={close} title={shown?.id ? (shown.fix ? "Corriger le solde" : "Modifier le compte") : "Nouveau compte"}>
      {last && <AccountForm key={last.run} id={last.id} fix={last.fix} onDone={close} />}
    </Sheet>
  );
}
