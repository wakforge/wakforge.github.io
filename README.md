# ⚒️ Wak'Forge – craft, bestiaire et archimonstres pour Wakfu

Choisis les objets que tu veux fabriquer : Wak'Forge calcule **toutes les ressources à réunir**, recettes intermédiaires comprises, et t'indique où trouver chacune (récolte, trappeur, drops). Tu coches au fur et à mesure, au besoin dans un **overlay** qui reste par-dessus le jeu.
Le **bestiaire** complet donne les drops de chaque monstre, et les **timers d'archimonstres** te préviennent de leur réapparition.

Disponible en **site web** (navigateur, mobile, installable) et en **appli Windows** autonome.
Avec un compte, tes timers et ta liste se synchronisent en direct entre tous tes appareils.

![Capture de Wak'Forge](docs/capture.png)

<details><summary>Bestiaire</summary>

![Bestiaire de Wak'Forge](docs/bestiaire.png)

</details>

> 🇬🇧 **English** – Wak'Forge is also available in English: [wakforge.github.io/?lang=en](https://wakforge.github.io/?lang=en) (or Settings → Langue · Language).
> Pick the items you want to craft and get **every base resource to gather**, intermediate recipes included, with where to find each one (harvest, trapper, monster drops). Tick them off as you go, in an **overlay** that stays on top of the game. Also: a full **bestiary** with drops, **archmonster timers**, shareable lists, market prices, profession levels and blueprints you have learned.
> Website (browser, mobile, installable) or standalone **Windows app**: [download `WakForge.exe`](https://github.com/wakforge/wakforge.github.io/releases/latest/download/WakForge.exe) (Windows warns because the exe is not signed: *More info → Run anyway*). Free community fan project, not affiliated with Ankama.

## Fonctionnalités

### Craft et bestiaire

- **Craft – liste de courses** : choisis les objets à fabriquer et leurs quantités. Wak'Forge calcule toutes les ressources de base, recettes intermédiaires comprises, avec pour chacune où la trouver : récolte (métier, niveau, ressource), trappeur ou drops (monstres, taux). Tu indiques ce que tu as déjà, tu peux choisir d'acheter un composant plutôt que de le fabriquer, et tu obtiens les étapes de fabrication dans l'ordre ainsi que les niveaux de métier nécessaires.
- **Prix et coût de revient** : saisis le prix HDV des ressources (colonne **Prix**, commune à toutes les listes) pour voir ce qu'il reste à dépenser. Dans les étapes de fabrication, un prix sur un composant compare **fabriquer** et **acheter** et indique le moins cher.
- **Plusieurs listes** : garde une liste par projet (« Panoplie 200 », « Reroll »…) et passe de l'une à l'autre avec les onglets au-dessus de la recherche. Double-clic sur l'onglet (ou ✎) pour renommer, × pour supprimer. Chaque liste a ses objectifs et ses quantités « j'ai ».
- **Partager une liste** : le bouton **Partager** copie un lien vers la liste. La personne qui l'ouvre peut l'importer en un clic (dans l'appli PC, colle le lien dans la recherche). Rien n'est envoyé à un serveur : la liste est dans le lien.
- **Importer un build** : le bouton **📷 Importer un build** ajoute d'un coup les équipements d'un build [Wakfuli](https://wakfuli.com/builder). Sur Wakfuli, onglet **Récap**, exporte le build en image, puis dépose-la (ou colle-la avec Ctrl+V) dans Wak'Forge : le nom et le niveau de chaque objet sont lus dans ton navigateur (rien n'est envoyé), la bonne rareté est retrouvée, et tu décoches ce que tu as déjà avant d'ajouter. L'option « Dans une nouvelle liste » crée une liste au nom du build.
- **Mes métiers** : indique tes niveaux dans **Réglages** (ou clique sur un métier sous les objectifs). Les fabrications et les récoltes au-dessus de ton niveau sont marquées 🔒.
- **Plans** : les objets qui ne se fabriquent qu'après avoir appris un plan (« Plan "Kokordon" »…) sont marqués 📜 **Plan requis** dans les étapes de fabrication, avec le nombre de plans à obtenir sous les objectifs. L'onglet **Plans** liste tous les plans du jeu, l'objet qu'ils débloquent et les monstres qui les droppent : coche ceux que tu as déjà appris pour ne plus être alerté.
- **Objets PvP** : les équipements qui s'achètent ou s'améliorent avec des jetons PvP (Médaille de Bravoure, Galon déchiré) portent un badge **⚔ PvP** dans la recherche, les objectifs, les ressources à réunir, les étapes de fabrication, l'overlay et la fiche objet. La case **Masquer PvP**, à côté de la quantité, les retire de la recherche (choix mémorisé).
- **Classement des ressources** : par niveau, par **provenance** (métier de récolte ou famille de monstre) ou par **monstre** (pour farmer plusieurs ressources sur le même), au choix. Le choix s'applique aussi à l'overlay.
- **English version** : Réglages → Langue (ou `?lang=en` dans l'adresse). Interface, noms des objets et des monstres, types et effets en anglais ; la recherche marche dans les deux langues.
- **Overlay** : le bouton **⧉ Overlay** de la liste de courses ouvre une version compacte qui reste par-dessus le jeu. On y coche ce qu'on récolte au fur et à mesure (+1, Maj + clic : +10), et tout reste synchronisé avec la liste complète.
  - **Appli PC** : la fenêtre passe en petit format, toujours au premier plan, avec une opacité réglable. Le bouton ⤢ la remet en grand.
  - **Chrome / Edge** : une fenêtre flottante (Picture-in-Picture) qui reste au-dessus des autres applis.
  - **Autres navigateurs** : la page passe en vue compacte.
  - **Liste affichée** : avec plusieurs listes, un menu en haut de l'overlay permet de changer de liste.
  - **Mode fabrication** : les onglets **Courses** / **Fabrication** passent de la liste des ressources aux étapes de fabrication, à cocher au fur et à mesure. Dès que la dernière ressource est réunie, l'overlay passe tout seul aux étapes.
- **Scan d'objet** (appli PC) : dans WAKFU, passe la souris sur un objet pour afficher son infobulle et appuie sur <kbd>Ctrl</kbd>+<kbd>D</kbd> : une petite fenêtre s'ouvre à côté de la souris pour choisir la rareté et la quantité, puis l'objet est ajouté à la liste de craft.
  Avec <kbd>Ctrl</kbd>+<kbd>F</kbd> sur une ressource de ta liste, elle s'ajoute à la colonne « J'ai ». Si l'infobulle affiche le bandeau « Possédés » (sur moi, équipé, coffre, pacte), Wak'Forge le lit : la quantité proposée est ce que tu possèdes, détaillée par emplacement (clique un emplacement pour ne pas le compter), et elle remplace celle de « J'ai ». Sinon, la quantité proposée est ce qu'il manque.
  L'appli fait une capture d'écran autour de la souris et la lit avec la reconnaissance de texte intégrée à Windows. Elle ne lit ni ne modifie le jeu, et rien n'est envoyé sur internet. Les raccourcis n'agissent que quand le jeu est au premier plan, et peuvent être désactivés dans Réglages.
- **Fiche objet** : stats, recette, provenance et « utilisé dans ».
- **Bestiaire** : ~1 400 monstres (les versions « quête environnementale » sont distinctes) avec leurs noms officiels français, leurs drops, leurs taux, leurs zones et la récolte du trappeur. La recherche fonctionne en français ou en anglais, par monstre, par famille, par zone ou par objet (« laine de bouftou » affiche les bouftous).
- **Icônes du jeu** : les icônes officielles des objets (CDN Ankama) et les portraits des monstres et des archimonstres (wakfu.wiki.gg). Elles sont chargées depuis ces sites, et non stockées dans le dépôt : il faut une connexion internet pour les voir. Les icônes de métier (`web/icons/metiers/`) sont les icônes actuelles du jeu, incluses dans le dépôt.

### Timers d'archimonstres

- **Recherche instantanée** : tolère les accents et les fautes de casse. Utilise <kbd>↑</kbd>/<kbd>↓</kbd> pour choisir, <kbd>Tab</kbd> pour compléter et <kbd>/</kbd> pour aller dans la recherche de l'onglet ouvert.
- **88 archimonstres pré-remplis** ([`web/data/data_archimonstre.json`](web/data/data_archimonstre.json)), dont 60 avec leur délai de réapparition (1 h, 2 h 30 ou 4 h selon le niveau). Les archimonstres de donjon, de Challenge et de stèle de Moon y figurent aussi, avec leur mode d'apparition.
- **Recherche par zone** : par exemple « Mont Zinit » liste les archimonstres de la zone.
- **Durées perso** : la fiche de chaque archimonstre (onglet **Bestiaire**) permet de lancer son timer et de modifier sa durée. Tu peux aussi ajouter tes propres archimonstres ; tes durées perso et tes ajouts sont listés dans **Réglages → Mes archimonstres**.
- **Apparition aléatoire** : avec une durée min et max, la carte indique « peut apparaître » puis « disponible ».
- **« Apparu il y a X min »** : si tu lances le timer en retard, il le prend en compte.
- **Alertes** : les cartes passent en jaune quand l'apparition approche, puis en vert. L'appli joue un son, affiche une notification et met la fenêtre au premier plan (appli PC).

### Compte et sauvegarde

- **Compte** (optionnel) : synchronisation en direct entre le site et l'appli PC.
- **Hors ligne** : le site s'installe comme une appli (PWA) et fonctionne sans connexion.
- **Sauvegarde** : tu peux exporter ou importer ta liste, et importer l'ancien `archimonstres.txt` de la v1.

## Utiliser

| | |
|---|---|
| 🌐 **Site** | [wakforge.github.io](https://wakforge.github.io/) |
| 💻 **Appli Windows** | [Télécharge `WakForge.exe`](https://github.com/wakforge/wakforge.github.io/releases/latest/download/WakForge.exe) (ou dans [Releases](../../releases)) et double-clique dessus. Aucune installation n'est nécessaire. |

> ⚠️ **Windows va afficher une alerte : c'est normal.** L'exe n'est pas signé (une signature de code est payante), donc Windows et le navigateur préviennent par précaution. Le code est public, ici même.
> - **Au téléchargement**, si Edge ou Chrome bloque le fichier (« peu téléchargé ») : clique sur **⋯** puis **Conserver** (et **Conserver quand même**).
> - **Au premier lancement**, Windows SmartScreen affiche « Windows a protégé votre ordinateur » : clique sur **Informations complémentaires**, puis **Exécuter quand même**. Ça ne se fait qu'une fois.

**Mises à jour** : quand une nouvelle version est publiée, l'appli PC affiche un bandeau. Le bouton **Mettre à jour** télécharge le nouvel exe, le met à la place de l'ancien (dans le même dossier) et relance l'appli. Tes données ne bougent pas.

L'appli PC fonctionne sous Windows 10 et 11. Elle utilise le composant Edge WebView2, déjà inclus dans Windows. Ses données sont dans `%APPDATA%\WakForge` (les données des anciennes versions, « Wak'Up » et « Minuteur Archimonstres », sont reprises automatiquement).

## Mettre le projet en ligne (GitHub)

Le dépôt est [wakforge/wakforge.github.io](https://github.com/wakforge/wakforge.github.io) (anciennement Phhanuel/Wak-Forge).

1. Pour récupérer le code : `git clone https://github.com/wakforge/wakforge.github.io.git`
2. Les modifications envoyées sur `main` mettent le site à jour automatiquement.
3. Active le site dans **Settings → Pages → Build and deployment → Source : GitHub Actions**.
   Le site se publie automatiquement à chaque modification. Si besoin, relance le workflow « Site » depuis l'onglet **Actions**.
4. Pour publier l'appli PC, va dans **Releases → Draft a new release**, crée un tag de version (ex. `v2.10.0`) et clique sur **Publish**.
   L'exe est compilé automatiquement et ajouté à la release en environ 2 minutes.

## Activer la connexion (comptes)

Sans configuration, tout fonctionne en **mode local** : les données sont enregistrées sur l'appareil.
Pour activer les comptes, on utilise [Supabase](https://supabase.com) (offre gratuite, environ 5 minutes) :

1. Crée un compte Supabase, puis un **New project**. Choisis une région en Europe et garde le mot de passe de la base de côté.
2. Ouvre **SQL Editor → New query**, colle le contenu de [`supabase/schema.sql`](supabase/schema.sql) et clique sur **Run**.
   Ce script crée la table et les règles de sécurité : chaque utilisateur ne voit que ses propres données.
3. Dans **Authentication → URL Configuration** :
   - **Site URL** : `https://wakforge.github.io/`
   - **Redirect URLs** : ajoute la même adresse, ainsi que `http://127.0.0.1:47816/` (pour l'appli PC).
4. Dans **Project Settings → API** (ou **API Keys**), copie l'**URL du projet** et la clé publique (**anon** ou **publishable**).
   Colle-les dans [`web/js/config.js`](web/js/config.js) avec l'adresse du site :
   ```js
   window.ARCHI_CONFIG = {
     supabaseUrl: 'https://abcdefgh.supabase.co',
     supabaseAnonKey: 'eyJhbGciOi…',
     siteUrl: 'https://wakforge.github.io/',
   };
   ```
   Cette clé est **publique par conception**. La sécurité repose sur les règles RLS du script SQL. Ne mets **jamais** la clé `service_role` dans ce fichier.
5. Commit, puis crée une nouvelle release : le site et l'exe ont maintenant la connexion.
   Pour un exe déjà téléchargé, il suffit de poser ce `config.js` à côté de l'exe.

Par défaut, Supabase demande de confirmer l'adresse e-mail à l'inscription, et son service d'e-mail intégré n'envoie que très peu de messages par heure.
Pour un usage entre amis, tu peux désactiver la confirmation dans **Authentication → Sign In / Providers → Email → Confirm email**.
Pour plus d'utilisateurs, configure un serveur SMTP dans **Authentication → Emails**.

## Données des archimonstres

Source : [MethodWakfu – Les Archimonstres](https://methodwakfu.com/pvm/les-archimonstres/) (WAKFU 1.92).

> **Comment marche le délai dans le jeu :** il repart au moment où l'archimonstre **apparaît**, et non quand il est tué.
> L'apparition n'a lieu qu'entre deux quêtes environnementales (QE) : si une QE est en cours à la fin du délai, l'archimonstre apparaît à la fin de la QE, plus 1 minute.
> Wak'Forge indique donc l'heure d'apparition **au plus tôt**.

Tout se trouve dans [`web/data/data_archimonstre.json`](web/data/data_archimonstre.json), à raison d'une ligne par archimonstre :

```json
{ "nom": "Kraken", "niveau": "68 à 73", "apparition": "environnement", "timer": "2h30", "zone": "Mont Zinit – Plage Sauvage" }
```

- `apparition` : `environnement` (avec un timer), `donjon`, `challenge` (stèle de Challenge) ou `stele` (stèle de Moon).
- `timer` : le délai entre deux apparitions. Formats acceptés : `"1h"`, `"2h30"`, `"45m"`, `"1:30:00"`, ou un nombre de secondes. Vaut `null` s'il n'y a pas de timer.
- `timer_max` (optionnel) : à renseigner si l'apparition est aléatoire entre `timer` et `timer_max`.
- `image` (optionnel) : le portrait, c'est-à-dire le nom du fichier sur [wakfu.wiki.gg](https://wakfu.wiki.gg) (ex. `"Claud_Sharpe.png"`). Sans portrait, l'appli affiche l'initiale.

Pour vérifier le fichier, lance `node scripts/check-data.mjs`. Cette vérification tourne aussi automatiquement sur chaque pull request.
Les corrections et ajouts sont les bienvenus, idéalement avec la source.

## Données d'artisanat et du bestiaire

| Fichier | Contenu |
|---|---|
| [`web/data/data_item.json`](web/data/data_item.json) | ~9 200 objets : nom FR/EN, niveau, rareté, type, stats, recettes, drops |
| [`web/data/data_ressource.json`](web/data/data_ressource.json) | ~1 300 ressources : recettes, récolte (métier, niveau, source), trappeur, drops |
| [`web/data/data_bestiaire.json`](web/data/data_bestiaire.json) | ~1 360 monstres : famille, niveaux, zones, drops (id d'objet + taux), trappeur |

Sources : les données **officielles** publiées par Ankama sur son CDN (objets, recettes, récoltes) et le wiki communautaire [wakfu.wiki.gg](https://wakfu.wiki.gg) (monstres, drops, zones), sous licence CC BY-SA 4.0.
Le wiki est anglophone : les noms des **monstres, familles et zones** sont traduits avec les **noms officiels français tirés des fichiers du jeu**, via la table [`scripts/gamedata/noms_fr.json`](scripts/gamedata/noms_fr.json). Environ 90 % des monstres sont couverts. Les autres sont des monstres d'événement ou retirés du jeu, qui gardent leur nom anglais.

Pour mettre la table à jour après une mise à jour du jeu, lance `node scripts/i18n-from-game.mjs` sur un PC où Wakfu est installé. Le script lit `contents/i18n` sans rien modifier ; tu peux aussi lui indiquer le dossier du jeu en argument.

Les fichiers sont régénérés **automatiquement chaque lundi** par le workflow « Mise à jour des données du jeu » (onglet Actions), pour suivre les mises à jour du jeu.
Pour les régénérer à la main : `node scripts/fetch-gamedata.mjs` (Node 18+).
Si le wiki est injoignable, le script garde le bestiaire et les drops actuels et met quand même à jour le reste (objets, recettes, textes anglais).
[`web/data/data_en.json`](web/data/data_en.json) contient les textes anglais du jeu pour la version anglaise (types d'objets, effets, familles, zones, lieux de récolte).

## Développer

```bash
python3 -m http.server 8080 --directory web     # site sur http://localhost:8080
cd desktop && bash build.sh                          # exe dans dist/ (Go 1.22+ et rsrc requis)
```

| Dossier | Contenu |
|---|---|
| `web/` | Le site (HTML/CSS/JS sans framework), embarqué tel quel dans l'exe |
| `web/data/` | Base des archimonstres |
| `desktop/` | Appli Windows en Go + WebView2 : fenêtre native, alertes programmées, notifications |
| `supabase/` | Script SQL des comptes |
| `scripts/` | Vérification des archimonstres, générateur des données d'artisanat et du bestiaire |

## Mentions légales

Wak'Forge est un **projet de fan gratuit et communautaire**, sans publicité ni revenu. Il n'est ni affilié à Ankama, ni approuvé par Ankama, et n'interagit pas avec le client du jeu.

- *WAKFU*, *DOFUS* et *Ankama* sont des marques d'Ankama. Les noms, textes, icônes et illustrations du jeu sont © Ankama, tous droits réservés, et sont utilisés ici à titre informatif et non commercial. Pour toute demande de retrait, ouvre une *issue*.
- Les données issues de [wakfu.wiki.gg](https://wakfu.wiki.gg) (monstres, drops, zones) sont sous licence [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/deed.fr). Les délais des archimonstres viennent de [MethodWakfu](https://methodwakfu.com/pvm/les-archimonstres/).
- Le **code** est sous licence [MIT](LICENSE). Cette licence ne couvre ni les contenus d'Ankama ni les données du wiki.
- Le détail (hébergeur, données personnelles, sources) est sur la page [`mentions-legales.html`](web/mentions-legales.html), accessible depuis le pied de page de l'appli.
