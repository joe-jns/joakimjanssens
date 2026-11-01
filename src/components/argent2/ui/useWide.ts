// Vrai sur PC (≥ 1024 px, comme les feuilles de style) ; suit le redimensionnement.
import { useEffect, useState } from "preact/hooks";

const QUERY = "(min-width: 1024px)";

export function useWide(): boolean {
  const [wide, setWide] = useState(() => globalThis.matchMedia?.(QUERY).matches ?? false);
  useEffect(() => {
    const mq = globalThis.matchMedia?.(QUERY);
    if (!mq) return;
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return wide;
}
