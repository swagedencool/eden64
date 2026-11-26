# Composants tiers

| Composant | Licence | Source | Dans ce dépôt |
|---|---|---|---|
| EmulatorJS 4.2.3 (inclut nipplejs et le client socket.io : MIT) | GPL-3.0 | [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) | `emulator/data/`, modifié : [patch](emulator/emulatorjs-4.2.3.patch) |
| mupen64plus-next + GLideN64 (libretro core) | GPL-2.0, [texte](emulator/data/cores/LICENSE.mupen64plus_next.txt) | [EmulatorJS/mupen64plus-libretro-nx](https://github.com/EmulatorJS/mupen64plus-libretro-nx), npm `@emulatorjs/core-mupen64plus_next` 4.2.3 | `emulator/data/cores/gl1`, `gl2`, `js/` (binaires non modifiés, décompressés) |
| ParaLLEl-N64 (libretro core) | basé sur mupen64plus (GPL-2.0) ; pas de fichier de licence global en amont | [EmulatorJS/parallel-n64](https://github.com/EmulatorJS/parallel-n64), npm `@emulatorjs/core-parallel_n64` 4.2.3 | `emulator/data/cores/pn64`, `pn64-gl1`, `js/` (binaires non modifiés, décompressés) |
| libretro-database cheat files | CC BY-SA 4.0 | [libretro/libretro-database](https://github.com/libretro/libretro-database) | `cheats/` (convertis en JSON par `tools/build_cheats.py`, même licence) |
| No-Intro N64 DAT | seuls les préfixes SHA-1 sont utilisés | [No-Intro](https://no-intro.org) | `cheats/index.json` |
| Chakra Petch, IBM Plex Sans / Mono | SIL OFL 1.1 | Google Fonts / IBM | intégrées dans `fonts.css` |
