// Jouer à deux, comme dans PokéLink : un code de salle, et les deux navigateurs se parlent en direct (WebRTC, chiffré).
// L'hôte fait tourner le jeu et envoie l'image et le son ; son ami n'a pas besoin de la cartouche et renvoie ses touches.
// Les relais publics Nostr (Trystero, MIT) servent seulement à se trouver. ?duo=local : deux onglets du même navigateur.
const E = window.eden; // exposé par app.js
const { $, em, ACTIONS, currentPad, bindOn, audioTap, toast, showNotice, savePrefs } = E;

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const makeCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
const cleanCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
const REACTIONS = ['❤️', '🎵', '😂', '👍', '⚡', '❓'];
const MODE_TXT = { watch: 'Ton ami regarde', p1: 'Ton ami joue avec toi (manette 1)', p2: 'Ton ami a la manette 2' };
const GUEST_TXT = { watch: 'Tu regardes', p1: 'Tu joues avec ton ami (manette 1)', p2: 'Tu as la manette 2' };
const local = new URLSearchParams(location.search).get('duo') === 'local';
const inviteCode = cleanCode(new URLSearchParams(location.search).get('salle'));
const full = (s) => (s >= 16 ? 0x7fff : 1);

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

// L'hôte fait toujours l'offre WebRTC, l'ami répond : pas de collision de négociation.
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

/* ---------- Hôte ---------- */
let H = null;
const hostUi = () => {
  const open = !!H;
  $('#duo-idle').hidden = open; $('#duo-host').hidden = !open;
  $('#duo-create').disabled = !E.running;
  $('#duo-idle-hint').textContent = E.running ? 'Ton ami reçoit un lien : il voit ton jeu en direct et joue avec sa manette ou son clavier, sans cartouche.' : 'Allume un jeu, puis crée une salle.';
  if (!open) return;
  $('#duo-code').textContent = H.code;
  $('#duo-status').textContent = H.peer ? 'Ami connecté' + (H.ms != null ? ' · ' + H.ms + ' ms' : '') : 'En attente de ton ami…';
  $('#duo-status').classList.toggle('on', !!H.peer);
  for (const b of $('#duo-mode').children) b.setAttribute('aria-pressed', String(b.dataset.m === H.mode));
  $('#duo-mode-txt').textContent = MODE_TXT[H.mode];
};
function release() {
  const gm = em() && em().gameManager;
  if (H && gm) for (const s of H.held.keys()) gm.simulateInput(H.mode === 'p2' ? 1 : 0, s, 0);
  if (H) H.held.clear();
}
function setMode(m) {
  release(); H.mode = m; E.prefs.duoMode = m; savePrefs();
  H.link.send({ t: 'mode', mode: m }); hostUi();
}
async function createRoom() {
  if (!E.running || H) return;
  const code = makeCode(), c = em().canvas, stream = c.captureStream(E.rom && E.rom.pal ? 50 : 60), tap = audioTap();
  if (tap) for (const t of tap.tap.stream.getAudioTracks()) stream.addTrack(t);
  H = { code, stream, tap, peer: null, ms: null, mode: ['watch', 'p1', 'p2'].includes(E.prefs.duoMode) ? E.prefs.duoMode : 'p1', held: new Map() };
  hostUi();
  try { H.link = await connect(code, true); } catch (e) { toast('Connexion impossible : ' + e.message, 4000); closeRoom(); return; }
  const L = H.link;
  L.onJoin((id) => {
    if (!H) return;
    if (H.peer && H.peer !== id) return L.send({ t: 'full' });
    H.peer = id; L.addStream(stream, id);
    L.send({ t: 'hello', title: E.rom ? E.rom.title : '', mode: H.mode });
    toast('Ton ami a rejoint la salle'); hostUi();
  });
  L.onLeave((id) => { if (!H || id !== H.peer) return; release(); H.peer = null; H.ms = null; toast('Ton ami est parti'); hostUi(); });
  L.onMsg((m) => {
    if (!H || !m) return;
    // Entrée venue d'un autre navigateur : on ne garde que des valeurs valides
    if (m.t === 'in' && H.mode !== 'watch' && Number.isInteger(m.s) && m.s >= 0 && m.s < 24 && Number.isFinite(m.v)) {
      const v = Math.max(0, Math.min(full(m.s), Math.round(m.v))), gm = em() && em().gameManager;
      if (!gm) return;
      gm.simulateInput(H.mode === 'p2' ? 1 : 0, m.s, v);
      if (v) H.held.set(m.s, v); else H.held.delete(m.s);
    }
    if (m.t === 'react') pop($('#game').parentElement, m.r);
    if (m.t === 'ask' && H.mode === 'watch') showNotice('Ton ami demande la manette.', [['Partager la manette 1', () => setMode('p1'), true], ['Plus tard', () => H && H.link.send({ t: 'no' })]]);
  });
  H.timer = setInterval(async () => {
    if (!E.running) { toast('Jeu éteint : salle fermée'); return closeRoom(); }
    if (H.peer) { try { H.ms = Math.round(await L.ping(H.peer)); } catch (e) {} hostUi(); }
  }, 2000);
}
function closeRoom() {
  if (!H) return;
  release(); clearInterval(H.timer);
  try { H.link && H.link.send({ t: 'bye' }); H.link && H.link.leave(); } catch (e) {}
  H.stream.getTracks().forEach((t) => t.stop()); if (H.tap) H.tap.close();
  H = null; hostUi();
}

/* ---------- Ami (invité) ---------- */
function guest(code) {
  window.duoGuest = true; // app.js n'allume pas de jeu local sous la vue invité
  const G = $('#duo-guest'), video = $('#duo-video');
  G.hidden = false; document.body.classList.add('duo-guest-on');
  $('#duo-g-code').textContent = code;
  let link = null, closed = false, mode = 'watch', sent = {}, kb = {}, pad = {};
  const status = (t) => { $('#duo-g-status').textContent = t; };
  const modeUi = () => { $('#duo-g-mode').textContent = GUEST_TXT[mode]; $('#duo-ask').hidden = mode !== 'watch'; };
  const send = (s) => {
    const v = Math.max(kb[s] || 0, pad[s] || 0);
    if ((sent[s] || 0) === v) return;
    sent[s] = v; link && link.send({ t: 'in', s, v });
  };
  const releaseAll = () => { kb = {}; pad = {}; for (const s in sent) send(+s); };
  const slots = () => ACTIONS.filter((a) => !a.hk && a.slot !== undefined);

  $('#duo-join').onclick = async () => {
    $('#duo-join-card').hidden = true; status('Connexion…');
    video.muted = false;
    link = await connect(code, false);
    link.onStream((s) => { video.srcObject = s; video.play().catch(() => {}); status('En direct'); });
    link.onMsg((m) => {
      if (m.t === 'hello') $('#duo-g-title').textContent = String(m.title || '').slice(0, 80);
      if ((m.t === 'hello' || m.t === 'mode') && m.mode in GUEST_TXT) { if (m.t === 'mode') { releaseAll(); toast(GUEST_TXT[m.mode]); } mode = m.mode; modeUi(); }
      if (m.t === 'react') pop(G, m.r);
      if (m.t === 'no') toast('Ton ami garde la manette pour l\'instant');
      if (m.t === 'full') status('Salle pleine : un autre ami est déjà là');
      if (m.t === 'bye') { closed = true; status('Ton ami a fermé la salle'); video.srcObject = null; }
    });
    link.onLeave(() => { if (!closed) status('Ton ami est parti'); releaseAll(); });
    link.onJoin((id) => setInterval(async () => { try { $('#duo-g-ping').textContent = Math.round(await link.ping(id)) + ' ms'; } catch (e) {} }, 2000));
  };
  $('#duo-ask').onclick = () => { link && link.send({ t: 'ask' }); toast('Demande envoyée'); };
  $('#duo-leave').onclick = () => { releaseAll(); link && link.leave(); location.href = location.pathname; };
  reactionBar($('#duo-g-react'), (r) => { pop(G, r); link && link.send({ t: 'react', r }); });

  // Clavier et manette de l'ami, avec ses propres réglages de touches
  addEventListener('keydown', (e) => {
    const a = slots().find((x) => E.prefs.binds.kb[x.id] === e.keyCode);
    if (!a || !link) return;
    e.preventDefault();
    if (!e.repeat) { kb[a.slot] = full(a.slot); send(a.slot); }
  });
  addEventListener('keyup', (e) => { const a = slots().find((x) => E.prefs.binds.kb[x.id] === e.keyCode); if (a) { kb[a.slot] = 0; send(a.slot); } });
  addEventListener('blur', releaseAll);
  const axisRe = /^(LEFT|RIGHT)_STICK_([XY]):([+-])1$/;
  (function poll() {
    const p = link && currentPad();
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

/* ---------- Branchement ---------- */
$('#duo-create').onclick = createRoom;
$('#duo-close').onclick = closeRoom;
$('#duo-copy').onclick = async () => {
  const url = location.origin + location.pathname + '?salle=' + H.code + (local ? '&duo=local' : '');
  try { await navigator.clipboard.writeText(url); toast('Lien copié : envoie-le à ton ami'); } catch (e) { toast(url, 6000); }
};
for (const b of $('#duo-mode').children) b.onclick = () => H && setMode(b.dataset.m);
reactionBar($('#duo-react'), (r) => { if (!H) return; pop($('#game').parentElement, r); H.link.send({ t: 'react', r }); });
$('#duo-go').onclick = () => { const v = $('#duo-in').value, m = v.match(/[?&]salle=([A-Za-z0-9]+)/), c = cleanCode(m ? m[1] : v); if (c) location.search = '?salle=' + c + (local ? '&duo=local' : ''); };
$('#duo-in').onkeydown = (e) => { if (e.key === 'Enter') $('#duo-go').click(); };
setInterval(() => { if (!H) hostUi(); }, 1000);
hostUi();
if (inviteCode) guest(inviteCode);
window.duo = { createRoom, closeRoom, get host() { return H; } };
