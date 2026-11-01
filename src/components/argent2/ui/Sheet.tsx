// Feuille qui monte du bas (téléphone), fermable en la glissant vers le bas ; fenêtre centrée sur PC.
// Accessible : tout ce qui est derrière devient inerte (le Tab reste dans la feuille), Échap ferme,
// le focus va au premier contrôle à l'ouverture puis revient sur le bouton qui l'a ouverte.
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { Icon } from "./Icon";

type Props = {
  open: boolean;
  onClose: () => void;
  title?: string;
  /** Nom accessible quand il n'y a pas de titre visible. */
  label?: string;
  children?: ComponentChildren;
};

const CLOSE_MS = 300;
const FOCUSABLE =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const reduced = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const isPhone = () => !(globalThis.matchMedia?.("(min-width: 1024px)").matches ?? false);

// Verrou de défilement partagé (plusieurs feuilles peuvent se croiser pendant une animation).
// position: fixed sur body : seul moyen fiable sur iOS ; la position est remise à la sortie.
let locks = 0;
let savedY = 0;
function lockScroll() {
  if (locks++ > 0) return;
  savedY = window.scrollY;
  const b = document.body.style;
  b.position = "fixed";
  b.top = `-${savedY}px`;
  b.left = "0";
  b.right = "0";
  b.width = "100%";
}
function unlockScroll() {
  if (--locks > 0) return;
  const b = document.body.style;
  b.position = b.top = b.left = b.right = b.width = "";
  window.scrollTo(0, savedY);
}

export function Sheet({ open, onClose, title, label, children }: Props) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y0: number; t0: number; dy: number } | null>(null);
  const opener = useRef<Element | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  const setDy = (dy: number) => panel.current?.style.setProperty("--drag", `${dy}px`);

  // Montée / descente : on garde la feuille dans la page le temps de son animation de sortie.
  useEffect(() => {
    if (open) {
      clearTimeout(resetTimer.current); // une remise à zéro d'un glisser précédent ne doit pas tomber en plein geste
      setDy(0);
      opener.current = document.activeElement;
      setMounted(true);
      let r2 = 0;
      const r1 = requestAnimationFrame(() => (r2 = requestAnimationFrame(() => setShown(true))));
      return () => {
        cancelAnimationFrame(r1);
        cancelAnimationFrame(r2);
      };
    }
    setShown(false);
    const t = setTimeout(() => setMounted(false), reduced() ? 0 : CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  // Derrière inerte, défilement bloqué, Échap ferme ; tout est rendu à la sortie, puis le focus revient.
  useEffect(() => {
    if (!mounted) return;
    const host = panel.current?.parentElement;
    const behind = host
      ? [...host.children].filter((el) => !el.matches(".ag-scrim, .ag-sheet") && !el.hasAttribute("inert"))
      : [];
    behind.forEach((el) => el.setAttribute("inert", ""));
    lockScroll();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      behind.forEach((el) => el.removeAttribute("inert"));
      unlockScroll();
      const el = opener.current as HTMLElement | null;
      if (el && typeof el.focus === "function" && document.contains(el)) el.focus({ preventScroll: true });
    };
  }, [mounted]);

  // Focus sur le premier contrôle du contenu (sinon le bouton Fermer, sinon la feuille).
  useEffect(() => {
    if (!shown || !panel.current) return;
    const p = panel.current;
    const first =
      p.querySelector<HTMLElement>(`.ag-sheet-body :is(${FOCUSABLE})`) ??
      p.querySelector<HTMLElement>(FOCUSABLE) ??
      p;
    first.focus({ preventScroll: true });
  }, [shown]);

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  if (!mounted) return null;

  const onDown = (e: PointerEvent) => {
    if (!isPhone() || (e.target as Element).closest("button, a, input, select, textarea")) return;
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {} // pointeur déjà relâché : le geste continue sans capture
    drag.current = { id: e.pointerId, y0: e.clientY, t0: e.timeStamp, dy: 0 };
    setDragging(true);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    d.dy = Math.max(0, e.clientY - d.y0);
    setDy(d.dy);
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    const speed = d.dy / Math.max(1, e.timeStamp - d.t0); // px/ms
    const h = panel.current?.offsetHeight ?? 400;
    if (d.dy > Math.min(120, h * 0.3) || (d.dy > 24 && speed > 0.6)) {
      onClose();
      clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setDy(0), CLOSE_MS);
    } else setDy(0);
  };
  // Geste interrompu (appel, défilement repris par le système) : on remet la feuille en place, jamais de fermeture.
  const onCancel = (e: PointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    setDragging(false);
    setDy(0);
  };
  const handlers = { onPointerDown: onDown, onPointerMove: onMove, onPointerUp: onUp, onPointerCancel: onCancel };
  const state = shown ? "open" : "closed";

  return (
    <>
      <div class="ag-scrim" data-state={state} onClick={onClose} aria-hidden="true" />
      <div
        ref={panel}
        class="ag-sheet"
        data-state={state}
        data-dragging={dragging ? "" : undefined}
        role="dialog"
        aria-modal="true"
        aria-label={title ?? label}
        tabIndex={-1}
      >
        <div class="ag-sheet-grip" {...handlers}>
          <span />
        </div>
        <div class="ag-sheet-head" {...handlers}>
          {title ? <h2>{title}</h2> : <span />}
          <button type="button" class="ag-icon-btn press" onClick={onClose} aria-label="Fermer">
            <Icon name="x" />
          </button>
        </div>
        <div class="ag-sheet-body">{children}</div>
      </div>
    </>
  );
}
