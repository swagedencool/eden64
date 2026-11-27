/* eden64 — logique de l'interface
   EmulatorJS 4.2.3 + core mupen64plus-next (GLideN64), servi sans eval ni script blob:
   Sections : utilitaires · préférences · stockage · archives · capacités · cartouche · ludothèque · émulateur
              · crochets du moteur · profil machine · Rumble Pak · performance · sauvegardes · Transfer Pak · états
              · vitesse · qualité · touches (remappage) · accessoires · captures · ocarina · codes · filet de sécurité · démarrage */
'use strict';
{
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const t0 = performance.now();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= Journal, toasts, formats ================= */
const logEl = $('#log');
function log(msg, cls) {
  const li = document.createElement('li');
  const tm = document.createElement('time');
  tm.textContent = ((performance.now() - t0) / 1000).toFixed(1) + ' s';
  const sp = document.createElement('span');
  sp.textContent = msg;
  if (cls) sp.className = cls;
  li.append(tm, sp);
  logEl.append(li);
  if (logEl.children.length > 200) logEl.firstElementChild.remove();
  logEl.scrollTop = logEl.scrollHeight;
}
let toastTimer = null;
function toast(msg, ms = 2200) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('on'), ms);
}
const set = (sel, v) => { $(sel).textContent = v; };
const hex = (n) => n.toString(16).toUpperCase().padStart(8, '0');
const mo = (n) => (n / 1048576).toFixed(n < 10485760 ? 1 : 0).replace('.', ',') + ' Mo';
function chip(id, s, label) { const c = $(id); c.dataset.s = s; if (label) c.lastElementChild.textContent = label; }
function stamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}h${p(d.getMinutes())}`;
}
function ago(t) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'à l\'instant';
  if (s < 3600) return 'il y a ' + Math.round(s / 60) + ' min';
  if (s < 86400) return 'il y a ' + Math.round(s / 3600) + ' h';
  return new Date(t).toLocaleDateString('fr-FR');
}
const safeName = (s) => (s || 'cartouche').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim() || 'cartouche';
const titleCase = (s) => s.toLowerCase().replace(/(^|[\s:'-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

/* ================= Préférences ================= */
const PRESETS = {
  fidele: { res: 1, aspect: '4:3', filter: '3point', tex: 'None', fxaa: '0', compat: 'std' },
  net: { res: 2, aspect: '4:3', filter: '3point', tex: 'None', fxaa: '0', compat: 'std' },
  hd: { res: 3, aspect: '4:3', filter: '3point', tex: 'None', fxaa: '0', compat: 'std' },
  ultra: { res: 6, aspect: '4:3', filter: 'standard', tex: 'None', fxaa: '1', compat: 'std' }
};
const RES = [
  { f: 1, r43: '320x240', r169: '640x360' }, { f: 2, r43: '640x480', r169: '960x540' },
  { f: 3, r43: '960x720', r169: '1280x720' }, { f: 4, r43: '1280x960', r169: '1920x1080' },
  { f: 5, r43: '1600x1200', r169: '1920x1080' }, { f: 6, r43: '1920x1440', r169: '2560x1440' },
  { f: 8, r43: '2560x1920', r169: '3840x2160' }
];
const DEFAULTS = { v: 3, layout: 'azerty', quality: { ...PRESETS.net }, shader: 'disabled', speed: 1, tab: 'partie', lowLatency: true };
let prefs = structuredClone(DEFAULTS), prefsFresh = true;
try {
  const raw = JSON.parse(localStorage.getItem('be64-prefs') || 'null');
  if (raw && typeof raw === 'object') {
    prefsFresh = false;
    prefs = { ...prefs, ...raw, quality: { ...prefs.quality, ...(raw.quality || {}) } };
    if (raw.v !== 3) prefs.quality = { ...PRESETS.net };   // nouvelle base plus sûre pour les portables
    prefs.v = 3;
  }
} catch (e) { /* stockage indisponible : valeurs par défaut */ }
delete prefs.quality.msaa;   // le MSAA de GLideN64 exige OpenGL ES 3.1 (absent de WebGL 2) : il fait planter le core
if (!RES.some((r) => r.f === +prefs.quality.res)) prefs.quality.res = 2;
if (!['std', 'exact'].includes(prefs.quality.compat)) prefs.quality.compat = 'std';
function savePrefs() { try { localStorage.setItem('be64-prefs', JSON.stringify(prefs)); } catch (e) {} }

/* ================= IndexedDB (ludothèque, états, reprise) ================= */
const idb = (() => {
  let dbp = null;
  const open = () => dbp || (dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('banc-essai-64', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  }));
  const run = async (mode, fn) => {
    const db = await open();
    return new Promise((res, rej) => {
      const tx = db.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => res(req ? req.result : undefined);
      tx.onerror = tx.onabort = () => rej(tx.error);
    });
  };
  return {
    ok: () => open().then(() => true, () => false),
    get: (k) => run('readonly', (s) => s.get(k)).catch(() => undefined),
    keys: (prefix) => run('readonly', (s) => s.getAllKeys()).then((ks) => ks.filter((k) => String(k).startsWith(prefix))).catch(() => []),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)).catch((e) => log('Stockage local refusé : ' + (e && e.message), 'e')),
    del: (k) => run('readwrite', (s) => s.delete(k)).catch(() => {})
  };
})();

/* ================= Compression native (sans eval) et ZIP ================= */
const pipe = async (u8, ts) => new Uint8Array(await new Response(new Blob([u8]).stream().pipeThrough(ts)).arrayBuffer());
const gzip = (u8) => pipe(u8, new CompressionStream('gzip'));
const gunzip = (u8) => pipe(u8, new DecompressionStream('gzip'));
let crcTable;
function crc32(bytes) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
async function makeZip(entries) {
  const enc = new TextEncoder(), parts = [], central = [];
  const d = new Date();
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  let offset = 0;
  for (const e of entries) {
    const name = enc.encode(e.name), data = e.data, crc = crc32(data);
    let method = 0, body = data;
    if (data.length > 2048) { const z = await pipe(data, new CompressionStream('deflate-raw')); if (z.length < data.length) { method = 8; body = z; } }
    const h = new DataView(new ArrayBuffer(30));
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint16(8, method, true);
    h.setUint16(10, time, true); h.setUint16(12, date, true); h.setUint32(14, crc, true); h.setUint32(18, body.length, true);
    h.setUint32(22, data.length, true); h.setUint16(26, name.length, true);
    parts.push(new Uint8Array(h.buffer), name, body);
    const c = new DataView(new ArrayBuffer(46));
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x0800, true); c.setUint16(10, method, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true); c.setUint32(16, crc, true); c.setUint32(20, body.length, true);
    c.setUint32(24, data.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(new Uint8Array(c.buffer), name);
    offset += 30 + name.length + body.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
}
function readZip(u8) {
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('archive ZIP illisible');
  const n = dv.getUint16(eocd + 10, true), out = [];
  let p = dv.getUint32(eocd + 16, true);
  for (let k = 0; k < n && dv.getUint32(p, true) === 0x02014b50; k++) {
    const method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true), xlen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true), lho = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(u8.subarray(p + 46, p + 46 + nlen));
    const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
    const raw = u8.subarray(start, start + csize);
    if (!name.endsWith('/')) out.push({ name, size, read: () => method === 0 ? Promise.resolve(raw.slice()) : method === 8 ? pipe(raw, new DecompressionStream('deflate-raw')) : Promise.reject(new Error('méthode de compression ' + method + ' non gérée')) });
    p += 46 + nlen + xlen + clen;
  }
  return out;
}

/* ================= Téléchargements (capacité de l'hébergement, sinon lien local) ================= */
let downloads = null;
try { if (window.claude && typeof window.claude.use === 'function') window.claude.use('downloads').then((ns) => { downloads = ns; }, () => {}); } catch (e) {}
async function offerFile(filename, blob) {
  if (downloads) {
    try { await downloads.save({ filename, data: blob }); log('Fichier remis : ' + filename, 'k'); toast('Fichier prêt : ' + filename); }
    catch (e) { const code = e && e.code; log(code === 'declined' ? 'Téléchargement annulé.' : 'Téléchargement impossible ici (' + (code || e) + ').', code === 'declined' ? 'w' : 'e'); }
    return;
  }
  if (window.claude) { log('Téléchargement indisponible dans ce cadre d\'hébergement.', 'e'); toast('Téléchargement indisponible ici'); return; }
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 15000);
  log('Fichier téléchargé : ' + filename, 'k');
}

/* ================= iPhone / iPad : sélecteur de fichiers ================= */
/* Safari iOS ne connaît pas les extensions .z64, .n64, .v64, .sav, .srm… : avec un filtre « accept », il grise
   ces fichiers dans l'app Fichiers. Sur iOS on retire donc le filtre ; le contenu est de toute façon vérifié
   (en-tête N64, en-tête Game Boy, formats de sauvegarde). */
const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if (isIOS) for (const i of $$('input[type=file]')) i.removeAttribute('accept');

/* ================= Capacités du navigateur ================= */
let hasGl2 = false;
try { hasGl2 = !!document.createElement('canvas').getContext('webgl2'); } catch (e) {}
chip('#cap-gl2', hasGl2 ? 'ok' : 'warn', hasGl2 ? 'WebGL 2' : 'WebGL 1');
idb.ok().then((ok) => chip('#cap-idb', ok ? 'ok' : 'warn', ok ? 'Stockage local' : 'Sans stockage'));
chip('#cap-wasm', 'warn', 'WebAssembly…');
/* Auto-test : compile un module vide, comme le fera le core. Une politique CSP sans 'wasm-unsafe-eval' le refuserait. */
(async () => {
  try {
    await WebAssembly.compile(new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]));
    chip('#cap-wasm', 'ok', 'WebAssembly');
  } catch (e) {
    chip('#cap-wasm', 'no', 'WebAssembly bloqué');
    log('Impossible de compiler du WebAssembly ici (' + (e && e.message) + ').', 'e');
    $('#err').textContent = 'Ce navigateur ou cet hébergement bloque WebAssembly : la console ne pourra pas démarrer ici. Utilise la version locale (Lancer.bat).';
  }
})();
log('Navigateur : WebGL 2 ' + (hasGl2 ? 'oui' : 'non') + ', isolation cross-origin ' + (window.crossOriginIsolated === true) + ', ' + (navigator.hardwareConcurrency || '?') + ' cœurs');

/* ================= Cartouche : analyse de l'en-tête ================= */
const MAGIC = { '80371240': 'z64', '37804012': 'v64', '40123780': 'n64' };
const FMT_LABEL = { z64: '.z64 — big-endian (natif)', v64: '.v64 — octets permutés', n64: '.n64 — little-endian' };
const REGIONS = { E: 'USA (NTSC)', J: 'Japon (NTSC)', P: 'Europe (PAL)', D: 'Allemagne (PAL)', F: 'France (PAL)', I: 'Italie (PAL)', S: 'Espagne (PAL)', U: 'Australie (PAL)', X: 'Europe (PAL)', Y: 'Europe (PAL)', H: 'Pays-Bas (PAL)', W: 'Scandinavie (PAL)', A: 'Asie (NTSC)', B: 'Brésil (PAL-M)', C: 'Chine', K: 'Corée', N: 'Canada', G: 'Gateway 64 (NTSC)', L: 'Gateway 64 (PAL)' };
const PAL = 'PDFISUXYHWL';
const CIC = { 0x6170A4A1: 'CIC-NUS-6101', 0x90BB6CB5: 'CIC-NUS-6102 / 7101', 0x0B050EE0: 'CIC-NUS-6103 / 7103', 0x98BC2C86: 'CIC-NUS-6105 / 7105', 0xACC8580A: 'CIC-NUS-6106 / 7106', 0x009E9EA3: 'CIC-NUS-7102' };
const KNOWN = { ZL: 'The Legend of Zelda: Ocarina of Time', ZS: "The Legend of Zelda: Majora's Mask", SM: 'Super Mario 64', KT: 'Mario Kart 64' };
function toBigEndian(src, fmt) {
  const b = new Uint8Array(src);
  if (fmt === 'v64') for (let i = 0; i + 1 < b.length; i += 2) { const t = b[i]; b[i] = b[i + 1]; b[i + 1] = t; }
  if (fmt === 'n64') swap32(b);
  return b;
}
function swap32(b) { for (let i = 0; i + 3 < b.length; i += 4) { const a = b[i], c = b[i + 1]; b[i] = b[i + 3]; b[i + 1] = b[i + 2]; b[i + 2] = c; b[i + 3] = a; } return b; }
function decodeName(bytes) {
  try { return new TextDecoder('shift_jis').decode(bytes).replace(/\0/g, '').trim(); }
  catch (e) { return String.fromCharCode(...bytes).replace(/[^\x20-\x7e]/g, '').trim(); }
}

function parseHeader(buf) {
  const magic = Array.from(buf.subarray(0, 4), (x) => x.toString(16).padStart(2, '0')).join('');
  const fmt = MAGIC[magic];
  if (!fmt) return { magic };
  const h = toBigEndian(buf.subarray(0, Math.min(0x1000, buf.length)), fmt);
  const ch = (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : '');
  const id = ch(h[0x3C]) + ch(h[0x3D]), regionCode = ch(h[0x3E]), media = ch(h[0x3B]);
  const name = decodeName(h.subarray(0x20, 0x34));
  const cic = h.length >= 0x1000 ? crc32(h.subarray(0x40, 0x1000)) : 0;
  return { fmt, magic, h, id, regionCode, media, name, cic, ver: h[0x3F], title: KNOWN[id] || (name ? titleCase(name) : '') };
}
const shortRegion = (c) => ({ E: 'USA', J: 'Japon', P: 'Europe', D: 'Allemagne', F: 'France', I: 'Italie', S: 'Espagne', U: 'Australie' })[c] || (c ? 'Région ' + c : '');

let rom = null;
/* Les états instantanés ne passent pas d'un moteur à l'autre (la sauvegarde du jeu, si) : clé distincte */
const skey = () => rom.sha1 + ((running && bootedEngine ? bootedEngine : currentEngine()) === 'parallel' ? '@pn64' : '');          // { file, base, sha1, name, title, pal, id }
let running = false;
const isRomMagic = (u8) => !!MAGIC[Array.from(u8.subarray(0, 4), (x) => x.toString(16).padStart(2, '0')).join('')];

async function insertRom(file, opts = {}) {
  $('#err').textContent = '';
  if (!file) return false;
  if (running) { toast('Éteins d\'abord la console'); return false; }
  let buf;
  try { buf = new Uint8Array(await file.arrayBuffer()); }
  catch (e) {
    log('Lecture de la cartouche impossible : ' + (e && e.message), 'e');
    $('#err').textContent = 'Le navigateur n\'arrive plus à relire cette cartouche (' + ((e && e.name) || 'erreur') + '). Ajoute-la à nouveau avec « Ajouter une cartouche ».';
    if (opts.key && opts.key.startsWith('lib:')) { await idb.del(opts.key); renderLibrary(); }
    set('#idle-title', 'Cartouche illisible');
    return false;
  }
  if (buf[0] === 0x50 && buf[1] === 0x4B) {
    try {
      const entry = readZip(buf).find((e) => /\.(z64|n64|v64|bin)$/i.test(e.name));
      if (!entry) throw new Error('aucune ROM .z64/.n64/.v64 dans l\'archive');
      buf = await entry.read();
      file = new File([buf], entry.name.split('/').pop());
      log('Archive décompressée nativement : ' + file.name, 'k');
    } catch (e) { $('#err').textContent = 'Archive : ' + e.message + '.'; return false; }
  }
  if (buf.length < 0x1000 || buf.length > 64 * 1048576) { $('#err').textContent = 'Taille inattendue pour une cartouche N64 (entre 4 Ko et 64 Mo).'; return false; }
  const H = parseHeader(buf);
  /* Safari (iOS) adosse les Blob d'IndexedDB à des fichiers qu'il peut supprimer dès que l'entrée est réécrite :
     la lecture suivante échoue (« The object can not be found here »). On garde donc la ROM en mémoire. */
  if (H.fmt) file = new File([buf], file.name);
  if (!H.fmt) { $('#err').textContent = 'En-tête inconnu (' + H.magic + ') : ce fichier ne ressemble pas à une ROM N64.'; log('Rejeté : magic ' + H.magic, 'e'); return false; }
  const dv = new DataView(H.h.buffer);
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', buf)), (x) => x.toString(16).padStart(2, '0')).join('');
  rom = { file, base: file.name.replace(/\.[^.]+$/, ''), sha1: sha, name: H.name || file.name, title: H.title || file.name, pal: !!H.regionCode && PAL.includes(H.regionCode), id: H.id, code: H.media + H.id, crc1: dv.getUint32(0x10).toString(16).toUpperCase().padStart(8, '0'), source: opts.source || 'navigateur' };
  set('#r-name', H.name || '(vide)');
  set('#r-id', H.id ? H.media + H.id + H.regionCode : 'aucun (homebrew ?)');
  set('#r-region', REGIONS[H.regionCode] || (H.regionCode ? 'Inconnue (' + H.regionCode + ')' : 'non renseignée'));
  set('#r-ver', '1.' + H.ver);
  set('#r-fmt', FMT_LABEL[H.fmt]);
  set('#r-size', mo(buf.length) + ' (' + +(buf.length * 8 / 1048576).toFixed(2) + ' Mbit)');
  set('#r-cic', CIC[H.cic] || 'IPL3 non reconnu (' + hex(H.cic) + ')');
  set('#r-crc', hex(dv.getUint32(0x10)) + ' / ' + hex(dv.getUint32(0x14)));
  set('#r-sha', sha);
  $('#gameid').textContent = KNOWN[H.id] ? KNOWN[H.id] + ' · ' + (REGIONS[H.regionCode] || H.regionCode) + ' · v1.' + H.ver : '';
  log('Cartouche : « ' + H.name + ' », ' + (H.id ? H.media + H.id + H.regionCode : 'sans ID') + ', ' + (CIC[H.cic] || 'IPL3 custom') + ', ' + H.fmt + ', SHA-1 ' + sha.slice(0, 12) + '…');
  if (opts.source !== 'dossier') {
    const prevKeys = await idb.keys('lib:');
    if (!prevKeys.includes('lib:' + sha)) log('Ajoutée à la ludothèque de ce navigateur.');
    const old = await idb.get('lib:' + sha);
    if (!old || !old.blob) await idb.set('lib:' + sha, { sha1: sha, name: file.name, title: rom.title, region: H.regionCode, size: buf.length, blob: new Blob([buf]), t: Date.now(), last: Date.now() });
    else await idb.set('last:' + sha, Date.now());
  }
  libCurrent = opts.key || 'lib:' + sha;
  renderLibrary();
  $('#power').disabled = false;
  set('#idle-title', rom.title);
  set('#idle-hint', 'Cartouche en place. Allume la console, ou appuie sur A / Start à la manette.');
  $('#idle-go').hidden = false;
  renderSlots();
  renderGb();
  $('#btn-oca').hidden = !isOot();
  if (!isOot() && ocaOpen) toggleOcarina(false);
  renderInputOpts();
  renderSafety();
  if (!$('#pane-codes').hidden) loadCheats();
  return true;
}

/* ================= Ludothèque : dossier roms/ (version locale) + ce navigateur ================= */
let libFolder = [], libCurrent = null;
async function readHead(url) {
  const r = await fetch(url);
  if (!r.ok || !r.body) throw new Error('HTTP ' + r.status);
  const reader = r.body.getReader(), parts = []; let n = 0;
  while (n < 0x1000) { const { done, value } = await reader.read(); if (done) break; parts.push(value); n += value.length; }
  reader.cancel().catch(() => {});
  const out = new Uint8Array(n); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function scanFolder() {
  try {
    const r = await fetch('roms/index.json', { cache: 'no-store' });
    if (!r.ok) return;
    const list = await r.json();
    if (!Array.isArray(list)) return;
    libFolder = [];
    for (const it of list.slice(0, 200)) {
      if (!it || typeof it.file !== 'string') continue;
      const url = 'roms/' + encodeURIComponent(it.file);
      let H = {};
      try { const head = await readHead(url); H = head[0] === 0x50 && head[1] === 0x4B ? {} : parseHeader(head); } catch (e) {}
      libFolder.push({ key: 'dir:' + it.file, url, name: it.file, title: H.title || it.file.replace(/\.[^.]+$/, '').replace(/_+/g, ' '), region: H.regionCode || '', size: +it.size || 0, source: 'dossier' });
    }
    if (libFolder.length) log('Dossier roms/ : ' + libFolder.length + ' cartouche' + (libFolder.length > 1 ? 's' : '') + ' trouvée' + (libFolder.length > 1 ? 's' : '') + '.', 'k');
    renderLibrary();
  } catch (e) { /* pas de serveur local : rien à lister */ }
}
const REGION_TINT = { P: '#2f6fd2', E: '#d22f27', J: '#e8b31c', D: '#2f6fd2', F: '#2f6fd2' };
function artStyle(title, region) {
  let h = 0; for (const c of title) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return `--lbl:hsl(${h % 360} 30% 84%);--stripe:${REGION_TINT[region] || '#6b6e76'}`;
}
async function renderLibrary() {
  const box = $('#lib');
  const keys = await idb.keys('lib:');
  const mine = [];
  for (const k of keys) { const r = await idb.get(k); if (r) mine.push({ key: k, title: r.title, name: r.name, region: r.region, size: r.size, last: (await idb.get('last:' + r.sha1)) || r.last || r.t, source: 'navigateur', sha1: r.sha1 }); }
  mine.sort((a, b) => b.last - a.last);
  const items = [...libFolder, ...mine.filter((m) => !libFolder.some((f) => f.title === m.title && f.size === m.size))];
  box.textContent = '';
  set('#lib-count', items.length ? items.length + ' jeu' + (items.length > 1 ? 'x' : '') : '');
  if (!items.length) {
    const e = document.createElement('div'); e.className = 'empty';
    e.textContent = 'Ta ludothèque est vide. Ajoute un dump .z64 : il restera ici, prêt en un clic. En version locale, dépose aussi tes jeux dans le dossier roms/.';
    box.append(e); return;
  }
  for (const it of items) {
    const row = document.createElement('div');
    row.className = 'cart'; row.setAttribute('role', 'listitem'); row.tabIndex = 0;
    row.setAttribute('aria-current', String(it.key === libCurrent));
    const art = document.createElement('span'); art.className = 'art'; art.setAttribute('style', artStyle(it.title, it.region));
    const txt = document.createElement('span');
    const b = document.createElement('b'); b.textContent = it.title;
    const sm = document.createElement('small'); sm.textContent = [shortRegion(it.region), mo(it.size)].filter(Boolean).join(' · ');
    row.title = it.title + (it.source === 'dossier' ? ' (dossier roms)' : ' (gardée dans ce navigateur)');
    txt.append(b, sm);
    const play = document.createElement('button'); play.className = 'play'; play.title = 'Jouer'; play.setAttribute('aria-label', 'Jouer à ' + it.title);
    play.innerHTML = '<svg class="ico"><use href="#i-play"/></svg>';
    row.append(art, txt, play);
    if (it.source === 'navigateur') {
      const x = document.createElement('button'); x.className = 'forget'; x.textContent = 'Retirer'; x.title = 'Retirer de ce navigateur';
      x.addEventListener('click', async (e) => { e.stopPropagation(); await idb.del(it.key); log('« ' + it.title + ' » retirée de ce navigateur.'); renderLibrary(); });
      row.append(x);
    }
    const choose = async (andPlay) => {
      if (running) { if (it.key !== libCurrent) toast('Éteins d\'abord la console pour changer de jeu'); return; }
      let ok = false;
      if (it.key !== libCurrent || !rom) {
        set('#idle-title', 'Lecture de la cartouche…');
        if (it.source === 'dossier') {
          const r = await fetch(it.url); const blob = await r.blob();
          ok = await insertRom(new File([blob], it.name), { source: 'dossier', key: it.key });
        } else {
          const rec = await idb.get(it.key);
          ok = rec && await insertRom(new File([rec.blob], rec.name), { blob: rec.blob, key: it.key });
        }
      } else ok = true;
      if (ok && andPlay) power();
    };
    row.addEventListener('click', () => choose(false));
    row.addEventListener('dblclick', () => choose(true));
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') choose(true); });
    play.addEventListener('click', (e) => { e.stopPropagation(); choose(true); });
    box.append(row);
  }
}

/* ================= Glisser-déposer ================= */
function dropzone(el, handler) {
  ['dragenter', 'dragover'].forEach((ev) => el.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); el.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => el.addEventListener(ev, () => el.classList.remove('over')));
  el.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); if (e.dataTransfer.files[0]) handler(e.dataTransfer.files[0]); });
}
dropzone($('#lib-add'), (f) => insertRom(f));
dropzone($('#slot-save'), (f) => analyseSave(f));
$('#file-rom').addEventListener('change', (e) => { insertRom(e.target.files[0]); e.target.value = ''; });
$('#file-save').addEventListener('change', (e) => { analyseSave(e.target.files[0]); e.target.value = ''; });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (isGbName(f.name)) { insertGb(f); return; }
  if (/\.sav$/i.test(f.name)) { importGbSave(f); return; }
  const head = new Uint8Array(await f.slice(0, 4).arrayBuffer());
  if (isRomMagic(head) || /\.(z64|n64|v64)$/i.test(f.name) || (/\.zip$/i.test(f.name) && !running && !rom)) insertRom(f); else analyseSave(f);
});

/* ================= Diagnostic intégré : à-coups, gels, erreurs du moteur ================= */
const diag = { frameCbs: [], links: 0, reads: 0, lastFrame: 0, frames: 0, pre: 0, busy: 0 };
/* Appelé par le core avant chaque image (crochet preMainLoop d'Emscripten) : mesure de la charge du moteur */
window.EJS_preFrame = () => { diag.pre = performance.now(); };
(() => {
  const P = window.WebGL2RenderingContext && WebGL2RenderingContext.prototype;
  if (!P) return;
  const lp = P.linkProgram, rp = P.readPixels;
  P.linkProgram = function (p) { diag.links++; return lp.call(this, p); };
  P.readPixels = function (...a) { diag.reads++; return rp.apply(this, a); };
})();
/* Appelé par le core après chaque image (crochet postMainLoop d'Emscripten) */
window.EJS_postFrame = () => {
  const now = performance.now();
  if (diag.pre) { diag.busy += now - diag.pre; diag.pre = 0; }
  if (diag.lastFrame && running && !paused && document.visibilityState === 'visible') {
    const dt = now - diag.lastFrame;
    if (dt > 400) {
      const why = [diag.links ? diag.links + ' shader' + (diag.links > 1 ? 's' : '') + ' compilé' + (diag.links > 1 ? 's' : '') : '', diag.reads ? diag.reads + ' lecture' + (diag.reads > 1 ? 's' : '') + ' GPU' : ''].filter(Boolean).join(', ') || 'travail du moteur';
      log('À-coup de ' + (dt / 1000).toFixed(2).replace('.', ',') + ' s (' + why + ')', dt > 1500 ? 'e' : 'w');
      if (dt > 1500) toast('À-coup de ' + (dt / 1000).toFixed(1).replace('.', ',') + ' s : détail dans Infos', 3000);
    }
  }
  diag.lastFrame = now; diag.links = 0; diag.reads = 0; diag.frames++;
  if (diag.frameCbs.length) for (const cb of diag.frameCbs.splice(0)) { try { cb(); } catch (e) {} }
};
{
  const seen = new Map();
  for (const lvl of ['error', 'warn']) {
    const orig = console[lvl].bind(console);
    console[lvl] = (...a) => {
      orig(...a);
      try {
        const msg = a.map((x) => (typeof x === 'string' ? x : (x && x.message) || '')).join(' ').trim();
        if (!msg || /GL Driver|rightClick|Could not fetch core report/.test(msg)) return;
        const n = (seen.get(msg) || 0) + 1; seen.set(msg, n);
        if (n === 1 || n === 10 || n === 100 || n === 1000) log((lvl === 'error' ? 'Moteur, erreur' : 'Moteur, avertissement') + (n > 1 ? ' ×' + n : '') + ' : ' + msg.slice(0, 180), lvl === 'error' ? 'e' : 'w');
      } catch (e) {}
    };
  }
  window.addEventListener('error', (e) => log('Erreur : ' + (e.message || e), 'e'));
  window.addEventListener('unhandledrejection', (e) => {
    const msg = (e.reason && e.reason.message) || String(e.reason);
    log('Erreur : ' + msg, 'e');
    if (running && !startedAt) bootFailed(msg);
  });
  let tick = performance.now(), seenFrames = -1, stallSaid = false;
  setInterval(() => {
    const now = performance.now(), gap = now - tick; tick = now;
    if (gap > 2500 && running && document.visibilityState === 'visible') log('La page a été bloquée ' + (gap / 1000).toFixed(1).replace('.', ',') + ' s par le moteur.', 'e');
    if (running && !startedAt && bootT && now - bootT > 60000) bootFailed('rien après 60 s');
    if (!running || !startedAt || paused || document.visibilityState !== 'visible') { seenFrames = -1; stallSaid = false; return; }
    if (diag.frames === seenFrames && now - diag.lastFrame > 3000) {
      if (!stallSaid) { stallSaid = true; log('Gel : aucune image depuis ' + Math.round((now - diag.lastFrame) / 1000) + ' s, alors que la page répond.', 'e'); toast('Le jeu ne produit plus d\'images : détail dans Infos', 4000); }
    } else stallSaid = false;
    seenFrames = diag.frames;
  }, 1000);
}

/* ================= Crochets du moteur : instance WebAssembly, contexte WebGL, son ================= */
/* Instance du core (mémoire + table de fonctions) : nécessaire au pont Rumble Pak */
const core = { inst: null, rumbleAddr: 0 };
for (const fn of ['instantiate', 'instantiateStreaming']) {
  const orig = WebAssembly[fn];
  if (typeof orig !== 'function') continue;
  WebAssembly[fn] = function (...a) {
    return orig.apply(this, a).then((r) => {
      const inst = r instanceof WebAssembly.Instance ? r : r && r.instance;
      if (inst && Object.values(inst.exports).some((v) => v instanceof WebAssembly.Table)) core.inst = inst;
      return r;
    });
  };
}
/* Basse latence : automatique sur ordinateur ; sur mobile et appareils virtuels, le chemin « desynchronized »
   dépend du pilote graphique (écran noir possible), il faut donc le demander explicitement. */
const isMobileUA = /Android|iP(hone|ad|od)|Mobile/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const lowLatencyOn = () => (prefs.llSet ? prefs.lowLatency !== false : !isMobileUA);
/* Contexte WebGL « desynchronized » : le canvas court-circuite la file du compositeur.
   Mesuré sur Hyrule Field en rendu logiciel, 3 essais alternés : +4 % d'images/s en moyenne (jusqu'à +10 %),
   cadence d'affichage +15 %, temps du moteur par image -10 %. Le gain principal sur une vraie carte graphique : la latence. */
{
  const getCtx = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, attrs) {
    if (attrs && typeof attrs === 'object' && 'majorVersion' in attrs && /webgl/.test(type) && lowLatencyOn()) attrs = Object.assign({}, attrs, { desynchronized: true });
    return getCtx.call(this, type, attrs);
  };
}
/* Prise de son pour les clips : on retient les nœuds reliés à la sortie audio, et on ne les branche
   sur un flux enregistrable que pendant un enregistrement (aucun coût le reste du temps) */
const audioOuts = new Set();
let lastAudioCtx = null;
const nodeConnect = AudioNode.prototype.connect;
AudioNode.prototype.connect = function (dest, ...rest) {
  const r = nodeConnect.call(this, dest, ...rest);
  try { if (typeof AudioDestinationNode !== 'undefined' && dest instanceof AudioDestinationNode) { audioOuts.add(this); lastAudioCtx = dest.context; } } catch (e) {}
  return r;
};
function audioTap() {
  if (!lastAudioCtx) return null;
  const tap = lastAudioCtx.createMediaStreamDestination();
  let n = 0;
  for (const node of audioOuts) { if (node.context !== lastAudioCtx) continue; try { nodeConnect.call(node, tap); n++; } catch (e) {} }
  return n ? { tap, close: () => { for (const node of audioOuts) { try { node.disconnect(tap); } catch (e) {} } } } : null;
}

/* ================= Profil de la machine (carte graphique, cœurs, mémoire) ================= */
const machine = (() => {
  let gpu = '';
  try {
    const c = document.createElement('canvas'), g = c.getContext('webgl2') || c.getContext('webgl');
    const d = g && g.getExtension('WEBGL_debug_renderer_info');
    gpu = String((g && (d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER))) || '').replace(/\s*\(0x[0-9a-f]+\)/i, '');
    const lc = g && g.getExtension('WEBGL_lose_context'); if (lc) lc.loseContext();
  } catch (e) {}
  const cores = navigator.hardwareConcurrency || 0, mem = navigator.deviceMemory || 0, l = gpu.toLowerCase();
  let tier = 'moyen';
  if (/swiftshader|llvmpipe|softpipe|basic render|microsoft basic|software/.test(l)) tier = 'logiciel';
  else if (/nvidia|geforce|rtx|gtx|quadro|radeon rx|radeon pro|arc\(tm\) a\d|arc a\d|apple m\d (pro|max|ultra)|apple m[2-9]/.test(l)) tier = 'puissant';
  else if (/intel.*(hd graphics|gma|uhd graphics 6\d\d)|mali-?[gt]?\d{1,2}\b|mali-4|adreno[^0-9]*[3-5]\d\d\b|powervr|videocore|radeon\(tm\) r[2-5]|vega [3-8]\b/.test(l)) tier = 'faible';
  if (tier !== 'logiciel' && ((cores && cores <= 2) || (mem && mem <= 2))) tier = tier === 'puissant' ? 'moyen' : 'faible';
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  return { gpu, cores, mem, tier, touch };
})();
const TIER_LABEL = { logiciel: 'rendu logiciel (sans carte graphique)', faible: 'machine légère', moyen: 'machine intermédiaire', puissant: 'machine puissante' };
const TIER_PRESET = { logiciel: 'fidele', faible: 'fidele', moyen: 'net', puissant: 'hd' };
if (prefsFresh) {
  prefs.quality = { ...PRESETS[TIER_PRESET[machine.tier]] };
  savePrefs();
}
log('Processeur graphique : ' + (machine.gpu || 'inconnu') + ' · ' + (machine.cores || '?') + ' cœurs' + (machine.mem ? ' · ' + machine.mem + ' Go' : '') + ' · profil ' + TIER_LABEL[machine.tier] + (prefsFresh ? ' → préréglage ' + TIER_PRESET[machine.tier] : ''));

/* ================= Rumble Pak : pont vers la vibration réelle de la manette ================= */
/* Le core appelle le set_rumble_state() de libretro ; RetroArch compilé pour le web ne le relie à rien.
   Ce pointeur vit à une adresse fixe de la mémoire du core : on la retrouve dans le binaire (motif unique,
   juste après le test « adresse == 0xC000 » du Rumble Pak), puis on remplace l'entrée de la table de
   fonctions par un mini-module WebAssembly qui appelle JavaScript. */
function findRumbleAddr(w) {
  const pat = [0x41, 0x80, 0x80, 0x03, 0x47, 0x0d, 0x01, 0x41];
  for (let i = w.indexOf(0x41); i >= 0 && i < w.length - 20; i = w.indexOf(0x41, i + 1)) {
    let k = 1; while (k < pat.length && w[i + k] === pat[k]) k++;
    if (k < pat.length) continue;
    let p = i + pat.length, v = 0, s = 0, b;
    do { b = w[p++]; v |= (b & 0x7f) << s; s += 7; } while ((b & 0x80) && s < 35);
    if (w[p] === 0x28 && w[p + 1] === 0x02 && w[p + 2] === 0x00) return v >>> 0;
  }
  return 0;
}
function makeBridge(fn) {
  const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 8, 1, 96, 3, 127, 127, 127, 1, 127, 2, 7, 1, 1, 101, 1, 102, 0, 0, 3, 2, 1, 0, 7, 5, 1, 1, 119, 0, 1, 10, 12, 1, 10, 0, 32, 0, 32, 1, 32, 2, 16, 0, 11]);
  return new WebAssembly.Instance(new WebAssembly.Module(bytes), { e: { f: fn } }).exports.w;
}
const rumbleSt = { installed: false, on: false, events: [], timer: null, mag: 0, until: 0, seen: false, count: 0 };
function installRumble() {
  if (rumbleSt.installed || !core.inst || !core.rumbleAddr) return;
  try {
    const ex = Object.values(core.inst.exports);
    const mem = ex.find((v) => v instanceof WebAssembly.Memory), tab = ex.find((v) => v instanceof WebAssembly.Table);
    const idx = new DataView(mem.buffer).getInt32(core.rumbleAddr, true);
    if (!(idx > 0 && idx < tab.length)) { log('Rumble Pak : interface du core introuvable (entrée ' + idx + ').', 'w'); return; }
    const orig = tab.get(idx);
    tab.set(idx, makeBridge((port, effect, strength) => {
      if (effect === 0) onRumble(port, strength);
      try { return orig ? orig(port, effect, strength) : 1; } catch (e) { return 1; }
    }));
    rumbleSt.installed = true;
    log('Rumble Pak relié à la vibration (pont WebAssembly, adresse 0x' + core.rumbleAddr.toString(16) + ', entrée ' + idx + ')', 'k');
  } catch (e) { log('Rumble Pak : pont impossible (' + (e && e.message) + ')', 'w'); }
}
function onRumble(port, strength) {
  if (port !== 0) return;
  const on = strength > 0;
  if (on === rumbleSt.on) return;
  rumbleSt.on = on; rumbleSt.count++;
  rumbleSt.events.push([performance.now(), on]);
  if (!rumbleSt.timer) rumbleSt.timer = setInterval(rumbleTick, 40);
  if (on && !rumbleSt.seen) { rumbleSt.seen = true; log('Le jeu fait vibrer le Rumble Pak.', 'k'); }
}
/* Les jeux N64 dosent la vibration en hachant le moteur (marche/arrêt) : on convertit ce rapport cyclique en intensité */
function rumbleTick() {
  const now = performance.now(), win = 160, ev = rumbleSt.events;
  while (ev.length > 1 && ev[1][0] < now - win) ev.shift();
  let onTime = 0;
  for (let i = 0; i < ev.length; i++) {
    const a = Math.max(ev[i][0], now - win), b = i + 1 < ev.length ? ev[i + 1][0] : now;
    if (ev[i][1] && b > a) onTime += b - a;
  }
  const duty = onTime / win;
  vibrate(Math.min(1, duty * 1.15) * (prefs.rumble / 100), now);
  if (!rumbleSt.on && duty === 0) { clearInterval(rumbleSt.timer); rumbleSt.timer = null; rumbleSt.events = []; vibrate(0, now); }
}
function padActuator() {
  const pads = readPads(), p = pads.find((x) => x.index === padIndex) || pads[0];
  return p ? (p.vibrationActuator || (p.hapticActuators && p.hapticActuators[0]) || null) : null;
}
function vibrate(mag, now = performance.now(), dur = 200) {
  const a = padActuator();
  if (a && a.playEffect) {
    if (mag < 0.03) { if (rumbleSt.mag > 0 && a.reset) a.reset().catch(() => {}); rumbleSt.mag = 0; return; }
    if (Math.abs(mag - rumbleSt.mag) > 0.08 || now > rumbleSt.until - 60) {
      a.playEffect('dual-rumble', { startDelay: 0, duration: dur, strongMagnitude: mag, weakMagnitude: Math.min(1, mag * 0.75) }).catch(() => {});
      rumbleSt.mag = mag; rumbleSt.until = now + dur;
    }
  } else if (a && a.pulse) {
    if (mag >= 0.03 && now > rumbleSt.until - 40) { a.pulse(mag, dur).catch(() => {}); rumbleSt.until = now + dur; }
    rumbleSt.mag = mag;
  } else if (navigator.vibrate && touchShown) {
    if (mag >= 0.03 && now > rumbleSt.until - 40) { navigator.vibrate(dur * 0.7); rumbleSt.until = now + dur * 0.7; }
    else if (mag < 0.03 && rumbleSt.mag) navigator.vibrate(0);
    rumbleSt.mag = mag;
  }
}

/* Échec au chargement : on le dit, et on propose de relancer proprement */
function bootFailed(msg) {
  if (startedAt || !running || $('#notice').dataset.boot) return;
  $('#notice').dataset.boot = '1';
  $('#led').dataset.s = ''; set('#state', 'Échec du chargement');
  const relaunch = () => { try { sessionStorage.setItem('be64-insert', libCurrent || ''); } catch (e) {} location.reload(); };
  const buttons = [['Relancer', relaunch, bootedEngine !== 'mupen']];
  if (bootedEngine === 'mupen') buttons.unshift(['Relancer avec le moteur léger', () => { prefs.engine = 'parallel'; savePrefs(); relaunch(); }, true]);
  showNotice('Le chargement s\'est arrêté (' + msg + ').' + (bootedEngine === 'mupen' ? ' Le moteur complet demande près d\'1 Go de mémoire : le moteur léger (~300 Mo) passe sur les appareils plus modestes.' : ' Relance : la cartouche sera relue depuis la ludothèque.'), buttons);
}
/* ================= Émulateur ================= */
const em = () => window.EJS_emulator;
const gm = () => (window.EJS_emulator && window.EJS_emulator.gameManager) || null;
function focusGame() {
  const p = em() && em().elements && em().elements.parent;
  if (!p) return;
  if (!p.hasAttribute('tabindex')) p.tabIndex = -1;
  p.focus({ preventScroll: true });
}
document.addEventListener('pointerup', (e) => {
  if (!running || e.target.closest('select, input, textarea, .log, .lib, .panel')) return;
  setTimeout(focusGame, 0);
});
const syncfs = () => new Promise((r) => { try { gm().FS.syncfs(false, () => r()); } catch (e) { r(); } });

const OPT = () => (bootedEngine === 'parallel' ? 'parallel-n64-' : 'mupen64plus-');
function coreOptions(q) {
  const r = RES.find((x) => x.f === +q.res) || RES[1];
  if (bootedEngine === 'parallel') {
    const sizes = ['320x240', '640x480', '960x720', '1280x960', '1440x1080', '1600x1200', '1920x1440', '2240x1680', '2880x2160'];
    return {
      'parallel-n64-screensize': sizes.includes(r.r43) ? r.r43 : '2240x1680',
      'parallel-n64-aspectratiohint': q.aspect === '4:3' ? 'normal' : 'widescreen',
      'parallel-n64-filtering': q.filter === 'standard' ? 'bilinear' : 'N64 3-point',
      'parallel-n64-gfxplugin': 'auto'
    };
  }
  return {
    'mupen64plus-43screensize': r.r43, 'mupen64plus-169screensize': r.r169, 'mupen64plus-aspect': q.aspect,
    'mupen64plus-EnableNativeResFactor': '0', 'mupen64plus-MultiSampling': '0', 'mupen64plus-BilinearMode': q.filter,
    'mupen64plus-txEnhancementMode': q.tex, 'mupen64plus-txFilterMode': 'None', 'mupen64plus-FXAA': q.fxaa,
    'mupen64plus-ThreadedRenderer': 'False',
    /* Copies framebuffer -> RDRAM : en WebAssembly, la lecture de PBO (glMapBufferRange en lecture) n'existe pas,
       la copie échoue donc toujours ; on la coupe pour éviter ce chemin et ses lectures GPU. */
    'mupen64plus-EnableCopyColorToRDRAM': q.compat === 'exact' ? 'Async' : 'Off',
    'mupen64plus-EnableCopyDepthToRDRAM': q.compat === 'exact' ? 'Software' : 'Off',
    'mupen64plus-EnableFBEmulation': 'True'
  };
}
/* Mémoire initiale : les deux cores réservent 512 Mo dès le départ alors qu'il leur en faut ~240 Mo (mupen64plus-next)
   et ~138 Mo (ParaLLEl-N64) avant le tas. Sur un téléphone modeste, un Android 32 bits ou un appareil virtuel,
   cette réservation d'un bloc peut être refusée. On la ramène au besoin réel + marge, sans changer la taille du
   binaire (deux octets LEB128 de la section mémoire) ; la mémoire grandit ensuite à la demande (maximum : 2 Go). */
function shrinkInitialMemory(w, pages) {
  let i = 8;
  const leb = (p) => { let v = 0, s = 0, b; do { b = w[p++]; v |= (b & 0x7f) << s; s += 7; } while (b & 0x80); return [v, p]; };
  while (i < w.length) {
    const id = w[i]; let [size, p] = leb(i + 1);
    if (id === 5) {
      const [count, q] = leb(p);
      if (count !== 1) return 0;
      const flags = w[q], start = q + 1;
      const [initial, end] = leb(start);
      const len = end - start;
      if (initial <= pages) return 0;
      const enc = []; let v = pages;
      for (let k = 0; k < len; k++) { let b = v & 0x7f; v >>>= 7; if (k < len - 1) b |= 0x80; enc.push(b); }
      if (v !== 0 || !(flags & 1)) return 0;
      w.set(enc, start);
      return initial;
    }
    i = p + size;
  }
  return 0;
}
/* Le .wasm est servi brut et compilé directement : pas d'archive 7z, pas d'eval */
async function unpackCore(bytes) {
  const meta = JSON.parse(new TextDecoder().decode(bytes));
  const base = 'emulator/data/cores/' + meta.variant + '/';
  const t = performance.now();
  const get = async (f) => { const r = await fetch(base + f); if (!r.ok) throw new Error(f + ' : HTTP ' + r.status); return new Uint8Array(await r.arrayBuffer()); };
  const [build, wasm] = await Promise.all([get('build.json'), get(meta.name + '_libretro.wasm')]);
  log('Core ' + meta.variant.toUpperCase() + ' chargé (' + mo(wasm.length) + ') en ' + Math.round(performance.now() - t) + ' ms');
  core.rumbleAddr = findRumbleAddr(wasm);
  const target = meta.name === 'parallel_n64' ? 2560 : 4096;
  const was = shrinkInitialMemory(wasm, target);
  if (was) log('Mémoire initiale du core : ' + (was * 64 / 1024) + ' Mo → ' + (target * 64 / 1024) + ' Mo (croît à la demande)');
  return { 'core.json': bytes, 'build.json': build, [meta.name + '_libretro.wasm']: wasm };
}

let fpsTimer = null, resumeState = null, bootedQuality = null, startedAt = 0, bootedEngine = null, bootT = 0;
/* Moteur N64 : mupen64plus-next + GLideN64 (complet) ou ParaLLEl-N64 (léger, choix d'EmulatorJS pour Safari mobile) */
if (!['auto', 'mupen', 'parallel'].includes(prefs.engine)) prefs.engine = 'auto';
const ENGINE_LABEL = { mupen: 'complet (mupen64plus-next + GLideN64)', parallel: 'léger (ParaLLEl-N64)' };
/* Mesuré : en jeu, mupen64plus-next occupe ~855 Mo de mémoire WebAssembly (quelles que soient ses options), ParaLLEl-N64
   ~300 Mo. Un navigateur mobile ou une machine à 4 Go de RAM refuse ou tue une page de près d'un gigaoctet :
   ces appareils prennent donc le moteur léger en Auto (c'est aussi le choix d'EmulatorJS pour Safari mobile). */
const lowMemDevice = isIOS || /Android|Mobile/i.test(navigator.userAgent) || (navigator.deviceMemory && navigator.deviceMemory <= 4);
const autoEngineWhy = () => (isIOS ? 'iPhone / iPad' : /Android|Mobile/i.test(navigator.userAgent) ? 'appareil mobile' : 'mémoire ' + navigator.deviceMemory + ' Go');
const currentEngine = () => (prefs.engine === 'auto' ? (lowMemDevice ? 'parallel' : 'mupen') : prefs.engine);
async function power() {
  if (!rom || running || window.duoGuest) return;
  running = true;
  const pw = $('#power');
  pw.classList.add('on'); pw.lastElementChild.textContent = 'Éteindre';
  $('#idle').hidden = true;
  $('#bezel').classList.toggle('wide', prefs.quality.aspect !== '4:3');
  $('#led').dataset.s = 'load'; set('#state', 'Chargement…');
  const tStart = performance.now();
  bootT = tStart;
  bootedEngine = currentEngine();
  const opts = coreOptions(prefs.quality);
  bootedQuality = qualitySig();
  bootedInput = inputSig();
  window.EJS_externalFiles = undefined;
  opts[OPT() + 'astick-deadzone'] = String(prefs.stick.dz);
  opts[OPT() + 'astick-sensitivity'] = String(prefs.stick.sens);
  log('Moteur N64 : ' + ENGINE_LABEL[bootedEngine] + (prefs.engine === 'auto' ? ' (auto' + (lowMemDevice ? ', ' + autoEngineWhy() : '') + ')' : ''), 'k');
  await preparePaks(opts);
  /* Machines légères : un tampon audio un peu plus long évite les craquements quand une image tarde */
  window.EJS_retroarchExtra = machine.tier === 'faible' || machine.tier === 'logiciel' ? 'audio_latency = 96\n' : '';
  Object.assign(window, {
    EJS_player: '#game', EJS_core: bootedEngine === 'parallel' ? 'parallel_n64' : 'mupen64plus_next', EJS_pathtodata: 'emulator/data/',
    EJS_gameUrl: rom.file, EJS_gameName: rom.base, EJS_language: 'af-FR',
    EJS_startOnLoaded: true, EJS_color: '#d22f27', EJS_threads: false,
    EJS_disableLocalStorage: true, EJS_defaultOptions: opts,
    EJS_coreScriptBase: 'emulator/data/cores/js/', EJS_unpackCore: unpackCore,
    EJS_paths: { 'mupen64plus_next-wasm.data': 'emulator/data/cores/gl2/core.json', 'mupen64plus_next-legacy-wasm.data': 'emulator/data/cores/gl1/core.json', 'parallel_n64-wasm.data': 'emulator/data/cores/pn64/core.json', 'parallel_n64-legacy-wasm.data': 'emulator/data/cores/pn64-gl1/core.json' },
    EJS_Buttons: { saveState: false, loadState: false, screenRecord: false, saveSavFiles: false, loadSavFiles: false, quickSave: false, quickLoad: false, screenshot: false, cacheManager: false, exitEmulation: false, netplay: false, diskButton: false, settings: false, contextMenu: false },
    EJS_defaultControls: buildControls(),
    EJS_ready: () => log('Interface EmulatorJS prête (' + Math.round(performance.now() - tStart) + ' ms)'),
    EJS_onGameStart: () => afterStart(tStart)
  });
  log('Allumage : rendu ' + (opts['mupen64plus-' + (prefs.quality.aspect === '4:3' ? '43' : '169') + 'screensize'] || opts['parallel-n64-screensize']) + ', filtrage ' + prefs.quality.filter + ', FXAA ' + (prefs.quality.fxaa === '1' ? 'oui' : 'non') + ', textures ' + prefs.quality.tex + ', compatibilité ' + prefs.quality.compat);
  const s = document.createElement('script');
  s.src = 'emulator/data/loader.js';
  s.onerror = () => { log('Impossible de charger emulator/data/loader.js', 'e'); set('#state', 'Erreur'); };
  document.body.appendChild(s);
}
async function afterStart(tStart) {
  const g = gm();
  startedAt = performance.now();
  log('Jeu démarré ' + Math.round(performance.now() - tStart) + ' ms après l\'allumage', 'k');
  $('#led').dataset.s = 'on'; set('#state', 'En marche');
  ['#btn-pause', '#btn-qsave', '#btn-qload', '#btn-full', '#btn-shot', '#btn-rec', '#sv-export'].forEach((s) => { $(s).disabled = false; });
  try { set('#render', g.functions.getVideoDimensions('width') + '×' + g.functions.getVideoDimensions('height')); } catch (e) {}
  watchGpu();
  installRumble();
  applyTouch();
  if (touchShown && innerWidth < 900 && !document.body.classList.contains('immersive')) {
    document.body.classList.add('immersive');
    setTimeout(() => { const e2 = em(); if (e2 && e2.handleResize) e2.handleResize(); }, 150);
    toast('Plein écran tactile : ✕ en haut à gauche pour revenir', 3500);
  }
  setTimeout(() => { try { const mem = core.inst && Object.values(core.inst.exports).find((v) => v instanceof WebAssembly.Memory); if (mem) log('Mémoire du core en jeu : ' + Math.round(mem.buffer.byteLength / 1048576) + ' Mo'); } catch (e) {} }, 4000);
  setTimeout(() => { try { const c = em().canvas, gl = c.getContext('webgl2') || c.getContext('webgl'), at = gl && gl.getContextAttributes(); if (at) log('Affichage : ' + (at.desynchronized ? 'basse latence (desynchronized)' : 'synchronisé au compositeur') + ', canvas ' + c.width + '×' + c.height); } catch (e) {} }, 1500);
  if (prefs.shader !== 'disabled') applyShader();
  applySpeed();
  startFps();
  updateQualityUi();
  if (pendingSave && pendingSave.kind !== 'state') await applyPendingSave();
  if (resumeState) {
    await sleep(400);
    try { g.loadState(resumeState); log('Partie reprise à l\'identique.', 'k'); toast('Partie reprise'); } catch (e) { log('Reprise impossible : ' + e, 'e'); }
    resumeState = null;
  }
  refreshSaveInfo();
  renderSlots();
  startGbSync();
  startSafety();
  renderEngine();
  renderInputOpts();
  loadCheats().then(() => applyCheats(false));
  focusGame();
}
/* Redémarrage éclair : capture l'état, recharge la page avec les nouveaux réglages, reprend la partie */
async function restartWithResume(reason, o = {}) {
  const g = gm();
  if (!g || !running) return;
  set('#state', 'Redémarrage…');
  try {
    if (rec) await rec.stop();
    if (reason !== 'gb') await syncGbSave('redémarrage');
    const st = o.noState ? null : await gzip(g.getState());
    g.saveSaveFiles(); await syncfs();
    await idb.set('resume', { sha1: rom.sha1, t: Date.now(), state: st ? new Blob([st]) : null, reason });
    await idb.set('resume-rom', { name: rom.file.name, blob: rom.file, key: libCurrent, source: rom.source });
    try { sessionStorage.setItem('be64-resume', '1'); } catch (e) {}
    location.reload();
  } catch (e) { log('Redémarrage impossible : ' + e, 'e'); set('#state', 'En marche'); }
}
/* Perte du contexte WebGL (GPU saturé, pilote réinitialisé) : on sauve l'état côté processeur et on relance plus léger */
function watchGpu() {
  const c = em() && em().canvas;
  if (!c || c.__watched) return;
  c.__watched = true;
  c.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    log('Le processeur graphique a lâché (contexte WebGL perdu).', 'e');
    const i = RES.findIndex((r) => r.f === +prefs.quality.res);
    if (i > 0) { prefs.quality.res = RES[i - 1].f; savePrefs(); }
    toast('Processeur graphique saturé : relance en résolution plus légère', 4000);
    restartWithResume('gpu');
  });
}

/* ================= Vitesse réelle, charge du moteur et régulateur de performance ================= */
/* Toutes les secondes : images émulées, cadence d'affichage du navigateur (rAF) et charge de la boucle du core
   (temps passé entre preMainLoop et postMainLoop). Si le jeu tient moins de 90 % de sa vitesse pendant 10 s,
   on cherche la cause avant de proposer quoi que ce soit. */
let perfWindow = [], perfOffered = false;
function startFps() {
  const target = rom.pal ? 50 : 60;
  let last = null, lastT = 0, ticks = 0, lastRaf = rafCount;
  clearInterval(fpsTimer);
  diag.busy = 0;
  fpsTimer = setInterval(() => {
    const g = gm();
    if (!g) return;
    let f; try { f = g.getFrameNum(); } catch (e) { return; }
    const now = performance.now();
    if (last !== null && now > lastT) {
      const dt = now - lastT, fps = (f - last) * 1000 / dt, raf = (rafCount - lastRaf) * 1000 / dt, load = diag.busy / dt;
      set('#fps', fps.toFixed(1).replace('.', ',') + ' i/s');
      set('#speed-real', paused ? 'en pause' : '×' + (fps / target).toFixed(2).replace('.', ',') + (currentSpeed() !== 1 ? ' (visé ×' + fmtSpeed(currentSpeed()) + ')' : ''));
      set('#load', paused ? '—' : Math.round(load * 100) + ' %');
      $('#load').title = 'Part du temps passée dans le moteur (émulation + commandes graphiques). Au-delà de 85 %, le processeur limite.';
      const steady = !paused && !capture && currentSpeed() === 1 && document.visibilityState === 'visible' && now - startedAt > 15000 && !rec;
      if (steady) { perfWindow.push({ s: fps / target, raf, load }); if (perfWindow.length > 10) perfWindow.shift(); } else perfWindow = [];
      if (!perfOffered && perfWindow.length === 10) diagnosePerf(target);
    }
    diag.busy = 0; lastRaf = rafCount; last = f; lastT = now;
    if (++ticks % 15 === 0 && !$('#pane-partie').hidden) refreshSaveInfo(false);
  }, 1000);
}
function lighterStep(q) {
  if (prefs.shader !== 'disabled') return { live: true, label: 'écran sans filtre', apply: () => { prefs.shader = 'disabled'; savePrefs(); applyShader(); updateQualityUi(); } };
  if (q.tex !== 'None') return { label: 'textures d\'origine', apply: () => { prefs.quality.tex = 'None'; } };
  if (q.fxaa === '1') return { label: 'sans FXAA', apply: () => { prefs.quality.fxaa = '0'; } };
  const i = RES.findIndex((r) => r.f === +q.res);
  if (i > 0) return { label: 'rendu ' + RES[i - 1].r43.replace('x', '×'), apply: () => { prefs.quality.res = RES[i - 1].f; } };
  return null;
}
function showNotice(text, buttons) {
  const box = $('#notice');
  box.hidden = false; box.textContent = '';
  const p = document.createElement('p'); p.textContent = text; box.append(p);
  for (const [label, fn, primary] of buttons) {
    const b = document.createElement('button'); b.className = 'btn sm' + (primary ? ' primary' : ''); b.textContent = label;
    b.addEventListener('click', () => { box.hidden = true; if (fn) fn(); focusGame(); });
    box.append(b);
  }
}
function diagnosePerf(target) {
  const med = (k) => perfWindow.map((x) => x[k]).sort((a, b) => a - b)[5];
  const s = med('s'), raf = med('raf'), load = med('load'), fps = Math.round(s * target);
  if (s >= 0.9) return;
  perfOffered = true;
  log('Performance : ' + fps + ' i/s sur ' + target + ' · affichage ' + Math.round(raf) + ' Hz · moteur occupé ' + Math.round(load * 100) + ' %', 'w');
  if (raf < target * 0.75 && raf > 18 && load < 0.6) {
    log('Cause probable : le navigateur bride l\'affichage (économie d\'énergie / batterie).', 'w');
    showNotice('Le navigateur n\'affiche que ' + Math.round(raf) + ' images/s alors que ta machine a de la marge : c\'est l\'économiseur d\'énergie (Chrome, Edge) ou le mode batterie de Windows. Branche le chargeur, ou désactive « Économiseur d\'énergie » dans Paramètres › Performances du navigateur.', [['Compris', null, true]]);
    return;
  }
  const step = lighterStep(prefs.quality);
  const why = machine.tier === 'logiciel' ? ' Le navigateur dessine sans carte graphique : active « Utiliser l\'accélération graphique » dans ses paramètres (Système), c\'est le gain le plus net.'
    : load > 0.85 ? ' Le processeur est le facteur limitant : fermer les autres onglets et applications aide aussi.' : '';
  if (!step) {
    showNotice('Ta machine affiche ' + fps + ' images/s sur ' + target + ', déjà au réglage le plus léger.' + why + ' Brancher le chargeur d\'un portable aide souvent.', [['Compris', null, true]]);
    return;
  }
  showNotice('Ta machine affiche ' + fps + ' images/s sur ' + target + '.' + why + ' Proposition : ' + step.label + (step.live ? ' (immédiat).' : ' (redémarrage de 2 s, partie reprise au même endroit).'), [
    ['Alléger : ' + step.label, () => {
      step.apply();
      log('Allègement accepté : ' + step.label, 'k');
      if (step.live) { perfOffered = false; perfWindow = []; return; }
      savePrefs(); restartWithResume('perf');
    }, true],
    ['Garder', null]
  ]);
}

$('#power').addEventListener('click', () => (running ? powerOff() : power()));
$('#idle-go').addEventListener('click', power);
let offArmed = null;
async function powerOff() {
  if (!offArmed) {
    $('#power').lastElementChild.textContent = 'Confirmer ?';
    offArmed = setTimeout(() => { offArmed = null; $('#power').lastElementChild.textContent = 'Éteindre'; }, 3000);
    return;
  }
  clearTimeout(offArmed);
  set('#state', 'Extinction…');
  if (rec) { try { await rec.stop(); } catch (e) {} }
  try { await syncGbSave('extinction'); gm().saveSaveFiles(); await syncfs(); } catch (e) {}
  try { sessionStorage.setItem('be64-insert', libCurrent || ''); } catch (e) {}
  location.reload();
}
document.addEventListener('visibilitychange', () => { if (document.hidden && running && gm()) { try { gm().saveSaveFiles(); syncGbSave(); } catch (e) {} } });

/* Pause et plein écran */
let paused = false;
function togglePause(silent) {
  const e = em();
  if (!running || !e || !e.togglePlaying) return;
  e.togglePlaying();
  paused = !!e.paused;
  $('#led').dataset.s = paused ? 'pause' : 'on';
  set('#state', paused ? 'En pause' : 'En marche');
  const b = $('#btn-pause');
  b.querySelector('use').setAttribute('href', paused ? '#i-play' : '#i-pause');
  b.querySelector('span').textContent = paused ? 'Reprendre' : 'Pause';
  if (!silent) toast(paused ? 'Pause' : 'Reprise');
}
$('#btn-pause').addEventListener('click', togglePause);
$('#btn-full').addEventListener('click', () => toggleFull());

/* ================= Sauvegarde du jeu (.srm ↔ formats cartouche) ================= */
// Disposition du .srm libretro (mupen64plus-next, libretro_memory.h) — SRAM et FlashRAM y sont en mots 32 bits inversés (^S8)
const SRM = { size: 0x48800, eeprom: [0x0, 0x800], mpk: [0x800, 0x8000], sram: [0x20800, 0x8000], flash: [0x28800, 0x20000] };
const KIND = {
  srm: 'Sauvegarde complète .srm (RetroArch / EmulatorJS)', sram: 'SRAM 256 Kbit (.sra)', flash: 'FlashRAM 1 Mbit (.fla)',
  eeprom: 'EEPROM (.eep)', mpk: 'Controller Pak (.mpk)', state: 'État instantané'
};
const RAW_EXT = { sram: 'sra', flash: 'fla', eeprom: 'eep' };
function findAscii(u8, word) {
  const w = Array.from(word, (c) => c.charCodeAt(0));
  outer: for (let i = 0; i + w.length <= u8.length; i++) { for (let j = 0; j < w.length; j++) if (u8[i + j] !== w[j]) continue outer; return true; }
  return false;
}
function detectOrder(u8) {
  if (findAscii(u8, 'ZELDA')) return { order: 'be', why: 'signature « ZELDA » lisible : ordre cartouche (big-endian)' };
  if (findAscii(swap32(u8.slice()), 'ZELDA')) return { order: 'le', why: 'signature « ZELDA » trouvée après inversion : ordre émulateur (Project64 / mupen64plus)' };
  return { order: 'be', why: 'aucune signature connue : ordre cartouche supposé (big-endian), inverse-le si le jeu ne voit pas ta partie', unsure: true };
}
function regionUsed(srm, [off, len]) { for (let i = off; i < off + len; i++) if (srm[i] !== 0xFF) return true; return false; }

let pendingSave = null;   // { kind, bytes, order, name }
async function analyseSave(file) {
  if (!file) return;
  let bytes = new Uint8Array(await file.arrayBuffer()), name = file.name;
  try {
    if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
      const entries = readZip(bytes);
      const pick = ['srm', 'sra', 'fla', 'eep', 'mpk', 'state'].map((x) => entries.find((e) => e.name.toLowerCase().endsWith('.' + x))).find(Boolean);
      if (!pick) throw new Error('aucune sauvegarde reconnue dans le .zip');
      bytes = await pick.read(); name = pick.name.split('/').pop();
      log('ZIP : ' + name + ' extrait (' + bytes.length.toLocaleString('fr-FR') + ' octets)');
    }
    if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = await gunzip(bytes);
  } catch (e) { showPending(null, 'Import impossible : ' + e.message + '.'); return; }
  const ext = (name.split('.').pop() || '').toLowerCase(), n = bytes.length;
  let kind = null;
  if (ext === 'srm' || n === SRM.size) kind = 'srm';
  else if (ext === 'state' || /^st\d?$/.test(ext) || n > 1048576) kind = 'state';
  else if (ext === 'mpk' || ext === 'pak') kind = 'mpk';
  else if (ext === 'eep' || n === 512 || n === 2048) kind = 'eeprom';
  else if (ext === 'fla' || n === 0x20000) kind = 'flash';
  else if (ext === 'sra' || n === 0x8000) kind = 'sram';
  if (!kind) { showPending(null, 'Format non reconnu (' + name + ', ' + n.toLocaleString('fr-FR') + ' octets).'); return; }
  const p = { kind, bytes, name, order: 'be', why: '' };
  if (kind === 'sram' || kind === 'flash') Object.assign(p, detectOrder(bytes));
  pendingSave = p;
  log('Sauvegarde analysée : ' + name + ' → ' + KIND[kind] + (p.why ? ' · ' + p.why : ''));
  showPending(p);
}
function showPending(p, error) {
  const box = $('#pending');
  box.hidden = false;
  box.textContent = '';
  const para = document.createElement('p');
  if (!p) { para.className = 'err'; para.style.margin = '0'; para.textContent = error; box.append(para); return; }
  para.textContent = p.name + ' — ' + KIND[p.kind] + ' (' + p.bytes.length.toLocaleString('fr-FR') + ' octets).';
  box.append(para);
  const row = document.createElement('div'); row.className = 'row';
  if (p.kind === 'sram' || p.kind === 'flash') {
    const why = document.createElement('p'); why.textContent = 'Ordre des octets : ' + p.why + '.'; box.insertBefore(why, null);
    const lab = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.order === 'le';
    cb.addEventListener('change', () => { p.order = cb.checked ? 'le' : 'be'; });
    lab.append(cb, document.createTextNode('Fichier issu de Project64 / mupen64plus (mots inversés)'));
    box.append(lab);
  }
  const mk = (label, fn, primary) => { const b = document.createElement('button'); b.className = 'btn sm' + (primary ? ' primary' : ''); b.textContent = label; b.addEventListener('click', fn); row.append(b); return b; };
  if (p.kind === 'state') {
    const note = document.createElement('p'); note.textContent = 'Ranger cet état dans l\'emplacement' + (running ? ' (il sera chargé aussitôt)' : '') + ' :'; box.append(note);
    [1, 2, 3].forEach((n) => mk(String(n), () => importState(p, n), n === 1));
  } else if (running) {
    mk('Importer et redémarrer', () => applyPendingSave(), true);
  } else {
    const note = document.createElement('p'); note.textContent = 'Elle sera appliquée automatiquement à l\'allumage.'; box.append(note);
  }
  mk('Annuler', () => { pendingSave = null; box.hidden = true; });
  box.append(row);
}
async function currentSrm() {
  const g = gm();
  const cur = g.getSaveFile(true);
  return cur && cur.length === SRM.size ? cur.slice() : new Uint8Array(SRM.size).fill(0xFF);
}
async function writeSrm(out, reason) {
  const g = gm(), path = g.getSaveFilePath();
  g.FS.writeFile(path, out);
  g.loadSaveFiles();
  await syncfs();
  g.restart();
  log(reason + ' → ' + path + ', console redémarrée pour relire la mémoire.', 'k');
}
async function applyPendingSave() {
  const p = pendingSave;
  if (!p || p.kind === 'state' || !running) return;
  const cur = await currentSrm();
  await idb.set('srmbak:' + rom.sha1, { t: Date.now(), data: cur.slice() });
  const out = cur.slice();
  const put = ([off, len], src) => out.set(src.subarray(0, Math.min(len, src.length)), off);
  if (p.kind === 'srm') out.set(p.bytes.subarray(0, SRM.size));
  else if (p.kind === 'sram' || p.kind === 'flash') put(SRM[p.kind], p.order === 'be' ? swap32(p.bytes.slice()) : p.bytes);
  else put(SRM[p.kind], p.bytes);
  await writeSrm(out, 'Import ' + KIND[p.kind] + ' (' + p.name + ')');
  toast('Sauvegarde importée');
  pendingSave = null; $('#pending').hidden = true; $('#sv-undo').hidden = false;
  refreshSaveInfo();
}
$('#sv-undo').addEventListener('click', async () => {
  const b = await idb.get('srmbak:' + rom.sha1);
  if (!b || !running) return;
  await writeSrm(b.data, 'Import annulé, sauvegarde précédente restaurée');
  await idb.del('srmbak:' + rom.sha1);
  $('#sv-undo').hidden = true; toast('Import annulé'); refreshSaveInfo();
});
$('#sv-import').addEventListener('click', () => $('#file-save').click());
function refreshSaveInfo(force = true) {
  const g = gm();
  if (!g) return;
  try {
    const s = g.getSaveFile(force);
    const used = ['sram', 'flash', 'eeprom'].filter((k) => s && regionUsed(s, SRM[k]));
    set('#sv-type', used.length ? used.map((k) => KIND[k]).join(', ') : 'Aucune donnée écrite pour l\'instant');
    set('#sv-time', new Date().toLocaleTimeString('fr-FR'));
  } catch (e) { set('#sv-type', 'Lecture impossible'); }
  idb.get('srmbak:' + (rom && rom.sha1)).then((b) => { $('#sv-undo').hidden = !b; });
}
$('#sv-export').addEventListener('click', async () => {
  const g = gm();
  if (!g) return;
  const srm = await currentSrm();
  const files = [{ name: rom.base + '.srm', data: srm }];
  const used = ['sram', 'flash', 'eeprom'].filter((k) => regionUsed(srm, SRM[k]));
  for (const k of used) {
    const [off, len] = SRM[k];
    let raw = srm.slice(off, off + len);
    if (k !== 'eeprom') swap32(raw);
    else if (!regionUsed(srm, [0x200, 0x600])) raw = raw.slice(0, 0x200);
    files.push({ name: rom.base + '.' + RAW_EXT[k], data: raw });
  }
  const readme = 'Sauvegarde exportée depuis eden64 le ' + stamp() + '\r\n' +
    'Cartouche : ' + rom.name + ' (SHA-1 ' + rom.sha1 + ')\r\n\r\n' +
    rom.base + '.srm : format libretro (RetroArch, EmulatorJS), à réimporter tel quel.\r\n' +
    used.map((k) => rom.base + '.' + RAW_EXT[k] + ' : ' + KIND[k] + ' brute, ordre cartouche (big-endian).').join('\r\n') + '\r\n' +
    'Project64 attend les mots de 32 bits inversés : utilise le .srm ou un convertisseur pour lui.\r\n';
  files.push({ name: 'LISEZMOI.txt', data: new TextEncoder().encode(readme) });
  const zip = await makeZip(files);
  log('Export : ' + files.map((f) => f.name).join(', '));
  offerFile(safeName(rom.name) + ' - sauvegarde ' + stamp() + '.zip', zip);
  refreshSaveInfo();
});

/* ================= Transfer Pak : cartouche Game Boy + sauvegarde (.sav) ================= */
/* Le core cherche « /<ROM N64>.gb » et « /<ROM N64>.sav » à côté de la ROM (libretro.c) : on les injecte
   dans son système de fichiers avant le démarrage, puis on resynchronise la sauvegarde que le core réécrit. */
const GB_TYPES = { 0x00: 'ROM seule', 0x01: 'MBC1', 0x02: 'MBC1 + RAM', 0x03: 'MBC1 + RAM + pile', 0x05: 'MBC2', 0x06: 'MBC2 + pile', 0x0F: 'MBC3 + horloge + pile', 0x10: 'MBC3 + horloge + RAM + pile', 0x11: 'MBC3', 0x12: 'MBC3 + RAM', 0x13: 'MBC3 + RAM + pile', 0x19: 'MBC5', 0x1A: 'MBC5 + RAM', 0x1B: 'MBC5 + RAM + pile', 0x1C: 'MBC5 + vibreur', 0x1D: 'MBC5 + vibreur + RAM', 0x1E: 'MBC5 + vibreur + RAM + pile', 0xFC: 'Pocket Camera' };
const gbRam = (h) => (h[0x147] === 0x05 || h[0x147] === 0x06 ? 512 : ({ 0: 0, 1: 0x800, 2: 0x2000, 3: 0x8000, 4: 0x20000, 5: 0x10000 })[h[0x149]] || 0);
function parseGb(u8) {
  if (u8.length < 0x8000 || u8[0x104] !== 0xCE || u8[0x105] !== 0xED) return null;
  const cgb = (u8[0x143] & 0x80) !== 0;
  const raw = Array.from(u8.subarray(0x134, cgb ? 0x13F : 0x144), (b) => (b >= 0x20 && b < 0x7f ? String.fromCharCode(b) : ' ')).join('').replace(/_/g, ' ').trim();
  return { title: raw ? titleCase(raw) : 'Cartouche Game Boy', type: GB_TYPES[u8[0x147]] || 'type 0x' + u8[0x147].toString(16), known: u8[0x147] in GB_TYPES, ram: gbRam(u8), cgb };
}
const isGbName = (n) => /\.(gb|gbc)$/i.test(n);
/* Jeux compatibles Transfer Pak : CRC1 d'en-tête relevés dans la base mupen64plus.ini embarquée dans le core
   (Transferpak=Yes, 83 dumps), plus les codes produit des versions courantes en filet de sécurité.
   Les autres jeux gardent le Controller Pak (carte mémoire) sur la manette 1. */
const TPAK_CRC = new Set(["03571182","058381EF","0AC244D1","1649D810","170D4973","1A122D43","1D82BE21","24081000","26647A17","26CD0F54","272B690F","2952369C","37B52113","38112EC7","3A3EB7FB","3A3FA519","3A6C42B5","3C084040","3FC42B3E","41F2B98F","42011E1B","4264DF23","438E6026","439B7E7E","49D83BB9","4B4672B9","4C115008","4CBC3B56","5001CF4F","58FBD28F","5B9A9618","5B9B1618","62E957D0","63775886","65264217","664BA3D4","665E8259","68D128AE","734F816B","73C0403D","76AF28D8","7E3D8157","7F564549","839F3AD5","84077275","84CDFB72","84EBE70F","90F5D9B3","91691C3D","91C9E05D","96747EB4","9ADD5DE5","9C8FB2FA","9DFE20E9","A19FA3D0","A23553A3","A53FA82D","AC5AA5C7","AF981AB7","B6E549CE","B75E20B7","B771E0A9","BC47A8BF","C5F1DE79","D0A1FC5B","D48944D1","D7F73553","D83BB920","DD16F47C","DDF460CC","DED0DD9A","E4B08007","E8761702","E8B3F63D","EE4FD7C2","EFCEAF00","F4646B69","F468118C","F9864452","FA8C4571","FB453D58","FDF95D15","FE667A12"]);
const TPAK_CODE = new Set(['NPO', 'NP3', 'NMF', 'NM8', 'NPD']);
const usesTpak = (r) => !!r && (TPAK_CRC.has(r.crc1) || TPAK_CODE.has(r.code));
const GB_HINT = 'Pour Pokémon Stadium, Mario Golf, Mario Tennis… La cartouche Game Boy et sa sauvegarde sont lues comme avec le vrai accessoire.';
let gbActive = false, gbSyncTimer = null, gbLastCrc = null;
if (typeof prefs.tpak !== 'boolean') prefs.tpak = true;
$('#tpak-on').checked = prefs.tpak;
$('#tpak-on').addEventListener('change', () => { prefs.tpak = $('#tpak-on').checked; savePrefs(); renderGb(); if (running) toast('Pris en compte au prochain allumage'); });

async function insertGb(file) {
  let buf = new Uint8Array(await file.arrayBuffer()), name = file.name;
  try {
    if (buf[0] === 0x50 && buf[1] === 0x4B) {
      const e = readZip(buf).find((x) => isGbName(x.name));
      if (!e) throw new Error('aucune ROM .gb / .gbc dans l\'archive');
      buf = await e.read(); name = e.name.split('/').pop();
    }
  } catch (e) { toast('Archive : ' + e.message); return false; }
  const H = parseGb(buf);
  if (!H) { toast('Ce fichier n\'est pas une cartouche Game Boy'); log('Rejeté : en-tête Game Boy invalide (' + name + ')', 'e'); return false; }
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-1', buf)), (x) => x.toString(16).padStart(2, '0')).join('');
  await idb.set('gb:' + sha, { sha1: sha, name, title: H.title, type: H.type, ram: H.ram, cgb: H.cgb, blob: new Blob([buf]), t: Date.now() });
  prefs.gb = sha; prefs.tpak = true; $('#tpak-on').checked = true; savePrefs();
  log('Transfer Pak : cartouche « ' + H.title + ' » (' + H.type + ', ' + (H.ram ? (H.ram / 1024) + ' Ko de RAM' : 'sans RAM') + ')' + (H.known ? '' : ' : type non reconnu par le Transfer Pak émulé'), H.known ? 'k' : 'w');
  toast(running ? 'Cartouche Game Boy prête : elle sera branchée au prochain allumage' : 'Cartouche Game Boy insérée dans le Transfer Pak');
  renderGb();
  return true;
}
function fitSave(u8, size) {
  if (!size || u8.length === size) return u8;
  const out = new Uint8Array(size).fill(0xFF);
  out.set(u8.subarray(0, Math.min(size, u8.length)));
  return out;
}
async function importGbSave(file) {
  if (!prefs.gb) { toast('Insère d\'abord la cartouche Game Boy'); return; }
  const rec = await idb.get('gb:' + prefs.gb);
  if (!rec) return;
  let bytes = new Uint8Array(await file.arrayBuffer()), name = file.name;
  if (bytes[0] === 0x50 && bytes[1] === 0x4B) {
    const e = readZip(bytes).find((x) => /\.(sav|srm)$/i.test(x.name));
    if (!e) { toast('Aucun .sav dans l\'archive'); return; }
    bytes = await e.read(); name = e.name.split('/').pop();
  }
  if (!rec.ram) { toast('Cette cartouche n\'a pas de mémoire de sauvegarde'); return; }
  const fitted = fitSave(bytes, rec.ram);
  const note = bytes.length > rec.ram ? ' (' + (bytes.length - rec.ram) + ' octets d\'horloge ignorés)' : bytes.length < rec.ram ? ' (complétée à ' + rec.ram + ' octets)' : '';
  const old = await idb.get('gbsav:' + prefs.gb);
  if (old) await idb.set('gbsavbak:' + prefs.gb, old);
  await idb.set('gbsav:' + prefs.gb, { t: Date.now(), data: fitted });
  log('Sauvegarde Game Boy importée pour « ' + rec.title + ' » : ' + name + note, 'k');
  renderGb();
  if (running && gbActive) {
    toast('Redémarrage pour relire la cartouche Game Boy', 2500);
    await sleep(600);
    restartWithResume('gb', { noState: true });
  } else toast('Sauvegarde Game Boy prête');
}
async function readGbSaveLive() {
  const e2 = em(), g = gm();
  if (!e2 || !g || !gbActive) return null;
  const path = '/' + e2.fileName + '.sav';
  try { return g.FS.analyzePath(path).exists ? g.FS.readFile(path) : null; } catch (e) { return null; }
}
async function syncGbSave(reason) {
  const data = await readGbSaveLive();
  if (!data || !prefs.gb) return;
  const c = crc32(data);
  if (c === gbLastCrc) return;
  gbLastCrc = c;
  await idb.set('gbsav:' + prefs.gb, { t: Date.now(), data: data.slice() });
  if (reason !== 'init') log('Sauvegarde Game Boy synchronisée (' + data.length + ' octets)' + (reason ? ', ' + reason : ''));
  renderGb();
}
async function exportGbSave() {
  if (!prefs.gb) return;
  const rec = await idb.get('gb:' + prefs.gb);
  await syncGbSave('export');
  const sav = await idb.get('gbsav:' + prefs.gb);
  if (!sav) { toast('Pas encore de sauvegarde pour cette cartouche'); return; }
  const base = safeName(rec.title);
  const files = [{ name: base + '.sav', data: sav.data }, { name: 'LISEZMOI.txt', data: new TextEncoder().encode('Sauvegarde Game Boy de « ' + rec.title + ' » (' + rec.type + '), exportée depuis le Transfer Pak de eden64 le ' + stamp() + '.\r\nFormat : mémoire de la cartouche brute (' + sav.data.length + ' octets), lisible par mGBA, BGB, SameBoy, RetroArch et les linkers de cartouches.\r\n') }];
  offerFile(base + ' - sauvegarde Game Boy ' + stamp() + '.zip', await makeZip(files));
}
async function renderGb() {
  const box = $('#gb-list');
  box.textContent = '';
  const keys = await idb.keys('gb:');
  $('#gb-actions').hidden = !prefs.gb || !keys.includes('gb:' + prefs.gb);
  $('#gb-hint').textContent = currentEngine() === 'parallel' ? 'Le Transfer Pak demande le moteur complet (onglet Image › Performance › Moteur N64).' : rom && usesTpak(rom)
    ? '« ' + rom.title + ' » utilise le Transfer Pak : ' + (keys.length ? 'la cartouche Game Boy sera branchée à l\'allumage.' : 'insère ta cartouche Game Boy (.gb / .gbc) et sa sauvegarde .sav.')
    : GB_HINT;
  for (const k of keys) {
    const r = await idb.get(k); if (!r) continue;
    const sav = await idb.get('gbsav:' + r.sha1);
    const row = document.createElement('div'); row.className = 'cart gb'; row.tabIndex = 0; row.setAttribute('role', 'button');
    const cur = r.sha1 === prefs.gb;
    row.setAttribute('aria-current', String(cur));
    const art = document.createElement('span'); art.className = 'art gbart'; art.setAttribute('style', artStyle(r.title, ''));
    const txt = document.createElement('span');
    const b = document.createElement('b'); b.textContent = r.title;
    const sm = document.createElement('small'); sm.textContent = sav ? 'Sauvegarde ' + ago(sav.t) : (r.ram ? 'Sans sauvegarde' : 'Sans mémoire');
    row.title = r.title + ' : ' + r.type + (r.ram ? ', ' + (r.ram / 1024) + ' Ko de RAM' : '') + (r.cgb ? ', Game Boy Color' : '');
    txt.append(b, sm);
    const tag = document.createElement('span'); tag.className = 'tag' + (cur && prefs.tpak ? ' on' : '');
    tag.textContent = cur ? (prefs.tpak ? (gbActive ? 'En jeu' : 'Insérée') : 'Débranché') : 'Choisir';
    row.append(art, txt, tag);
    const x = document.createElement('button'); x.className = 'forget'; x.textContent = 'Retirer'; x.title = 'Retirer cette cartouche Game Boy et sa sauvegarde de ce navigateur';
    x.addEventListener('click', async (e) => { e.stopPropagation(); await idb.del(k); await idb.del('gbsav:' + r.sha1); if (prefs.gb === r.sha1) { prefs.gb = null; savePrefs(); } log('Cartouche Game Boy « ' + r.title + ' » retirée de ce navigateur.'); renderGb(); });
    row.append(x);
    const pick = () => { if (prefs.gb === r.sha1) return; prefs.gb = r.sha1; prefs.tpak = true; $('#tpak-on').checked = true; savePrefs(); renderGb(); toast(running ? 'Prise en compte au prochain allumage' : '« ' + r.title + ' » dans le Transfer Pak'); };
    row.addEventListener('click', pick);
    row.addEventListener('keydown', (e) => { if (e.key === 'Enter') pick(); });
    box.append(row);
  }
}
/* Accessoire de la manette 1, choisi automatiquement d'après la base mupen64plus.ini du core
   (Rumble=Yes : 1076 dumps, Mempak=Yes : 920 dumps, indexés par CRC1 d'en-tête) */
const PAKDB = { rumble: new Set('001A3BD0,00A46EE3,00BC1D78,00EDCC34,018CF733,01D66F37,02D8366A,033F4C13,036A20D8,0414CA61,045C08C4,04DAF07F,053C89A7,0549765A,0553AE9D,0578F24F,05BCD54E,0684FBFB,06F6B180,076C5C15,07861842,079501B9,07A69D01,07C1866E,07F3B276,08123595,0866BEDD,0894909C,08FFA4B7,09035DC5,09465AC3,096A40EA,098D46A2,09A0A6E5,09AE57B1,09D4D757,09D53E16,0A1667C7,0A5D8F83,0AA0055B,0B0AB4CD,0B46D03D,0B58B8CD,0B6B4DDB,0BBCDFCF,0BD8008B,0BFC12D9,0C02B3C5,0C41F9C2,0C5057AD,0C581C7A,0C5EE085,0CAD17E6,0CB81686,0CEBC4C7,0D93BA11,0DD4ABAB,0DE2CE36,0E596247,0EC158F5,0F1FA987,0F5FD10B,0F743195,1001F10C,102888BF,1180A247,1185EC85,11936D8C,11FBD007,12737DA5,132D2732,136EBEE3,13836389,138D7E56,1416FEBB,142A17AA,147E0EDB,14DE709E,150DDE31,151F79F4,155B7CDF,15A00969,161545FE,165CBDA2,166312CB,16931D74,16EDC447,1739EFBA,17679054,17C54A61,18439105,1917566C,192C1422,192C15DA,1938525C,19AB29AF,1A4D3AD8,1A7F70B5,1B598BF1,1B5AAD82,1B80E202,1C348AFE,1C37BF54,1C6F7718,1C952873,1CD50DF2,1D4136F3,1D82BE21,1E0E96E8,1E12883D,1E17A377,1E4C4743,1EA26214,1F95CAAA,1FA056E0,1FB5D932,1FBAF161,1FDFCBDC,20073BC7,20095B34,202A8EE4,204489C1,204EC022,20B53662,2138A076,214CAD94,21910973,219191C1,21CD632F,21F7ABFB,21FF0391,21FFFD0A,22212351,2256ECDA,22AD2E8E,22CA2C52,22E9623F,22F301B6,2337D8E8,23749578,237E73B4,2388984C,23E39896,24081000,2483F22B,24F7EB57,2500267E,254CF663,255018DF,259F7F84,26035CF8,26211297,2655BB70,26647A17,26809B20,26CD0F54,275A4533,27A3831D,27C425D0,2816D957,2829657E,2857674D,28705FA5,28768D6D,2877AC2D,28784622,287D601E,28D5562D,2954A98F,29A045CE,29A9E7F6,29CE7692,2A49018D,2A6B1820,2A721F06,2A980400,2AD07230,2AF9B65C,2B38AEC0,2B4F4EFB,2B696CB4,2C3E19BD,2CBB127F,2CEEE754,2DCFCA60,2E0E7749,2E359339,2E955ECD,2EF4D519,2F493DD0,2FE62885,2FEB152B,305AB328,308BC746,308DFEC8,30B6A6AB,30C7AC50,30EAD54F,31100ADC,312E2FC5,31739C69,319093EC,31E33A96,32CA974B,32EFC7CB,33487563,336364A0,337F24EE,33828616,33A275A4,33BE8CD6,33E61153,3409CEB6,34AEB154,356130AD,35D9BA0C,35E811F3,35F51C8E,35F53383,35FF8F1A,361E1288,36281F23,364C4ADC,369B314B,36ACBA9B,36F1C74B,36FA35EB,373F5889,37FA8F16,38112EC7,38442634,3918834A,3925D625,392A0C42,395E91DF,396F5ADD,3983D1A9,399B9B81,39CE39C1,3A03E50F,3A180FF4,3A3FA519,3A4760B5,3A6C42B5,3A6F8C6B,3B941695,3BA7CDDC,3C059038,3C2AC7FA,3C2B07FC,3CC77150,3CECBCB8,3D02989B,3D6044AB,3D615CF5,3DBD5E85,3E198D9E,3E6250B2,3EDC7E12,3F16568F,3F245305,3F4AFB7B,3F66A9D9,3F84EB47,412E02B8,41380792,417DD4F4,417DD7F4,4191BA80,41B25DC4,41D44009,41F2B98F,4222D89F,422D29E1,4252A5AD,42CF5EA3,42EDB4BB,44127A31,441768D0,4446FDD6,44C54A0B,451ACA0F,457B9CD9,45C59BC3,46039FB4,46A3F7AF,46C6F185,470112E9,47F09853,48176863,485256FF,486BF335,4875AF3D,489C84E6,49088A11,4998DDBB,49D83BB9,49E46C2D,4A997C74,4AAAF6ED,4B4672B9,4B629EF4,4C261323,4C2B343C,4C52BBB2,4D0224A5,4D3ADFDA,4D3E622E,4D79D316,4DB05DC4,4E17004A,4E30BD3A,4E4B0640,4ECEB1DE,4F29474F,4F8AA5EC,4F8AFC3A,4F8B1784,4FAFC64B,5001CF4F,514B6900,5168D520,519EA4E1,51D29418,522409D3,5242DFBC,529AA985,52A3CF47,52F78805,5326696F,5354631C,53575A75,535DF3E2,53CCAD28,53D440E7,53D93EA2,53ED2DC4,540F359D,54310E7D,5446C6EF,544E3629,5573C64D,559A0FD3,55D4C4CE,5638C715,568E02F5,56E06922,57AF893E,57BFF74D,57CD5D6D,57F81C9B,580162EC,581900E5,58886DD0,588F980C,58B5EA62,58FD3F25,591A806E,593BD58B,59445C71,596E145B,5972E751,59F34558,5A98A468,5AEB33A3,5B6AC01B,5B755842,5B904BAE,5B9A9618,5B9B1618,5BC51145,5BF45B7B,5C4EB1C9,5CD4150B,5D0283F5,5D6AA6EA,5DDB495C,5DFC4249,5E0C3DF7,5E23985B,5E547A4D,5E6508BB,5EDE011C,5EF44642,5F25B0EE,5F3F49C6,5F6A04E2,5F6DDEA2,5FD7CDA0,60006C98,60460680,60C437E5,616B8494,6192E59D,61D116B0,61F5B152,62269B3D,625E0850,62E957D0,62F6BE95,6309FC17,630AA37D,63112A53,635CB5C6,636E6B19,63CCD041,63E7391C,641D3A7F,6420535A,6440D7CE,64BF47C4,651F2792,65264217,655BE931,658F8F37,65AEDEEF,65DB63E3,65EEE53A,664BA3D4,66572080,66A24A12,66A24BEC,66CF0FFE,66E4FA0F,6712C779,673D099B,67C38660,67D20729,67D239A0,67FF12CC,68CE63CC,68D128AE,68D7A1DE,68E8A875,68FCF726,693BA2AE,69458B9E,696F2896,6976748D,698FE5E8,69AE0438,6A121930,6A162FF2,6AA4DDE7,6AECEC4F,6BB11645,6C45B60C,6C80F13B,6CED60AC,6D8DF08E,6DF2CB25,6DFDCDC3,6EDA5178,6F48FF84,6F66B92D,700694EA,700F6DD9,705AC38A,70666F63,70B0260E,70BF6C4C,7188F445,71BE60B9,720278EC,72611D7D,72618906,72836ECB,729B5E32,72F70398,73036F3B,730D25F4,733FCCB1,734F816B,736AE6AF,73A88E3D,7433D9D7,7435C9BB,74BCA5D3,74E87A70,752E1BF8,75A4E247,75B61647,75BC6AD6,75CAA990,75CF4CCD,75FBDE20,768AD2AA,769147F3,76A8C9F4,76F8FB3,776646F6,782A9075,787AECF1,7A6081FC,7AADA8DD,7B016055,7BB5698F,7C3829D9,7CD08B12,7D5772F8,7EAE2488,7ECBE939,7EE0E8BB,7EE0E945,7F304099,7F3CEB77,7F43E701,7F9345D3,7FCBF1D2,8066D58A,80A2BBB5,80C1C05C,80C8564A,810CED2D,812289D0,822E0915,82342320,82380387,8264014A,827E4890,82DC04FD,82EFDC30,832C168B,834304AE,834C19FF,835B97A2,839F3AD5,83E7E0D2,83F3931E,845B0269,8473D0C1,84CDFB72,84D44448,84D5FD75,84EAB557,84F5C897,84F5CF63,84FC04FF,85443325,8547FED3,85AE781A,85C18B16,85C52CA4,85DB4944,85F5A08A,861C3519,862C0657,8632071E,8637BEAA,8637C692,8638A334,86EDC3C1,874621CB,874733A4,88047F1D,88BD5A9E,88C79381,88EC3675,88FFAB7D,89529B12,8952E61E,8954584D,8954A655,8979169C,89A498AE,89A579F1,8A2E80DC,8A6009B6,8A97A197,8AFB2D9A,8B2FCAD3,8B31F4AD,8B79DBFD,8BC3A47A,8BD4A334,8BDBAF68,8BDDD635,8BEE2831,8C138BE0,8C38E5DB,8C47CE8B,8CDB94C2,8CF1CECB,8D1780B6,8D412933,8D6F5219,8DF95B18,8E1B3303,8E835437,8E9D834E,8ECC02F0,8F00E51E,8F12C096,8F3151C8,8F50B845,90111D7E,90A59003,916852D8,91691C3D,916B8B5B,917D18F6,917D1B16,918E2D60,91B66D42,92072A84,9207357A,93053075,930C29EA,931AEF3F,93945F48,93A292F1,93A625B9,93C5ED78,93EB3F7E,94123517,944FAFC4,94593D97,94807E6B,94FEDD3F,9510D8D7,95286EB4,9624C4F9,964ADD0B,96747EB4,96816CCD,96961E83,988C4CC3,99150E18,99179359,993CC742,9A490D9D,9A75C9C2,9ABC592A,9ADD5DE5,9B500E8E,9BA3E5CC,9BF2A817,9C660FA0,9C663069,9C7318D2,9C961069,9CB1BBB0,9CE02E22,9D2B9C7F,9D7E3C4B,9E330C01,9EA95858,9F5BF79C,9F8926A5,9F8B96C3,9FC385E5,9FD0987D,9FD375F8,9FD881BC,A08D0F77,A0976BE9,A150743E,A197CB52,A19F8089,A19FA3D0,A1B64A61,A1BFF9C9,A1CC026F,A1E78A63,A24F4CF1,A273AB56,A292524F,A2E8F35B,A3271D83,A39C0306,A4BF9306,A4C8852A,A4F2F521,A5533106,A60ED171,A6421764,A6A99491,A6B6B413,A6FD0808,A7507855,A7941528,A7D015F8,A8275140,A92D52E5,A92E0966,A986ECC1,A9895CD9,A9A17EF3,AA18B1A5,AA1D215A,AA7B0658,AA89A18D,AA94493C,AAD95AFC,AAE11F01,AB7C101D,ABA51D09,ABB57137,AC000A2B,AC062778,AC16400E,AC16460E,AC976B38,AC9F7DA7,ACBF6069,ACDCA0C6,ACDE962F,ADA815BE,ADB9498B,ADCDEC69,ADDD6241,AE4992C9,AE5B9465,AE5E467C,AE90DBEB,AEBCDD54,AEEF2F45,AF13E2C2,AF3E4E2D,AF5F3773,AF61F386,AF754F7B,AF8679B6,AF9DCC15,AFDCF850,AFF44E2D,B0105C85,B0119B37,B044B569,B088FBB4,B0AC4321,B0B4EDFF,B19AD999,B1C7794B,B1CF1114,B2055FBD,B20CC247,B20F73B6,B210DF19,B2242748,B24303F4,B244B30C,B3054F9F,B30ED978,B31A9FBB,B3CD11F6,B443EB08,B44CAB74,B5025BAD,B58988E9,B6223A7B,B6306E99,B63200D4,B66E0F7C,B6835E54,B6951A94,B6A90FB4,B6BC0FB0,B6BE20A5,B6D0CAA0,B6DB2595,B703EB23,B70BAEE5,B722133E,B73AB6F6,B754A584,B771E0A9,B7CF2136,B8B73263,B8F0BD03,B9233DC7,B9A9ECA2,B9AF8CC6,B9CDC5C3,BA780BA0,BAE8E871,BB30B1A5,BB53C809,BBC99D32,BBFDEC37,BC47A8BF,BC4F2AB8,BC875B60,BC9B2CC3,BCB1F89F,BCC83145,BCEAF9B7,BCFACCAA,BD13F636,BD58346E,BD8E0304,BDA8F143,BDF9766D,BE37CDC8,BE5973E0,BE76EDFF,BEADC61C,BEBAB677,BF4317E2,BF5D6D65,BFE23884,C006E3C0,C0DE0747,C0F6DB17,C1373DC8,C1452553,C151AD61,C1D702BD,C2751D1A,C27F7CEC,C29FF9E4,C2E9AA9A,C3193C16,C34304AC,C3CA0BA3,C3CD76FF,C3E7E29E,C43E23A7,C49ADCA2,C52E0BC6,C535091F,C5674160,C5F020F3,C5F1DE79,C63B1ADA,C6C71B88,C6E39C0A,C71353BE,C7501968,C76B18F6,C7C3086D,C7C98F8E,C7F30CFA,C8DC65EB,C8FEF05D,C9176D39,CA1BB86F,CA2A7444,CB93DB97,CBD83828,CBF72BBD,CBFE69C7,CC3CC8B3,CCDEAF02,CCE336FE,CCEB3858,CD094235,CD538CE4,CD5BEC0F,CD7559AC,CDB8B4D0,CDB998BE,CDCCFF87,CDDB4BDF,CE84793D,CED986FD,CF138879,CF84F45F,CF8EC901,CFEF2CD6,D0151AB0,D03F0CCB,D094B170,D09BA538,D124DBB7,D137A2CA,D1A78A07,D1F7D8AB,D21AF769,D250103E,D25C1211,D2BE2F14,D3D806FC,D3DF2FEE,D3F10E5D,D3F52BA5,D3F97D49,D43DA81F,D48944D1,D4C45A1A,D4DD9982,D51CF20D,D5295672,D543BCD6,D571C883,D5898CAF,D5B2339C,D5BDCD1D,D614E5BF,D666593B,D692CC5E,D6FBA4A8,D7134F8D,D741CD80,D76333AC,D7C762B6,D8059804,D81963C7,D83BB920,D84C17CA,D852E238,D85C4E29,D89261A9,D8928E46,D89BE2F8,D8C74049,D9042FBB,D9EDD54D,DA233397,DA573DB9,DAA6CA7D,DB6E353B,DB7184C9,DB833E34,DBF4EA9D,DC36626A,DC41E81E,DCBC50D1,DCCEDB8F,DD10BC7E,DD26FDA1,DD318CE2,DDD93C85,DDD982EF,DDEF1333,DDF460CC,DE4E5E2E,DEB78BBA,DED0DD9A,DEE584A2,DEE596AB,DF09D625,DF0C666A,DF331A18,DF98B95D,DFD8AB47,DFE61153,DFF227D9,E0144180,E09DAF6C,E0B92B94,E1EF93F7,E2A32049,E2BC82A2,E328B4FA,E36166C2,E378B28A,E3AB4ED0,E3CCFE36,E3D6A795,E402430D,E436467A,E48E01F5,E4906679,E4B08007,E5B7F405,E606EE26,E616B5BC,E655B42D,E688A5B8,E6896018,E68A9F6E,E6B339F6,E6FCB468,E73C7C4F,E7428718,E7D20193,E820670A,E8522F04,E857ED95,E86415A6,E8761702,E896092B,E8B3F63D,E8C95AFC,E8DBC96A,E8FC8EA1,E9219533,E97955C6,E9C8E262,EA06F8C3,EA090572,EA630EC7,EA6D4C3F,EA71056A,EAB7B429,EAC07419,EAE6ACE2,EB38F792,EB499C8F,EB7709E2,EBA949DC,EBEEA8DB,EBF5F6B7,EBFE2397,EC417312,EC58EABF,EC6F66AC,EC7011B7,EC986EA9,ED567D0F,ED98957E,EDD6E031,EDF419A8,EDFB6B01,EE4A0E33,EE7AF9EC,EE802DC4,EEE48FAF,EEF7DE23,EFDF9140,F00F2D4E,F034001A,F04A729C,F050746C,F050D644,F0C5F320,F1301043,F163A242,F1850C35,F23CA406,F255D6F1,F389A35A,F3996B67,F3DD35BA,F3F2F385,F43B45BA,F4520439,F478D8B3,F4CBE92C,F5360FBE,F5363349,F5C21403,F5C5866D,F611F4BA,F63B89CE,F6621BFB,F667DC04,F6E3494A,F7F52DB8,F8009DB0,F82DD377,F8B1C7C7,F921961E,F96E28F7,F9864452,F9D411E3,FA8C4571,FB3C48D0,FB453D58,FB610592,FB816989,FB816D35,FBB9F1FA,FC70E272,FC7797BF,FCB2955B,FCBCCB21,FCE0D799,FD0E716E,FD2FC875,FD73F775,FD8F6875,FDA245D2,FDF95D15,FDFC3328,FE05840B,FE4B6B43,FE5DC5D4,FE94E570,FEB72E1D,FEE97010,FEF9D364,FF14C1DA,FF44EDC4,FFCAA7C1'.split(',')), mempak: new Set('001A3BD0,00EDCC34,015BB81E,018CF733,0198A651,01D66F37,0290AEB9,02B46F55,02D8366A,0304C48E,033F4C13,036897CE,036CBFE5,045C08C4,04DAF07F,0549765A,0553AE9D,056EAB63,06CB44B7,06F6B180,07861842,07A69D01,07F3B276,08123595,085055B6,0894909C,08FFA4B7,09035DC5,093F916E,096A40EA,098D46A2,09A0A6E5,09AE57B1,09D53E16,0A1667C7,0AC244D1,0AC61D39,0ADAECA7,0AE2B37C,0B28EBA3,0B623F24,0B6B4DDB,0BD8008B,0BFC12D9,0C41F9C2,0C814EC4,0CAD17E6,0CB81686,0CE3D2E6,0DE2CE36,0DED0568,0E31EDF0,0E4B8C92,0E596247,0F1FA987,0F743195,0FC42C70,1001F10C,102888BF,112051D2,1185EC85,11FBD007,123D0F44,12737DA5,132D2732,136EBEE3,13836389,138D7E56,13D0EE29,1416FEBB,142A17AA,146C4366,14DE709E,150DDE31,151F79F4,15A00969,161545FE,1649D810,1671E7BC,1671F4A0,16931D74,170D4973,1739EFBA,18531B7D,1917566C,1938525C,1A4D3AD8,1A7F70B5,1BDCB30F,1C010CCD,1C8CDF74,1C952873,1CC06338,1E12883D,1E17A377,1E22CF2E,1EA26214,1FA056E0,1FB5D932,1FC21532,1FDFCBDC,20073BC7,202A8EE4,204EC022,208A0427,208A0437,20B53662,20FD0BF1,21250314,2138A076,2153143F,21910973,21F7ABFB,21FF0391,2209094B,2209095F,22CA2C52,22E9623F,23749578,237E73B4,2388984C,23E39896,24081000,254CF663,2577C7D4,2655BB70,26809B20,26CD0F54,277B129D,27C425D0,2857674D,28705FA5,28768D6D,2877AC2D,28784622,287D601E,2954A98F,29A045CE,29CE7692,2A49018D,2A6B1820,2A721F06,2A980400,2AD07230,2AF9B65C,2B38AEC0,2BC1FCF2,2BCCF9C4,2C3E19BD,2C739EAC,2CBB127F,2CEEE754,2D03FD5B,2DC4FFCC,2E0E7749,2E955ECD,2EF4D519,2F7009DD,2F700DCD,2F70F10D,2FC5C34C,2FDAA221,2FE62885,308DFEC8,30B6A6AB,30EAD54F,319093EC,31E33A96,322EF540,3261D429,3261D479,32CA974B,32EFC7CB,336364A0,337F24EE,33828616,33A275A4,33BE8CD6,34495BAD,356130AD,35D9BA0C,35E811F3,35F51C8E,35FF8F1A,361E1288,364C4ADC,36ACBA9B,36F1C74B,36FA35EB,37B52113,37FA8F16,38D637C1,3918834A,3925D625,392A0C42,396F5ADD,399B9B81,39CE39C1,39F60C11,3A089BBC,3A180FF4,3A4760B5,3A4B5938,3A595B0E,3B941695,3BCCA16E,3C084040,3C2AC7FA,3C2B07FC,3CC77150,3CECBCB8,3D6044AB,3D615CF5,3D67C62B,3DBD5E85,3DF17480,3E198D9E,3E5055B6,3E6250B2,3EDC7E12,3F462D42,3F47EEA0,3F4AFB7B,3F84EB47,3FEA5620,3FFE80F4,40066883,40CA1EC9,40D5D2DE,412E02B8,41380792,417DD4F4,417DD7F4,41B25DC4,41D44009,41F2B98F,4222D89F,422D29E1,423E96F4,4252A5AD,4264DF23,42EDB4BB,438CEBDC,438E6026,43D67345,440355A4,44127A31,441768D0,4445612B,44995484,44C54A0B,4537BDFF,4578A055,465035CA,4690FB1C,46C6F185,46F3248B,470112E9,4795217F,48176863,486BF335,4875AF3D,489C84E6,49020C8E,49088A11,492F4B61,4998DDBB,49D83BB9,49E46C2D,4B629EF4,4BCDFF47,4C261323,4C2B343C,4C52BBB2,4D9C55B6,4DB05DC4,4E4A7643,4E4B0640,4E69B487,4F1E88F7,4F29474F,4F8AA5EC,4F8AFC3A,4F8B1784,4FAFC64B,4FBFA429,503EA760,5129B6DA,519EA4E1,51D29418,522409D3,529AA985,52A3CF47,52F78805,5306CF45,5318786C,53575A75,535DF3E2,53CCAD28,53D440E7,53D93EA2,54310E7D,5446C6EF,544E3629,54554A42,551C7F43,5535972E,5573C64D,559A0FD3,55D4C4CE,5638C715,568E02F5,569433AD,56E06922,575CCC2E,575F340B,57AF893E,57BFF74D,57F81C9B,580162EC,581900E5,588F980C,591A806E,59445C71,596E145B,5972E751,59F34558,5A160336,5A9D3859,5AEB33A3,5B6AC01B,5B755842,5BC51145,5BF45B7B,5C1B5FBD,5C9191D6,5CD4150B,5D0283F5,5D6AA6EA,5DDB495C,5DFC4249,5E0C3DF7,5E23985B,5E3E60E8,5E547A4D,5EF44642,5F25B0EE,5F2763C4,5F3F49C6,5F48A227,5FD7CDA0,60006C98,60C437E5,60D5E10B,61079876,616B8494,6192E59D,61D116B0,62269B3D,6309FC17,630AA37D,63112A53,63CCD041,641D3A7F,6440D7CE,64B62D16,64F1B7CA,650EFA96,651F2792,65234451,65264217,655BE931,658F8F37,661B45F3,665F09DD,665FC793,665FD963,66751A57,66807E77,66CF0FFE,66E4FA0F,6712C779,673D099B,67D21868,67D239A0,68CE63CC,68FCF726,69458B9E,6976748D,698FE5E8,6A121930,6A162FF2,6AA4DDE7,6B45223F,6BFF4758,6C45B60C,6C80F13B,6CED60AC,6D452016,6D8DF08E,6DF2CB25,6DFDCDC3,6DFF4C37,6EDA5178,6EDD4766,700694EA,700F6DD9,7055FD0A,70B0260E,71BE60B9,71ED5D14,720278EC,72611D7D,72618906,72836ECB,729B5E32,73036F3B,7365D8F8,736657F6,73A88E3D,73ABB1FB,7433D9D7,7435C9BB,74554B3B,74BCA5D3,74E87A70,752E1BF8,75A4E247,75BC6AD6,75FA0E14,75FBDE20,7613A630,769147F3,76F8FB3,7711DBA7,773E3E8E,782A9075,787AECF1,792C3A8E,7AA65B36,7AADA8DD,7BB5698F,7C647C25,7C647E65,7C64E6DB,7CD08B12,7D5772F8,7DE11F53,7EC22587,7ECBE939,7F0FDA09,7F3CEB77,7F43E701,7F9345D3,7FD0761E,80203B94,80C1C05C,80F41131,810729F6,812289D0,82342320,82B3248B,82DC04FD,82EFDC30,832C168B,834304AE,835B97A2,845B0269,84D44448,84D5FD75,84EAB557,84FC04FF,85443325,85670AB4,85AE781A,85C18B16,85C52CA4,85DB4944,85E42D70,861C3519,861F9BDC,862C0657,8632071E,8637BEAA,8637C692,8638A334,874621CB,874733A4,87766747,88BD5A9E,88CF980A,89529B12,8952E61E,8954584D,8954A655,89A498AE,89A579F1,89FED774,8A2E80DC,8A5B9018,8A86F073,8A97A197,8ACE6683,8AFB2D9A,8B79DBFD,8BB6E3EB,8BD4A334,8BDBAF68,8BDDD635,8BEE2831,8C38E5DB,8CC182A6,8CD06379,8CDB94C2,8D1780B6,8D2BAE98,8D412933,8D6F5219,8DF95B18,8E835437,8E9D834E,8ECC02F0,8F00E51E,8F0CC36D,8F12C096,8F3151C8,8F4C4B32,8F50B845,90111D7E,90A59003,90F43037,91644B9F,916AE6B8,918E2D60,91B66D42,926C2E3B,938CA401,93A292F1,93A625B9,94123517,944FAFC4,9510D8D7,9542E183,95854656,95A80114,95B2B30B,96747EB4,96816CCD,96BA4EFB,979B263E,988C4CC3,98F9F2D0,99150E18,99179359,993CC742,9A490D9D,9A75C9C2,9AB3B50A,9ABC592A,9ADD5DE5,9BA10C4E,9BA3E5CC,9C7318D2,9C961069,9CAB6AEA,9CE02E22,9CEED5BA,9D7E3C4B,9E330C01,9E8FCDFA,9E8FE2BA,9F1ECAF0,9F5BF79C,9F8926A5,9FD881BC,9FF69D4F,A0976BE9,A150743E,A197CB52,A19F8089,A1B64A61,A1CC026F,A1E78A63,A273AB56,A292524F,A2C54BE7,A2E8F35B,A4C8852A,A5F667E1,A60ED171,A62230C3,A6421764,A6A99491,A6B6B413,A7507855,A83E101A,A864A921,A896AB1D,A92D52E5,A92E0966,A986ECC1,A9895CD9,A9A17EF3,AA1D215A,AA7B0658,AA89A18D,AA94493C,AAD95AFC,AAE11F01,AB5E61C8,AB7C101D,ABA51D09,ABB57137,AC062778,AC16400E,AC16460E,AC173077,AC8E4B32,AC976B38,AC9F7DA7,ACDCA0C6,ACDE962F,AD19A172,ADB9498B,ADCDEC69,ADDD6241,AE21569D,AE2D3A35,AE4992C9,AE82687A,AE90DBEB,AEBE463E,AEEF2F45,AF19D9F5,AF754F7B,AF8679B6,AF981AB7,AFDCF850,B00903C9,B00E3829,B0119B37,B01A1DAB,B0AC4321,B121ED86,B1CF1114,B1D5280C,B20CC247,B20F73B6,B210DF19,B24303F4,B2C6D27F,B3054F9F,B3402554,B35FEBB0,B3CD11F6,B3D451C6,B44CAB74,B58988E9,B6223A7B,B6524461,B6835E54,B6A90FB4,B6BE20A5,B6C4F400,B6D0CAA0,B6DB2595,B6F68615,B754A584,B75E20B7,B7CF2136,B8B73263,B8C303FA,B8F0BD03,B98BA456,B9A9ECA2,BAE8E871,BB30B1A5,BB53C809,BBC99D32,BC4F2AB8,BC875B60,BCC83145,BCEAF9B7,BCFACCAA,BD58346E,BD636D6A,BD8E206D,BDA8F143,BDF9766D,BE37CDC8,BE5973E0,BE76EDFF,BEADC61C,BEBAB677,BF4317E2,C0DE0747,C0F6DB17,C1452553,C151AD61,C16C421B,C27F7CEC,C29FF9E4,C34304AC,C3B6DE9D,C3CD76FF,C3E7E29E,C3F19159,C43E23A7,C49ADCA2,C52E0BC6,C53EDC41,C5F020F3,C5F1DE79,C5F4865F,C71353BE,C73AD016,C788DCAE,C7C98F8E,C83CEB83,C8BB4DD9,C8DC65EB,C8FEF05D,C954B38C,C98C4580,C9C3A987,CA2A7444,CB1ACDDE,CB93DB97,CBFE69C7,CCDEAF02,CCEB3858,CCEDB696,CD094235,CD538CE4,CD5BEC0F,CDB998BE,CDDB4BDF,CEA8B54F,CEDCDE1E,CF84F45F,CF8957AD,CFE2CB31,CFEF2CD6,D0151AB0,D03F0CCB,D094B170,D124DBB7,D1A78A07,D1F7D8AB,D21AF769,D22943DA,D250103E,D25C1211,D2BE2F14,D4C45A1A,D51CF20D,D5295672,D543BCD6,D571C883,D5898CAF,D5B2339C,D5BDCD1D,D614E5BF,D692CC5E,D7134F8D,D72FD14D,D7891F1C,D7A6DCFA,D7C762B6,D83045C8,D83BB920,D84C17CA,D84EEA84,D89261A9,D89BE2F8,D8C74049,D9042FBB,D9EDD54D,DA0E5024,DA233397,DB6E353B,DB7184C9,DB833E34,DBF4EA9D,DC36626A,DC3BAA59,DC41E81E,DC649466,DCBE12CD,DCCEDB8F,DCCF2134,DD10BC7E,DDF460CC,DE4E5E2E,DEB78BBA,DEE584A2,DF09D625,DF331A18,DFF227D9,E0144180,E0A79F8C,E0B92B94,E13AE2DC,E1C7ABD6,E2BC82A2,E2D37CF0,E328B4FA,E340A49C,E36166C2,E3AB4ED0,E3BD221D,E3D6A795,E402430D,E43C9765,E470469D,E48E01F5,E4B08007,E4B35E4C,E5B7F405,E600831E,E616B5BC,E61CFF0A,E6419BC5,E655B42D,E688A5B8,E6896018,E68A000E,E68A9F6E,E6A95A4F,E6B339F6,E6BA0A06,E73C7C4F,E78F66E6,E7D20193,E820670A,E8522F04,E86415A6,E8B3F63D,E8C95AFC,E8DBC96A,E8E5B179,E8E8DD70,E8FC8EA1,E9219533,E9C8E262,EA06F8C3,EA090572,EA71056A,EAB7B429,EB38F792,EB499C8F,EB7709E2,EBEEA8DB,EBF5F6B7,EBFE2397,ED98957E,EDD6E031,EDF419A8,EDFB6B01,EE4A0E33,EE802DC4,EEF7DE23,EF703CA4,EF9E9714,EFDF9140,F00F2D4E,F050746C,F0C5F320,F1301043,F1850C35,F23CA406,F255D6F1,F35D5335,F35D5F95,F389A35A,F3996B67,F3C5BF9B,F3D27F54,F3F2F385,F41B6343,F45A6784,F4646B69,F468118C,F478D8B3,F5360FBE,F5363349,F568D51E,F5733C67,F5C5866D,F63B89CE,F6E3494A,F774EAEE,F8009DB0,F82C85BE,F82DD377,F908CA4C,F96E28F7,F9864452,F9D411E3,F9FC3090,FB453D58,FB610592,FC7797BF,FC8BED44,FCB2955B,FCBCCB21,FD2FC875,FD73F775,FDA245D2,FDAA963C,FDD248B2,FDF95D15,FE05840B,FE4B6B43,FE5DC5D4,FE94E570,FEB72E1D,FF14C1DA,FF2F2FB4,FF44EDC4'.split(',')) };
const PAK_LABEL = { memory: 'carte mémoire (Controller Pak)', rumble: 'Rumble Pak (vibration)', transfer: 'Transfer Pak', none: 'aucun accessoire' };
let bootedPak = null;
function autoPak(r, gbReady) {
  const rum = PAKDB.rumble.has(r.crc1), mem = PAKDB.mempak.has(r.crc1);
  if (gbReady && usesTpak(r)) return ['transfer', 'cartouche Game Boy insérée'];
  if (rum && !mem) return ['rumble', 'le jeu gère la vibration'];
  if (mem) return ['memory', rum ? 'le jeu sauvegarde aussi sur carte mémoire' : 'le jeu sauvegarde sur carte mémoire'];
  return ['memory', 'jeu absent de la base'];
}
/* Branchement au démarrage : appelé par power() avant le chargement d'EmulatorJS */
async function preparePaks(opts) {
  gbActive = false; gbLastCrc = null;
  const gbRec = prefs.tpak && prefs.gb ? await idb.get('gb:' + prefs.gb) : null;
  let pak = prefs.pak || 'auto', why = '';
  if (pak === 'auto') [pak, why] = autoPak(rom, !!gbRec);
  if (pak === 'transfer' && !gbRec) { pak = 'memory'; log('Transfer Pak demandé sans cartouche Game Boy : carte mémoire branchée à la place.', 'w'); }
  if (pak === 'transfer' && bootedEngine === 'parallel') { pak = 'memory'; log('Le moteur léger ParaLLEl-N64 n\'a pas de Transfer Pak : carte mémoire branchée. Passe au moteur complet pour Pokémon Stadium.', 'w'); }
  opts[OPT() + 'pak1'] = pak;
  bootedPak = pak;
  log('Manette 1 : ' + PAK_LABEL[pak] + (why ? ' (auto : ' + why + ')' : ''), 'k');
  if (pak !== 'transfer') return;
  const sav = await idb.get('gbsav:' + prefs.gb);
  const files = {};
  for (const n of new Set([rom.file.name, rom.base])) {
    files['/' + n + '.gb'] = new Blob([await gbRec.blob.arrayBuffer()]);
    if (sav) files['/' + n + '.sav'] = new Blob([fitSave(sav.data, gbRec.ram)]);
  }
  window.EJS_externalFiles = files;
  gbActive = true;
  log('Transfer Pak : « ' + gbRec.title + ' »' + (sav ? ' avec sa sauvegarde (' + sav.data.length + ' octets)' : ', sans sauvegarde (cartouche vierge)'), 'k');
}
function startGbSync() {
  clearInterval(gbSyncTimer);
  if (!gbActive) return;
  syncGbSave('init');
  gbSyncTimer = setInterval(() => syncGbSave(), 5000);
  renderGb();
}
dropzone($('#slot-gb'), (f) => insertGb(f));
$('#file-gb').addEventListener('change', (e) => { insertGb(e.target.files[0]); e.target.value = ''; });
$('#file-gbsav').addEventListener('change', (e) => { importGbSave(e.target.files[0]); e.target.value = ''; });
$('#gb-export').addEventListener('click', exportGbSave);

/* ================= États instantanés (3 emplacements, IndexedDB, compressés) ================= */
const thumbs = {};
async function renderSlots() {
  const box = $('#tiles');
  box.textContent = '';
  for (const n of [1, 2, 3]) {
    const rec = rom ? await idb.get('state:' + skey() + ':' + n) : null;
    const row = document.createElement('div'); row.className = 'slotrow';
    const th = document.createElement('div'); th.className = 'thumb';
    if (rec && rec.png) {
      if (thumbs[n]) URL.revokeObjectURL(thumbs[n]);
      thumbs[n] = URL.createObjectURL(rec.png);
      const img = document.createElement('img'); img.src = thumbs[n]; img.alt = 'Aperçu de l\'emplacement ' + n; th.append(img);
    } else th.textContent = rec ? 'Sans aperçu' : 'Vide';
    const info = document.createElement('div');
    const b = document.createElement('b'); b.textContent = 'Emplacement ' + n;
    const sm = document.createElement('small'); sm.textContent = rec ? ago(rec.t) + ' · ' + mo(rec.size) : (n === 1 ? 'F2 / F4' : 'vide');
    const act = document.createElement('div'); act.className = 'actions';
    const mk = (label, fn, dis) => { const x = document.createElement('button'); x.className = 'btn sm'; x.textContent = label; x.disabled = dis; x.addEventListener('click', fn); act.append(x); };
    mk('Sauver', () => saveSlot(n), !running);
    mk('Charger', () => loadSlot(n), !running || !rec);
    mk('Exporter', () => exportSlot(n), !rec);
    info.append(b, sm, act);
    row.append(th, info);
    box.append(row);
  }
}
/* Vignette : copie du canvas WebGL juste après le rendu d'une image (crochet postMainLoop d'Emscripten).
   La capture native du core plante avec GLideN64 en WebAssembly. */
function grabThumb() {
  return new Promise((resolve) => {
    let fired = false;
    const done = (b) => { if (fired) return; fired = true; clearTimeout(timer); resolve(b); };
    const timer = setTimeout(() => done(null), 1500);
    onNextFrame(() => {
      try {
        const c = em().canvas, w = 240, h = Math.round(240 * (c.height / c.width || 0.75));
        const t = document.createElement('canvas'); t.width = w; t.height = h;
        t.getContext('2d').drawImage(c, 0, 0, w, h);
        t.toBlob((b) => done(b), 'image/png');
      } catch (e) { done(null); }
    });
  });
}
let slotBusy = false;
async function saveSlot(n) {
  const g = gm();
  if (!g || !running || slotBusy) return;
  slotBusy = true;
  try {
    const t = performance.now();
    const st = g.getState();
    const png = await grabThumb();
    const gz = await gzip(st);
    await idb.set('state:' + skey() + ':' + n, { t: Date.now(), size: st.length, png, data: new Blob([gz]) });
    log('État ' + n + ' sauvegardé (' + mo(gz.length) + ' compressé, ' + Math.round(performance.now() - t) + ' ms)', 'k');
    toast('État ' + n + ' sauvegardé');
    renderSlots();
  } finally { slotBusy = false; }
}
async function loadSlot(n) {
  const g = gm();
  if (!g || !running) return;
  const rec = await idb.get('state:' + skey() + ':' + n);
  if (!rec) { toast('Emplacement ' + n + ' vide'); return; }
  await autoState('avant');
  g.loadState(await gunzip(new Uint8Array(await rec.data.arrayBuffer())));
  log('État ' + n + ' chargé (' + ago(rec.t) + ')', 'k');
  toast('État ' + n + ' chargé');
}
async function exportSlot(n) {
  const rec = await idb.get('state:' + skey() + ':' + n);
  if (!rec) return;
  const files = [{ name: rom.base + ' - etat ' + n + '.state', data: await gunzip(new Uint8Array(await rec.data.arrayBuffer())) }];
  if (rec.png) files.push({ name: 'apercu.png', data: new Uint8Array(await rec.png.arrayBuffer()) });
  files.push({ name: 'LISEZMOI.txt', data: new TextEncoder().encode('État instantané mupen64plus-next (EmulatorJS) de ' + rom.name + '\r\nSHA-1 de la cartouche : ' + rom.sha1 + '\r\nRéimporte ce .zip dans eden64 avec la même cartouche.\r\n') });
  offerFile(safeName(rom.title) + ' - etat ' + n + ' ' + stamp(new Date(rec.t)) + '.zip', await makeZip(files));
}
async function importState(p, n) {
  if (!rom) { showPending(null, 'Insère d\'abord la cartouche correspondante.'); return; }
  const gz = await gzip(p.bytes);
  await idb.set('state:' + skey() + ':' + n, { t: Date.now(), size: p.bytes.length, png: null, data: new Blob([gz]) });
  log('État importé dans l\'emplacement ' + n + ' (' + p.name + ')', 'k');
  pendingSave = null; $('#pending').hidden = true;
  if (running) await loadSlot(n);
  renderSlots();
}
$('#btn-qsave').addEventListener('click', () => saveSlot(1));
$('#btn-qload').addEventListener('click', () => loadSlot(1));

/* ================= Vitesse (avance rapide / ralenti natifs RetroArch) ================= */
const SPEEDS = [0.5, 1, 2, 3, 4];
const turboSrc = new Set();
let turbo = false;
const currentSpeed = () => (turbo ? Math.max(3, prefs.speed) : prefs.speed);
const fmtSpeed = (s) => String(s).replace('.', ',');
$('#speed-seg').innerHTML = SPEEDS.map((s) => `<button data-s="${s}" aria-pressed="false" title="Vitesse ×${fmtSpeed(s)}">×${fmtSpeed(s)}</button>`).join('');
$$('#speed-seg button').forEach((b) => b.addEventListener('click', () => { prefs.speed = +b.dataset.s; savePrefs(); applySpeed(); toast('Vitesse ×' + fmtSpeed(prefs.speed)); }));
function applySpeed() {
  $$('#speed-seg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.s === prefs.speed)));
  const g = gm();
  if (!g || !running) return;
  const s = currentSpeed();
  perfWindow = [];
  try {
    if (s > 1) { g.toggleSlowMotion(0); g.setFastForwardRatio(s); g.toggleFastForward(1); }
    else if (s < 1) { g.toggleFastForward(0); g.setSlowMotionRatio(1 / s); g.toggleSlowMotion(1); }
    else { g.toggleFastForward(0); g.toggleSlowMotion(0); }
  } catch (e) { log('Réglage de vitesse refusé : ' + e, 'e'); }
}
function setTurbo(on, src = 'clavier') {
  if (on) turboSrc.add(src); else turboSrc.delete(src);
  const next = running && turboSrc.size > 0;
  if (turbo === next) return;
  turbo = next;
  applySpeed();
  toast(turbo ? 'Accélérateur ×' + fmtSpeed(currentSpeed()) : 'Vitesse ×' + fmtSpeed(prefs.speed), 1200);
}
window.addEventListener('blur', () => { turboSrc.clear(); setTurbo(false); });

/* ================= Qualité d'image (options GLideN64 lues au démarrage) ================= */
$('#q-res').innerHTML = RES.map((r) => `<option value="${r.f}">×${r.f} · ${r.r43.replace('x', '×')}${r.f === 1 ? ' (natif)' : r.f === 2 ? ' (recommandé)' : r.f >= 6 ? ' (GPU puissant)' : ''}</option>`).join('');
$('#preset-seg').innerHTML = '<button data-p="fidele">Fidèle</button><button data-p="net">Net</button><button data-p="hd">HD</button><button data-p="ultra">Ultra</button><button data-p="perso" disabled>Perso</button>';
const QFIELDS = { res: '#q-res', aspect: '#q-aspect', fxaa: '#q-fxaa', filter: '#q-filter', tex: '#q-tex', compat: '#q-compat' };
const qualitySig = () => JSON.stringify([prefs.quality, lowLatencyOn()]);
function matchPreset(q) { return Object.keys(PRESETS).find((k) => Object.keys(PRESETS[k]).every((f) => String(PRESETS[k][f]) === String(q[f]))) || 'perso'; }
function updateQualityUi() {
  const q = prefs.quality;
  for (const [k, sel] of Object.entries(QFIELDS)) $(sel).value = String(q[k]);
  $('#q-shader').value = prefs.shader;
  const preset = matchPreset(q);
  $$('#preset-seg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.p === preset)));
  const r = RES.find((x) => x.f === +q.res);
  const dims = q.aspect === '4:3' ? r.r43 : r.r169;
  const px = +dims.split('x')[0] * +dims.split('x')[1] / 76800;
  $('#q-summary').innerHTML = `Rendu interne <b>${dims.replace('x', '×')}</b> · ${px.toFixed(0)}× les pixels de la N64${q.fxaa === '1' ? ' · FXAA' : ''}${q.tex !== 'None' ? ' · textures ' + q.tex : ''}`;
  const changed = running && bootedQuality !== qualitySig();
  $('#ll-on').checked = lowLatencyOn();
  $('#q-apply').disabled = !changed;
  $('#q-note').textContent = !running ? 'Appliqué au prochain allumage.' : changed ? 'Redémarrage de 2 s, partie reprise au même endroit.' : 'Réglages actifs.';
}
$$('#preset-seg button').forEach((b) => b.addEventListener('click', () => {
  if (!PRESETS[b.dataset.p]) return;
  prefs.quality = { ...PRESETS[b.dataset.p] }; savePrefs(); updateQualityUi();
}));
for (const [k, sel] of Object.entries(QFIELDS)) $(sel).addEventListener('change', () => { prefs.quality[k] = k === 'res' ? +$(sel).value : $(sel).value; savePrefs(); updateQualityUi(); });
$('#q-shader').addEventListener('change', () => { prefs.shader = $('#q-shader').value; savePrefs(); if (running) applyShader(); });
function applyShader() {
  try { em().enableShader(prefs.shader); log('Écran : ' + $('#q-shader').selectedOptions[0].textContent); } catch (e) { log('Filtre d\'écran indisponible : ' + e, 'w'); }
}
$('#engine-sel').value = prefs.engine;
function renderEngine() {
  const e = currentEngine();
  set('#engine-note', (prefs.engine === 'auto' ? 'Auto : le moteur complet occupe ~900 Mo de mémoire, le léger ~300 Mo ; téléphones, tablettes et machines à 4 Go ou moins prennent le léger. ' : '') +
    (e === 'parallel' ? 'Moteur léger : ni Transfer Pak, ni FXAA, ni textures lissées, ni vibration relayée. ' : 'Moteur complet : toutes les fonctions d\'eden64. ') +
    'La sauvegarde du jeu est commune aux deux moteurs ; les états instantanés sont propres à chacun.');
  $('#engine-apply').hidden = !(running && bootedEngine && bootedEngine !== e);
}
$('#engine-sel').addEventListener('change', () => { prefs.engine = $('#engine-sel').value; savePrefs(); renderEngine(); renderSlots(); renderSafety(); renderGb(); });
$('#engine-apply').addEventListener('click', () => { $('#engine-apply').disabled = true; restartWithResume('moteur', { noState: true }); });
renderEngine();
$('#ll-on').addEventListener('change', () => { prefs.lowLatency = $('#ll-on').checked; prefs.llSet = true; savePrefs(); updateQualityUi(); });
set('#machine', (machine.gpu || 'Carte graphique inconnue') + ' · ' + (machine.cores || '?') + ' cœurs' + (machine.mem ? ' · ' + machine.mem + ' Go' : ''));
set('#machine-tier', TIER_LABEL[machine.tier].replace(/^./, (c) => c.toUpperCase()) + ' · préréglage conseillé : ' + { fidele: 'Fidèle', net: 'Net', hd: 'HD' }[TIER_PRESET[machine.tier]]);
$('#q-apply').addEventListener('click', () => { $('#q-apply').disabled = true; set('#q-note', 'Redémarrage…'); restartWithResume('qualite'); });

/* ================= Touches : boutons N64 et raccourcis, réassignables au clavier et à la manette ================= */
/* slot = numéro de commande EmulatorJS (RetroPad) que le core mupen64plus-next lit pour ce bouton N64 */
const ACTIONS = [
  { id: 'a', n: 'A', g: 'Boutons', slot: 0 }, { id: 'b', n: 'B', g: 'Boutons', slot: 1 },
  { id: 'z', n: 'Z (viser)', g: 'Boutons', slot: 12 }, { id: 'start', n: 'Start', g: 'Boutons', slot: 3 },
  { id: 'l', n: 'L', g: 'Boutons', slot: 10 }, { id: 'r', n: 'R (bouclier)', g: 'Boutons', slot: 11 },
  { id: 'su', n: 'Stick ↑', g: 'Stick', slot: 19 }, { id: 'sd', n: 'Stick ↓', g: 'Stick', slot: 18 },
  { id: 'sl', n: 'Stick ←', g: 'Stick', slot: 17 }, { id: 'sr', n: 'Stick →', g: 'Stick', slot: 16 },
  { id: 'cu', n: 'C ↑', g: 'Boutons C', slot: 23 }, { id: 'cd', n: 'C ↓', g: 'Boutons C', slot: 22 },
  { id: 'cl', n: 'C ←', g: 'Boutons C', slot: 21 }, { id: 'cr', n: 'C →', g: 'Boutons C', slot: 20 },
  { id: 'du', n: 'Croix ↑', g: 'Croix', slot: 4 }, { id: 'dd', n: 'Croix ↓', g: 'Croix', slot: 5 },
  { id: 'dl', n: 'Croix ←', g: 'Croix', slot: 6 }, { id: 'dr', n: 'Croix →', g: 'Croix', slot: 7 },
  { id: 'turbo', n: 'Accélérateur (maintenir)', g: 'Raccourcis eden64', hk: true },
  { id: 'save1', n: 'Sauver l\'état 1', g: 'Raccourcis eden64', hk: true },
  { id: 'load1', n: 'Charger l\'état 1', g: 'Raccourcis eden64', hk: true },
  { id: 'pause', n: 'Pause', g: 'Raccourcis eden64', hk: true },
  { id: 'shot', n: 'Capture d\'écran', g: 'Raccourcis eden64', hk: true },
  { id: 'rec', n: 'Enregistrer un clip', g: 'Raccourcis eden64', hk: true },
  { id: 'oca', n: 'Partitions d\'ocarina', g: 'Raccourcis eden64', hk: true },
  { id: 'full', n: 'Plein écran', g: 'Raccourcis eden64', hk: true }
];
const ACT = Object.fromEntries(ACTIONS.map((a) => [a.id, a]));
const KB_PRESET = {
  azerty: { a: 75, b: 74, z: 32, start: 13, l: 65, r: 16, su: 90, sd: 83, sl: 81, sr: 68, cu: 38, cd: 40, cl: 37, cr: 39, turbo: 9, save1: 113, load1: 115, pause: 80, shot: 119, rec: 120, oca: 79, full: 70 },
  qwerty: { a: 75, b: 74, z: 32, start: 13, l: 81, r: 16, su: 87, sd: 83, sl: 65, sr: 68, cu: 38, cd: 40, cl: 37, cr: 39, turbo: 9, save1: 113, load1: 115, pause: 80, shot: 119, rec: 120, oca: 79, full: 70 }
};
const PAD_DEFAULT = {
  a: 'BUTTON_1', b: 'BUTTON_3', z: 'LEFT_BOTTOM_SHOULDER', start: 'START', l: 'LEFT_TOP_SHOULDER', r: 'RIGHT_BOTTOM_SHOULDER',
  su: 'LEFT_STICK_Y:-1', sd: 'LEFT_STICK_Y:+1', sl: 'LEFT_STICK_X:-1', sr: 'LEFT_STICK_X:+1',
  cu: 'RIGHT_STICK_Y:-1', cd: 'RIGHT_STICK_Y:+1', cl: 'RIGHT_STICK_X:-1', cr: 'RIGHT_STICK_X:+1',
  du: 'DPAD_UP', dd: 'DPAD_DOWN', dl: 'DPAD_LEFT', dr: 'DPAD_RIGHT',
  turbo: 'RIGHT_TOP_SHOULDER', save1: 'SELECT+BUTTON_4', load1: 'SELECT+BUTTON_2', oca: 'SELECT+RIGHT_TOP_SHOULDER', shot: 'SELECT+LEFT_STICK', rec: 'SELECT+RIGHT_STICK'
};
/* Combinaison « SELECT+BUTTON_4 » : le « + » ne sépare que deux libellés (pas le signe d'un axe « :+1 ») */
const COMBO = /\+(?=[A-Z])/;
const kbPreset = (layout) => ({ ...KB_PRESET[layout === 'qwerty' ? 'qwerty' : 'azerty'] });
if (!prefs.binds || typeof prefs.binds !== 'object') prefs.binds = {};
if (!prefs.binds.kb) prefs.binds.kb = kbPreset(prefs.layout);
if (!prefs.binds.pad) prefs.binds.pad = { ...PAD_DEFAULT };
if (!prefs.binds.kbl) prefs.binds.kbl = {};
for (const a of ACTIONS) { if (!(a.id in prefs.binds.kb)) prefs.binds.kb[a.id] = null; if (!(a.id in prefs.binds.pad)) prefs.binds.pad[a.id] = PAD_DEFAULT[a.id] || null; }

const KNAMES = { 8: 'Retour', 9: 'Tab', 13: 'Entrée', 16: 'Maj', 17: 'Ctrl', 18: 'Alt', 20: 'Verr. Maj', 27: 'Échap', 32: 'Espace', 33: 'Page ↑', 34: 'Page ↓', 35: 'Fin', 36: 'Début', 37: '←', 38: '↑', 39: '→', 40: '↓', 45: 'Inser', 46: 'Suppr', 106: 'Pavé ×', 107: 'Pavé +', 109: 'Pavé −', 110: 'Pavé ,', 111: 'Pavé ÷' };
function keyName(id) {
  const kc = prefs.binds.kb[id];
  if (kc == null) return '';
  return prefs.binds.kbl[id] || KNAMES[kc] || (kc >= 112 && kc <= 123 ? 'F' + (kc - 111) : kc >= 96 && kc <= 105 ? 'Pavé ' + (kc - 96) : (kc >= 48 && kc <= 90) ? String.fromCharCode(kc) : 'Touche ' + kc);
}
const BTN_LABEL = ['BUTTON_1', 'BUTTON_2', 'BUTTON_3', 'BUTTON_4', 'LEFT_TOP_SHOULDER', 'RIGHT_TOP_SHOULDER', 'LEFT_BOTTOM_SHOULDER', 'RIGHT_BOTTOM_SHOULDER', 'SELECT', 'START', 'LEFT_STICK', 'RIGHT_STICK', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT'];
const BTN_INDEX = Object.fromEntries(BTN_LABEL.map((l, i) => [l, i]));
const AXIS_LABEL = ['LEFT_STICK_X', 'LEFT_STICK_Y', 'RIGHT_STICK_X', 'RIGHT_STICK_Y'];
const XNAMES = { BUTTON_1: 'A', BUTTON_2: 'B', BUTTON_3: 'X', BUTTON_4: 'Y', LEFT_TOP_SHOULDER: 'LB', RIGHT_TOP_SHOULDER: 'RB', LEFT_BOTTOM_SHOULDER: 'LT', RIGHT_BOTTOM_SHOULDER: 'RT', SELECT: 'View', START: 'Menu', LEFT_STICK: 'L3', RIGHT_STICK: 'R3', DPAD_UP: 'Croix ↑', DPAD_DOWN: 'Croix ↓', DPAD_LEFT: 'Croix ←', DPAD_RIGHT: 'Croix →', GAMEPAD_16: 'Home' };
const PSNAMES = { BUTTON_1: 'Croix', BUTTON_2: 'Rond', BUTTON_3: 'Carré', BUTTON_4: 'Triangle', LEFT_TOP_SHOULDER: 'L1', RIGHT_TOP_SHOULDER: 'R1', LEFT_BOTTOM_SHOULDER: 'L2', RIGHT_BOTTOM_SHOULDER: 'R2', SELECT: 'Create', START: 'Options', LEFT_STICK: 'L3', RIGHT_STICK: 'R3', GAMEPAD_16: 'PS' };
function padName(b, names = XNAMES) {
  if (!b) return '';
  return b.split(COMBO).map((x) => {
    const m = x.match(/^(LEFT|RIGHT)_STICK_([XY]):([+-])1$/);
    if (m) return 'Stick ' + (m[1] === 'LEFT' ? 'G' : 'D') + ' ' + (m[2] === 'X' ? (m[3] === '+' ? '→' : '←') : (m[3] === '+' ? '↓' : '↑'));
    const e = x.match(/^EXTRA_STICK_(\d+):([+-])1$/);
    if (e) return 'Axe ' + e[1] + ' ' + (e[2] === '+' ? '+' : '−');
    return names[x] || XNAMES[x] || x.replace('GAMEPAD_', 'Bouton ');
  }).join(' + ');
}
/* État d'une liaison manette sur l'objet Gamepad courant */
function inputOn(p, x) {
  const m = x.match(/^(?:(LEFT|RIGHT)_STICK_([XY])|EXTRA_STICK_(\d+)):([+-])1$/);
  if (m) {
    const ax = m[3] !== undefined ? +m[3] : (m[1] === 'LEFT' ? 0 : 2) + (m[2] === 'Y' ? 1 : 0);
    const v = p.axes[ax] || 0;
    return m[4] === '+' ? v > 0.5 : v < -0.5;
  }
  const i = x in BTN_INDEX ? BTN_INDEX[x] : +((x.match(/^GAMEPAD_(\d+)$/) || [])[1]);
  return Number.isInteger(i) && pressed(p, i);
}
const bindOn = (p, b) => !!b && b.split(COMBO).every((x) => inputOn(p, x));

/* Commandes passées à EmulatorJS (clavier en keyCode, manette en libellés de son GamepadHandler) */
function buildControls() {
  const c = {};
  for (let i = 0; i < 30; i++) c[i] = { value: -1, value2: '' };
  for (const a of ACTIONS) if (a.slot !== undefined) c[a.slot] = { value: prefs.binds.kb[a.id] ?? -1, value2: prefs.binds.pad[a.id] || '' };
  return { 0: c, 1: {}, 2: {}, 3: {} };
}
const gameKeyCodes = () => new Set(ACTIONS.filter((a) => !a.hk && prefs.binds.kb[a.id] != null).map((a) => prefs.binds.kb[a.id]));
const hotkeyForKey = (kc) => ACTIONS.find((a) => a.hk && prefs.binds.kb[a.id] === kc);
let gameKeys = gameKeyCodes();
let lastDevice = 'kb';
function applyBinds() {
  gameKeys = gameKeyCodes();
  const e2 = em();
  if (running && e2 && e2.controls) { e2.controls = buildControls(); }
  const kbT = keyName('turbo'), padT = padName(prefs.binds.pad.turbo);
  $('#turbo-hint').title = 'Accélérateur : maintenir ' + [kbT, padT].filter(Boolean).join(' ou ');
  const k1 = [keyName('save1'), keyName('load1')].filter(Boolean), p1 = [padName(prefs.binds.pad.save1), padName(prefs.binds.pad.load1)].filter(Boolean);
  $('#st-hint').textContent = 'Reprends exactement où tu étais.' + (k1.length ? ' Emplacement 1 au clavier : ' + k1.join(' / ') + '.' : '') + (p1.length ? ' À la manette : ' + p1.join(' / ') + '.' : '');
  $('#btn-qsave').title = 'Sauver l\'état dans l\'emplacement 1' + (keyName('save1') ? ' (' + keyName('save1') + ')' : '');
  $('#btn-qload').title = 'Charger l\'état de l\'emplacement 1' + (keyName('load1') ? ' (' + keyName('load1') + ')' : '');
  $('#btn-qsave kbd').textContent = keyName('save1') || '—'; $('#btn-qload kbd').textContent = keyName('load1') || '—';
  $('#btn-pause').title = 'Pause' + (keyName('pause') ? ' (' + keyName('pause') + ')' : '');
  $('#btn-shot').title = 'Capture d\'écran' + (keyName('shot') ? ' (' + keyName('shot') + ')' : '');
  $('#btn-rec').title = 'Enregistrer un clip vidéo avec le son' + (keyName('rec') ? ' (' + keyName('rec') + ')' : '');
  $('#btn-oca').title = 'Partitions d\'ocarina' + (keyName('oca') ? ' (' + keyName('oca') + ')' : '');
  renderOcaLegend();
}
function assignBind(dev, id, value, label) {
  const B = prefs.binds[dev], old = B[id], oldLabel = dev === 'kb' ? prefs.binds.kbl[id] : null;
  const other = value == null ? null : ACTIONS.find((a) => a.id !== id && B[a.id] === value);
  if (other) {
    B[other.id] = old ?? null;
    if (dev === 'kb') { if (oldLabel) prefs.binds.kbl[other.id] = oldLabel; else delete prefs.binds.kbl[other.id]; }
    toast('« ' + other.n + ' » ' + (old != null ? 'prend ' + (dev === 'kb' ? (oldLabel || KNAMES[old] || 'l\'ancienne touche') : padName(old)) : 'n\'a plus de touche'), 2600);
  }
  B[id] = value ?? null;
  if (dev === 'kb') { if (label) prefs.binds.kbl[id] = label; else delete prefs.binds.kbl[id]; }
  savePrefs(); applyBinds(); renderBinds();
  log('Touche « ' + ACT[id].n + ' » (' + (dev === 'kb' ? 'clavier' : 'manette') + ') : ' + (value == null ? 'aucune' : dev === 'kb' ? keyName(id) : padName(value)));
}

/* Capture d'une nouvelle touche : Échap annule, Retour arrière efface */
let capture = null;
function startCapture(dev, id, el) {
  stopCapture();
  capture = { dev, id, el, base: null, sel: false };
  if (running && !paused) { togglePause(true); capture.resume = true; }
  el.classList.add('wait'); el.textContent = dev === 'kb' ? 'Appuie sur une touche…' : 'Appuie sur un bouton…';
  set('#bind-hint', dev === 'kb' ? 'Appuie sur la touche voulue. Échap annule, Retour arrière efface.' : 'Appuie sur le bouton ou incline le stick. Pour un raccourci, garde View enfoncé puis appuie sur un autre bouton. Échap annule.');
  if (dev === 'pad') {
    const p = currentPad();
    capture.base = p ? { btn: new Set(p.buttons.map((b, i) => (pressed(p, i) ? i : -1)).filter((i) => i >= 0)), axes: p.axes.slice() } : null;
    if (!p) set('#bind-hint', 'Aucune manette détectée : branche-la et appuie sur un bouton.');
  }
  capture.timer = setTimeout(() => { stopCapture(); toast('Capture annulée'); }, 12000);
}
function stopCapture() {
  if (!capture) return;
  clearTimeout(capture.timer);
  const resume = capture.resume;
  capture = null;
  set('#bind-hint', 'Clique sur une touche pour la changer. Une touche déjà prise est échangée automatiquement.');
  renderBinds();
  if (resume && paused) togglePause(true);
}
function finishCapture(value, label) {
  const { dev, id } = capture;
  clearTimeout(capture.timer);
  const resume = capture.resume;
  capture = null;
  set('#bind-hint', 'Clique sur une touche pour la changer. Une touche déjà prise est échangée automatiquement.');
  assignBind(dev, id, value, label);
  if (resume && paused) togglePause(true);
}
function capturePad(p) {
  if (!capture.base) { capture.base = { btn: new Set(), axes: p.axes.slice() }; return; }
  const hk = !!ACT[capture.id].hk, base = capture.base;
  for (const i of Array.from(base.btn)) if (!pressed(p, i)) base.btn.delete(i);
  for (let i = 0; i < p.buttons.length; i++) {
    if (!pressed(p, i) || base.btn.has(i)) continue;
    if (i === 8 && hk) { capture.sel = true; base.btn.add(8); continue; }
    const lbl = BTN_LABEL[i] || 'GAMEPAD_' + i;
    finishCapture(hk && i !== 8 && pressed(p, 8) ? 'SELECT+' + lbl : lbl);
    return;
  }
  if (capture.sel && !pressed(p, 8)) { finishCapture('SELECT'); return; }
  for (let ax = 0; ax < p.axes.length; ax++) {
    const d = (p.axes[ax] || 0) - (base.axes[ax] || 0);
    if (Math.abs(d) > 0.6 && Math.abs(p.axes[ax]) > 0.5) {
      finishCapture((ax < 4 ? AXIS_LABEL[ax] : 'EXTRA_STICK_' + ax) + ':' + (p.axes[ax] > 0 ? '+' : '-') + '1');
      return;
    }
  }
}

/* Tableau des liaisons (onglet Touches) */
let bindDev = 'pad';
function renderBinds() {
  const tb = $('#binds');
  tb.textContent = '';
  let grp = '';
  for (const a of ACTIONS) {
    if (a.g !== grp) {
      grp = a.g;
      const h = document.createElement('tr'); h.className = 'grp';
      const th = document.createElement('th'); th.colSpan = 2; th.textContent = grp; h.append(th); tb.append(h);
    }
    const tr = document.createElement('tr'); tr.dataset.id = a.id;
    const td1 = document.createElement('td'); td1.textContent = a.n;
    const td2 = document.createElement('td');
    const b = document.createElement('button'); b.className = 'bind';
    const val = bindDev === 'kb' ? keyName(a.id) : padName(prefs.binds.pad[a.id]);
    b.textContent = val || 'aucune';
    if (!val) b.classList.add('none');
    if (bindDev === 'pad' && prefs.binds.pad[a.id]) b.title = 'PlayStation : ' + padName(prefs.binds.pad[a.id], PSNAMES);
    b.setAttribute('aria-label', a.n + ' : ' + (val || 'aucune') + '. Cliquer pour changer');
    b.addEventListener('click', () => startCapture(bindDev, a.id, b));
    td2.append(b); tr.append(td1, td2); tb.append(tr);
  }
  $('#kb-azerty').setAttribute('aria-pressed', String(bindDev === 'kb' && sameKb('azerty')));
  $('#kb-qwerty').setAttribute('aria-pressed', String(bindDev === 'kb' && sameKb('qwerty')));
}
const sameKb = (l) => Object.entries(KB_PRESET[l]).every(([k, v]) => prefs.binds.kb[k] === v);
$('#kb-azerty').addEventListener('click', () => { prefs.layout = 'azerty'; prefs.binds.kb = kbPreset('azerty'); prefs.binds.kbl = {}; savePrefs(); applyBinds(); renderBinds(); toast('Clavier AZERTY par défaut'); });
$('#kb-qwerty').addEventListener('click', () => { prefs.layout = 'qwerty'; prefs.binds.kb = kbPreset('qwerty'); prefs.binds.kbl = {}; savePrefs(); applyBinds(); renderBinds(); toast('Clavier QWERTY par défaut'); });
$('#bind-reset').addEventListener('click', () => {
  if (bindDev === 'kb') { prefs.binds.kb = kbPreset(prefs.layout); prefs.binds.kbl = {}; } else prefs.binds.pad = { ...Object.fromEntries(ACTIONS.map((a) => [a.id, null])), ...PAD_DEFAULT };
  savePrefs(); applyBinds(); renderBinds(); toast(bindDev === 'kb' ? 'Clavier réinitialisé' : 'Manette réinitialisée');
});

/* ================= Manette : schéma en direct, allumage, raccourcis ================= */
let padBlocked = false, padIndex = null;
const prev = {};
const padHk = {};
const pressed = (p, i) => !!(p.buttons[i] && (p.buttons[i].pressed || p.buttons[i].value > 0.5));
function readPads() {
  try { return Array.from(navigator.getGamepads ? navigator.getGamepads() : []).filter(Boolean); }
  catch (e) {
    if (!padBlocked) { padBlocked = true; chip('#cap-pad', 'no', 'Manette bloquée'); set('#pad-status', 'Ce cadre bloque l\'API Gamepad : ouvre la version locale pour jouer à la manette.'); log('API Gamepad refusée : ' + e.name, 'e'); }
    return [];
  }
}
const currentPad = () => { const pads = readPads(); return pads.find((x) => x.index === padIndex) || pads[0] || null; };
function onPad(g) {
  padIndex = g.index;
  const std = g.mapping === 'standard';
  const vib = !!(g.vibrationActuator || (g.hapticActuators && g.hapticActuators.length));
  chip('#cap-pad', std ? 'ok' : 'warn', 'Manette connectée');
  set('#pad-status', g.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() + (std ? ' · disposition standard' : ' · disposition non standard : réassigne les boutons ci-dessous') + (vib ? ' · vibration disponible' : ' · sans vibration'));
  log('Manette : ' + g.id + ' (mapping ' + (g.mapping || 'inconnu') + (vib ? ', vibration' : '') + ')', 'k');
  toast('Manette connectée');
  applyTouch();
}
window.addEventListener('gamepadconnected', (e) => { if (padIndex !== e.gamepad.index) onPad(e.gamepad); });
window.addEventListener('gamepaddisconnected', () => { padIndex = null; chip('#cap-pad', 'warn', 'Manette débranchée'); set('#pad-status', 'Manette débranchée. Rebranche-la puis appuie sur un bouton.'); applyTouch(); });
const svgKeys = $$('.pad .k[data-b]');
const padVisible = () => !$('#pane-cmd').hidden && bindDev === 'pad';
let lastPadSig = '', rafCount = 0;
function runHotkey(id) {
  if (id === 'oca') { toggleOcarina(); return; }
  if (id === 'full') { toggleFull(); return; }
  if (!running) return;
  if (id === 'save1') saveSlot(1);
  else if (id === 'load1') loadSlot(1);
  else if (id === 'pause') togglePause();
  else if (id === 'shot') screenshot();
  else if (id === 'rec') toggleRecord();
}
function padFrame() {
  rafCount++;
  const p = currentPad();
  if (p) {
    if (padIndex === null) onPad(p);
    if (capture && capture.dev === 'pad') { capturePad(p); requestAnimationFrame(padFrame); return; }
    const B = prefs.binds.pad;
    if (!running && rom && !capture) {
      const go = ['a', 'start'].some((id) => { const on = bindOn(p, B[id]); const was = padHk['go' + id]; padHk['go' + id] = on; return on && !was; });
      if (go) {
        if (navigator.userActivation && !navigator.userActivation.hasBeenActive) toast('Clique une fois dans la page (le navigateur l\'exige pour le son), puis appuie sur A', 3500);
        else power();
      }
    }
    const selHeld = pressed(p, 8);
    let any = false;
    for (const a of ACTIONS) {
      const b = B[a.id];
      if (!b) continue;
      const on = bindOn(p, b) && (!a.hk || COMBO.test(b) || b === 'SELECT' || !selHeld);
      if (on) any = true;
      const was = !!padHk[a.id];
      padHk[a.id] = on;
      if (on !== was && ocaOpen && !a.hk && on) ocaNote(a.id);
      if (!a.hk) continue;
      if (a.id === 'turbo') { if (on !== was) setTurbo(on, 'manette'); continue; }
      if (on && !was) runHotkey(a.id);
    }
    if (any) lastDevice = 'pad';
    if (padVisible()) {
      const ax = (i) => (Math.abs(p.axes[i] || 0) > 0.12 ? p.axes[i] : 0);
      const btn = p.buttons.map((b, i) => (pressed(p, i) || ((i === 6 || i === 7) && b.value > 0.15) ? 1 : 0)).join('');
      const sig = btn + ax(0).toFixed(2) + ax(1).toFixed(2) + ax(2).toFixed(2) + ax(3).toFixed(2);
      if (sig !== lastPadSig) {
        lastPadSig = sig;
        for (const el of svgKeys) el.classList.toggle('on', btn[+el.dataset.b] === '1');
        $('#pad-ls').setAttribute('transform', `translate(${ax(0) * 11} ${ax(1) * 11})`);
        $('#pad-rs').setAttribute('transform', `translate(${ax(2) * 11} ${ax(3) * 11})`);
        for (const r of $$('#binds tr[data-id]')) r.classList.toggle('on', !!padHk[r.dataset.id]);
      }
    }
    for (let i = 0; i < p.buttons.length; i++) prev[i] = pressed(p, i);
  }
  requestAnimationFrame(padFrame);
}
requestAnimationFrame(padFrame);

/* ================= Clavier : capture, raccourcis, transmission au jeu ================= */
const isField = (t) => t && t.closest && t.closest('input, select, textarea, [contenteditable=""], [contenteditable=true]');
function forwardKey(e) {
  /* EmulatorJS n'écoute le clavier que sur son propre élément : on transmet les touches du jeu quand le focus est ailleurs */
  const e2 = em();
  if (!running || !e2 || !e2.keyChange || isField(e.target)) return;
  if (e2.elements.parent.contains(e.target)) return;
  if (!gameKeys.has(e.keyCode)) return;
  e2.keyChange(e);
}
const keyRows = (kc, on) => { if (bindDev !== 'kb' || $('#pane-cmd').hidden) return; for (const a of ACTIONS) if (prefs.binds.kb[a.id] === kc) { const r = $('#binds tr[data-id="' + a.id + '"]'); if (r) r.classList.toggle('on', on); } };
window.addEventListener('keydown', (e) => {
  if (capture && capture.dev === 'kb') {
    e.preventDefault(); e.stopPropagation();
    if (e.key === 'Escape') { stopCapture(); toast('Capture annulée'); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') { finishCapture(null); return; }
    const label = e.key && e.key.length === 1 && e.key !== ' ' ? e.key.toUpperCase() : (KNAMES[e.keyCode] ? null : e.code.replace(/^Key|^Digit/, ''));
    finishCapture(e.keyCode, label);
    return;
  }
  if (capture && e.key === 'Escape') { stopCapture(); return; }
  if (isField(e.target)) return;
  keyRows(e.keyCode, true);
  if (gameKeys.has(e.keyCode)) lastDevice = 'kb';
  if (ocaOpen && !e.repeat) { const a = ['a', 'cu', 'cd', 'cl', 'cr'].find((id) => prefs.binds.kb[id] === e.keyCode); if (a) ocaNote(a); }
  const hk = hotkeyForKey(e.keyCode);
  if (!running) {
    if (hk && (hk.id === 'oca' || hk.id === 'full')) { e.preventDefault(); if (!e.repeat) runHotkey(hk.id); return; }
    if ((e.key === 'Enter' || e.keyCode === prefs.binds.kb.start) && rom && (document.activeElement === document.body || document.activeElement === null)) power();
    return;
  }
  if (hk) {
    e.preventDefault(); e.stopPropagation();
    if (hk.id === 'turbo') { if (!e.repeat) setTurbo(true, 'clavier'); } else if (!e.repeat) runHotkey(hk.id);
    return;
  }
  forwardKey(e);
}, true);
window.addEventListener('keyup', (e) => {
  keyRows(e.keyCode, false);
  if (capture) return;
  const hk = hotkeyForKey(e.keyCode);
  if (hk && running) { e.preventDefault(); if (hk.id === 'turbo') setTurbo(false, 'clavier'); return; }
  forwardKey(e);
}, true);

/* ================= Accessoire, vibration, stick, manette tactile ================= */
if (!['auto', 'memory', 'rumble', 'transfer', 'none'].includes(prefs.pak)) prefs.pak = 'auto';
if (typeof prefs.rumble !== 'number') prefs.rumble = 80;
if (!prefs.stick) prefs.stick = { dz: 15, sens: 100 };
if (!['auto', 'on', 'off'].includes(prefs.touch)) prefs.touch = 'auto';
let bootedInput = null;
const inputSig = () => JSON.stringify([prefs.pak, prefs.stick.dz, prefs.stick.sens]);
function renderInputOpts() {
  $('#pak-sel').value = prefs.pak;
  $('#rumble-int').value = prefs.rumble; set('#rumble-val', prefs.rumble + ' %');
  $('#dz').value = prefs.stick.dz; set('#dz-val', prefs.stick.dz + ' %');
  $('#sens').value = prefs.stick.sens; set('#sens-val', prefs.stick.sens + ' %');
  $('#touch-sel').value = prefs.touch;
  let note = '';
  if (rom) {
    const [p, why] = autoPak(rom, !!(prefs.tpak && prefs.gb));
    note = prefs.pak === 'auto' ? 'Pour « ' + rom.title + ' » : ' + PAK_LABEL[p] + ' (' + why + ').' : 'Choix manuel pour tous les jeux.';
    if (running && bootedPak) note += ' Branché maintenant : ' + PAK_LABEL[bootedPak] + '.';
  } else note = 'Auto choisit selon le jeu : Rumble Pak si le jeu vibre, carte mémoire s\'il y sauvegarde, Transfer Pak pour Pokémon Stadium & co.';
  set('#pak-note', note);
  const changed = running && bootedInput !== null && bootedInput !== inputSig();
  $('#in-apply').hidden = !changed;
}
$('#pak-sel').addEventListener('change', () => { prefs.pak = $('#pak-sel').value; savePrefs(); renderInputOpts(); });
$('#rumble-int').addEventListener('input', () => { prefs.rumble = +$('#rumble-int').value; savePrefs(); set('#rumble-val', prefs.rumble + ' %'); });
$('#dz').addEventListener('input', () => { prefs.stick.dz = +$('#dz').value; savePrefs(); renderInputOpts(); });
$('#sens').addEventListener('input', () => { prefs.stick.sens = +$('#sens').value; savePrefs(); renderInputOpts(); });
$('#touch-sel').addEventListener('change', () => { prefs.touch = $('#touch-sel').value; savePrefs(); applyTouch(); });
$('#in-apply').addEventListener('click', () => { $('#in-apply').disabled = true; restartWithResume('touches'); });
$('#rumble-test').addEventListener('click', () => {
  const a = padActuator();
  if (a && a.playEffect) { a.playEffect('dual-rumble', { startDelay: 0, duration: 450, strongMagnitude: Math.max(0.2, prefs.rumble / 100), weakMagnitude: Math.max(0.2, prefs.rumble / 100) * 0.75 }).catch(() => {}); toast('Bzzz…'); }
  else if (a && a.pulse) { a.pulse(prefs.rumble / 100, 450); toast('Bzzz…'); }
  else if (navigator.vibrate && machine.touch) { navigator.vibrate(300); toast('Bzzz…'); }
  else toast(currentPad() ? 'Cette manette ne vibre pas dans ce navigateur' : 'Branche une manette et appuie sur un bouton');
});
let touchShown = false;
function applyTouch() {
  const e2 = em();
  const show = prefs.touch === 'on' || (prefs.touch === 'auto' && machine.touch && padIndex === null);
  touchShown = show && running;
  document.body.classList.toggle('touchplay', touchShown);
  if (!e2 || !running) return;
  /* EmulatorJS réapplique son propre réglage « virtual-gamepad » après le démarrage : on passe par lui */
  const put = () => { try { if (e2.changeSettingOption) e2.changeSettingOption('virtual-gamepad', show ? 'enabled' : 'disabled'); } catch (e) {} try { if (e2.toggleVirtualGamepad) e2.toggleVirtualGamepad(show); } catch (e) {} };
  put(); setTimeout(put, 700);
}
$('#sub-pad').addEventListener('click', () => subTab('pad'));
$('#sub-kb').addEventListener('click', () => subTab('kb'));
function subTab(dev) {
  bindDev = dev; stopCapture();
  $('#cmd-pad').hidden = dev !== 'pad'; $('#cmd-kb').hidden = dev !== 'kb';
  $('#sub-pad').setAttribute('aria-pressed', String(dev === 'pad')); $('#sub-kb').setAttribute('aria-pressed', String(dev === 'kb'));
  renderBinds();
}

/* ================= Captures d'écran et clips vidéo (avec le son) ================= */
function onNextFrame(cb) { diag.frameCbs.push(cb); }
function flash() { const f = $('#flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
function screenshot() {
  if (!running) return;
  onNextFrame(() => {
    try {
      const c = em().canvas, t = document.createElement('canvas');
      t.width = c.width; t.height = c.height;
      t.getContext('2d').drawImage(c, 0, 0);
      flash();
      t.toBlob((b) => { if (b) offerFile(safeName(rom.title) + ' ' + stamp().replace('h', 'h') + '.png', b); }, 'image/png');
    } catch (e) { log('Capture impossible : ' + e, 'e'); }
  });
}
let rec = null;
function pickMime() {
  if (!window.MediaRecorder) return '';
  for (const m of ['video/mp4;codecs=avc1.42E01F,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']) if (MediaRecorder.isTypeSupported(m)) return m;
  return '';
}
const fmtDur = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
function updateRecUi() {
  const b = $('#btn-rec'), badge = $('#rec-badge');
  b.classList.toggle('rec-on', !!rec); b.setAttribute('aria-pressed', String(!!rec));
  badge.hidden = !rec;
  if (rec) set('#rec-time', fmtDur((performance.now() - rec.t0) / 1000));
}
function toggleRecord() {
  if (rec) { rec.stop(); return Promise.resolve(); }
  if (!running) return Promise.resolve();
  const mime = pickMime();
  if (!mime) { toast('Ce navigateur ne sait pas enregistrer de vidéo'); return Promise.resolve(); }
  const c = em().canvas, fps = rom.pal ? 50 : 60;
  const stream = c.captureStream(fps);
  const tap = audioTap();
  if (tap) for (const tr of tap.tap.stream.getAudioTracks()) stream.addTrack(tr);
  const mr = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: Math.round(Math.min(12e6, Math.max(3e6, c.width * c.height * fps * 0.12))), audioBitsPerSecond: 160000 });
  const chunks = [];
  mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  let done;
  const finished = new Promise((r) => { done = r; });
  mr.onstop = async () => {
    clearInterval(rec.timer); clearTimeout(rec.limit);
    stream.getTracks().forEach((t) => t.stop());
    if (tap) tap.close();
    const secs = (performance.now() - rec.t0) / 1000;
    rec = null; updateRecUi();
    const ext = mime.startsWith('video/mp4') ? 'mp4' : 'webm';
    const blob = new Blob(chunks, { type: 'video/' + ext });
    log('Clip enregistré : ' + fmtDur(secs) + ', ' + mo(blob.size) + ' (' + mime.split(';')[0] + (tap ? ', avec le son' : ', sans le son') + ')', 'k');
    await offerFile(safeName(rom.title) + ' ' + stamp() + '.' + ext, blob);
    done();
  };
  mr.start(1000);
  rec = { mr, t0: performance.now(), stop: () => { if (mr.state !== 'inactive') mr.stop(); return finished; } };
  rec.timer = setInterval(updateRecUi, 500);
  rec.limit = setTimeout(() => { toast('Clip arrêté à 10 minutes'); rec && rec.stop(); }, 600000);
  updateRecUi();
  toast('Enregistrement… ' + (keyName('rec') ? keyName('rec') + ' pour arrêter' : 'reclique pour arrêter'), 2500);
  if (machine.tier === 'faible' || machine.tier === 'logiciel') log('Enregistrement vidéo sur une machine légère : l\'encodage prend du processeur, le jeu peut ralentir.', 'w');
  return finished;
}
$('#btn-shot').addEventListener('click', screenshot);
$('#btn-rec').addEventListener('click', () => toggleRecord());

/* ================= Partitions d'ocarina (Zelda : Ocarina of Time) ================= */
const SONGS = [
  ['Berceuse de Zelda', 'l u r l u r', 'Prouve ton lien avec la famille royale'],
  ['Chant d\'Epona', 'u l r u l r', 'Appelle Epona, apaise les vaches'],
  ['Chant de Saria', 'd r l d r l', 'Parle à Saria, ouvre des passages'],
  ['Chant du Soleil', 'r d u r d u', 'Fait passer le temps, fige les morts-vivants'],
  ['Chant du Temps', 'r A d r A d', 'Déplace les blocs du temps'],
  ['Chant des Tempêtes', 'A d u A d u', 'Fait tomber la pluie'],
  ['Menuet des Bois', 'A u l r l r', 'Téléporte au Bosquet Sacré'],
  ['Boléro du Feu', 'd A d A r d r d', 'Téléporte au Cratère du Péril'],
  ['Sérénade de l\'Eau', 'A d r r l', 'Téléporte au Lac Hylia'],
  ['Nocturne de l\'Ombre', 'l r r A l r d', 'Téléporte au cimetière de Cocorico'],
  ['Requiem des Esprits', 'A d A r d A', 'Téléporte au Colosse du Désert'],
  ['Prélude de la Lumière', 'u r u r l u', 'Téléporte au Temple du Temps']
].map(([n, s, d]) => ({ n, notes: s.split(' '), d }));
const NOTE_ID = { A: 'a', u: 'cu', d: 'cd', l: 'cl', r: 'cr' };
const NOTE_GLYPH = { A: 'A', u: '▲', d: '▼', l: '◀', r: '▶' };
let ocaOpen = false, ocaSeq = [];
const isOot = () => !!rom && rom.id === 'ZL';
function noteEl(n) { const s = document.createElement('span'); s.className = 'nt ' + (n === 'A' ? 'na' : 'nc'); s.textContent = NOTE_GLYPH[n]; s.setAttribute('aria-label', n === 'A' ? 'A' : 'C ' + { u: 'haut', d: 'bas', l: 'gauche', r: 'droite' }[n]); return s; }
function renderOcarina() {
  const g = $('#oca-grid');
  g.textContent = '';
  for (const s of SONGS) {
    const card = document.createElement('div'); card.className = 'song'; card.dataset.n = s.n;
    const b = document.createElement('b'); b.textContent = s.n;
    const row = document.createElement('div'); row.className = 'notes';
    for (const n of s.notes) row.append(noteEl(n));
    const d = document.createElement('small'); d.textContent = s.d;
    card.append(b, row, d); g.append(card);
  }
  renderOcaLegend();
}
function renderOcaLegend() {
  const el = $('#oca-legend');
  if (!el) return;
  const dev = lastDevice === 'pad' && currentPad() ? 'pad' : 'kb';
  const name = (id) => (dev === 'kb' ? keyName(id) : padName(prefs.binds.pad[id])) || '—';
  el.textContent = (dev === 'kb' ? 'Au clavier' : 'À la manette') + ' : A = ' + name('a') + ' · C▲ = ' + name('cu') + ' · C▼ = ' + name('cd') + ' · C◀ = ' + name('cl') + ' · C▶ = ' + name('cr');
}
function ocaNote(id) {
  const n = Object.keys(NOTE_ID).find((k) => NOTE_ID[k] === id);
  if (!n) return;
  ocaSeq.push(n); if (ocaSeq.length > 8) ocaSeq.shift();
  const row = $('#oca-input'); row.textContent = '';
  for (const x of ocaSeq) row.append(noteEl(x));
  const hit = SONGS.find((s) => ocaSeq.length >= s.notes.length && s.notes.every((x, i) => x === ocaSeq[ocaSeq.length - s.notes.length + i]));
  if (hit) {
    const card = $('#oca-grid .song[data-n="' + CSS.escape(hit.n) + '"]');
    if (card) { card.classList.remove('hit'); void card.offsetWidth; card.classList.add('hit'); }
    set('#oca-found', '♪ ' + hit.n);
    ocaSeq = [];
  } else set('#oca-found', '');
}
function toggleOcarina(force) {
  if (!isOot()) { if (force !== false) toast('Les partitions concernent Zelda : Ocarina of Time'); return; }
  ocaOpen = typeof force === 'boolean' ? force : !ocaOpen;
  $('#ocarina').hidden = !ocaOpen;
  $('#btn-oca').setAttribute('aria-pressed', String(ocaOpen));
  if (ocaOpen) { renderOcaLegend(); ocaSeq = []; $('#oca-input').textContent = ''; set('#oca-found', ''); }
  focusGame();
}
$('#btn-oca').addEventListener('click', () => toggleOcarina());
$('#oca-close').addEventListener('click', () => toggleOcarina(false));
renderOcarina();

/* ================= Codes GameShark (base libretro-database, CC BY-SA 4.0) ================= */
let cheatIdx = null;
const cheat = { sha: null, name: null, list: [], on: new Set(), custom: [] };
async function loadCheatIndex() {
  if (cheatIdx) return cheatIdx;
  try { const r = await fetch('cheats/index.json'); cheatIdx = r.ok ? await r.json() : { sha: {}, games: {} }; }
  catch (e) { cheatIdx = { sha: {}, games: {} }; }
  return cheatIdx;
}
async function loadCheats() {
  if (!rom) return;
  const sha = rom.sha1;
  if (cheat.sha === sha) return;
  Object.assign(cheat, { sha, name: null, list: [], on: new Set(), custom: [] });
  set('#ch-src', 'Recherche des codes…');
  const idx = await loadCheatIndex();
  let name = idx.sha[sha.slice(0, 12)] || null;
  if (!name && idx.games[rom.base]) name = rom.base;
  let list = [];
  if (name) {
    try { const r = await fetch('cheats/' + String(idx.games[name]).padStart(2, '0') + '.json'); if (r.ok) list = (await r.json())[name] || []; } catch (e) {}
  }
  const saved = (await idb.get('cheats:' + sha)) || { on: [], custom: [] };
  if (cheat.sha !== sha) return;
  cheat.name = name; cheat.custom = saved.custom || [];
  cheat.list = list.map(([d, c]) => ({ d, c })).concat(cheat.custom.map(([d, c]) => ({ d, c, mine: true })));
  cheat.on = new Set((saved.on || []).filter((c) => cheat.list.some((x) => x.c === c)));
  set('#ch-src', name ? cheat.list.length + ' codes pour « ' + name + ' » (base libretro, empreinte SHA-1 reconnue).' : cheat.custom.length ? cheat.custom.length + ' code(s) perso. Aucun code connu pour ce dump dans la base.' : 'Aucun code connu pour ce dump : ajoute les tiens ci-dessous.');
  renderCheats();
  if (running) applyCheats(false);
}
function saveCheats() { if (cheat.sha) idb.set('cheats:' + cheat.sha, { on: Array.from(cheat.on), custom: cheat.custom }); }
function applyCheats(announce = true) {
  const g = gm();
  if (!g || !running) return;
  try {
    g.resetCheat();
    let i = 0;
    for (const c of cheat.on) g.setCheat(i++, 1, c);
    if (announce || cheat.on.size) log('Codes actifs : ' + cheat.on.size, cheat.on.size ? 'k' : undefined);
  } catch (e) { log('Codes refusés par le core : ' + e, 'e'); }
}
function renderCheats() {
  const ul = $('#ch-list'), q = $('#ch-q').value.trim().toLowerCase();
  ul.textContent = '';
  const shown = cheat.list.filter((x) => !q || x.d.toLowerCase().includes(q) || x.c.toLowerCase().includes(q));
  const lim = shown.slice(0, 300);
  for (const x of lim) {
    const li = document.createElement('li'); if (cheat.on.has(x.c)) li.className = 'on';
    const lab = document.createElement('label'); lab.className = 'switch';
    const inp = document.createElement('input'); inp.type = 'checkbox'; inp.checked = cheat.on.has(x.c);
    inp.addEventListener('change', () => {
      if (inp.checked) cheat.on.add(x.c); else cheat.on.delete(x.c);
      li.classList.toggle('on', inp.checked);
      saveCheats(); applyCheats(false); updateCheatCount();
      toast((inp.checked ? 'Code activé : ' : 'Code désactivé : ') + x.d, 1800);
    });
    const tr = document.createElement('span'); tr.className = 'track';
    lab.append(inp, tr);
    const txt = document.createElement('span'); txt.className = 'ctxt';
    const b = document.createElement('b'); b.textContent = x.d + (x.mine ? ' (perso)' : '');
    const code = document.createElement('code'); code.textContent = x.c.replace(/\+/g, ' · ');
    txt.append(b, code);
    lab.append(txt);
    li.append(lab);
    if (x.mine) {
      const del = document.createElement('button'); del.className = 'btn sm ghost'; del.textContent = 'Retirer';
      del.addEventListener('click', () => { cheat.custom = cheat.custom.filter(([d, c]) => !(d === x.d && c === x.c)); cheat.on.delete(x.c); cheat.list = cheat.list.filter((y) => y !== x); saveCheats(); applyCheats(false); renderCheats(); });
      li.append(del);
    }
    ul.append(li);
  }
  if (shown.length > lim.length) { const li = document.createElement('li'); li.className = 'more'; li.textContent = (shown.length - lim.length) + ' autres codes : affine la recherche.'; ul.append(li); }
  if (!shown.length && cheat.list.length) { const li = document.createElement('li'); li.className = 'more'; li.textContent = 'Aucun code ne correspond.'; ul.append(li); }
  updateCheatCount();
}
function updateCheatCount() {
  set('#ch-count', cheat.on.size ? cheat.on.size + ' actif' + (cheat.on.size > 1 ? 's' : '') : '');
  $('#ch-off').hidden = !cheat.on.size;
  $('#tab-codes').classList.toggle('dot-on', cheat.on.size > 0);
}
$('#ch-q').addEventListener('input', renderCheats);
$('#ch-off').addEventListener('click', () => { cheat.on.clear(); saveCheats(); applyCheats(); renderCheats(); toast('Tous les codes sont désactivés'); });
$('#ch-add').addEventListener('click', () => {
  if (!rom) { toast('Insère d\'abord une cartouche'); return; }
  const d = $('#ch-name').value.trim() || 'Code perso';
  const parts = Array.from($('#ch-code').value.toUpperCase().matchAll(/([0-9A-F]{8})[\s:]*([0-9A-F]{4})/g), (m) => m[1] + ' ' + m[2]);
  if (!parts.length) { toast('Format attendu : XXXXXXXX YYYY (une instruction par ligne)'); return; }
  const c = parts.join('+');
  cheat.custom.push([d, c]); cheat.list.push({ d, c, mine: true }); cheat.on.add(c);
  $('#ch-name').value = ''; $('#ch-code').value = '';
  saveCheats(); applyCheats(); renderCheats();
  toast('Code ajouté et activé');
});

/* ================= Filet de sécurité : état automatique toutes les 2 minutes (5 gardés) ================= */
if (typeof prefs.safety !== 'boolean') prefs.safety = true;
$('#safety-on').checked = prefs.safety;
$('#safety-on').addEventListener('change', () => { prefs.safety = $('#safety-on').checked; savePrefs(); startSafety(); toast(prefs.safety ? 'Filet de sécurité activé' : 'Filet de sécurité désactivé'); });
let safetyTimer = null, autoBusy = false, lastAuto = 0;
function startSafety() { clearInterval(safetyTimer); safetyTimer = prefs.safety && running ? setInterval(() => autoState('auto'), 120000) : null; renderSafety(); }
async function autoState(kind) {
  const g = gm();
  if (!g || !running || autoBusy || slotBusy) return;
  if (kind === 'auto' && (paused || document.hidden || performance.now() - startedAt < 30000)) return;
  if (kind === 'avant' && Date.now() - lastAuto < 10000) return;
  autoBusy = true;
  try {
    const st = g.getState(), png = await grabThumb(), gz = await gzip(st), t = Date.now();
    await idb.set('auto:' + skey() + ':' + t, { t, kind, size: st.length, png, data: new Blob([gz]) });
    lastAuto = t;
    const all = (await idb.keys('auto:' + skey() + ':')).sort();
    while (all.length > 5) await idb.del(all.shift());
    renderSafety();
  } catch (e) { log('Filet de sécurité : ' + e, 'w'); } finally { autoBusy = false; }
}
const autoUrls = [];
async function renderSafety() {
  const box = $('#safety');
  box.textContent = '';
  autoUrls.splice(0).forEach((u) => URL.revokeObjectURL(u));
  const keys = rom ? (await idb.keys('auto:' + skey() + ':')).sort().reverse() : [];
  if (!keys.length) { const p = document.createElement('p'); p.className = 'hint'; p.style.margin = '0'; p.textContent = prefs.safety ? 'Le premier point de retour sera pris 2 minutes après l\'allumage.' : 'Désactivé.'; box.append(p); return; }
  for (const k of keys) {
    const r = await idb.get(k); if (!r) continue;
    const b = document.createElement('button'); b.className = 'auto';
    if (r.png) { const u = URL.createObjectURL(r.png); autoUrls.push(u); const im = document.createElement('img'); im.src = u; im.alt = ''; b.append(im); }
    const s = document.createElement('small'); s.textContent = r.kind === 'avant' ? 'avant chargement' : ago(r.t);
    b.append(s);
    b.title = 'Revenir à ce moment (' + new Date(r.t).toLocaleTimeString('fr-FR') + ')';
    b.disabled = !running;
    b.addEventListener('click', async () => {
      if (!b.classList.contains('armed')) { $$('#safety .auto.armed').forEach((x) => { x.classList.remove('armed'); }); b.classList.add('armed'); s.dataset.t = s.textContent; s.textContent = 'Revenir ici ?'; setTimeout(() => { if (b.isConnected) { b.classList.remove('armed'); s.textContent = s.dataset.t; } }, 4000); return; }
      await autoState('avant');
      gm().loadState(await gunzip(new Uint8Array(await r.data.arrayBuffer())));
      log('Retour au point du filet de sécurité (' + ago(r.t) + ')', 'k'); toast('Retour en arrière effectué'); renderSafety(); focusGame();
    });
    box.append(b);
  }
}

/* ================= Plein écran (immersif sur écran tactile) ================= */
function toggleFull() {
  if (!running) return;
  if (machine.touch || touchShown) {
    const on = !document.body.classList.contains('immersive');
    document.body.classList.toggle('immersive', on);
    try { if (on && document.documentElement.requestFullscreen) document.documentElement.requestFullscreen({ navigationUI: 'hide' }).then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {})).catch(() => {}); else if (!on && document.fullscreenElement) document.exitFullscreen(); } catch (e) {}
    setTimeout(() => { const e2 = em(); if (e2 && e2.handleResize) e2.handleResize(); }, 120);
    return;
  }
  const e = em(); if (e && e.toggleFullscreen) e.toggleFullscreen(!document.fullscreenElement);
}
$('#imm-exit').addEventListener('click', () => { if (document.body.classList.contains('immersive')) toggleFull(); });
document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement && document.body.classList.contains('immersive')) { document.body.classList.remove('immersive'); setTimeout(() => { const e2 = em(); if (e2 && e2.handleResize) e2.handleResize(); }, 120); } });

$('#log-copy').addEventListener('click', async () => {
  const txt = Array.from(logEl.children, (li) => li.children[0].textContent + '  ' + li.children[1].textContent).join('\n');
  try { await navigator.clipboard.writeText('eden64, journal technique\n' + navigator.userAgent + '\n\n' + txt); toast('Journal copié'); }
  catch (e) { toast('Copie refusée par le navigateur'); }
});

/* ================= Onglets ================= */
const TABS = ['partie', 'image', 'cmd', 'codes', 'infos', 'duo'];
function showTab(name) {
  for (const t of TABS) {
    $('#tab-' + t).setAttribute('aria-selected', String(t === name));
    $('#tab-' + t).tabIndex = t === name ? 0 : -1;
    $('#pane-' + t).hidden = t !== name;
  }
  prefs.tab = name; savePrefs();
  if (name === 'partie' && running) refreshSaveInfo();
  if (name === 'codes') loadCheats();
  if (name !== 'cmd') stopCapture();
}
TABS.forEach((t, i) => {
  $('#tab-' + t).addEventListener('click', () => showTab(t));
  $('#tab-' + t).addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const n = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    showTab(n); $('#tab-' + n).focus();
  });
});
/* ================= Démarrage de la page ================= */
showTab(TABS.includes(prefs.tab) ? prefs.tab : 'partie');
renderGb();
applyBinds();
renderBinds();
renderInputOpts();
renderSafety();
updateQualityUi();
applySpeed();
renderSlots();
(async () => {
  // Ancienne clé « rom » (versions précédentes) -> ludothèque
  const legacy = await idb.get('rom');
  if (legacy && legacy.sha1) { await idb.set('lib:' + legacy.sha1, { sha1: legacy.sha1, name: legacy.name, title: legacy.title, region: '', size: legacy.size, blob: legacy.blob, t: legacy.t, last: legacy.t }); await idb.del('rom'); }
  await renderLibrary();
  await scanFolder();
  let resume = false, insertKey = '';
  try { resume = sessionStorage.getItem('be64-resume') === '1'; sessionStorage.removeItem('be64-resume'); insertKey = sessionStorage.getItem('be64-insert') || ''; sessionStorage.removeItem('be64-insert'); } catch (e) {}
  if (resume) {
    const rec = await idb.get('resume'), rr = await idb.get('resume-rom');
    if (rec && rr && Date.now() - rec.t < 10 * 60 * 1000 && await insertRom(new File([rr.blob], rr.name), { blob: rr.blob, key: rr.key, source: rr.source === 'dossier' ? 'dossier' : undefined }) && rom.sha1 === rec.sha1) {
      resumeState = rec.state ? await gunzip(new Uint8Array(await rec.state.arrayBuffer())) : null;
      set('#idle-title', rec.reason === 'gpu' ? 'Relancé en résolution plus légère' : rec.reason === 'gb' ? 'Nouvelle sauvegarde Game Boy en place' : rec.reason === 'moteur' ? 'Moteur N64 changé' : 'Réglages appliqués');
      set('#idle-hint', rec.state ? 'Ta partie est prête à reprendre exactement là où tu l\'as laissée.' : rec.reason === 'moteur' ? 'Rallume la console : ta sauvegarde du jeu est conservée.' : 'La console redémarre et relit la cartouche Game Boy du Transfer Pak.');
      $('#idle-go').lastChild.textContent = rec.state ? 'Reprendre la partie' : 'Rallumer la console';
      $('#idle-go').focus();
    }
    idb.del('resume'); idb.del('resume-rom');
  } else if (insertKey.startsWith('lib:')) {
    const r = await idb.get(insertKey);
    if (r) insertRom(new File([r.blob], r.name), { blob: r.blob, key: insertKey });
  } else if (insertKey.startsWith('dir:')) {
    const it = libFolder.find((x) => x.key === insertKey);
    if (it) { const r = await fetch(it.url); insertRom(new File([await r.blob()], it.name), { source: 'dossier', key: it.key }); }
  }
})();
// Pour duo.js (module à part) : ce dont « Jouer à deux » a besoin
window.eden = { $, em, showTab, ACTIONS, currentPad, bindOn, audioTap, toast, showNotice, savePrefs, get running() { return running; }, get rom() { return rom; }, get prefs() { return prefs; } };
}
