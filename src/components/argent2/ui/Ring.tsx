// Anneau SVG : une part par valeur, 2 px d'espace entre les parts, la part touchée mise en avant.
import { useState } from "preact/hooks";

export type RingPart = { value: number; color: string; id: string; label?: string };
type Props = {
  parts: RingPart[];
  size?: number;
  thickness?: number;
  onSelect?: (id: string | null) => void;
};

const GAP = 2; // px, mesuré sur le cercle médian
const GROW = 4; // la part choisie s'épaissit de 4 px

function arc(c: number, r: number, a0: number, a1: number): string {
  const p = (a: number) => `${(c + r * Math.cos(a)).toFixed(3)} ${(c + r * Math.sin(a)).toFixed(3)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${p(a0)} A ${r} ${r} 0 ${large} 1 ${p(a1)}`;
}

export function Ring({ parts, size = 160, thickness = 18, onSelect }: Props) {
  const [active, setActive] = useState<string | null>(null);
  const shown = parts.filter((p) => p.value > 0);
  const total = shown.reduce((s, p) => s + p.value, 0);
  const c = size / 2;
  const r = (size - thickness - GROW) / 2;
  const gap = shown.length > 1 ? GAP / r : 0;

  const pick = (id: string) => {
    const next = active === id ? null : id;
    setActive(next);
    onSelect?.(next);
  };

  let a = -Math.PI / 2;
  return (
    <svg class="ag-ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="group">
      {total === 0 && <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ag-line)" stroke-width={thickness} />}
      {shown.map((p) => {
        const sweep = (p.value / total) * Math.PI * 2;
        const a0 = a + gap / 2;
        const a1 = a + sweep - gap / 2;
        a += sweep;
        const common = {
          fill: "none",
          stroke: p.color,
          "stroke-width": active === p.id ? thickness + GROW : thickness,
          opacity: active && active !== p.id ? 0.35 : 1,
          tabIndex: 0,
          role: "button",
          "aria-label": p.label ?? p.id,
          "aria-pressed": active === p.id,
          onClick: () => pick(p.id),
          onKeyDown: (e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              pick(p.id);
            }
          },
        };
        if (shown.length === 1) return <circle key={p.id} cx={c} cy={c} r={r} {...common} />;
        if (a1 <= a0) return null;
        return <path key={p.id} d={arc(c, r, a0, a1)} {...common} />;
      })}
    </svg>
  );
}
