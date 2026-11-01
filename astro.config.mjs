// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";
import tailwindcss from "@tailwindcss/vite";
import preact from "@astrojs/preact";

export default defineConfig({
  site: "https://joakimjanssens.com",
  // La feuille de style (7 Ko) est glissée dans la page : une requête bloquante de moins.
  build: { inlineStylesheets: "always" },
  integrations: [preact(), sitemap({ filter: (page) => !/\/(404|argent)\/?$/.test(page) })],
  vite: {
    plugins: [tailwindcss()],
  },
});
