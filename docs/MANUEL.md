eden64 - émulateur Nintendo 64 local
====================================

Lancer
------
1. Double-clique sur tools\Lancer.bat.
   Une fenêtre noire s'ouvre (le serveur) et ton navigateur affiche http://localhost:8064.
2. Dépose tes dumps (.z64, .n64, .v64 ou .zip) dans le dossier roms\ :
   ils apparaissent dans la Ludothèque, à gauche, prêts en un clic (bouton rouge = jouer).
   Tu peux aussi glisser un fichier n'importe où sur la page.
3. Facultatif : "Insérer une sauvegarde" (Carte mémoire) pour reprendre ta partie.
4. Clique sur un jeu puis "Allumer", ou appuie sur A / Start à la manette.

Le dossier roms\ est privé : ne le publie jamais avec le site.
5. Pour arrêter : ferme la fenêtre noire.

Alternative si tu as Node.js : ouvre un terminal dans ce dossier et tape
   node tools/serveur.mjs

Touches (onglet « Touches », tout est réassignable)
---------------------------------------------------
Clique sur une touche dans le tableau puis appuie sur la nouvelle (clavier) ou sur
le bouton / la direction du stick voulus (manette). Échap annule, Retour arrière efface.
Une touche déjà prise est échangée automatiquement. Pour un raccourci à la manette,
garde View enfoncé puis appuie sur un autre bouton (combinaison).
Par défaut :
  Manette : A = A, X = B, LT = Z, RT = R, LB = L, Menu = Start,
            stick gauche = stick, stick droit = boutons C, croix = croix N64,
            RB maintenu = accélérateur, View+Y / View+B = sauver / charger l'état 1,
            View+RB = partitions d'ocarina, View+L3 = capture, View+R3 = clip vidéo.
  Clavier (AZERTY) : Z Q S D stick, K = A, J = B, Espace = Z, Maj = R, A = L,
            Entrée = Start, flèches = boutons C, Tab maintenu = accélérer,
            F2 / F4 = sauver / charger l'état 1, P = pause, F8 = capture,
            F9 = clip vidéo, O = partitions d'ocarina, F = plein écran.
Accessoire de la manette 1 : Auto choisit selon le jeu (Rumble Pak si le jeu vibre,
carte mémoire s'il y sauvegarde, Transfer Pak pour Pokémon Stadium & co).
La vibration passe par la vraie manette (Chrome/Edge, manettes Xbox et PlayStation).

Codes, captures, ocarina, filet de sécurité
-------------------------------------------
- Onglet « Codes » : codes GameShark de 742 jeux (base libretro-database, CC BY-SA 4.0),
  reconnus par l'empreinte de ta cartouche ; ajoute aussi tes propres codes.
- Boutons appareil photo / rond rouge : capture PNG et clip vidéo MP4 avec le son.
- Bouton note de musique (Ocarina of Time) : les 12 mélodies avec TES touches ;
  la mélodie jouée est reconnue en direct.
- Filet de sécurité (onglet Partie) : un état automatique toutes les 2 minutes et avant
  chaque chargement, les 5 derniers gardés. Clique deux fois sur une vignette pour revenir.

Performance
-----------
eden64 détecte la machine au premier lancement et choisit un préréglage adapté.
Si le jeu ralentit, il mesure la cause (économiseur d'énergie du navigateur,
rendu sans carte graphique, processeur saturé) et propose un réglage plus léger
en un clic. Le chiffre « Moteur » de la barre d'état indique la charge de l'émulation.
Moteur N64 (onglet Image > Performance) : « complet » (mupen64plus-next + GLideN64, toutes
les fonctions, ~900 Mo de mémoire) ou « léger » (ParaLLEl-N64, ~300 Mo). En Auto, téléphones,
tablettes et machines à 4 Go de RAM ou moins prennent le moteur léger ; les ordinateurs, le complet.
La sauvegarde du jeu est commune aux deux moteurs.

Transfer Pak (Pokémon Stadium 1 et 2, Mario Golf, Mario Tennis, Perfect Dark...)
--------------------------------------------------------------------------------
Colonne de gauche, section "Transfer Pak" :
  1. "+ Cartouche Game Boy" : ta ROM Game Boy / Game Boy Color (.gb, .gbc ou .zip).
  2. "Importer .sav" : la sauvegarde de cette cartouche (celle de ton émulateur
     Game Boy ou de ton lecteur de cartouches). Les octets d'horloge ajoutés par
     certains émulateurs (Pokémon Or/Argent/Cristal) sont retirés automatiquement.
  3. Allume la console : pour les jeux compatibles (83 versions reconnues, base du core),
     le Transfer Pak est branché sur la manette 1 avec la cartouche dedans.
     Les autres jeux gardent la carte mémoire (Controller Pak).
Tout ce que le jeu N64 écrit dans la cartouche Game Boy (Pokémon déposés, objets...)
est enregistré dans le navigateur toutes les 5 s et à l'extinction.
"Exporter .sav" la télécharge pour la remettre dans ton émulateur Game Boy.

Sauvegardes
-----------
Import : .srm (RetroArch), .sra / .fla / .eep (cartouche, Everdrive, Project64), .mpk,
.state, ou le .zip exporté. L'ordre des octets est détecté automatiquement pour Zelda.
Export : un .zip qui contient le .srm et la mémoire brute au format cartouche.
La sauvegarde du jeu est aussi conservée automatiquement dans le navigateur.

Performances
------------
La résolution par défaut est 640×480 (×2). Si ta machine n'atteint pas la pleine vitesse,
la page te propose une résolution plus légère, et la partie reprend au même endroit.
Si le processeur graphique décroche, la console relance seule en plus léger.

Qualité d'image
---------------
Résolution interne de ×1 (320×240) à ×12 (3840×2880), 16:9, FXAA, textures xBRZ,
filtres d'écran cathodiques. "Appliquer" redémarre la console et reprend ta partie
exactement au même endroit. Le MSAA n'est pas proposé : il exige OpenGL ES 3.1,
absent de WebGL 2, et ferait planter le moteur.

Jouer à deux
------------
Onglet "À deux" : mets ton pseudo, crée une salle, puis "Copier le lien" et envoie-le à ton ami.

"Chacun sa partie" (Ocarina of Time) : ton ami ouvre le lien, charge SA cartouche et allume
le jeu. Chacun joue sa partie ; quand vous êtes dans la même zone, ton ami apparaît chez toi
à sa vraie place (silhouette verte avec son pseudo), et toi chez lui. S'il est hors de l'écran,
une flèche au bord indique sa direction. L'onglet dit s'il est dans la même zone et à quelle distance.

"Partager mon écran" : ton ami ouvre le lien et voit ton jeu en direct avec le son,
sans cartouche. Il joue avec sa manette ou son clavier : "Regarde", "Avec toi" (manette 1)
ou "Manette 2". Il peut demander la manette.

Dans les deux cas, vous vous envoyez des réactions. Ta ROM reste chez toi.

Ta ROM
------
Elle n'est ni copiée sur un serveur ni envoyée : la page la lit en mémoire avec l'API File.
Si "mémoriser" est actif, elle est gardée dans le stockage local de ton navigateur
pour la réinsérer en un clic (bouton "Oublier" pour l'effacer).

Contenu
-------
web/                                 le site : index.html, app.js, duo.js (À deux), fonts.css
web/emulator/data/                   EmulatorJS 4.2.3 + cœurs mupen64plus-next et ParaLLEl-N64 en WebAssembly
tools/serveur.ps1, tools/serveur.mjs serveurs HTTP locaux (en-têtes COOP/COEP inclus)
roms/                                tes jeux, pour la ludothèque locale

Licences : EmulatorJS GPL-3.0, cœurs GPL-2.0, Trystero MIT, polices SIL OFL (détails : THIRD_PARTY.md).
