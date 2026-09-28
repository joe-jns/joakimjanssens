import type { IconName } from "../components/Icon.astro";

export const languages = {
  fr: { locale: "fr-BE", ogLocale: "fr_BE", label: "FR", name: "Français" },
  en: { locale: "en-GB", ogLocale: "en_GB", label: "EN", name: "English" },
} as const;

export type Lang = keyof typeof languages;

export const email = "contact@joakimjanssens.com";

export const links = {
  x: "https://x.com/joe_ghl",
  github: "https://github.com/joe-jns",
  linkedin: "https://www.linkedin.com/in/joakim-janssens/",
  email: `mailto:${email}`,
};

interface Job {
  title: string;
  org: string;
  place: string;
  from: string; // AAAA-MM
  to?: string; // AAAA-MM, absent si le poste est en cours
  tasks: string[];
}

export interface Content {
  meta: { title: string; description: string };
  role: string;
  bio: string[];
  cta: { email: string; noteBefore: string; noteAfter: string; copyTitle: string; copied: string };
  socialEmail: string;
  langSwitch: string;
  offers: { heading: string; items: { title: string; icon: IconName; desc: string; lien?: string }[] };
  now: { heading: string; updated: string };
  jobs: { heading: string; since: string; between: string; items: Job[] };
  footer: { copyright: string; status: string };
  ui: {
    clockTitle: string;
    savePdf: string;
    cvFileName: string;
    shortcutsHint: string;
    shortcutsTitle: string;
    shortcuts: { lang: string; email: string; pdf: string; toggle: string; close: string };
  };
  knowsAbout: string[];
}

// Espace insécable devant la ponctuation haute en français.
const nb = "\u00a0";

export const content: Record<Lang, Content> = {
  fr: {
    meta: {
      title: "Joakim Janssens · Sites web qui convertissent · IA locale",
      description:
        "Des sites web beaux et qui vendent vraiment, et des IA qui tournent entièrement sur les machines de mes clients.",
    },
    role: "Sites web qui convertissent · IA locale · Charleroi",
    bio: [
      `salut, moi c’est Joakim. Je fais deux choses${nb}: des sites web beaux et qui vendent vraiment, et des IA qui tournent entièrement sur les machines de mes clients.`,
      `L’IA locale, c’est pour les métiers dont les données n’ont pas le droit de partir sur des serveurs américains${nb}: avocats, notaires, cabinets médicaux et comptables. Les sites, c’est pour ceux qui en ont assez d’une jolie vitrine qui ne rapporte rien.`,
    ],
    cta: {
      email: "M’écrire un e-mail",
      noteBefore: "Écrivez-moi à",
      noteAfter: `${nb}: on regarde ensemble si l’IA locale tient la route chez vous.`,
      copyTitle: "Cliquer pour copier l’adresse",
      copied: "Copié",
    },
    socialEmail: "E-mail",
    langSwitch: "Langue",
    offers: {
      heading: "Ce que je fais",
      items: [
        {
          title: "Sites web",
          icon: "layout-template",
          lien: "portfolio",
          desc: `Dessiné dans Pen.dev, construit en Astro${nb}: une page rapide, belle, et qui transforme les visiteurs en clients.`,
        },
        {
          title: "IA locale",
          icon: "cpu",
          desc: "Des assistants qui tournent sur vos propres machines. Aucune donnée ne sort, aucun abonnement au cloud.",
        },
      ],
    },
    now: { heading: "En ce moment", updated: "mis à jour le" },
    jobs: {
      heading: "Parcours",
      since: "depuis",
      between: "à",
      items: [
        {
          title: "Fondateur",
          org: "Chacun Son Job",
          place: "Charleroi",
          from: "2024-10",
          tasks: [
            `Gestion complète de l’activité${nb}: contact client, suivi des dossiers, facturation et relances.`,
            "Organisation du travail en autonomie et respect des délais.",
          ],
        },
        {
          title: "Director of Web Services",
          org: "Halenria",
          place: "Londres",
          from: "2024-03",
          tasks: [
            "Création et maintenance de sites web pour des clients PME (WordPress, Elementor, Kadence).",
            "Diagnostic et résolution des problèmes techniques signalés par les clients.",
            "Explication des solutions en termes simples à des interlocuteurs non techniques.",
            "Automatisation de processus et gestion de plusieurs projets en parallèle.",
          ],
        },
        {
          title: "Webmaster",
          org: "Voir et Savoir ASBL",
          place: "Charleroi",
          from: "2020-09",
          to: "2023-07",
          tasks: [
            "Gestion, mises à jour et dépannage du site de l’association.",
            "Travail en équipe au sein d’une structure associative.",
          ],
        },
      ],
    },
    footer: { copyright: "© 2026 · construit en public", status: "Ouvert à un premier déploiement pilote" },
    ui: {
      clockTitle: "Heure locale à Charleroi",
      savePdf: "Enregistrer en PDF",
      cvFileName: "CV Joakim Janssens",
      shortcutsHint: "raccourcis",
      shortcutsTitle: "Raccourcis clavier",
      shortcuts: {
        lang: "Passer en anglais",
        email: "Copier l’e-mail",
        pdf: "Enregistrer le CV en PDF",
        toggle: "Afficher ces raccourcis",
        close: "Fermer",
      },
    },
    knowsAbout: [
      "Création de sites web",
      "Astro",
      "WordPress",
      "Intelligence artificielle locale",
      "Automatisation de processus métier",
    ],
  },

  en: {
    meta: {
      title: "Joakim Janssens · Websites that convert · Local AI",
      description: "Websites that look good and bring in business, and AI that runs entirely on your own machines.",
    },
    role: "Websites that convert · Local AI · Charleroi",
    bio: [
      "hi, I’m Joakim. I build two things: websites that look good and actually bring in business, and AI that runs entirely on your own machines.",
      "The AI is for firms whose client data can’t end up on US servers: law firms, accountants, medical practices. The websites are for anyone whose current site looks fine but never brings in a single enquiry.",
    ],
    cta: {
      email: "Email me",
      noteBefore: "Drop me a line at",
      noteAfter: " and we’ll see whether local AI fits the way you work.",
      copyTitle: "Click to copy the address",
      copied: "Copied",
    },
    socialEmail: "Email",
    langSwitch: "Language",
    offers: {
      heading: "What I do",
      items: [
        {
          title: "Websites",
          icon: "layout-template",
          lien: "portfolio",
          desc: "Designed in Pen.dev, built with Astro: fast, good-looking pages that turn visitors into clients.",
        },
        {
          title: "Local AI",
          icon: "cpu",
          desc: "Assistants that run on your own hardware. Your data stays in-house, and there’s no cloud subscription.",
        },
      ],
    },
    now: { heading: "Right now", updated: "updated" },
    jobs: {
      heading: "Experience",
      since: "since",
      between: "to",
      items: [
        {
          title: "Founder",
          org: "Chacun Son Job",
          place: "Charleroi",
          from: "2024-10",
          tasks: [
            "Run the business end to end: client relationships, case management, invoicing and chasing payments.",
            "Manage my own workload and deliver on time.",
          ],
        },
        {
          title: "Director of Web Services",
          org: "Halenria",
          place: "London",
          from: "2024-03",
          tasks: [
            "Build and maintain websites for small and mid-sized businesses (WordPress, Elementor, Kadence).",
            "Diagnose and fix the technical issues clients raise.",
            "Explain fixes in plain English to people who aren’t technical.",
            "Automate workflows and run several projects at once.",
          ],
        },
        {
          title: "Webmaster",
          org: "Voir et Savoir ASBL",
          place: "Charleroi",
          from: "2020-09",
          to: "2023-07",
          tasks: [
            "Ran, updated and troubleshot the charity’s website.",
            "Worked as part of a small non-profit team.",
          ],
        },
      ],
    },
    footer: { copyright: "© 2026 · built in public", status: "Taking on a first pilot project" },
    ui: {
      clockTitle: "Local time in Charleroi, Belgium",
      savePdf: "Save as PDF",
      cvFileName: "Joakim Janssens CV",
      shortcutsHint: "shortcuts",
      shortcutsTitle: "Keyboard shortcuts",
      shortcuts: {
        lang: "Switch to French",
        email: "Copy my email",
        pdf: "Save my CV as a PDF",
        toggle: "Show these shortcuts",
        close: "Close",
      },
    },
    knowsAbout: ["Web design and development", "Astro", "WordPress", "Local artificial intelligence", "Business process automation"],
  },
};

export const formatMonth = (yearMonth: string, lang: Lang) =>
  new Intl.DateTimeFormat(languages[lang].locale, { month: "short", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${yearMonth}-01T00:00:00Z`),
  );
