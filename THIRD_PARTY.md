# Third-party components

| Component | Licence | Source | In this repo |
|---|---|---|---|
| EmulatorJS 4.2.3 (bundles nipplejs, socket.io client: MIT) | GPL-3.0 | [EmulatorJS/EmulatorJS](https://github.com/EmulatorJS/EmulatorJS) | `emulator/data/`, modified: [patch](emulator/emulatorjs-4.2.3.patch) |
| mupen64plus-next + GLideN64 (libretro core) | GPL-2.0, [text](emulator/data/cores/LICENSE.mupen64plus_next.txt) | [EmulatorJS/mupen64plus-libretro-nx](https://github.com/EmulatorJS/mupen64plus-libretro-nx), npm `@emulatorjs/core-mupen64plus_next` 4.2.3 | `emulator/data/cores/gl1`, `gl2`, `js/` (unmodified binaries, unpacked) |
| ParaLLEl-N64 (libretro core) | mupen64plus-based (GPL-2.0); no top-level licence file upstream | [EmulatorJS/parallel-n64](https://github.com/EmulatorJS/parallel-n64), npm `@emulatorjs/core-parallel_n64` 4.2.3 | `emulator/data/cores/pn64`, `pn64-gl1`, `js/` (unmodified binaries, unpacked) |
| libretro-database cheat files | CC BY-SA 4.0 | [libretro/libretro-database](https://github.com/libretro/libretro-database) | `cheats/` (converted to JSON by `tools/build_cheats.py`, same licence) |
| No-Intro N64 DAT | used for SHA-1 prefixes only | [No-Intro](https://no-intro.org) | `cheats/index.json` |
| Chakra Petch, IBM Plex Sans / Mono | SIL OFL 1.1 | Google Fonts / IBM | embedded in `fonts.css` |
