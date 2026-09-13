import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";
import { languages, type Lang } from "../i18n/content";
import fr from "../data/en-ce-moment.txt?raw";
import en from "../data/en-ce-moment.en.txt?raw";

const sources: Record<Lang, { raw: string; file: string }> = {
  fr: { raw: fr, file: "src/data/en-ce-moment.txt" },
  en: { raw: en, file: "src/data/en-ce-moment.en.txt" },
};

export interface NowItem {
  label: string;
  tag?: string;
  current: boolean;
}

export function readNow(lang: Lang): NowItem[] {
  return sources[lang].raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line, i) => {
      const [label, tag] = line.split("|").map((part) => part.trim());
      return { label, tag: tag || undefined, current: i === 0 };
    });
}

const git = (...args: string[]) =>
  execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * Date de dernière modification du fichier.
 * Fichier commité et intact : date du dernier commit qui l'a touché (stable sur un serveur de build,
 * où la date du fichier sur disque est celle du clone). Fichier modifié en local ou pas de git :
 * date du fichier sur disque.
 */
export function nowUpdatedAt(lang: Lang): Date {
  const file = join(process.cwd(), sources[lang].file);
  const mtime = statSync(file).mtime;
  try {
    if (git("status", "--porcelain", "--", file)) return mtime;
    const committed = git("log", "-1", "--format=%cI", "--", file);
    return committed ? new Date(committed) : mtime;
  } catch {
    return mtime;
  }
}

export const formatShortDate = (date: Date, lang: Lang) =>
  new Intl.DateTimeFormat(languages[lang].locale, { day: "numeric", month: "short", timeZone: "Europe/Brussels" }).format(
    date,
  );

export const isoDate = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Brussels" }).format(date);
