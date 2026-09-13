// Chemins compatibles avec un sous-dossier (GitHub Pages : /joakimjanssens/) comme avec la racine d'un domaine.
const base = import.meta.env.BASE_URL.endsWith("/") ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;

/** Chemin relatif au site : withBase("og.png") → "/joakimjanssens/og.png" ou "/og.png". */
export const withBase = (path = "") => `${base}${path.replace(/^\//, "")}`;

/** Adresse absolue : absolute(site, "og.png") → "https://…/joakimjanssens/og.png". */
export const absolute = (site: URL | undefined, path = "") => new URL(withBase(path), site).href;
