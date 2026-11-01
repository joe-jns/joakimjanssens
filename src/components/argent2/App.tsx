// Coquille de l'appli Argent : onglets (téléphone) ou menu latéral (PC), écrans, feuilles.
// Accueil : `Home` sur téléphone, tableau de bord `Dashboard` sur PC (≥ 1024 px).
import { useEffect, useState } from "preact/hooks";
import { refreshAuto, saveError, state } from "../../lib/argent/store";
import { initSync } from "../../lib/argent/sync";
import { TABS, addPreset, closeSheet, go, openSheet, query, sheet, tab, txnId, type Tab } from "./nav";
import { AccountSheets, Accounts } from "./screens/Accounts";
import { Activity } from "./screens/Activity";
import { Dashboard } from "./screens/Dashboard";
import { Home } from "./screens/Home";
import { Plan, PlanSheets } from "./screens/Plan";
import { AddSheet } from "./sheets/AddSheet";
import { CategoryManager } from "./sheets/CategorySheet";
import { ImportSheet } from "./sheets/ImportSheet";
import { SettingsSheet } from "./sheets/SettingsSheet";
import { TxnDetail, txnVersion } from "./sheets/TxnSheet";
import { Icon } from "./ui/Icon";
import { Sheet } from "./ui/Sheet";
import { Sidebar } from "./ui/Sidebar";
import { TabBar } from "./ui/TabBar";
import { useWide } from "./ui/useWide";

const longDate = (d: Date) => {
  const s = d.toLocaleDateString("fr-BE", { weekday: "long", day: "numeric", month: "long" });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const titleOf = (t: Tab) => TABS.find((x) => x.id === t)!.label;

function HeaderPhone({ date }: { date: string }) {
  return (
    <header class="ag-header-phone">
      <p class="ag-date">{date}</p>
      <button type="button" class="ag-icon-btn press" aria-label="Chercher une opération" onClick={() => go("activite")}>
        <Icon name="search" />
      </button>
      <button type="button" class="ag-icon-btn press" aria-label="Réglages" onClick={() => openSheet("settings")}>
        <Icon name="sliders-horizontal" />
      </button>
    </header>
  );
}

function HeaderPc({ date, title }: { date: string; title: string }) {
  return (
    <header class="ag-header-pc">
      <div>
        <p class="ag-date">{date}</p>
        <h1>{title}</h1>
      </div>
      <div class="ag-actions">
        <label class="ag-search">
          <Icon name="search" size={18} />
          <input
            type="search"
            placeholder="Chercher une opération"
            aria-label="Chercher une opération"
            value={query.value}
            onInput={(e) => {
              query.value = (e.currentTarget as HTMLInputElement).value;
              if (query.value) go("activite");
            }}
          />
        </label>
        <button type="button" class="ag-pill ag-pill-soft press" onClick={() => openSheet("import")}>
          <Icon name="file-up" size={18} />
          Importer un extrait
        </button>
        <button type="button" class="ag-pill ag-pill-primary press" onClick={() => openSheet("add")}>
          <Icon name="plus" size={18} strokeWidth={2} />
          Ajouter
        </button>
      </div>
    </header>
  );
}

function Screen({ id, now, wide }: { id: Tab; now: Date; wide: boolean }) {
  return (
    <section class="ag-screen" aria-label={titleOf(id)}>
      {id !== "accueil" && <h1 class="ag-title-phone ag-header-phone-only">{titleOf(id)}</h1>}
      {id === "accueil" ? (
        wide ? <Dashboard now={now} /> : <Home now={now} />
      ) : id === "activite" ? (
        <Activity now={now} />
      ) : id === "planning" ? (
        <Plan now={now} />
      ) : (
        <Accounts now={now} />
      )}
    </section>
  );
}

export default function App() {
  const [now, setNow] = useState(() => new Date());
  const [addRun, setAddRun] = useState(0); // une saisie neuve à chaque ouverture
  const wide = useWide();
  // Garde la dernière opération ouverte pendant l'animation de fermeture de la feuille.
  const [lastTxn, setLastTxn] = useState<string | null>(null);
  const openTxn = txnId.value;
  useEffect(() => {
    if (openTxn) setLastTxn(openTxn);
  }, [openTxn]);

  useEffect(() => {
    refreshAuto(new Date());
    initSync();
    const onVisible = () => {
      if (document.visibilityState !== "visible") return;
      const d = new Date();
      setNow(d);
      refreshAuto(d);
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  useEffect(() => {
    if (sheet.value === "add") setAddRun((n) => n + 1);
    if (sheet.value !== "add" && addPreset.value) addPreset.value = null;
  }, [sheet.value]);

  const date = longDate(now);
  const current = tab.value;
  const open = sheet.value;

  return (
    <div class="ag">
      <Sidebar />
      <div class="ag-panel">
        <HeaderPc date={date} title={titleOf(current)} />
        <main class="ag-main">
          {saveError.value && (
            <p class="ag-save-error" role="alert">
              <Icon name="triangle-alert" size={18} />
              {saveError.value}
            </p>
          )}
          <HeaderPhone date={date} />
          <Screen key={current} id={current} now={now} wide={wide} />
        </main>
      </div>
      <TabBar />

      <Sheet open={open === "add"} onClose={closeSheet} label="Ajouter une opération">
        <AddSheet key={addRun} preset={addPreset.peek()} onDone={closeSheet} />
      </Sheet>
      <Sheet open={!wide && !!openTxn} onClose={() => (txnId.value = null)} title="Opération">
        {lastTxn && <TxnDetail key={`${lastTxn}|${txnVersion(state.value, lastTxn)}`} id={lastTxn} onDone={() => (txnId.value = null)} />}
      </Sheet>
      <PlanSheets now={now} />
      <Sheet open={open === "categories"} onClose={closeSheet} title="Catégories">
        <CategoryManager />
      </Sheet>
      <Sheet open={open === "import"} onClose={closeSheet} title="Importer un extrait">
        <ImportSheet />
      </Sheet>
      <Sheet open={open === "settings"} onClose={closeSheet} title="Réglages">
        <SettingsSheet />
      </Sheet>
      <AccountSheets />
    </div>
  );
}
