# /argent v2 — une vraie appli de gestion d'argent

Date : 2026-10-31. Dépôt **public** : ce document ne contient aucun montant, nom ou IBAN personnel.

## Pourquoi

La première version de `/argent` (page Astro, onglets, listes) marche mais « ne fait pas pro » : elle
ressemble à une page du site, pas à une appli. L'utilisateur veut repartir de zéro côté design et
présentation : une vraie appli de gestion d'argent, belle sur téléphone (fluide, comme une appli
installée) et un vrai beau tableau de bord sur PC. Inspiration : les maquettes Dribbble « money
management app » (cartes arrondies, gros solde, anneaux et barres de couleur, bouton « + » central),
mais **en thème clair**.

Il a regardé Finary : non retenu (pas d'ajout manuel de dépenses, pas de logique de paie ni de dettes,
banques belges incertaines, payant). L'appli reste la sienne.

## Ce que l'utilisateur voit en ouvrant l'appli (accueil, téléphone)

Dans cet ordre, en un coup d'œil :

1. **Tout son argent** : la somme de tous ses comptes (banque, Revolut, épargne, liquide). Pas
   d'interrupteur « dépensable / tout ». Sous le montant : ce qui est à recevoir (journées faites pas
   encore payées) et la date de la prochaine paie.
2. **Ce qui va sortir bientôt** : paiements fixes et tranches de dettes à venir, avec la date (« dans
   2 jours »).
3. **Graphe des dépenses du mois** : un anneau, une part par catégorie, dans la couleur de la
   catégorie, avec le pourcentage. Toucher une part = voir les opérations de cette catégorie.

Puis les dernières opérations.

## Fonctions

### Dépenses et rentrées à la main
- Ajout rapide depuis le bouton « + » central (barre du bas, téléphone) : montant au pavé numérique,
  catégorie, date (aujourd'hui par défaut), note, compte.
- **Catégories** : liste de départ fournie, l'utilisateur peut en créer, renommer, supprimer. Chaque
  catégorie a **son icône et sa couleur** (choisies dans une palette et une bibliothèque d'icônes).
- Corriger ou supprimer une opération.

### Comptes
- Plusieurs comptes : au départ banque CBC, Revolut, épargne Revolut, liquide (modifiable : ajouter,
  renommer). Chaque opération appartient à un compte. Le total = somme des comptes.
- Virements entre ses propres comptes : pas une dépense (ne comptent pas dans le graphe).

### Paie automatique
- Un **montant par jour travaillé**, réglable, ajouté tout seul chaque lundi–vendredi depuis une date de
  début (et jusqu'à une date de fin facultative).
- La journée du jour n'apparaît qu'à partir de **20 h** (fin de journée de travail). Elle s'affiche en « à recevoir » et entre dans l'argent le **jeudi de la semaine
  suivante** (paie hebdomadaire de la semaine d'avant).
- Un jour non travaillé (malade, congé, férié) se retire d'un geste ; plusieurs jours d'un coup aussi.
- Quand l'extrait bancaire contient le vrai virement de paie, il **remplace** les journées estimées de
  la semaine concernée (le montant réel gagne).

### Extraits de compte (fin de mois)
- Import du PDF Revolut (déjà fonctionnel en v1, lu dans le navigateur). CBC à ajouter dès que
  l'utilisateur fournit un extrait (format encore inconnu).
- **Rapprochement** :
  - une opération notée à la main qui correspond à une ligne de l'extrait (même compte, montant
    proche, date proche) est reliée ; le montant de la banque gagne ;
  - une ligne de l'extrait sans équivalent est ajoutée, avec une catégorie devinée (règles par nom de
    commerçant) que l'utilisateur peut corriger ; la correction est retenue pour la suite ;
  - une opération notée à la main **absente** de l'extrait reste telle quelle, sans alerte (liquide,
    autre) ;
  - le solde du compte est recalé sur le solde de l'extrait.
- Réimporter le même extrait n'ajoute rien.

### Paiements fixes (récurrents)
- Montant, sens, fréquence (mois / semaine / 2 semaines), prochaine date, catégorie. Apparaissent dans
  « à venir ».

### Dettes
- Total dû, tranche, fréquence, prochaine date : échéancier jusqu'à zéro, progression, date de fin.
  Distinct des paiements fixes (une dette s'arrête).

### Objectifs d'épargne
- Nom, icône, montant visé, date facultative ; progression en anneau.
- Un objectif est **lié à un compte d'épargne / une poche** (par ex. la poche Revolut « Nouvel an ») :
  y mettre de l'argent = un **virement** du compte courant vers ce compte (l'argent bouge vraiment ; le
  total ne change pas, ce n'est pas une dépense). Le solde de l'objectif = le solde de ce compte.
  Les mouvements de poche/épargne des extraits Revolut alimentent donc l'objectif.

### Prévision « combien j'aurai le… »
- À garder sous une forme plus lisible : le calcul ligne par ligne (aujourd'hui, paies, fixes, dettes,
  prévus) livré en v1, présenté dans le nouveau style.

### Synchro PC ↔ téléphone
- Garder la synchro chiffrée de la v1 (`public/argent-sync.php`, code de synchro, chiffrement dans le
  navigateur). Le nouveau format de données doit y passer.

## Hors sujet (pour l'instant)
- **Budgets par catégorie** : non voulus.
- **Investissements** (Trade Republic, Revolut Invest) : plus tard, peut-être une carte à saisir à la main.
- Connexion directe aux banques : non.

## Ce qui serait un échec
- Un look « page web » : tableaux, listes plates, texte gris partout, mise en page de site.
- Un tableau de bord PC générique, « IA », pas travaillé.
- Sur téléphone : pas fluide, pas de sensation d'appli (transitions, retours au toucher).

## Design
- **Thème clair.** Couleur d'accent : **rose bonbon / rose pâle**. Un rose doux pour les fonds et
  surfaces d'accent, un rose plus soutenu pour le bouton « + » et les éléments importants, en gardant
  un contraste lisible sur blanc.
- Ne plus reprendre le design du site joakimjanssens.com (polices, crème, style éditorial).
- Téléphone : barre du bas avec bouton « + » central, feuilles qui montent du bas pour ajouter /
  modifier, transitions douces, retours visuels au toucher, zones de toucher généreuses.
- PC : vrai tableau de bord, plusieurs blocs visibles à la fois (total + comptes, à venir, anneau des
  dépenses, évolution, opérations), navigation latérale ou haute.
- Les couleurs des catégories doivent rester distinguables entre elles (les tester, pas à l'œil).

## Contraintes
- Reste sur **joakimjanssens.com/argent**, page cachée : noindex complet, hors sitemap, pas dans
  robots.txt (déjà en place via la prop `hidden` du layout).
- Données **sur l'appareil** (localStorage), plus la synchro chiffrée. Rien en clair sur le serveur,
  rien dans le dépôt (public).
- **Pas de reprise des données v1** : la v2 repart de zéro et se remplit avec les extraits de compte
  (Revolut et CBC) que l'utilisateur fournit. Les anciennes clés (`argent:v1`, `argent:comptes:v1`)
  restent intactes dans le navigateur, en secours, et ne sont pas lues.
- Déploiement : push sur `main` = en ligne (rsync vers le serveur). Pas de push sans accord.

## Appli installable
- **Web app**, pas d'appli de magasin (pas de compte développeur) : manifeste + icône pour l'écran
  d'accueil, ouverture en plein écran, fonctionne hors ligne (service worker limité à /argent).

## Choix faits par Claude (à valider en lisant)
- Paiements fixes et tranches de dettes : à leur date, ils deviennent une opération « prévue » sur le
  compte choisi ; la ligne de l'extrait correspondante les remplace (jamais comptés deux fois).
- Paie dans l'extrait CBC : reconnue au nom de l'employeur (réglable) ; elle remplace les journées
  estimées de la semaine d'avant. Détails à régler avec un vrai extrait CBC.
- Le solde recalé par un extrait est stocké comme un solde de référence daté par compte ; les
  opérations après cette date s'y ajoutent.
- Pile : Astro reste l'hôte de la page ; l'interface de l'appli est écrite en composants côté client
  (îlot unique) pour gérer écrans, feuilles et transitions proprement. Graphes en SVG faits main
  (pas de grosse librairie).
- Ordre de travail : d'abord des **maquettes en capture d'écran** (téléphone + PC) envoyées à
  l'utilisateur pour validation du look, puis le code.

## Laissé au constructeur
- Liste de catégories de départ et leurs icônes/couleurs, règles de devinette par commerçant (v1 en a
  déjà).
- Détails d'animation, structure exacte des écrans secondaires.

## Design validé (2026-10-31)

Validé par l'utilisateur sur maquettes (fichier local hors dépôt : `C:\Users\micro\designs\argent\maquette\argent.maquette`, captures `C:\Users\micro\designs\argent\png\v2-*.jpg`). Refusés en route : dégradés, ombres, lueurs, tuiles d'icônes colorées partout (« trop IA »), grille 2×3 de gros blocs (« pas un dashboard »). Référence de structure retenue : le tableau de bord Dribbble « ACRU » (dense, plat, une couleur d'accent).

**Jetons**
- Police : Instrument Sans (Google Fonts), 400 et 500 seulement. Chiffres en 500, interlettrage serré sur les grands montants (−0,04 em).
- Couleurs : fond `#F3F1F0` · carte/panneau blanc `#FFFFFF` · encre `#151314` · gris texte `#75706E` · trait `#E7E3E1` · rose pâle `#FBE2EB` · rose `#F4A8C5` · rose vif (actions, bouton +) `#D9447F` · rose texte (liens) `#B12E64` · vert (hausse, rentrées) `#14935F`.
- Graphes : rentrées de la période choisie `#F4A8C5`, dépenses de la période choisie `#151314` ; autres périodes en fantômes `#F3D2DF` / `#C9C2BF` ; ligne zéro `#D9D3D1`.
- Catégories (ordre fixe) : `#6E5BD0`, `#EB6834`, `#2A78D6`, `#1BAF7A`, `#EDA100`, puis `#E34948`, `#008300`, `#2A78D6` décliné… (au-delà de 8 → « Autres »).
- Rayons : cartes 20 px (PC) / 22 px (téléphone), panneau principal PC 24 px, boutons en pilule, pastilles 8–10 px. **Aucune ombre, aucun dégradé.** Surfaces séparées par un pas de ton (cartes `#F3F1F0` sur panneau blanc).

**PC (≥ 1024 px)** : menu latéral gauche sur le fond (logo carré rose vif « € » + « Argent », Accueil / Activité / Planning / Comptes, état de la synchro en bas). Panneau blanc arrondi à droite avec en-tête (date + titre ; recherche, « Importer un extrait », bouton rose vif « + Ajouter »). Accueil en grille dense :
- rangée A : **graphe du solde** (gros total + « Tout mon argent, ce soir », sélecteur Semaine/Mois/Année, légende Rentrées/Dépenses, barres par période avec rentrées au-dessus de zéro et dépenses en dessous, période courante en couleur avec bulle de détail, axe à gauche) + **colonne de chiffres** (Rentré / Dépensé / Mis de côté du mois, variation vs mois précédent) ;
- rangée B : **paie de la semaine** (5 pastilles de jours, montant, date du jeudi) + **à payer dans les 15 jours** (bloc noir, total en rose) ;
- rangée C : **analyse des dépenses** (total, barre segmentée par catégorie, légende %), **dettes** (demi-jauge % remboursé, « libre le … »), **objectifs** (barres) ;
- colonne droite : **mes comptes** (deux cartes pleines rose vif / noire pour CBC et Revolut, lignes épargne et liquide, actions Ajouter / Virement / Épargner / Importer) + **historique** (dernières opérations).

**Téléphone** : fond blanc, cartes `#F3F1F0`. Accueil de haut en bas : en-tête (date, recherche, réglages) ; graphe du solde (total, sélecteur Sem./Mois/An, barres par semaine, légende) ; trois chiffres (Rentré / Dépensé / De côté) ; paie de la semaine (pastilles roses des jours, touchables pour retirer un jour) ; à payer bientôt (bloc noir) ; dépenses du mois (barre segmentée + légende) ; historique. Barre du bas blanche : Accueil, Activité, gros « + » rose vif, Planning, Comptes. Feuille d'ajout : sens (Dépense / Rentrée / Virement), gros montant, pastilles de catégories, pavé numérique, bouton pleine largeur.
