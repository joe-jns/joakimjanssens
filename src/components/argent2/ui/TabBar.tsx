// Barre du bas (téléphone) : Accueil, Activité, gros « + », Planning, Comptes.
import { TABS, go, openSheet, tab } from "../nav";
import { Icon } from "./Icon";

function TabButton({ id }: { id: (typeof TABS)[number]["id"] }) {
  const t = TABS.find((x) => x.id === id)!;
  const current = tab.value === id;
  return (
    <button type="button" class="ag-tab press" aria-current={current ? "page" : undefined} onClick={() => go(id)}>
      <Icon name={t.icon} size={22} strokeWidth={current ? 2 : 1.75} />
      <span>{t.label}</span>
    </button>
  );
}

export function TabBar() {
  return (
    <nav class="ag-tabbar" aria-label="Navigation">
      <div class="ag-tabbar-inner">
        <TabButton id="accueil" />
        <TabButton id="activite" />
        <button type="button" class="ag-fab press" onClick={() => openSheet("add")} aria-label="Ajouter une opération">
          <Icon name="plus" size={28} strokeWidth={2} />
        </button>
        <TabButton id="planning" />
        <TabButton id="comptes" />
      </div>
    </nav>
  );
}
