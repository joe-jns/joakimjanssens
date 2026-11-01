// Menu latéral (PC) : logo, les 4 entrées, état de la synchro en bas.
import { syncStatus } from "../../../lib/argent/sync";
import { TABS, go, openSheet, tab } from "../nav";
import { Icon } from "./Icon";

const hhmm = (t: number) => new Date(t).toLocaleTimeString("fr-BE", { hour: "2-digit", minute: "2-digit" });

function SyncLine() {
  const s = syncStatus.value;
  const title = s.enabled ? "Synchro active" : "Synchro désactivée";
  const detail = s.message ?? (s.enabled ? (s.lastOk ? `À jour à ${hhmm(s.lastOk)}` : "En attente…") : "Données sur cet appareil");
  return (
    <div class="ag-syncline" role="status">
      <p>{title}</p>
      <p class="muted">{detail}</p>
    </div>
  );
}

export function Sidebar() {
  return (
    <aside class="ag-sidebar">
      <div class="ag-logo">
        <span class="ag-logo-mark" aria-hidden="true">
          €
        </span>
        Argent
      </div>
      <nav class="ag-nav" aria-label="Navigation">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            class="ag-nav-item press"
            aria-current={tab.value === t.id ? "page" : undefined}
            onClick={() => go(t.id)}
          >
            <Icon name={t.icon} size={18} />
            {t.label}
          </button>
        ))}
      </nav>
      <button type="button" class="ag-nav-item ag-nav-settings press" onClick={() => openSheet("settings")}>
        <Icon name="sliders-horizontal" size={18} />
        Réglages
      </button>
      <SyncLine />
    </aside>
  );
}
