// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  site: "https://joakimjanssens.com",
  // La feuille de style (7 Ko) est glissée dans la page : une requête bloquante de moins.
  build: { inlineStylesheets: "always" },
  integrations: [sitemap({ filter: (page) => !/\/404\/?$/.test(page) })],
  vite: {
    plugins: [tailwindcss()],
  },
});
