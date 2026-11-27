// Jouer à deux, comme dans PokéLink : un code de salle, et les deux navigateurs se parlent en direct (WebRTC, chiffré).
// Deux façons de jouer :
//  - « Chacun sa partie » : chacun a sa cartouche d'Ocarina of Time ; on lit la position de Link dans la mémoire du jeu,
//    on l'envoie à l'ami, et l'ami s'affiche à sa vraie place dans le monde 3D de l'autre (par-dessus l'image).
//  - « Partager mon écran » : l'hôte envoie l'image et le son, l'ami (sans cartouche) renvoie ses touches.
// Les relais publics Nostr (Trystero, MIT) servent seulement à se trouver. ?duo=local : deux onglets du même navigateur.
import { readPose, validPose, linkRenderer } from './duo-link.js';
const E = window.eden; // exposé par app.js
const { $, em, ACTIONS, currentPad, bindOn, audioTap, toast, showNotice, savePrefs } = E;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const cleanName = (s) => String(s || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 16) || 'Ton ami';
const REACTIONS = ['❤️', '🎵', '😂', '👍', '⚡', '❓'];
const MODE_TXT = { watch: 'Ton ami regarde', p1: 'Ton ami joue avec toi (manette 1)', p2: 'Ton ami a la manette 2' };
const GUEST_TXT = { watch: 'Tu regardes', p1: 'Tu joues avec ton ami (manette 1)', p2: 'Tu as la manette 2' };
const params = new URLSearchParams(location.search);
const local = params.get('duo') === 'local';
const inviteCode = cleanCode(params.get('salle'));
const full = (s) => (s >= 16 ? 0x7fff : 1);
const myName = () => cleanName(E.prefs.duoName || 'Joueur');
const TUNICS = { violet: [0.55, 0.25, 0.85, 1], jaune: [0.95, 0.78, 0.12, 1] };
const myTunic = () => (E.prefs.duoTunic in TUNICS ? E.prefs.duoTunic : 'violet');

/* ---------- Liaisons : même interface pour Internet (Trystero) et deux onglets (BroadcastChannel) ---------- */
async function trysteroLink(code) {
  const { joinRoom } = await import('./vendor/trystero.js');
  const cfg = { appId: 'eden64.app/v1', password: 'eden64:' + code };
  let room;
  try { room = joinRoom({ ...cfg, identity: 'none' }, code); } catch (e) { room = joinRoom(cfg, code); }
  const act = room.makeAction('m');
  return {
    send: (m) => act.send(m).catch(() => {}),
    onMsg: (fn) => act.onMessage((d) => fn(d)),
    onJoin: (fn) => room.onPeerJoin((c) => fn(c.peerId)),
    onLeave: (fn) => room.onPeerLeave((c) => fn(c.peerId)),
    addStream: (s, id) => room.addStream(s, { target: id }),
    onStream: (fn) => room.onPeerStream((s) => fn(s)),
    ping: (id) => room.ping(id),
    leave: () => room.leave()
  };
}

// Le créateur de la salle fait toujours l'offre WebRTC, l'autre répond : pas de collision de négociation.
function localLink(code, host) {
  const me = Math.random().toString(36).slice(2), ch = new BroadcastChannel('eden64-duo:' + code);
  const fn = { msg: [], join: [], leave: [], stream: [] };
  let pc = null, dc = null, peer = null;
  const post = (x) => ch.postMessage({ ...x, from: me });
  const makePc = (id) => {
    peer = id; pc = new RTCPeerConnection();
    pc.onicecandidate = (e) => e.candidate && post({ k: 'ice', to: id, c: e.candidate.toJSON() });
    pc.ontrack = (e) => fn.stream.forEach((f) => f(e.streams[0]));
    pc.onnegotiationneeded = async () => { await pc.setLocalDescription(); post({ k: 'sdp', to: id, d: pc.localDescription.toJSON() }); };
  };
  const wire = (d) => {
    dc = d;
    d.onopen = () => fn.join.forEach((f) => f(peer));
    d.onmessage = (e) => fn.msg.forEach((f) => f(JSON.parse(e.data)));
    d.onclose = () => fn.leave.forEach((f) => f(peer));
  };
  ch.onmessage = async ({ data: x }) => {
    if (x.from === me || (x.to && x.to !== me)) return;
    if (x.k === 'hi' && host && !pc) { makePc(x.from); wire(pc.createDataChannel('m')); }
    if (x.k === 'sdp') {
      if (!pc) { makePc(x.from); pc.ondatachannel = (e) => wire(e.channel); }
      await pc.setRemoteDescription(x.d);
      if (x.d.type === 'offer') { await pc.setLocalDescription(); post({ k: 'sdp', to: x.from, d: pc.localDescription.toJSON() }); }
    }
    if (x.k === 'ice' && pc) pc.addIceCandidate(x.c).catch(() => {});
  };
  if (!host) post({ k: 'hi' });
  return {
    send: (m) => dc && dc.readyState === 'open' && dc.send(JSON.stringify(m)),
    onMsg: (f) => fn.msg.push(f), onJoin: (f) => fn.join.push(f), onLeave: (f) => fn.leave.push(f), onStream: (f) => fn.stream.push(f),
    addStream: (s) => s.getTracks().forEach((t) => pc.addTrack(t, s)),
    ping: async () => 1,
    leave: () => { try { dc && dc.close(); pc && pc.close(); } catch (e) {} ch.close(); }
  };
}
const connect = (code, host) => (local ? localLink(code, host) : trysteroLink(code));

/* ---------- Mémoire de la N64 : où est Link ? ---------- */
// La RDRAM vit dans la mémoire du cœur, en mots de 32 bits petit-boutistes. On la retrouve grâce au code de démarrage
// de la cartouche, que la console copie de ROM 0x1000 vers RDRAM 0x400.
// Décalages de la décompilation d'OoT, vérifiés en jeu (notre projection = celle du jeu) :
// PlayState +0xA4 scène, +0x1C44 acteur joueur, +0x11D60 matrice vue-projection ; acteur +0x24 position, +0xB6 orientation.
const OOT = { frames: 0x9C, scene: 0xA4, player: 0x1C44, vp: 0x11D60 };
const KNOWN_PLAY = [0x801C64E0, 0x801C84A0]; // PAL 1.0, NTSC 1.0 ; sinon on cherche dans toute la RAM
const isOot = () => !!E.rom && /^.ZL/.test(E.rom.code || '');
function ram(base) {
  let buf = null, d = null;
  const dv = () => { const b = em().Module.HEAPU8.buffer; if (b !== buf) { buf = b; d = new DataView(b); } return d; };
  const u32 = (a) => dv().getUint32(base + (a & 0x7ffffc), true);
  const s16 = (a) => { const w = u32(a); const v = a & 2 ? w & 0xffff : w >>> 16; return v > 0x7fff ? v - 0x10000 : v; };
  const u8 = (a) => (u32(a) >>> ((3 - (a & 3)) * 8)) & 0xff;
  const f = new DataView(new ArrayBuffer(4));
  const f32 = (a) => { f.setUint32(0, u32(a)); return f.getFloat32(0); };
  return { base, u32, s16, u8, f32 };
}
const isPtr = (v) => v >= 0x80000000 && v < 0x80800000;
const isPlayer = (r, p) => isPtr(p) && !(p & 3) && r.s16(p) === 0 && r.u8(p + 2) === 2;
const isPlay = (r, g) => isPtr(r.u32(g)) && isPtr(r.u32(g + 4)) && isPlayer(r, r.u32(g + OOT.player)) && r.s16(g + OOT.scene) >= 0 && r.s16(g + OOT.scene) < 0x80;
function findPlay(r) {
  for (const g of KNOWN_PLAY) if (isPlay(r, g)) return g;
  for (let g = 0x80000000; g < 0x80800000 - OOT.vp; g += 4) if (isPlay(r, g)) return g;
  return 0;
}
async function bootWords() {
  const b = new DataView(await E.rom.file.slice(0, 0x1010).arrayBuffer()), magic = b.getUint32(0);
  const fix = (v) => (magic === 0x37804012 ? (((v & 0xff00ff) << 8) | ((v >>> 8) & 0xff00ff)) >>> 0 // .v64
    : magic === 0x40123780 ? (((v & 0xff) << 24) | ((v & 0xff00) << 8) | ((v >>> 8) & 0xff00) | (v >>> 24)) >>> 0 : v); // .n64
  return [0, 4, 8, 12].map((o) => fix(b.getUint32(0x1000 + o)));
}
let mem = null, memTry = 0;
async function findRam() {
  if (Date.now() - memTry < 2000) return null;
  memTry = Date.now();
  const want = await bootWords(), H = em().Module.HEAPU8, W = new Uint32Array(H.buffer, 0, H.buffer.byteLength >> 2);
  const found = [];
  for (let i = 0x100; i < W.length - 4; i++) {
    if (W[i] !== want[0] || W[i + 1] !== want[1] || W[i + 2] !== want[2] || W[i + 3] !== want[3]) continue;
    const r = ram(i * 4 - 0x400), play = findPlay(r);
    if (play) found.push({ ...r, play, t: r.u32(play + OOT.frames) });
  }
  // Une copie figée de la RAM peut aussi exister (états instantanés) : on garde celle dont le compteur d'images avance
  await new Promise((res) => setTimeout(res, 120));
  return found.find((r) => r.u32(r.play + OOT.frames) !== r.t) || null;
}
function readMe() {
  if (!mem) return null;
  if (!isPlay(mem, mem.play)) { mem = null; return null; }
  const p = mem.u32(mem.play + OOT.player);
  return { sc: mem.s16(mem.play + OOT.scene), x: mem.f32(p + 0x24), y: mem.f32(p + 0x28), z: mem.f32(p + 0x2C), r: mem.s16(p + 0xB6), ...readPose(mem, p) };
}
// Position envoyée par l'autre navigateur : on ne garde que des nombres plausibles
const validPos = (m) => Number.isInteger(m.sc) && m.sc >= 0 && m.sc < 0x80 && [m.x, m.y, m.z, m.r].every((v) => Number.isFinite(v) && Math.abs(v) < 1e5) && (m.j === undefined || validPose(m));

/* ---------- L'ami dans ton monde : projeté avec la caméra du jeu, dessiné par-dessus l'image ---------- */
const ghost = { samples: [], name: 'Ton ami', title: '', tunic: 'violet', ingame: false, react: null };
let layer = null, glLayer = null, drawLink = null;
// Segments N64 utilisés par le modèle de Link : 6 son objet, 4 gameplay_keep, 8 et 9 yeux et bouche (en tête de l'objet)
function segs() {
  const slot = (want) => { for (let i = 0; i < 19; i++) { const s = mem.play + 0x117A4 + 0xC + i * 0x44; if (want(mem.s16(s))) return { id: mem.s16(s), base: mem.u32(s + 4) }; } return null; };
  const link = slot((id) => id === 0x14 || id === 0x15), keep = slot((id) => id === 1);
  if (!link || !keep) return null;
  const base = { 4: keep.base, 6: link.base, 8: link.base, 9: link.base + 0x4000 };
  return { id: link.id, seg: (a) => (a >= 0x80000000 ? a : (base[a >>> 24] || 0) + (a & 0xffffff)) };
}
function project(x, y, z, M, k) {
  const X = M[0] * x + M[4] * y + M[8] * z + M[12], Y = M[1] * x + M[5] * y + M[9] * z + M[13], W = M[3] * x + M[7] * y + M[11] * z + M[15];
  return { x: 0.5 + 0.5 * k * X / Math.abs(W || 1e-6), y: 0.5 - 0.5 * Y / Math.abs(W || 1e-6), w: W };
}
function friendNow() {
  const s = ghost.samples, t = performance.now() - 100; // rejoué avec 100 ms de retard, sans à-coups
  if (!s.length) return null;
  let i = s.length - 1;
  while (i > 0 && s[i - 1].t > t) i--;
  const a = s[Math.max(0, i - 1)], b = s[i];
  if (a.sc !== b.sc || b.t === a.t) return b;
  const u = Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t)));
  let dr = b.r - a.r; if (dr > 32768) dr -= 65536; if (dr < -32768) dr += 65536;
  const turn = (p, q) => { let d = q - p; if (d > 32768) d -= 65536; if (d < -32768) d += 65536; return Math.round(p + d * u); };
  const j = a.j && b.j && a.o === b.o ? b.j.map((q, i) => (i < 3 ? Math.round(a.j[i] + (q - a.j[i]) * u) : turn(a.j[i], q))) : b.j;
  return { ...b, x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u, z: a.z + (b.z - a.z) * u, r: a.r + dr * u, j };
}
function drawGhost() {
  requestAnimationFrame(drawGhost);
  const c = em() && em().canvas, show = R && R.kind === 'ensemble' && R.peer && E.running && c && mem;
  if (!show) { if (layer) layer.hidden = true; return; }
  if (!layer) { layer = document.createElement('canvas'); layer.className = 'duo-layer'; layer.setAttribute('aria-hidden', 'true'); }
  if (layer.parentElement !== c.parentElement) c.parentElement.append(layer);
  layer.hidden = false;
  // Zone réellement occupée par l'image (le canvas peut être cadré avec des bandes)
  const box = c.getBoundingClientRect(), host = c.parentElement.getBoundingClientRect(), ar = c.width / c.height;
  const w = Math.min(box.width, box.height * ar), h = w / ar, left = box.left - host.left + (box.width - w) / 2, top = box.top - host.top + (box.height - h) / 2;
  const dpr = devicePixelRatio || 1;
  Object.assign(layer.style, { left: left + 'px', top: top + 'px', width: w + 'px', height: h + 'px' });
  if (layer.width !== Math.round(w * dpr)) layer.width = Math.round(w * dpr);
  if (layer.height !== Math.round(h * dpr)) layer.height = Math.round(h * dpr);
  const g = layer.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  if (!glLayer) { glLayer = document.createElement('canvas'); glLayer.className = 'duo-layer'; glLayer.setAttribute('aria-hidden', 'true'); drawLink = linkRenderer(glLayer); }
  if (glLayer.nextSibling !== layer) layer.before(glLayer);
  glLayer.style.cssText = layer.style.cssText;
  if (glLayer.width !== layer.width || glLayer.height !== layer.height) { glLayer.width = layer.width; glLayer.height = layer.height; }
  const me = readMe(), f = friendNow();
  glLayer.hidden = true;
  if (!me || !f || !ghost.ingame || f.sc !== me.sc) return;
  const M = []; for (let i = 0; i < 16; i++) M.push(mem.f32(mem.play + OOT.vp + i * 4));
  const k = E.prefs.quality && E.prefs.quality.aspect === '16:9' ? 0.75 : 1; // GLideN64 élargit l'image en gardant le 4:3 au centre
  // Le vrai Link, quand ton ami a le même âge que toi (son modèle est alors dans ta mémoire)
  const sg = drawLink && f.j && segs();
  if (sg && sg.id === f.o && feet0(f, M, k)) {
    try { drawLink(mem, sg.seg, f, new Float32Array(M), k, TUNICS[ghost.tunic]); glLayer.hidden = false; } catch (e) { console.warn('[eden64] modèle de Link', e); drawLink = null; }
  }
  const P = (x, y, z) => { const p = project(x, y, z, M, k); return { x: p.x * w, y: p.y * h, w: p.w }; };
  const feet = P(f.x, f.y, f.z), head = P(f.x, f.y + 52, f.z), label = P(f.x, f.y + 78, f.z);
  const col = '#2fbf71', inView = feet.w > 1 && head.x > -40 && head.x < w + 40 && head.y > -40 && feet.y < h + 40;
  if (!inView) return edgeArrow(g, w, h, feet, col);
  const s = Math.max(2.5, Math.min(36, 900 / feet.w));
  if (!glLayer.hidden) return tag(g, label.x, label.y, ghost.name, ghost.react && performance.now() - ghost.react.t < 2500 ? ghost.react.r : '');
  // Anneau au sol et sens du regard : ils donnent la profondeur
  g.beginPath();
  for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI * 2, p = P(f.x + Math.sin(a) * 20, f.y + 1, f.z + Math.cos(a) * 20); i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y); }
  g.fillStyle = col + '33'; g.fill(); g.lineWidth = Math.max(1.5, s / 6); g.strokeStyle = col; g.stroke();
  const ang = (f.r / 32768) * Math.PI, tip = P(f.x + Math.sin(ang) * 34, f.y + 1, f.z + Math.cos(ang) * 34);
  const l = P(f.x + Math.sin(ang + 0.5) * 21, f.y + 1, f.z + Math.cos(ang + 0.5) * 21), r = P(f.x + Math.sin(ang - 0.5) * 21, f.y + 1, f.z + Math.cos(ang - 0.5) * 21);
  g.beginPath(); g.moveTo(tip.x, tip.y); g.lineTo(l.x, l.y); g.lineTo(r.x, r.y); g.closePath(); g.fillStyle = col; g.fill();
  // Silhouette : un corps et une tête, translucides
  g.lineCap = 'round'; g.globalAlpha = 0.85;
  g.beginPath(); g.moveTo(feet.x, feet.y - s * 0.4); g.lineTo(head.x, head.y + s * 0.9); g.lineWidth = s * 1.3; g.strokeStyle = col; g.stroke();
  g.beginPath(); g.arc(head.x, head.y, s * 0.75, 0, Math.PI * 2); g.fillStyle = col; g.fill();
  g.globalAlpha = 1; g.lineWidth = Math.max(1, s / 8); g.strokeStyle = '#0b3d22'; g.stroke();
  tag(g, label.x, label.y, ghost.name, ghost.react && performance.now() - ghost.react.t < 2500 ? ghost.react.r : '');
}
const feet0 = (f, M, k) => project(f.x, f.y, f.z, M, k).w > 1;
function tag(g, x, y, name, react) {
  g.font = '600 13px "IBM Plex Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'bottom';
  const tw = g.measureText(name).width + 14;
  g.fillStyle = '#0b0c0fcc'; g.beginPath(); g.roundRect(x - tw / 2, y - 22, tw, 20, 8); g.fill();
  g.fillStyle = '#fff'; g.fillText(name, x, y - 5);
  if (react) { g.font = '28px system-ui, sans-serif'; g.fillText(react, x, y - 26); }
}
// Ami hors de l'écran (ou derrière la caméra) : une flèche au bord, vers lui
function edgeArrow(g, w, h, p, col) {
  let dx = p.x - w / 2, dy = p.y - h / 2;
  if (p.w < 0) { dx = -dx; dy = -dy; }
  const n = Math.hypot(dx, dy) || 1, sc = Math.min((w / 2 - 26) / Math.abs(dx / n || 1e-6), (h / 2 - 26) / Math.abs(dy / n || 1e-6));
  const x = w / 2 + (dx / n) * sc, y = h / 2 + (dy / n) * sc, a = Math.atan2(dy, dx);
  g.save(); g.translate(x, y); g.rotate(a);
  g.beginPath(); g.moveTo(14, 0); g.lineTo(-8, -10); g.lineTo(-8, 10); g.closePath(); g.fillStyle = col; g.fill(); g.lineWidth = 2; g.strokeStyle = '#0b3d22'; g.stroke();
  g.restore();
  tag(g, Math.max(40, Math.min(w - 40, x)), Math.max(48, Math.min(h - 4, y + (dy > 0 ? -16 : 40))), ghost.name, '');
}

/* ---------- Salle (créateur ou invité) ---------- */
let R = null; // { code, kind, host, link, peer, ms, mode, held, stream, tap }
const hereTxt = () => {
  if (!R || R.kind !== 'ensemble') return '';
  if (!R.peer) return '';
  if (!E.running) return 'Allume ton jeu pour apparaître chez ' + ghost.name + '.';
  if (!isOot()) return 'Chacun sa partie marche avec Ocarina of Time.';
  if (!ghost.ingame) return ghost.name + ' n\'est pas encore en jeu.';
  const me = readMe(), f = friendNow();
  if (!me || !f) return 'Recherche de Link dans la mémoire du jeu…';
  if (f.sc !== me.sc) return ghost.name + ' est dans une autre zone.';
  return ghost.name + ' est dans la même zone, à ' + Math.max(1, Math.round(Math.hypot(f.x - me.x, f.z - me.z) / 40)) + ' m.';
};
function roomUi() {
  const open = !!R;
  $('#duo-idle').hidden = open; $('#duo-host').hidden = !open;
  $('#duo-create').disabled = !E.running;
  if (!open) return;
  $('#duo-kind').textContent = R.kind === 'ensemble' ? 'Chacun sa partie' : 'Écran partagé';
  $('#duo-code').textContent = R.code;
  $('#duo-status').textContent = R.peer ? ghost.name + ' est connecté' + (R.ms != null ? ' · ' + R.ms + ' ms' : '') : R.host ? 'En attente de ton ami…' : 'Connexion à la salle…';
  $('#duo-status').classList.toggle('on', !!R.peer);
  $('#duo-where').textContent = hereTxt();
  $('#duo-ecran').hidden = R.kind !== 'ecran';
  if (R.kind === 'ecran') {
    for (const b of $('#duo-mode').children) b.setAttribute('aria-pressed', String(b.dataset.m === R.mode));
    $('#duo-mode-txt').textContent = MODE_TXT[R.mode];
  }
}
function release() {
  const gm = em() && em().gameManager;
  if (R && R.held && gm) for (const s of R.held.keys()) gm.simulateInput(R.mode === 'p2' ? 1 : 0, s, 0);
  if (R && R.held) R.held.clear();
}
function setMode(m) {
  release(); R.mode = m; E.prefs.duoMode = m; savePrefs();
  R.link.send({ t: 'mode', mode: m }); roomUi();
}
const hello = () => R.link.send({ t: 'hello', kind: R.kind, name: myName(), tunic: myTunic(), title: E.rom ? E.rom.title : '', mode: R.mode });

async function openRoom(kind, code, host) {
  if (R) return;
  if (kind === 'ecran' && !E.running) return;
  R = { code, kind, host, peer: null, ms: null, mode: ['watch', 'p1', 'p2'].includes(E.prefs.duoMode) ? E.prefs.duoMode : 'p1', held: new Map() };
  if (kind === 'ecran') {
    R.stream = em().canvas.captureStream(E.rom && E.rom.pal ? 50 : 60); R.tap = audioTap();
    if (R.tap) for (const t of R.tap.tap.stream.getAudioTracks()) R.stream.addTrack(t);
  }
  ghost.samples = []; ghost.ingame = false;
  roomUi();
  try { R.link = await connect(code, host); } catch (e) { toast('Connexion impossible : ' + e.message, 4000); closeRoom(); return; }
  const L = R.link;
  if (!host) L.onStream((s) => { const v = $('#duo-video'); v.srcObject = s; v.play().catch(() => {}); $('#duo-g-status').textContent = 'En direct'; });
  L.onJoin((id) => {
    if (!R) return;
    if (R.peer && R.peer !== id) return L.send({ t: 'full' });
    R.peer = id;
    if (R.stream) L.addStream(R.stream, id);
    hello(); roomUi();
  });
  L.onLeave((id) => { if (!R || id !== R.peer) return; release(); R.peer = null; R.ms = null; ghost.samples = []; toast(ghost.name + ' est parti'); roomUi(); });
  L.onMsg((m) => {
    if (!R || !m) return;
    if (m.t === 'hello') {
      const first = !R.greeted;
      ghost.name = cleanName(m.name); ghost.title = String(m.title || '').slice(0, 80); ghost.tunic = m.tunic in TUNICS ? m.tunic : 'violet'; R.greeted = true;
      if (first) toast(ghost.name + ' est dans la salle');
      if (!R.host && m.kind === 'ecran') return watch(m); // salle « écran partagé » : vue invité
      if (!R.host) R.kind = 'ensemble';
      roomUi();
    }
    if (m.t === 'pos') {
      ghost.ingame = !!m.in && validPos(m);
      if (ghost.ingame) { ghost.samples.push({ sc: m.sc, x: m.x, y: m.y, z: m.z, r: m.r, o: m.o, j: m.j, d: m.d, t: performance.now() }); if (ghost.samples.length > 8) ghost.samples.shift(); }
    }
    // Entrée venue d'un autre navigateur (écran partagé) : on ne garde que des valeurs valides
    if (m.t === 'in' && R.kind === 'ecran' && R.host && R.mode !== 'watch' && Number.isInteger(m.s) && m.s >= 0 && m.s < 24 && Number.isFinite(m.v)) {
      const v = Math.max(0, Math.min(full(m.s), Math.round(m.v))), gm = em() && em().gameManager;
      if (!gm) return;
      gm.simulateInput(R.mode === 'p2' ? 1 : 0, m.s, v);
      if (v) R.held.set(m.s, v); else R.held.delete(m.s);
    }
    if (m.t === 'react' && REACTIONS.includes(m.r)) { ghost.react = { r: m.r, t: performance.now() }; pop($('#game').parentElement, m.r); }
    if (m.t === 'ask' && R.kind === 'ecran' && R.mode === 'watch') showNotice(ghost.name + ' demande la manette.', [['Partager la manette 1', () => setMode('p1'), true], ['Plus tard', () => R && R.link.send({ t: 'no' })]]);
    if (m.t === 'bye' && !R.host) { toast('La salle est fermée'); closeRoom(true); }
  });
  R.timer = setInterval(async () => {
    if (!R) return;
    if (R.kind === 'ecran' && R.host && !E.running) { toast('Jeu éteint : salle fermée'); return closeRoom(); }
    if (R.peer) { hello(); try { R.ms = Math.round(await L.ping(R.peer)); } catch (e) {} } // le pseudo est renvoyé : rien ne se perd au démarrage
    roomUi();
  }, 2000);
  R.pos = setInterval(async () => { // ~15 fois par seconde : où est mon Link
    if (!R || R.kind !== 'ensemble' || !R.peer) return;
    if (E.running && isOot() && !mem && em() && em().Module) mem = await findRam().catch(() => null);
    const me = E.running ? readMe() : null;
    L.send(me ? { t: 'pos', in: 1, ...me } : { t: 'pos', in: 0 });
  }, 66);
}
function closeRoom(quiet) {
  if (!R) return;
  release(); clearInterval(R.timer); clearInterval(R.pos);
  try { if (!quiet) R.link && R.link.send({ t: 'bye' }); R.link && R.link.leave(); } catch (e) {}
  if (R.stream) R.stream.getTracks().forEach((t) => t.stop());
  if (R.tap) R.tap.close();
  R = null; ghost.samples = []; roomUi();
}

/* ---------- Invité d'un écran partagé : il voit le jeu de l'hôte et renvoie ses touches ---------- */
function watch(hi) {
  window.duoGuest = true; // app.js n'allume pas de jeu local sous la vue invité
  const G = $('#duo-guest'), video = $('#duo-video'), link = R.link;
  G.hidden = false; document.body.classList.add('duo-guest-on');
  $('#duo-g-code').textContent = R.code; $('#duo-g-title').textContent = ghost.title;
  let closed = false, mode = hi.mode in GUEST_TXT ? hi.mode : 'watch', sent = {}, kb = {}, pad = {};
  const status = (t) => { $('#duo-g-status').textContent = t; };
  const modeUi = () => { $('#duo-g-mode').textContent = GUEST_TXT[mode]; $('#duo-ask').hidden = mode !== 'watch'; };
  const send = (s) => {
    const v = Math.max(kb[s] || 0, pad[s] || 0);
    if ((sent[s] || 0) === v) return;
    sent[s] = v; link.send({ t: 'in', s, v });
  };
  const releaseAll = () => { kb = {}; pad = {}; for (const s in sent) send(+s); };
  const slots = () => ACTIONS.filter((a) => !a.hk && a.slot !== undefined);
  if (!video.srcObject) status('Connecté');
  link.onMsg((m) => {
    if ((m.t === 'hello' || m.t === 'mode') && m.mode in GUEST_TXT) { if (m.t === 'mode') { releaseAll(); toast(GUEST_TXT[m.mode]); } mode = m.mode; modeUi(); }
    if (m.t === 'react') pop(G, m.r);
    if (m.t === 'no') toast(ghost.name + ' garde la manette pour l\'instant');
    if (m.t === 'full') status('Salle pleine : un autre ami est déjà là');
    if (m.t === 'bye') { closed = true; status(ghost.name + ' a fermé la salle'); video.srcObject = null; }
  });
  link.onLeave(() => { if (!closed) status(ghost.name + ' est parti'); releaseAll(); });
  // Le son ne démarre qu'après un clic (règle des navigateurs)
  $('#duo-join').onclick = () => { $('#duo-join-card').hidden = true; video.muted = false; video.play().catch(() => {}); };
  $('#duo-ask').onclick = () => { link.send({ t: 'ask' }); toast('Demande envoyée'); };
  $('#duo-leave').onclick = () => { releaseAll(); link.leave(); location.href = location.pathname; };
  reactionBar($('#duo-g-react'), (r) => { pop(G, r); link.send({ t: 'react', r }); });
  addEventListener('keydown', (e) => {
    const a = slots().find((x) => E.prefs.binds.kb[x.id] === e.keyCode);
    if (!a) return;
    e.preventDefault();
    if (!e.repeat) { kb[a.slot] = full(a.slot); send(a.slot); }
  });
  addEventListener('keyup', (e) => { const a = slots().find((x) => E.prefs.binds.kb[x.id] === e.keyCode); if (a) { kb[a.slot] = 0; send(a.slot); } });
  addEventListener('blur', releaseAll);
  const axisRe = /^(LEFT|RIGHT)_STICK_([XY]):([+-])1$/;
  (function poll() {
    const p = currentPad();
    if (p) for (const a of slots()) {
      const b = E.prefs.binds.pad[a.id], m = b && b.match(axisRe);
      let v = 0;
      if (m) {
        const x = (p.axes[(m[1] === 'LEFT' ? 0 : 2) + (m[2] === 'Y' ? 1 : 0)] || 0) * (m[3] === '+' ? 1 : -1);
        if (x > E.prefs.stick.dz / 100) v = a.slot >= 16 ? Math.round(Math.min(1, x) * 32) * 1023 : 1; // 32 crans : assez fin, peu de messages
      } else if (bindOn(p, b)) v = full(a.slot);
      pad[a.slot] = v; send(a.slot);
    }
    requestAnimationFrame(poll);
  })();
  modeUi();
}

/* ---------- Réactions : une bulle qui monte au-dessus du jeu ---------- */
function pop(where, r) {
  if (!REACTIONS.includes(r)) return;
  const el = document.createElement('div');
  el.className = 'duo-pop'; el.textContent = r; el.style.left = 20 + Math.random() * 60 + '%';
  where.append(el); setTimeout(() => el.remove(), 2200);
}
function reactionBar(box, send) {
  box.replaceChildren(...REACTIONS.map((r) => {
    const b = document.createElement('button'); b.className = 'btn sm duo-r'; b.textContent = r; b.title = 'Envoyer ' + r;
    b.onclick = () => send(r); return b;
  }));
}

/* ---------- Branchement ---------- */
$('#duo-name').value = E.prefs.duoName || '';
for (const b of $('#duo-tunic').children) { b.setAttribute('aria-pressed', String(b.dataset.c === myTunic())); b.onclick = () => { E.prefs.duoTunic = b.dataset.c; savePrefs(); for (const x of $('#duo-tunic').children) x.setAttribute('aria-pressed', String(x === b)); }; }
$('#duo-name').onchange = () => { E.prefs.duoName = cleanName($('#duo-name').value); savePrefs(); };
$('#duo-create-ens').onclick = () => openRoom('ensemble', makeCode(), true);
$('#duo-create').onclick = () => openRoom('ecran', makeCode(), true);
$('#duo-close').onclick = () => closeRoom();
$('#duo-copy').onclick = async () => {
  const url = location.origin + location.pathname + '?salle=' + R.code + (local ? '&duo=local' : '');
  try { await navigator.clipboard.writeText(url); toast('Lien copié : envoie-le à ton ami'); } catch (e) { toast(url, 6000); }
};
for (const b of $('#duo-mode').children) b.onclick = () => R && R.kind === 'ecran' && setMode(b.dataset.m);
reactionBar($('#duo-react'), (r) => { if (!R) return; pop($('#game').parentElement, r); R.link.send({ t: 'react', r }); });
$('#duo-go').onclick = () => { const v = $('#duo-in').value, m = v.match(/[?&]salle=([A-Za-z0-9]+)/), c = cleanCode(m ? m[1] : v); if (c) openRoom('ensemble', c, false); };
$('#duo-in').onkeydown = (e) => { if (e.key === 'Enter') $('#duo-go').click(); };
setInterval(() => { if (!R) roomUi(); }, 1000);
roomUi();
requestAnimationFrame(drawGhost);
if (inviteCode) { E.showTab('duo'); openRoom('ensemble', inviteCode, false); }
// Pour les tests : injecter une position d'ami
window.duo = { openRoom, closeRoom, get room() { return R; }, get ghost() { return ghost; }, get mem() { return mem; }, readMe, feed: (m) => { ghost.ingame = true; ghost.samples.push({ ...m, t: performance.now() - 200 }, { ...m, t: performance.now() }); } };
