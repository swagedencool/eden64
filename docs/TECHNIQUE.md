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

## Navigateurs

- iOS grise les extensions inconnues dans le sélecteur de fichiers : l'attribut `accept` est retiré sur iOS.
- Safari invalide un fichier stocké dans IndexedDB quand l'enregistrement est réécrit : la cartouche est copiée en mémoire avant le lancement.
- En-têtes ([web/_headers](../web/_headers)) : COOP/COEP, et une CSP limitée au site lui-même (plus `data:`, `blob:` et `wasm-unsafe-eval`).
