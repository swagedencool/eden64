# Notes techniques

## Organisation

```
web/            le site publié (aucune étape de build)
  app.js        toute la logique d'eden64
  emulator/     EmulatorJS 4.2.3 patché et les cœurs N64
  cheats/       codes GameShark (index + 48 fichiers chargés à la demande)
tools/          serveur local (Node ou PowerShell) et génération des codes
tests/          test de fumée sans dépendance
docs/           manuel, notes, logo et captures
roms/           tes dumps en local (ignoré par Git)
```

## EmulatorJS

[emulatorjs-4.2.3.patch](../web/emulator/emulatorjs-4.2.3.patch) ajoute quelques points d'accroche à EmulatorJS 4.2.3 :

- `EJS_unpackCore` : le cœur est fourni déjà décompressé, sans archive 7z à ouvrir au lancement.
- `EJS_coreScriptBase` : le code JavaScript du cœur est chargé comme un fichier normal, compatible avec la CSP.
- `EJS_preFrame` / `EJS_postFrame` : appelés à chaque image, pour la pause, l'accélération et la mesure des images par seconde.
- `EJS_retroarchExtra` : des lignes ajoutées à la configuration RetroArch.
- `getGamepads()` ne plante plus quand le navigateur refuse l'accès aux manettes.

## Cœurs et mémoire

| Moteur | Cœur | Mémoire mesurée en jeu |
|---|---|---|
| complet | mupen64plus-next + GLideN64 (`gl2` WebGL 2, `gl1` WebGL 1) | ~855 Mo |
| léger | ParaLLEl-N64 (`pn64`, `pn64-gl1`) | ~280 à 330 Mo |

Les deux cœurs réservent 512 Mo au démarrage. eden64 réécrit cette valeur dans le binaire au chargement (256 Mo pour le complet, 160 Mo pour le léger) : la mémoire grandit ensuite à la demande, et les téléphones ne refusent plus de lancer le jeu. En automatique, les iPhone, Android et machines à 4 Go de RAM ou moins prennent le moteur léger.

La sauvegarde du jeu est commune aux deux moteurs. Les états instantanés sont propres à chacun.

## Vibration

Le cœur appelle une fonction de vibration par un pointeur de sa table de fonctions. eden64 retrouve ce pointeur dans le binaire, puis le remplace par un mini module WebAssembly écrit à la main (52 octets) qui appelle JavaScript. La force est calculée sur une fenêtre de 160 ms et envoyée à la manette avec `vibrationActuator.playEffect('dual-rumble')`.

## Accessoires

Le cœur embarque la base `mupen64plus.ini`, qui dit quels jeux utilisent le Transfer Pak (83 versions), le Rumble Pak (1076) ou la carte mémoire (920). eden64 la lit avec l'empreinte CRC1 de la cartouche et branche le bon accessoire. Pour le Transfer Pak, la cartouche et la sauvegarde Game Boy sont données au cœur comme fichiers, et ce que le jeu écrit est gardé dans le navigateur toutes les 5 s.

## Codes

`tools/build_cheats.py` croise les fichiers `.cht` de libretro-database avec le DAT No-Intro : chaque cartouche est reconnue par les 12 premiers caractères de son SHA-1. Seul le fichier qui contient le jeu est téléchargé.

## Performance

Au premier lancement, la carte graphique (via `WEBGL_debug_renderer_info`) range la machine dans un profil : logiciel, faible, moyen ou puissant. Pendant la partie, eden64 compare les images affichées, le rythme de l'écran et la charge du moteur. Il peut ainsi dire si le ralentissement vient de l'économiseur d'énergie du navigateur, d'un rendu sans carte graphique ou du processeur. Le canvas à faible latence (`desynchronized`) est activé seulement sur ordinateur : il apporte environ +4 % d'images par seconde en moyenne.

## À deux

`web/duo.js`, sur le modèle de PokéLink. Un code de salle de 6 caractères sert à se trouver via des relais publics Nostr ([Trystero](https://github.com/dmotz/trystero)) ; ensuite les deux navigateurs se parlent en WebRTC, chiffré de bout en bout. Le pseudo est renvoyé toutes les 2 s, pour que rien ne se perde au démarrage.

**Chacun sa partie** (Ocarina of Time)

- La RAM de la N64 est retrouvée dans la mémoire du cœur grâce au code de démarrage de la cartouche (copié de ROM 0x1000 vers RAM 0x400). Si deux copies existent, on garde celle dont le compteur d'images avance.
- Dans le `PlayState` (0x801C64E0 en PAL 1.0, 0x801C84A0 en NTSC 1.0, sinon cherché dans toute la RAM) : scène à +0xA4, acteur joueur à +0x1C44, matrice vue-projection à +0x11D60. Dans l'acteur : position à +0x24, orientation à +0xB6.
- Position envoyée 15 fois par seconde, rejouée chez l'autre avec 100 ms de retard et interpolée.
- L'ami est projeté avec la matrice du jeu (vérifié : même résultat que `projectedPos` du jeu) et dessiné dans un calque par-dessus l'image : silhouette, anneau au sol, sens du regard, pseudo. Hors champ, une flèche au bord de l'écran. Il est toujours dessiné devant le décor.
- Les positions reçues sont vérifiées (scène et nombres plausibles).
- **Le vrai Link** (`web/duo-link.js`) : l'ami envoie aussi sa pose (23 os du `SkelAnime` à Player +0x1A4) et les listes d'affichage de ses mains, de son fourreau et de sa taille (tableaux à Player +0x150 à +0x15C, c'est ainsi que le jeu montre le grappin ou le boomerang en main). Chez toi, le modèle est lu dans l'objet de Link déjà chargé dans ta mémoire (ObjectContext à PlayState +0x117A4) : les listes d'affichage F3DEX2 sont traduites en triangles WebGL 2, textures N64 décodées (RGBA16, CI4/CI8, IA, I), combineur de couleurs N64 traduit en shader. Les os sont parcourus comme `SkelAnime_DrawFlex` (matrices du segment 0x0D). La tunique est la couleur d'environnement, comme pour les tuniques Goron et Zora.
- Si vous n'avez pas le même âge (enfant / adulte), le modèle de l'autre n'est pas dans ta mémoire : une silhouette le remplace.

**Partager mon écran**

- L'hôte envoie le canvas du jeu (`captureStream`) et le son (le même branchement que les clips vidéo).
- L'ami renvoie seulement les changements de ses touches, avec ses propres réglages ; le stick analogique est arrondi à 32 crans.
- L'hôte vérifie chaque entrée reçue (bouton 0 à 23, valeur bornée) avant de l'envoyer au cœur sur la manette 1 ou 2. Il relâche tout ce que l'ami tenait quand le mode change ou quand l'ami part.

`?duo=local` : la même chose entre deux onglets du même navigateur (BroadcastChannel pour se trouver), pour les tests.

## Navigateurs

- iOS grise les extensions inconnues dans le sélecteur de fichiers : l'attribut `accept` est retiré sur iOS.
- Safari invalide un fichier stocké dans IndexedDB quand l'enregistrement est réécrit : la cartouche est copiée en mémoire avant le lancement.
- Publié sur GitHub Pages, qui ne permet pas d'en-têtes : la CSP est dans une balise `<meta>` d'`index.html`. Elle est limitée au site lui-même (plus `data:`, `blob:`, `wasm-unsafe-eval`, et `wss:` pour les relais de « À deux »). Les serveurs locaux ajoutent COOP/COEP.
