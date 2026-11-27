// Test de fumée sans dépendance : lance serveur.mjs et vérifie que tout ce que le site charge est servi.
// Usage : node tests/smoke.mjs
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const port = 18064;
const base = `http://localhost:${port}/`;
const srv = spawn(process.execPath, [fileURLToPath(new URL('tools/serveur.mjs', root))], { env: { ...process.env, PORT: String(port) }, stdio: 'ignore' });
const get = (p) => fetch(base + p);

try {
  for (let i = 0; ; i++) {
    try { await get(''); break; } catch { if (i > 50) throw new Error('serveur injoignable'); await new Promise((r) => setTimeout(r, 100)); }
  }

  const home = await get('');
  assert.equal(home.status, 200);
  assert.equal(home.headers.get('cross-origin-embedder-policy'), 'require-corp');
  const html = await home.text();

  // Tout ce que index.html, le manifeste et le moteur demandent
  const paths = [...html.matchAll(/(?:src|href)="(?!#|https?:)([^"]+)"/g)].map((m) => m[1]);
  const manifest = await (await get('manifest.webmanifest')).json();
  paths.push(...manifest.icons.map((i) => i.src));
  paths.push('vendor/trystero.js', 'emulator/data/loader.js', 'emulator/data/emulator.min.js', 'emulator/data/emulator.min.css', 'cheats/index.json');
  for (const v of ['gl1', 'gl2', 'pn64', 'pn64-gl1']) {
    const core = await (await get(`emulator/data/cores/${v}/core.json`)).json();
    paths.push(`emulator/data/cores/${v}/build.json`, `emulator/data/cores/${v}/${core.name}_libretro.wasm`);
    paths.push(`emulator/data/cores/js/${core.name}${v.endsWith('gl1') ? '-legacy' : ''}.js`);
  }
  for (const p of paths) assert.equal((await get(p)).status, 200, p);

  assert.equal((await get('emulator/data/cores/gl2/mupen64plus_next_libretro.wasm')).headers.get('content-type'), 'application/wasm');
  const cheats = await (await get('cheats/index.json')).json();
  assert.ok(Object.keys(cheats.games).length > 700, 'base de codes incomplète');
  assert.ok(Array.isArray(await (await get('roms/index.json')).json()), 'ludothèque locale');

  // Sécurité : le serveur ne sort pas de son dossier
  assert.equal((await get('..%2f..%2fetc%2fpasswd')).status, 404);

  // Le moteur embarqué contient bien chaque ligne ajoutée par le patch
  const js = await readFile(new URL('web/emulator/data/emulator.min.js', root), 'utf8');
  const patch = await readFile(new URL('web/emulator/emulatorjs-4.2.3.patch', root), 'utf8');
  for (const l of patch.split('\n')) if (l.startsWith('+') && !l.startsWith('+++')) assert.ok(js.includes(l.slice(1)), 'patch absent : ' + l);

  console.log(`ok : ${paths.length} fichiers servis, ${Object.keys(cheats.games).length} jeux avec codes, patch EmulatorJS présent`);
} finally {
  srv.kill();
}
