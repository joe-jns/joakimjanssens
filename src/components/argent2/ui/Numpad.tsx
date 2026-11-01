// Pavé numérique pour un montant en euros : « 40,03 ». Garde au plus 2 décimales et 7 chiffres avant la virgule.
import { useEffect, useRef } from "preact/hooks";
import { Icon } from "./Icon";

export type Key = "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "," | "back";
const KEYS: Key[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ",", "0", "back"];

export function pressKey(v: string, k: Key): string {
  if (k === "back") return v.slice(0, -1);
  if (k === ",") return v.includes(",") ? v : `${v || "0"},`;
  const [int, dec] = v.split(",");
  if (dec !== undefined) return dec.length >= 2 ? v : v + k;
  if (int === "0") return k;
  return int.length >= 7 ? v : v + k;
}

type Props = {
  value: string;
  onChange: (v: string) => void;
  /** Accepte aussi le clavier physique (chiffres, virgule ou point, retour arrière). */
  keyboard?: boolean;
};

export function Numpad({ value, onChange, keyboard = true }: Props) {
  // Dernières valeurs lues par l'écouteur clavier : une frappe rapide ne repart jamais d'un état périmé.
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const press = (k: Key) => {
    const next = pressKey(latest.current.value, k);
    latest.current.value = next;
    latest.current.onChange(next);
  };

  useEffect(() => {
    if (!keyboard) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      const k: Key | null = /^[0-9]$/.test(e.key)
        ? (e.key as Key)
        : e.key === "," || e.key === "."
          ? ","
          : e.key === "Backspace"
            ? "back"
            : null;
      if (!k) return;
      e.preventDefault();
      press(k);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [keyboard]);

  return (
    <div class="ag-numpad">
      {KEYS.map((k) => (
        <button
          key={k}
          type="button"
          class="ag-key press num"
          onClick={() => press(k)}
          aria-label={k === "back" ? "Effacer" : k === "," ? "Virgule" : undefined}
        >
          {k === "back" ? <Icon name="delete" size={22} /> : k}
        </button>
      ))}
    </div>
  );
}
