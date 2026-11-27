// Le vrai modèle 3D de Link, lu dans la mémoire du jeu en cours (rien du jeu n'est copié dans le dépôt) :
// ses listes d'affichage N64 (F3DEX2) sont traduites en triangles WebGL, posées avec les os envoyés par l'ami,
// et la tunique prend une autre couleur, comme le jeu le fait pour les tuniques Goron et Zora.
// Décalages vérifiés en jeu : Player +0x1A4 SkelAnime (+4 squelette, +0x20 os) ; ObjectContext à PlayState +0x117A4.

// Tableaux de listes d'affichage de Player (+0x150..+0x15C) et membre qu'ils remplacent (vérifié en jeu)
const HAND_OFF = [0x150, 0x154, 0x158, 0x15C], HAND_LIMBS = [18, 15, 19, 1];

/* ---------- Côté joueur : ce qu'on envoie à l'ami ---------- */
function linkObject(m) {
  for (let i = 0; i < 19; i++) {
    const s = m.play + 0x117A4 + 0xC + i * 0x44, id = m.s16(s);
    if (id === 0x14 || id === 0x15) return { id, base: m.u32(s + 4) }; // 0x14 adulte, 0x15 enfant
  }
  return null;
}
export function readPose(m, pl) {
  const o = linkObject(m), jt = m.u32(pl + 0x1A4 + 0x20), sk = m.u32(pl + 0x1A4 + 4);
  if (!o || !(jt >= 0x80000000 && jt < 0x80800000) || !(sk >= 0x80000000 && sk < 0x80800000)) return null;
  const j = [];
  for (let i = 0; i < 23 * 3; i++) j.push(m.s16(jt + i * 2));
  // Les tableaux de listes ont une entrée par âge et par niveau de détail : on prend celle du squelette chargé
  const waist = m.u32(o.base + ((m.u32(sk + 4) & 0xffffff) + 8)), wt = m.u32(pl + 0x15C);
  let k = 0;
  for (let i = 0; i < 4; i++) if (m.u32(wt + i * 4) === waist) { k = i; break; }
  return { o: o.id, j, d: HAND_OFF.map((off) => m.u32(m.u32(pl + off) + k * 4)) };
}
export const validPose = (p) => p && (p.o === 0x14 || p.o === 0x15) && Array.isArray(p.j) && p.j.length === 69 && p.j.every((v) => Number.isInteger(v) && v >= -32768 && v < 32768)
  && Array.isArray(p.d) && p.d.length === 4 && p.d.every((v) => Number.isInteger(v) && (v === 0 || (v >>> 24) === 6));

/* ---------- Côté ami : lire le modèle dans ma mémoire et le dessiner ---------- */
// Entrées du combineur de couleurs N64 (A - B) * C + D, par emplacement ; c = résultat du cycle précédent
const IN = { a: 'c t t p s e 1 0', b: 'c t t p s e .5 0', c: 'c t t p s e 1 c.a t.a t.a p.a s.a e.a 0 1 0', d: 'c t t p s e 1 0', A: 'c t t p s e 1 0', C: '0 t t p s e 1 0' };
const pick = (slot, i) => {
  const v = IN[slot].split(' ')[i] || '0', alpha = slot === 'A' || slot === 'C';
  if (/^[ctpse]$/.test(v)) return alpha ? v + '.a' : v + '.rgb';
  const n = /^[ctpse]\.a$/.test(v) ? v : (+v).toFixed(2);
  return alpha ? n : 'vec3(' + n + ')';
};
function combinerGlsl(w0, w1) {
  const f = (w, s, n) => (w >>> s) & ((1 << n) - 1);
  const cyc = (a, b, c, d, Aa, Ab, Ac, Ad) =>
    `c = vec4((${pick('a', a)} - ${pick('b', b)}) * ${pick('c', c)} + ${pick('d', d)}, (${pick('A', Aa)} - ${pick('A', Ab)}) * ${pick('C', Ac)} + ${pick('A', Ad)});`;
  return cyc(f(w0, 20, 4), f(w1, 28, 4), f(w0, 15, 5), f(w1, 15, 3), f(w0, 12, 3), f(w1, 12, 3), f(w0, 9, 3), f(w1, 9, 3)) + '\n'
    + cyc(f(w0, 5, 4), f(w1, 24, 4), f(w0, 0, 5), f(w1, 6, 3), f(w1, 21, 3), f(w1, 3, 3), f(w1, 18, 3), f(w1, 0, 3));
}
const VS = `#version 300 es
in vec3 aPos; in vec4 aCol; in vec2 aUv; in float aBone;
uniform mat4 uVP, uWorld, uBones[24]; uniform float uK, uLit;
out vec4 vShade; out vec2 vUv;
void main() {
  mat4 m = uWorld * uBones[int(aBone)];
  vec4 p = uVP * m * vec4(aPos, 1.0); p.x *= uK; gl_Position = p;
  vec3 n = normalize(mat3(m) * aCol.xyz);
  float l = 0.55 + 0.6 * max(dot(n, normalize(vec3(0.3, 0.8, 0.5))), 0.0);
  vShade = uLit > 0.5 ? vec4(vec3(min(l, 1.0)), aCol.a) : aCol; vUv = aUv;
}`;
const FS = (body) => `#version 300 es
precision mediump float;
in vec4 vShade; in vec2 vUv; uniform sampler2D uTex; uniform vec4 uPrim, uEnv; out vec4 o;
void main() {
  vec4 t = texture(uTex, vUv), s = vShade, p = uPrim, e = uEnv, c = vec4(0.0);
  ${body}
  if (c.a < 0.4) discard;
  o = vec4(clamp(c.rgb, 0.0, 1.0), 1.0);
}`;

export function linkRenderer(canvas) {
  const gl = canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: false, antialias: true });
  if (!gl) return null;
  const progs = new Map(), texs = new Map(), meshes = new Map();
  const program = (key, body) => {
    if (progs.has(key)) return progs.get(key);
    const sh = (t, s) => { const x = gl.createShader(t); gl.shaderSource(x, s); gl.compileShader(x); if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x)); return x; };
    const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS(body)));
    ['aPos', 'aCol', 'aUv', 'aBone'].forEach((n, i) => gl.bindAttribLocation(p, i, n));
    gl.linkProgram(p);
    const u = {}; for (const n of ['uVP', 'uWorld', 'uBones', 'uK', 'uLit', 'uTex', 'uPrim', 'uEnv']) u[n] = gl.getUniformLocation(p, n);
    const r = { p, u }; progs.set(key, r); return r;
  };
  const white = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, white); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([255, 255, 255, 255]));

  // Texture N64 → RGBA (formats utilisés par Link : RGBA16, CI4/CI8 avec palette RGBA16, IA, I)
  function texture(m, seg, t, addr, tlut) {
    const key = [addr, t.fmt, t.siz, t.w, t.h, t.line, t.pal, tlut && tlut.addr, t.cms, t.cmt].join(',');
    if (texs.has(key)) return texs.get(key);
    const a = seg(addr), out = new Uint8Array(t.w * t.h * 4), row = t.line * 8;
    const pal = (i) => { const c = m.s16(seg(tlut.addr) + ((t.pal * 16 + i) - tlut.start) * 2) & 0xffff; return [((c >> 11) & 31) * 8.226, ((c >> 6) & 31) * 8.226, ((c >> 1) & 31) * 8.226, c & 1 ? 255 : 0]; };
    for (let y = 0; y < t.h; y++) for (let x = 0; x < t.w; x++) {
      let px;
      if (t.siz === 0) { const b = m.u8(a + y * row + (x >> 1)), n = x & 1 ? b & 15 : b >> 4; px = t.fmt === 2 && tlut ? pal(n) : t.fmt === 3 ? [(n >> 1) * 36, (n >> 1) * 36, (n >> 1) * 36, n & 1 ? 255 : 0] : [n * 17, n * 17, n * 17, n * 17]; }
      else if (t.siz === 1) { const n = m.u8(a + y * row + x); px = t.fmt === 2 && tlut ? pal(n) : t.fmt === 3 ? [(n >> 4) * 17, (n >> 4) * 17, (n >> 4) * 17, (n & 15) * 17] : [n, n, n, n]; }
      else if (t.siz === 2) { const c = m.s16(a + y * row + x * 2) & 0xffff; px = t.fmt === 3 ? [c >> 8, c >> 8, c >> 8, c & 255] : [((c >> 11) & 31) * 8.226, ((c >> 6) & 31) * 8.226, ((c >> 1) & 31) * 8.226, c & 1 ? 255 : 0]; }
      else { const c = m.u32(a + y * row + x * 4); px = [c >>> 24, (c >>> 16) & 255, (c >>> 8) & 255, c & 255]; }
      out.set(px, (y * t.w + x) * 4);
    }
    const tx = gl.createTexture(), wrap = (cm) => (cm & 2 ? gl.CLAMP_TO_EDGE : cm & 1 ? gl.MIRRORED_REPEAT : gl.REPEAT);
    gl.bindTexture(gl.TEXTURE_2D, tx);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, t.w, t.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, out);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap(t.cms)); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap(t.cmt));
    texs.set(key, tx); return tx;
  }

  // Une liste d'affichage → des lots de triangles (un lot par matériau). bone = matrice du membre (segment 0x0D).
  function mesh(m, seg, dl, bone) {
    const key = dl + ':' + bone;
    if (meshes.has(key)) return meshes.get(key);
    const vb = [], groups = [], st = { tiles: [], tmem: {}, tex: { s: 1, t: 1, tile: 0 }, geom: 0, prim: [1, 1, 1, 1], env: null, comb: [0, 0] };
    let bon = bone, timg = null, tlut = null, cur = null, steps = 0;
    const flush = () => {
      const t = st.tiles[st.tex.tile] || {}, tex = t.w ? texture(m, seg, t, st.tmem[t.tmem], tlut) : white;
      const k = [tex === white ? 0 : t.w, st.comb, st.geom & 0x20000, st.prim, st.env].join('|');
      if (cur && cur.k === k) return;
      cur = { k, tex, t, v: [], comb: st.comb.slice(), lit: st.geom & 0x20000 ? 1 : 0, prim: st.prim.slice(), env: st.env && st.env.slice(), cull: st.geom & 0x600 };
      groups.push(cur);
    };
    const tri = (a, b, c) => { flush(); for (const i of [a, b, c]) if (vb[i]) cur.v.push(...vb[i](cur.t)); };
    const run = (addr, depth) => {
      for (let pc = seg(addr); steps++ < 6000 && depth < 10; pc += 8) {
        const w0 = m.u32(pc), w1 = m.u32(pc + 4), op = w0 >>> 24;
        if (op === 0x01) {
          const n = (w0 >>> 12) & 0xff, v0 = ((w0 >>> 1) & 0x7f) - n, va = seg(w1);
          for (let i = 0; i < n && v0 + i < 64; i++) {
            const p = va + i * 16, x = m.s16(p), y = m.s16(p + 2), z = m.s16(p + 4), s = m.s16(p + 8), tt = m.s16(p + 10);
            const c = [m.u8(p + 12), m.u8(p + 13), m.u8(p + 14), m.u8(p + 15)], lit = st.geom & 0x20000, b = bon, sc = st.tex;
            const col = lit ? [((c[0] << 24) >> 24) / 127, ((c[1] << 24) >> 24) / 127, ((c[2] << 24) >> 24) / 127, c[3] / 255] : c.map((q) => q / 255);
            vb[v0 + i] = (t) => [x, y, z, ...col, t.w ? (s / 32 * sc.s - t.uls / 4) / t.w : 0, t.w ? (tt / 32 * sc.t - t.ult / 4) / t.h : 0, b];
          }
        } else if (op === 0x05) tri((w0 >>> 17) & 0x7f, (w0 >>> 9) & 0x7f, (w0 >>> 1) & 0x7f);
        else if (op === 0x06 || op === 0x07) { tri((w0 >>> 17) & 0x7f, (w0 >>> 9) & 0x7f, (w0 >>> 1) & 0x7f); tri((w1 >>> 17) & 0x7f, (w1 >>> 9) & 0x7f, (w1 >>> 1) & 0x7f); }
        else if (op === 0xDE) { if (w0 & 0x10000) { pc = seg(w1) - 8; } else run(w1, depth + 1); }
        else if (op === 0xDF) return;
        else if (op === 0xDA && (w1 >>> 24) === 0x0D) bon = (w1 & 0xffffff) / 0x40;
        else if (op === 0xD7) st.tex = { s: ((w1 >>> 16) || 0x10000) / 0x10000, t: ((w1 & 0xffff) || 0x10000) / 0x10000, tile: (w0 >>> 8) & 7 };
        else if (op === 0xD9) st.geom = (st.geom & (w0 | 0xff000000)) | w1;
        else if (op === 0xFD) timg = w1;
        else if (op === 0xF5) { const i = (w1 >>> 24) & 7; st.tiles[i] = { ...st.tiles[i], fmt: (w0 >>> 21) & 7, siz: (w0 >>> 19) & 3, line: (w0 >>> 9) & 0x1ff, tmem: w0 & 0x1ff, pal: (w1 >>> 20) & 15, cmt: (w1 >>> 18) & 3, cms: (w1 >>> 8) & 3 }; }
        else if (op === 0xF2) { const t = st.tiles[(w1 >>> 24) & 7] || (st.tiles[(w1 >>> 24) & 7] = {}); t.uls = (w0 >>> 12) & 0xfff; t.ult = w0 & 0xfff; t.w = (((w1 >>> 12) & 0xfff) - t.uls) / 4 + 1; t.h = ((w1 & 0xfff) - t.ult) / 4 + 1; }
        else if (op === 0xF3 || op === 0xF4) { const t = st.tiles[(w1 >>> 24) & 7]; if (t) st.tmem[t.tmem] = timg; }
        else if (op === 0xF0) { const t = st.tiles[(w1 >>> 24) & 7]; if (t) tlut = { addr: timg, start: t.tmem - 256 }; }
        else if (op === 0xFC) st.comb = [w0 & 0xffffff, w1];
        else if (op === 0xFA) st.prim = [w1 >>> 24, (w1 >>> 16) & 255, (w1 >>> 8) & 255, w1 & 255].map((q) => q / 255);
        else if (op === 0xFB) st.env = [w1 >>> 24, (w1 >>> 16) & 255, (w1 >>> 8) & 255, w1 & 255].map((q) => q / 255);
      }
    };
    run(dl, 0);
    const out = groups.filter((g) => g.v.length).map((g) => {
      const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(g.v), gl.STATIC_DRAW);
      return { buf, n: g.v.length / 10, tex: g.tex, lit: g.lit, prim: g.prim, env: g.env, cull: g.cull, prog: program(g.comb.join(','), combinerGlsl(g.comb[0], g.comb[1])) };
    });
    meshes.set(key, out); return out;
  }

  // Os : même parcours que SkelAnime_DrawFlex du jeu (enfant puis frère), une matrice par membre dessiné
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) o[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3]; return o; };
  const T = (x, y, z) => new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
  const S = (s) => new Float32Array([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, 0, 0, 0, 1]);
  const R = (ax, v) => { const a = (v / 32768) * Math.PI, c = Math.cos(a), s = Math.sin(a); return ax === 'x' ? new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]) : ax === 'y' ? new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]) : new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]); };

  return function draw(m, seg, f, VP, k, tint) {
    const pl = m.u32(m.play + 0x1C44), sk = m.u32(pl + 0x1A4 + 4), limbs = [];
    for (let i = 0; i < 22; i++) { const L = seg(m.u32(sk + i * 4)); limbs.push({ x: m.s16(L), y: m.s16(L + 2), z: m.s16(L + 4), child: m.u8(L + 6), sib: m.u8(L + 7), dl: m.u32(L + 8) }); }
    const bones = [], order = [], j = f.j;
    const walk = (i, parent) => {
      const L = limbs[i], p = i === 0 ? [j[0], j[1], j[2]] : [L.x, L.y, L.z], r = 3 + i * 3;
      const M = mul(mul(mul(mul(parent, T(...p)), R('z', j[r + 2])), R('y', j[r + 1])), R('x', j[r]));
      if (L.dl) { const h = HAND_LIMBS.indexOf(i); order.push({ dl: h >= 0 && f.d[h] ? f.d[h] : L.dl, bone: bones.length }); bones.push(M); }
      if (L.child !== 0xff) walk(L.child, M);
      if (L.sib !== 0xff) walk(L.sib, parent);
    };
    walk(0, S(1));
    const world = mul(mul(T(f.x, f.y, f.z), R('y', f.r)), S(0.01));
    gl.viewport(0, 0, canvas.width, canvas.height); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    const flat = new Float32Array(24 * 16); bones.forEach((b, i) => flat.set(b, i * 16));
    for (const o of order) for (const g of mesh(m, seg, o.dl, o.bone)) {
      const { p, u } = g.prog;
      gl.useProgram(p);
      gl.uniformMatrix4fv(u.uVP, false, VP); gl.uniformMatrix4fv(u.uWorld, false, world); gl.uniformMatrix4fv(u.uBones, false, flat);
      gl.uniform1f(u.uK, k); gl.uniform1f(u.uLit, g.lit); gl.uniform4fv(u.uPrim, g.prim); gl.uniform4fv(u.uEnv, g.env || tint);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, g.tex); gl.uniform1i(u.uTex, 0);
      if (g.cull) { gl.enable(gl.CULL_FACE); gl.cullFace(g.cull & 0x400 ? gl.BACK : gl.FRONT); } else gl.disable(gl.CULL_FACE);
      gl.bindBuffer(gl.ARRAY_BUFFER, g.buf);
      [[0, 3, 0], [1, 4, 12], [2, 2, 28], [3, 1, 36]].forEach(([i, n, off]) => { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, n, gl.FLOAT, false, 40, off); });
      gl.drawArrays(gl.TRIANGLES, 0, g.n);
    }
  };
}
