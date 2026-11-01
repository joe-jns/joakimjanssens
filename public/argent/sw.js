// Service worker de /argent/ : la page et ses fichiers marchent hors ligne. Jamais la synchro.
const CACHE = "argent-v2";
const PAGE = "/argent/";
// Au-delà, une page lente est servie depuis le cache (le réseau continue de remplir le cache derrière).
const TIMEOUT = 3500;

// Seules les vraies réponses complètes du site vont en cache (pas de 206, d'erreur ni de réponse opaque).
const cacheable = (res) => res.status === 200 && res.type === "basic";
const astroName = (path) => (path.startsWith("/_astro/") ? path.slice("/_astro/".length) : "");

self.addEventListener("install", (e) => {
  e.waitUntil(
    fetch(PAGE)
      .then((res) => (cacheable(res) ? savePage(res) : undefined))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((ks) => Promise.all(ks.filter((k) => k.startsWith("argent-") && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/**
 * Garde la page reçue puis retire du cache les fichiers /_astro/ qu'elle n'utilise plus (anciens déploiements).
 * « Utilisé » : cité par la page, ou par un fichier JS/CSS utilisé (morceaux chargés plus tard, polices).
 */
async function savePage(res) {
  const html = await res.clone().text();
  const cache = await caches.open(CACHE);
  await cache.put(PAGE, res);
  const files = new Map();
  for (const req of await cache.keys()) {
    const name = astroName(new URL(req.url).pathname);
    if (name) files.set(name, req);
  }
  const keep = new Set([...files.keys()].filter((n) => html.includes(n)));
  const queue = [...keep];
  while (queue.length) {
    const name = queue.pop();
    if (!/\.(m?js|css)$/.test(name)) continue;
    const hit = await cache.match(files.get(name));
    const text = hit ? await hit.text() : "";
    for (const other of files.keys()) {
      if (!keep.has(other) && text.includes(other)) {
        keep.add(other);
        queue.push(other);
      }
    }
  }
  await Promise.all([...files].filter(([n]) => !keep.has(n)).map(([, req]) => cache.delete(req)));
}

async function put(req, res) {
  const cache = await caches.open(CACHE);
  await cache.put(req, res);
}

// Page : réseau d'abord, cache si le réseau échoue ou traîne plus de TIMEOUT.
function navigate(e, isApp) {
  const got = fetch(e.request).then((res) => ({ res, copy: res.clone() }));
  e.waitUntil(got.then(({ copy }) => (isApp && cacheable(copy) ? savePage(copy) : undefined)).catch(() => {}));
  return new Promise((resolve) => {
    let done = false;
    const finish = (r) => {
      if (done || !r) return;
      done = true;
      clearTimeout(timer);
      resolve(r);
    };
    const cached = () => caches.match(PAGE);
    const timer = setTimeout(() => cached().then(finish), TIMEOUT);
    got.then(({ res }) => finish(res)).catch(() => cached().then((r) => finish(r || Response.error())));
  });
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/argent-sync")) return; // réseau seul, jamais en cache
  if (req.mode === "navigate") return e.respondWith(navigate(e, url.pathname === PAGE || url.pathname === "/argent"));
  if (!url.pathname.startsWith("/argent/") && !url.pathname.startsWith("/_astro/") && !/\.(woff2?|css|js|png|svg)$/.test(url.pathname)) return;

  // Fichiers /_astro/ : leur nom change à chaque version, le cache suffit. Le reste : réseau d'abord.
  const fromNet = () =>
    fetch(req).then((res) => {
      if (cacheable(res)) e.waitUntil(put(req, res.clone()));
      return res;
    });
  if (url.pathname.startsWith("/_astro/")) {
    e.respondWith(caches.match(req).then((hit) => hit || fromNet()));
  } else {
    e.respondWith(fromNet().catch(() => caches.match(req).then((r) => r || Response.error())));
  }
});
