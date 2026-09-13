// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

// Adresse de publication. Par défaut le domaine final ; le déploiement GitHub Pages
// (.github/workflows/deploy.yml) passe SITE_URL et BASE_PATH tant que le domaine n'est pas branché.
const site = process.env.SITE_URL || "https://joakimjanssens.com";
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  site,
  base,
  integrations: [sitemap({ filter: (page) => !/\/404\/?$/.test(page) })],
  vite: {
    plugins: [tailwindcss()],
  },
});
