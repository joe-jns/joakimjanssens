// Barre segmentée des dépenses par catégorie : une part par catégorie, un clic ouvre ses opérations.
// Clavier : un seul arrêt de tabulation, les flèches (et Début / Fin) passent d'une part à l'autre.
// Info-bulle au survol, au focus et au toucher (premier toucher : l'info-bulle ; deuxième : les opérations).
// Elle reste dans la barre : ancrée au centre de la part, décalée de son propre pourcentage (0 % à gauche, 100 % à droite).
import { useRef, useState } from "preact/hooks";
import { fmt } from "../../../lib/argent/money";
import type { Segment } from "../../../lib/argent/series";

export const sharePct = (x: number) => `${Math.round(x * 100)} %`;

export function SegBar({ segs, onOpen }: { segs: Segment[]; onOpen: (ids: string[]) => void }) {
  const [shown, setShown] = useState<number | null>(null);
  const [stop, setStop] = useState(0); // la part qui porte l'arrêt de tabulation
  const touch = useRef(false);
  const parts = useRef<(HTMLButtonElement | null)[]>([]);
  const total = segs.reduce((a, x) => a + x.amount, 0) || 1;
  let acc = 0;
  const centre = segs.map((x) => {
    const c = ((acc + x.amount / 2) / total) * 100;
    acc += x.amount;
    return c;
  });
  const tab = Math.min(stop, segs.length - 1);

  const onKey = (e: KeyboardEvent, i: number) => {
    const n = segs.length;
    const to = e.key === "ArrowLeft" ? i - 1 : e.key === "ArrowRight" ? i + 1 : e.key === "Home" ? 0 : e.key === "End" ? n - 1 : -1;
    if (to < 0 || to >= n) return;
    e.preventDefault();
    setStop(to);
    parts.current[to]?.focus();
  };

  const tip = shown !== null && shown < segs.length ? segs[shown] : null;
  return (
    <div class="ag-segbar" role="group" aria-label="Dépenses par catégorie" onMouseLeave={() => setShown(null)}>
      {segs.map((x, i) => (
        <button
          key={x.ids.join()}
          ref={(el) => (parts.current[i] = el)}
          type="button"
          class="ag-segbar-part"
          tabIndex={i === tab ? 0 : -1}
          data-shown={i === shown ? "" : undefined}
          style={{ flexGrow: x.amount, background: x.color }}
          aria-label={`${x.name} : ${fmt(x.amount)}, ${sharePct(x.share)}. Voir les opérations`}
          onPointerDown={(e) => (touch.current = e.pointerType === "touch")}
          onMouseEnter={() => !touch.current && setShown(i)}
          onFocus={() => {
            setStop(i);
            if (!touch.current) setShown(i); // au toucher, c'est le clic qui montre l'info-bulle
          }}
          onBlur={() => setShown(null)}
          onKeyDown={(e) => {
            touch.current = false;
            onKey(e, i);
          }}
          onClick={() => {
            if (touch.current && shown !== i) {
              setShown(i);
              return;
            }
            onOpen(x.ids);
          }}
        />
      ))}
      {tip && (
        <span class="ag-tip" aria-hidden="true" style={{ left: `${centre[shown!]}%`, transform: `translateX(-${centre[shown!]}%)` }}>
          <span>{tip.name}</span>
          <span class="num">
            {fmt(tip.amount)} · {sharePct(tip.share)}
          </span>
        </span>
      )}
    </div>
  );
}
