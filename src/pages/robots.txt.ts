import type { APIRoute } from "astro";
import { absolute } from "../lib/paths";

export const GET: APIRoute = ({ site }) =>
  new Response(`User-agent: *\nAllow: /\n\nSitemap: ${absolute(site, "sitemap-index.xml")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
