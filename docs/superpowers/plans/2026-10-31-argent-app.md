# /argent v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la page `/argent` par une vraie appli de gestion d'argent (thème clair, accent rose), fluide sur téléphone, avec un beau tableau de bord sur PC.

**Architecture:** Toute la logique (modèle, paie, échéances, soldes, import, rapprochement) vit dans des modules TypeScript purs sous `src/lib/argent/`, testés avec Vitest. L'interface est un îlot Preact unique monté par `src/pages/argent.astro` (`client:only`), qui lit et écrit un seul état dans `localStorage` (clé `argent:v2`) et passe par la synchro chiffrée existante. Web app installable : manifeste + service worker limités à `/argent/`.

**Tech Stack:** Astro 7, Tailwind v4, Preact 11.0.1 + @astrojs/preact 6.1.0 + @preact/signals 2.11.3, lucide-preact 1.58.0 (icônes), pdfjs-dist 6.4.299 (déjà là), Vitest 4.1.12.

**Spec:** `docs/superpowers/specs/2026-10-31-argent-app-design.md`

## Global Constraints

- Dépôt **public** : aucun montant, nom, IBAN ou extrait réel dans le code, les tests ou les fixtures. Fixtures = données inventées.
- Page cachée : `<Base … hidden>` (noindex complet, pas d'OG), exclue du sitemap (`astro.config.mjs` déjà), jamais dans robots.txt.
- Données sur l'appareil : `localStorage["argent:v2"]`. Les clés v1 `argent:v1` et `argent:comptes:v1` ne sont ni lues ni effacées.
- Dates en chaîne locale `AAAA-MM-JJ` (jamais `toISOString()`, qui passe en UTC).
- Thème clair ; accent rose bonbon. Ne reprend ni les polices ni le crème du site.
- Paie : montant par jour réglable (défaut 100), lun–ven, journée du jour visible seulement **à partir de 20 h**, payée le **jeudi de la semaine suivante**.
- Pas de budgets par catégorie. Pas d'investissements.
- Un commit par tâche (ou par action). Messages en français, préfixe « Argent : ». Pas de trailer Co-Authored-By. Jamais de push sans accord explicite (et `git fetch` avant).
- Versions exactes ci-dessus dans `package.json` (pas de `^` vers une version plus récente que 2 semaines).

## Review Focus

- **App rouverte après plusieurs jours** : toutes les journées manquées (lun–ven, non retirées) sont créées, aucune en double → test dans Task 3.
- **Même extrait importé deux fois / deux extraits qui se chevauchent** : rien n'est ajouté ni relié deux fois → test dans Task 7.
- **Deux dépenses notées identiques (même montant, même jour)** et une seule ligne bancaire : une seule est reliée, l'autre reste → test dans Task 7.
- **Fuseau horaire** : une opération saisie à 23 h 30 reste à la bonne date → test dans Task 2.
- **Saisie « 12,50 »** (virgule) et montants négatifs tapés : bien lus → test dans Task 2.

---

### Task 1: Maquettes à valider (porte d'entrée du design)

Aucune ligne de produit n'est codée avant le « c'est bon » de l'utilisateur sur ces maquettes. Les tâches 2 à 8 (logique) peuvent avancer en parallèle.

**Files:**
- Create (hors dépôt) : `<scratchpad>/maquettes/index.html` et captures `phone-*.png`, `desktop.png`

- [ ] **Step 1:** Regarder de nouveau les références Dribbble « money management app » (thème clair de préférence), noter typo, rayons, ombres, densité.
- [ ] **Step 2:** Construire une maquette HTML statique, données inventées : téléphone 390 px (Accueil, Activité, feuille « Ajouter » avec pavé numérique et catégories, Planning : fixes/dettes/objectifs, Comptes), PC 1440 px (tableau de bord). Fixer ici les jetons : couleurs (rose clair, rose soutenu, neutres, couleurs de catégories), police, rayons, ombres.
- [ ] **Step 3:** Valider la palette des catégories avec `node <dataviz>/scripts/validate_palette.js "<hex,…>" --mode light` ; corriger tout FAIL.
- [ ] **Step 4:** Captures Playwright (390×844 et 1440×900), regarder chaque capture (chevauchements, contraste, débordements), corriger.
- [ ] **Step 5:** Envoyer les captures (SendUserFile), itérer jusqu'au « c'est bon ». Recopier les jetons validés dans `docs/superpowers/specs/2026-10-31-argent-app-design.md` (section Design) et committer : `Argent v2 : jetons de design validés`.

### Task 2: Socle — dépendances, modèle, dates, montants

**Files:**
- Modify: `package.json` (preact 11.0.1, @astrojs/preact 6.1.0, @preact/signals 2.11.3, lucide-preact 1.58.0, vitest 4.1.12 en dev ; script `"test": "vitest run"`), `astro.config.mjs` (intégration `preact()`)
- Create: `src/lib/argent/model.ts`, `src/lib/argent/dates.ts`, `src/lib/argent/money.ts`
- Test: `src/lib/argent/dates.test.ts`, `src/lib/argent/money.test.ts`

**Interfaces — Produces (`model.ts`):**
```ts
type AccountKind = "courant" | "epargne" | "liquide";
type Account = { id: string; name: string; kind: AccountKind; bank?: "revolut" | "cbc"; iban?: string;
  color: string; anchor?: { date: string; balance: number } };
type Category = { id: string; name: string; icon: string; color: string; kind: "out" | "in" };
type TxnStatus = "manuel" | "prevu" | "banque";
type TxnSource = "journee" | "fixe" | "dette" | "import" | "saisie";
type Txn = { id: string; accountId: string; date: string; amount: number; label: string;
  categoryId?: string; status: TxnStatus; source: TxnSource; refId?: string; bankKey?: string;
  transferId?: string; note?: string };
type Every = "month" | "week" | "2weeks";
type Recurring = { id: string; label: string; amount: number; every: Every; first: string; accountId: string; categoryId?: string };
type Debt = { id: string; label: string; total: number; amount: number; every: Every; first: string; accountId: string };
type Goal = { id: string; name: string; icon: string; color: string; target: number; date?: string; accountId: string };
type Work = { dayAmount: number; start?: string; end?: string; skipped: string[]; accountId?: string; payer: string };
type State = { v: 2; accounts: Account[]; categories: Category[]; txns: Txn[]; recurring: Recurring[];
  debts: Debt[]; goals: Goal[]; work: Work; learned: Record<string, string> };
function emptyState(): State   // comptes de départ : « CBC » (courant, cbc), « Revolut » (courant, revolut),
                               // « Revolut épargne » (epargne, revolut), « Liquide » (liquide) ; catégories de départ ;
                               // work = { dayAmount: 100, skipped: [], payer: "" }
```
Catégories de départ (sortie) : Courses, Carburant, Resto & snacks, Sorties, Abonnements, Santé, Logement, Proches, Autres ; (entrée) : Salaire, Proches, Autres rentrées. Icônes = noms lucide ; couleurs = palette validée en Task 1.

**`dates.ts`:** `iso(d: Date): string`, `parse(s: string): Date`, `addDays(s: string, n: number): string`, `isWorkday(s: string): boolean`, `payday(s: string): string` (jeudi de la semaine suivante), `nthDate(r: { first: string; every: Every }, n: number): string` (mois : jour gardé, ramené à la fin du mois — repris de v1), `todayIso(now?: Date): string`.
**`money.ts`:** `toAmount(input: string): number` (accepte « 12,50 », « 12.5 », « -3 »), `fmt(n: number): string` (fr-BE, EUR, sans « ,00 »), `round2(n: number): number`.

- [ ] **Step 1: Tests**
```ts
test("payday : lundi 2026-10-05 → jeudi 2026-10-15", () => expect(payday("2026-10-05")).toBe("2026-10-15"));
test("payday : vendredi 2026-10-09 → jeudi 2026-10-15", () => expect(payday("2026-10-09")).toBe("2026-10-15"));
test("iso garde la date locale à 23 h 30", () => expect(iso(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31"));
test("nthDate mensuel le 31 → 30 novembre", () => expect(nthDate({ first: "2026-10-31", every: "month" }, 1)).toBe("2026-11-30"));
test("toAmount virgule", () => expect(toAmount("12,50")).toBe(12.5));
test("toAmount négatif", () => expect(toAmount("-3")).toBe(-3));
test("fmt", () => expect(fmt(1200)).toBe("1 200 €"));   // espace insécable fine selon Intl : comparer après normalisation \s
```
- [ ] **Step 2:** `npm i -E preact@11.0.1 @astrojs/preact@6.1.0 @preact/signals@2.11.3 lucide-preact@1.58.0 && npm i -DE vitest@4.1.12`, ajouter `preact()` dans `astro.config.mjs`. `npx vitest run src/lib/argent` → FAIL (modules absents).
- [ ] **Step 3:** Écrire `model.ts`, `dates.ts`, `money.ts`.
- [ ] **Step 4:** `npx vitest run src/lib/argent` → PASS ; `npx astro build` → Complete.
- [ ] **Step 5:** Commit `Argent v2 : socle (modèle, dates, montants, Preact, Vitest)`.

### Task 3: Journées payées automatiquement

**Files:** Create `src/lib/argent/workdays.ts` ; Test `src/lib/argent/workdays.test.ts`

**Interfaces:**
- Consumes: `State`, `Txn`, `isWorkday`, `addDays`, `iso`.
- Produces: `syncWorkdays(state: State, now: Date): State` — ajoute une `Txn` `{ status: "prevu", source: "journee", amount: work.dayAmount, label: "Journée", categoryId: <Salaire>, accountId: work.accountId ?? <CBC> }` pour chaque jour lun–ven de `work.start` à aujourd'hui (aujourd'hui seulement si `now.getHours() >= 20`), borné par `work.end`, sauf `work.skipped` et sauf jour déjà présent (journée ou paie bancaire couvrant ce jour, cf. Task 7) ; renvoie un nouvel état (pas de mutation). `skipDays(state, days: string[]): State` (retire + ajoute à `skipped`), `unskipDay(state, day): State`.

- [ ] **Step 1: Tests** — `aucune journée sans work.start` ; `jeudi 19 h 59 : pas la journée du jour` ; `jeudi 20 h 00 : journée du jour ajoutée` ; `rouvert 10 jours plus tard : toutes les journées lun–ven manquantes, aucune en double (appel deux fois → même nombre)` ; `jour retiré jamais recréé` ; `work.end respecté`.
- [ ] **Step 2:** Lancer → FAIL. **Step 3:** Implémenter. **Step 4:** → PASS.
- [ ] **Step 5:** Commit `Argent v2 : journées payées automatiquement (dès 20 h)`.

### Task 4: Paiements fixes et dettes

**Files:** Create `src/lib/argent/schedule.ts` ; Test `src/lib/argent/schedule.test.ts`

**Interfaces — Produces:**
- `debtSchedule(d: Debt): { date: string; amount: number }[]` (jusqu'à zéro, dernière tranche partielle — repris de v1), `debtLeft(d: Debt, at: string): number`.
- `materializeSchedule(state: State, today: string): State` — pour chaque échéance de fixe/dette `<= today` sans `Txn` existante (`refId` = id du fixe/dette **et** même date), ajoute `{ status: "prevu", source: "fixe" | "dette", refId, amount, accountId, categoryId }` (dette : montant négatif).
- `upcoming(state: State, today: string, days: number): { date: string; label: string; amount: number; kind: "fixe" | "dette" | "paie"; refId?: string }[]` trié par date — inclut le prochain jeudi de paie (somme des journées en attente).

- [ ] **Step 1: Tests** — `dette 1200 / 100 par mois → 12 échéances, fin connue` ; `dette 250 / 100 → 100, 100, 50` ; `materialize idempotent (2 appels = mêmes txns)` ; `upcoming 30 jours contient le fixe du 5 et la paie du jeudi`.
- [ ] **Step 2–4:** FAIL → implémenter → PASS.
- [ ] **Step 5:** Commit `Argent v2 : paiements fixes et dettes (échéances, à venir)`.

### Task 5: Soldes, dépenses du mois, prévision

**Files:** Create `src/lib/argent/balance.ts` ; Test `src/lib/argent/balance.test.ts`

**Interfaces — Produces:**
- `effectiveDate(t: Txn): string` (journée → `payday(t.date)`, sinon `t.date`).
- `accountBalance(state: State, accountId: string, at: string): number` = `anchor.balance` + somme des txns du compte avec `anchor.date < effectiveDate <= at` (sans ancre : toutes jusqu'à `at`).
- `totalBalance(state: State, at: string): number` (tous les comptes).
- `pendingPay(state: State, at: string): { amount: number; next?: string }` (journées faites, pas encore payées).
- `spendByCategory(state: State, month: string /* AAAA-MM */): { categoryId: string; amount: number; share: number }[]` — sorties seulement, **sans** virements (`transferId`), triées décroissant.
- `forecast(state: State, target: string, now: Date): { total: number; rows: { label: string; amount: number; details: string[] }[]; later: number }` — lignes : aujourd'hui, paies (journées à venir lun–ven non retirées incluses), prévus, fixes, dettes ; `later` = journées faites payées après `target`.
- `transfer(state, fromId, toId, amount, date): State` — deux txns liées par `transferId` (sert aux objectifs).

- [ ] **Step 1: Tests** — `ancre 0 € au 31/10 + dépense -40 le 2/11 → -40` ; `journée du 6/11 pas dans le solde du 11/11, oui le 12/11` ; `virement CBC → Revolut épargne : total inchangé, absent de spendByCategory` ; `forecast : total = somme des lignes`.
- [ ] **Step 2–4:** FAIL → implémenter → PASS.
- [ ] **Step 5:** Commit `Argent v2 : soldes, dépenses par catégorie, prévision`.

### Task 6: Lecture d'extraits (Revolut) et catégories devinées

**Files:** Create `src/lib/argent/import/types.ts`, `src/lib/argent/import/pdf.ts`, `src/lib/argent/import/revolut.ts`, `src/lib/argent/categorize.ts` ; Test `src/lib/argent/import/revolut.test.ts`, `src/lib/argent/categorize.test.ts`, fixture inventée `src/lib/argent/import/fixtures/revolut-items.json`

**Interfaces — Produces:**
```ts
type PdfItem = { page: number; x: number; y: number; h: number; s: string };
type StatementLine = { key: string; date: string; amount: number; label: string; counterparty: string; iban: string;
  section: "courant" | "poche" | "epargne"; balance: number | null };
type Statement = { bank: "revolut" | "cbc"; iban: string; owner: string; lines: StatementLine[] };
readPdfItems(file: File): Promise<PdfItem[]>      // pdf.ts, import dynamique de pdfjs (legacy build), comme v1
parseRevolut(items: PdfItem[]): Statement | null  // revolut.ts, logique portée depuis src/components/argent/Comptes.astro
guessCategory(line: StatementLine, state: State): string | undefined   // categorize.ts : learned[nom normalisé] d'abord, puis règles (v1)
learnCategory(state: State, label: string, amount: number, categoryId: string): State
```
- [ ] **Step 1:** Fabriquer la fixture : items PDF **inventés** au format Revolut (titres de sections, en-têtes « Money out/in », 6 lignes dont une sur deux lignes, une sortie carte, une entrée, un virement vers une poche). Tests : `6 lignes lues` ; `montants signés corrects` ; `clé = revolut:<section>:<Transaction Id>` ; `libellé sur deux lignes recollé` ; `guessCategory("LUKOIL") = Carburant` ; `une correction apprise gagne sur la règle`.
- [ ] **Step 2–4:** FAIL → porter/implémenter → PASS.
- [ ] **Step 5:** Commit `Argent v2 : lecture des extraits Revolut et catégories devinées`.

CBC : ajoutée dans une tâche séparée quand l'utilisateur fournit un extrait réel (format inconnu) — `parseCbc(items): Statement | null` sur le même type.

### Task 7: Rapprochement fin de mois

**Files:** Create `src/lib/argent/reconcile.ts` ; Test `src/lib/argent/reconcile.test.ts`

**Interfaces:**
- Consumes: `Statement`, `State`, `guessCategory`, `isWorkday`.
- Produces: `reconcile(state: State, st: Statement): { state: State; report: { added: number; linked: number; replacedDays: number; already: number } }`

Règles (dans cet ordre) :
1. Compte cible : par `iban` + `section` (courant → compte courant de la banque, epargne/poche → compte épargne de la banque) ; créer le compte s'il manque.
2. Ligne dont `key` existe déjà (`bankKey`) → `already`, rien.
3. Paie : `amount > 0` et `label`/`counterparty` contient `work.payer` (insensible à la casse) → supprimer les txns `source: "journee"` des lun–ven de la **semaine précédant** la semaine de la ligne ; ajouter la ligne (`status: "banque"`, catégorie Salaire) ; marquer ces jours comme couverts pour `syncWorkdays` (les jours couverts = ceux de la semaine remplacée).
4. Sinon chercher une txn `status !== "banque"` du même compte, même signe, `|Δmontant| <= max(1, 5 %)`, `|Δjours| <= 4`, non encore reliée ; la plus proche (date puis montant). Trouvée → elle prend le montant, la date, `bankKey`, `status: "banque"` (garde catégorie et note) → `linked`.
5. Sinon ajouter (`status: "banque"`, `source: "import"`, `categoryId: guessCategory`) → `added`. Lignes vers/depuis un compte à soi (IBAN connu, prénom du titulaire, poche/épargne) → `transferId` partagé avec la ligne miroir si elle existe.
6. Txns manuelles absentes de l'extrait : inchangées.
7. Ancre : pour chaque section, `anchor = { date: dernière date, balance: dernier solde }` si plus récente que l'ancre actuelle.

- [ ] **Step 1: Tests** — `même extrait importé 2 fois → 2e fois already = tout, added = 0` ; `dépense manuelle -40 le 3 + ligne -40,20 le 4 → reliée, montant -40,20` ; `deux manuelles -10 le même jour + une ligne -10 → une reliée, l'autre intacte` ; `manuelle sans ligne → intacte` ; `paie de l’employeur le jeudi 15 → journées du 5 au 9 remplacées, solde = montant réel` ; `ancre posée au dernier solde`.
- [ ] **Step 2–4:** FAIL → implémenter → PASS.
- [ ] **Step 5:** Commit `Argent v2 : rapprochement des extraits`.

### Task 8: Stockage et synchro

**Files:** Create `src/lib/argent/store.ts`, `src/lib/argent/sync.ts` ; Modify `public/argent-sync.php` (rien, sauf si besoin) ; Test `src/lib/argent/store.test.ts`

**Interfaces — Produces:**
- `store.ts` : signal `state` (`@preact/signals`) chargé depuis `argent:v2` (sinon `emptyState()`), `update(fn: (s: State) => State): void` qui enregistre et émet `argent:saved` ; `refreshAuto(now: Date)` = `syncWorkdays` + `materializeSchedule`.
- `sync.ts` : logique de `src/components/argent/Sync.astro` portée en module (chiffrement AES-GCM, code, `pull/push`, 409, règle « le distant gagne »), avec `KEYS = ["argent:v2"]` ; API `syncStatus` (signal), `enableSync()`, `joinSync(code)`, `stopSync()`, `copyLink()`. Après application d'un état distant : recharger le signal (pas de `location.reload()`).
- [ ] **Step 1: Tests** — `état absent → emptyState` ; `JSON corrompu → emptyState, sans exception` ; `update écrit argent:v2 et émet argent:saved` ; `chiffrer puis déchiffrer redonne le même texte` (Vitest + `crypto.subtle` de Node).
- [ ] **Step 2–4:** FAIL → implémenter → PASS.
- [ ] **Step 5:** Commit `Argent v2 : stockage et synchro chiffrée`.

### Task 9: Coquille de l'appli (navigation, feuilles, transitions)

**Files:** Create `src/components/argent2/App.tsx`, `ui/Sheet.tsx`, `ui/TabBar.tsx`, `ui/Sidebar.tsx`, `ui/Numpad.tsx`, `ui/Ring.tsx`, `ui/Icon.tsx`, `theme.css` ; Modify `src/pages/argent.astro` (remplacé : `<Base title="Argent" description="" hidden>` + `<App client:only="preact" />` + metas appli) ; v1 `src/components/argent/*` supprimés à la fin de Task 13.

- Téléphone (< 1024 px) : barre du bas 4 onglets (Accueil, Activité, Planning, Comptes) + bouton « + » central rose qui ouvre la feuille d'ajout ; transitions d'écran (fondu + léger glissement, 200 ms, respect de `prefers-reduced-motion`) ; feuilles qui montent du bas, fermables en glissant vers le bas ; retours au toucher (`active:scale`), zones ≥ 44 px ; `env(safe-area-inset-*)`.
- PC (≥ 1024 px) : barre latérale gauche (mêmes entrées + « Ajouter »), contenu en grille.
- Jetons (couleurs, rayons, ombres, police) = ceux validés en Task 1, en variables CSS dans `theme.css`.
- `Ring.tsx` : anneau SVG `({ parts: { value: number; color: string; id: string }[], size, thickness, onSelect })`, espace de 2 px entre parts, part touchée mise en avant.
- [ ] **Step 1:** Monter la coquille avec écrans vides ; `npx astro build` → Complete.
- [ ] **Step 2:** Playwright 390×844 et 1440×900 : changer d'onglet, ouvrir/fermer la feuille, aucune erreur console, pas de défilement horizontal ; captures comparées aux maquettes validées.
- [ ] **Step 3:** Commit `Argent v2 : coquille de l'appli (onglets, feuilles, transitions)`.

### Task 10: Accueil + ajout rapide + catégories

**Files:** Create `src/components/argent2/screens/Home.tsx`, `sheets/AddSheet.tsx`, `sheets/CategorySheet.tsx`
- Accueil (ordre de la spec) : **tout mon argent** (`totalBalance`), à recevoir + prochaine paie (`pendingPay`) ; **à venir** (`upcoming(…, 14)`) en cartes horizontales défilantes ; **anneau du mois** (`spendByCategory`) avec légende et % ; toucher une part → Activité filtrée ; dernières opérations ; carte journée du jour (« Pas travaillé » / « Remettre ») quand c'est un jour de travail.
- Feuille d'ajout : sens (dépense / rentrée / virement), montant au pavé numérique, catégories en pastilles (icône + couleur), compte, date, note. Enregistre `status: "manuel", source: "saisie"`.
- Catégories : créer / renommer / supprimer, choisir icône (sélection lucide) et couleur (palette validée).
- [ ] **Step 1:** Implémenter. **Step 2:** Playwright : ajouter « 40 € Carburant » → anneau et solde mis à jour, rechargement → persiste ; captures 390/1440. **Step 3:** Commit `Argent v2 : accueil, ajout rapide, catégories`.

### Task 11: Activité

**Files:** Create `src/components/argent2/screens/Activity.tsx`, `sheets/TxnSheet.tsx`
- Opérations groupées par jour (en-tête avec total du jour), icône de catégorie en pastille colorée, montant ; badges « prévu » / « banque » ; recherche texte ; filtres (Tout, Dépenses, Rentrées, Fixes, par catégorie) ; toucher → feuille de détail (modifier montant/catégorie/compte/date/note, supprimer — une journée supprimée passe par `skipDays`). Changer la catégorie d'une ligne bancaire appelle `learnCategory`.
- [ ] **Step 1:** Implémenter. **Step 2:** Playwright : filtre, recherche, modification, suppression d'une journée (ne revient pas après `refreshAuto`). **Step 3:** Commit `Argent v2 : activité (jours, recherche, filtres, détail)`.

### Task 12: Planning — fixes, dettes, objectifs, prévision

**Files:** Create `src/components/argent2/screens/Plan.tsx`, `sheets/RecurringSheet.tsx`, `sheets/DebtSheet.tsx`, `sheets/GoalSheet.tsx`, `sheets/ForecastSheet.tsx`
- Fixes (prochaine date, fréquence), dettes (barre de progression, reste, date de fin, total à rembourser, « libre le … »), objectifs (anneau de progression = solde du compte lié / cible ; « Mettre de côté » = `transfer` du courant vers le compte lié), prévision « Combien j'aurai le… » (date + curseur, lignes de `forecast`).
- Réglages de la paie ici aussi (montant par jour, début, fin, jours non travaillés en plage, compte de paie, nom de l'employeur).
- [ ] **Step 1:** Implémenter. **Step 2:** Playwright : dette 1200/100 → fin affichée ; objectif + mettre de côté 50 € → total inchangé, objectif +50 ; prévision = somme des lignes. **Step 3:** Commit `Argent v2 : planning (fixes, dettes, objectifs, prévision)`.

### Task 13: Comptes, import d'extraits, réglages

**Files:** Create `src/components/argent2/screens/Accounts.tsx`, `sheets/ImportSheet.tsx`, `sheets/SettingsSheet.tsx` ; Delete `src/components/argent/Comptes.astro`, `src/components/argent/Sync.astro`
- Comptes : une carte par compte (solde, petite courbe du mois), ajouter/renommer ; import PDF (`readPdfItems` → `parseRevolut` → `reconcile`) avec résumé « X ajoutées · Y reliées · Z journées remplacées · déjà là » ; réglages : synchro (activer, code, copier le lien, rejoindre via `#sync=`), export/import JSON, effacer.
- [ ] **Step 1:** Implémenter. **Step 2:** Playwright avec un PDF **généré pour le test** (ou la fixture d'items) : import, réimport → rien ajouté ; synchro simulée entre deux contextes (route mockée comme en v1). **Step 3:** Commit `Argent v2 : comptes, import d'extraits, réglages et synchro`.

### Task 14: Tableau de bord PC

**Files:** Modify écrans de Tasks 10–13 (variantes `lg:`), Create `src/components/argent2/screens/Dashboard.tsx` (accueil PC)
- Grille : total + comptes (haut gauche), à venir (haut droite), anneau du mois + évolution des dépenses sur 6 mois en barres (milieu), dernières opérations (bas), conforme à la maquette PC validée. Survol = info-bulle sur barres et parts d'anneau.
- [ ] **Step 1:** Implémenter. **Step 2:** Captures 1440×900 et 1280×800, comparées à la maquette ; aucune erreur console. **Step 3:** Commit `Argent v2 : tableau de bord PC`.

### Task 15: Web app installable + vérification finale

**Files:** Create `public/argent/manifest.webmanifest`, `public/argent/sw.js`, `public/argent/icon-192.png`, `public/argent/icon-512.png`, `public/argent/apple-touch-icon.png` ; Modify `src/pages/argent.astro` (lien manifeste, `theme-color`, enregistrement du SW avec `scope: "/argent/"`)
- Manifeste : `name` « Argent », `start_url` `/argent/`, `scope` `/argent/`, `display` `standalone`, couleurs du thème. SW : met en cache la page et ses assets (réseau d'abord, cache en secours) ; ne met **jamais** en cache `argent-sync.php`.
- [ ] **Step 1:** Implémenter. **Step 2:** Build + preview : manifeste valide, SW actif, page servie hors ligne (Playwright `context.setOffline(true)` puis rechargement). Vérifier `<meta name="robots" content="noindex…">` toujours présent, page absente du sitemap. `npx vitest run` → tout PASS. **Step 3:** Commit `Argent v2 : web app installable`. Puis **demander l'accord** avant `git fetch` + push.
