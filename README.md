<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg">
    <img src="docs/logo.svg" alt="eden64, browser n64 emulator" width="420">
  </picture>
</p>

<p align="center">
  Nintendo 64 emulator that runs in the browser (WebAssembly). No install, no account: games and saves stay on your device.<br>
  <a href="https://eden64.netlify.app"><b>Try it</b></a> · <a href="https://edenbourezg.myportfolio.com/eden64">Case study</a> · <a href="LISEZMOI.txt">Manuel (FR)</a>
</p>

<p align="center">
  <a href="../../actions/workflows/ci.yml"><img src="../../actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <img src="https://img.shields.io/badge/license-GPL--3.0-blue" alt="GPL-3.0">
</p>

![eden64](docs/screenshot.png)

## Features

- **Two engines, picked per device:** mupen64plus-next + GLideN64 (up to 2560×1920, native 16:9, texture enhancement) or ParaLLEl-N64 for phones and small machines (~300 MB instead of ~900 MB).
- **Saves:** kept in the browser; import/export `.srm .sra .fla .eep .mpk` (byte order detected); 3 save-state slots; safety net every 2 min and before each load.
- **Accessories:** Controller Pak, Rumble Pak (real gamepad vibration), Transfer Pak with a Game Boy cartridge and save (Pokémon Stadium…), chosen per game automatically.
- **Controls:** keyboard and gamepad remapping (combos included), auto-detected controllers, touch controller on mobile.
- **Extras:** GameShark codes for 742 games, PNG screenshots, MP4 clips with sound, ocarina songs overlay, fullscreen.
- **Performance governor:** detects the machine, finds the cause of slowdowns and offers a lighter setting in one click.

UI is in French.

## Run

- **Online:** [eden64.netlify.app](https://eden64.netlify.app), then *Ajouter une cartouche*.
- **Windows:** double-click `Lancer.bat`, then open http://localhost:8064.
- **Any OS (Node 18+):** `node serveur.mjs`.

Put your dumps in `roms/` to see them in the library. No game is included: use dumps of cartridges you own. `roms/` is git-ignored and CI fails if a dump is committed.

## Deploy

Static site, no build step. On Netlify, import this repo: `netlify.toml` publishes the root and `_headers` sets COOP/COEP and the CSP.

## How it works

- [EmulatorJS 4.2.3](https://github.com/EmulatorJS/EmulatorJS) with a small patch ([emulator/emulatorjs-4.2.3.patch](emulator/emulatorjs-4.2.3.patch)) adding hooks: raw core loading, per-frame callbacks, extra RetroArch config.
- Cores ship unpacked (WebGL 2 and WebGL 1 builds). Their initial WebAssembly memory is lowered at load so phones can allocate it.
- Rumble: the core's rumble callback is redirected to a tiny hand-written WebAssembly module that calls the Gamepad vibration API.
- Everything else is plain JavaScript in `app.js`. No framework, no bundler.

## Development

```sh
node tests/smoke.mjs                                   # serves the site and checks every asset (no dependencies)
python tools/build_cheats.py <libretro-database> cheats  # rebuilds the cheat codes
```

## License

eden64 is GPL-3.0, like EmulatorJS. Third-party parts: [THIRD_PARTY.md](THIRD_PARTY.md).
Not affiliated with Nintendo. Nintendo 64 is a trademark of Nintendo.

Design and development: [Eden Bourezg](https://edenbourezg.myportfolio.com).
