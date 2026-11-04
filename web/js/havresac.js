// Havre-sac : lecture d'une capture du « Coffre de compte » de WAKFU (onglet de 10×10 cases).
// Tout se fait sur l'appareil, sans DOM (testable avec Node) : on retrouve la grille sur l'image,
// on compare chaque case aux icônes officielles des ressources (web/data/icones_ressources.bin)
// et on lit la quantité écrite en bas à droite avec des modèles de chiffres (police du jeu).

export const ICON_N = 16;   // taille des icônes de référence (16×16)
const P = 63;               // pas de la grille à l'échelle de référence (interface 1920×1080)
const CELL = 56;            // côté d'une case, cadre compris
// une case est reconnue si l'icône la plus proche est très proche, ou assez proche et nettement devant la suivante
const SURE = 0.12, MAX_DIST = 0.3, MIN_GAP = 0.06;

/* --------------------------------------------------------- icônes de référence */

/** Fichier binaire : « WFI1 », taille (u16), 0 (u16), nombre (u32), gfx (u32 × n), pixels RVBA (n × N × N × 4). */
export function encodeIcons(gfxList, rawList) {
  const per = ICON_N * ICON_N * 4, n = gfxList.length;
  const buf = new Uint8Array(12 + n * 4 + n * per);
  const dv = new DataView(buf.buffer);
  buf.set([87, 70, 73, 49]);
  dv.setUint16(4, ICON_N, true);
  dv.setUint32(8, n, true);
  gfxList.forEach((g, i) => { dv.setUint32(12 + i * 4, g, true); buf.set(rawList[i], 12 + n * 4 + i * per); });
  return buf;
}

export function parseIcons(input) {
  const buf = input instanceof Uint8Array ? input : new Uint8Array(input);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'WFI1' || dv.getUint16(4, true) !== ICON_N) throw new Error('icônes illisibles');
  const n = dv.getUint32(8, true), per = ICON_N * ICON_N;
  const gfx = Array.from({ length: n }, (_, i) => dv.getUint32(12 + i * 4, true));
  const raw = buf.subarray(12 + n * 4, 12 + n * 4 + n * per * 4);
  const rgb = new Float32Array(n * per * 3), a = new Float32Array(n * per);
  for (let i = 0; i < n * per; i++) {
    a[i] = raw[i * 4 + 3] / 255;
    for (let c = 0; c < 3; c++) rgb[i * 3 + c] = raw[i * 4 + c] / 255;
  }
  return { n, gfx, raw, rgb, a };
}

/* --------------------------------------------------------- grille */

/**
 * Cherche la grille du coffre : chaque case a un cadre clair de 2 px (couleur de rareté) doublé à l'intérieur
 * d'un trait presque noir. On compte ces bords par colonne et par ligne, puis on garde la plus longue suite
 * régulière (10 colonnes pour le coffre, contre 5 pour l'inventaire à côté).
 * @returns {{ x, y, pitch, cols, rows } | null}
 */
export function findGrid(img) {
  const { width: W, height: H, data } = img;
  const v = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) v[i] = Math.max(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
  // bord gauche/haut d'une case : clair puis sombre juste à l'intérieur (tolérant au redimensionnement)
  const edge = (a, b, c, d) => v[a] >= 100 && v[b] >= 70 && Math.min(v[c], v[d]) < 45 && v[c] < 90;
  const colL = new Float32Array(W);
  for (let y = 0; y < H; y++) {
    const o = y * W;
    for (let x = 0; x < W - 3; x++) if (edge(o + x, o + x + 1, o + x + 2, o + x + 3)) colL[x]++;
  }
  const cols = chain(colL, 40, 110);
  if (!cols || cols.n < 3) return null;
  const pitch = cols.pitch;
  const x0 = cols.start, x1 = Math.min(W - 1, Math.round(x0 + cols.n * pitch));
  const rowT = new Float32Array(H);
  for (let y = 0; y < H - 3; y++) {
    for (let x = x0; x < x1; x++) {
      const o = y * W + x;
      if (edge(o, o + W, o + 2 * W, o + 3 * W)) rowT[y]++;
    }
  }
  const rows = chain(rowT, Math.floor(pitch) - 2, Math.ceil(pitch) + 2);
  if (!rows) return null;
  return { x: x0, y: rows.start, pitch: (pitch + rows.pitch) / 2, cols: Math.min(10, cols.n), rows: Math.min(10, rows.n) };
}

/** Plus longue suite de pics régulièrement espacés dans un profil. */
function chain(prof, pMin, pMax) {
  let max = 0;
  for (const x of prof) if (x > max) max = x;
  if (!max) return null;
  const thr = max * 0.25;
  const peak = i => i >= 0 && i < prof.length && prof[i] >= thr && prof[i] >= (prof[i - 1] || 0) && prof[i] >= (prof[i + 1] || 0);
  const peaks = [];
  for (let i = 0; i < prof.length; i++) if (peak(i)) peaks.push(i);
  let best = null;
  for (const a of peaks) {
    for (const b of peaks) {
      const p = b - a;
      if (p < pMin || p > pMax) continue;
      let n = 2, last = b, sum = prof[a] + prof[b];
      for (;;) {
        let next = -1;
        for (let d = -1; d <= 1; d++) if (peak(last + p + d) && (next < 0 || prof[last + p + d] > prof[next])) next = last + p + d;
        if (next < 0) break;
        n++; sum += prof[next]; last = next;
      }
      const pitch = n > 1 ? (last - a) / (n - 1) : p;
      if (!best || n > best.n || (n === best.n && sum > best.sum)) best = { start: a, n, pitch, sum };
    }
  }
  return best;
}

/* --------------------------------------------------------- lecture */

/** Image de la grille ramenée à l'échelle de référence (pas de 63 px), en RVB 0-255. */
function normalize(img, g) {
  const s = g.pitch / P, w = g.cols * P, h = g.rows * P;
  const out = new Float32Array(w * h * 3);
  const { width: W, height: H, data } = img;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(H - 1.001, g.y + y * s), y0 = Math.floor(fy), ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(W - 1.001, g.x + x * s), x0 = Math.floor(fx), tx = fx - x0;
      const i00 = (y0 * W + x0) * 4, i01 = i00 + 4, i10 = i00 + W * 4, i11 = i10 + 4;
      for (let c = 0; c < 3; c++) {
        out[(y * w + x) * 3 + c] = (data[i00 + c] * (1 - tx) + data[i01 + c] * tx) * (1 - ty) + (data[i10 + c] * (1 - tx) + data[i11 + c] * tx) * ty;
      }
    }
  }
  return { w, h, px: out };
}

const at = (G, x, y, c) => G.px[(y * G.w + x) * 3 + c];

/** Zone de l'icône (52 px dans la case) réduite en N×N par moyenne, valeurs 0-1. */
function iconSample(G, cx, cy) {
  const N = ICON_N, size = 52, step = size / N, out = new Float32Array(N * N * 3);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const xa = cx + 2 + x * step, ya = cy + 2 + y * step;
    let n = 0;
    const acc = [0, 0, 0];
    for (let yy = Math.floor(ya); yy < Math.ceil(ya + step); yy++) for (let xx = Math.floor(xa); xx < Math.ceil(xa + step); xx++) {
      for (let c = 0; c < 3; c++) acc[c] += at(G, xx, yy, c);
      n++;
    }
    for (let c = 0; c < 3; c++) out[(y * N + x) * 3 + c] = acc[c] / n / 255;
  }
  return out;
}

// pixels comparés : sans le cadenas (en haut à gauche) ni la quantité (en bas)
const MASK = (() => {
  const N = ICON_N, m = new Uint8Array(N * N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const lock = y < Math.floor(N * 0.35) && x < Math.floor(N * 0.35);
    const qty = y >= Math.floor(N * 0.7) && x >= Math.floor(N * 0.3);
    m[y * N + x] = lock || qty ? 0 : 1;
  }
  return m;
})();
const MASK_N = MASK.reduce((s, v) => s + v, 0);

function median(a) { const s = [...a].sort((p, q) => p - q); return s[s.length >> 1]; }

/** Meilleures icônes pour une case : [{ i, d }] triées, d = écart moyen (0 = identique). */
function matchIcon(sample, icons) {
  const N = ICON_N;
  const bg = [0, 1, 2].map(c => {
    const vals = [];
    for (let k = 0; k < N; k++) {
      vals.push(sample[k * 3 + c], sample[(N + k) * 3 + c]);              // deux lignes du haut
      vals.push(sample[(k * N + N - 1) * 3 + c], sample[(k * N + N - 2) * 3 + c]); // deux colonnes de droite
    }
    return median(vals);
  });
  const per = N * N, res = [];
  for (let i = 0; i < icons.n; i++) {
    let d = 0;
    for (let p = 0; p < per; p++) {
      if (!MASK[p]) continue;
      const a = icons.a[i * per + p];
      for (let c = 0; c < 3; c++) d += Math.abs(icons.rgb[(i * per + p) * 3 + c] * a + bg[c] * (1 - a) - sample[p * 3 + c]);
    }
    res.push({ i, d: d / MASK_N });
  }
  return res.sort((p, q) => p.d - q.d).slice(0, 3);
}

function isEmpty(sample) {
  let s = 0, s2 = 0;
  for (const v of sample) { s += v; s2 += v * v; }
  const n = sample.length, m = s / n;
  return Math.sqrt(Math.max(0, s2 / n - m * m)) < 0.03;
}

/** Rareté d'après la couleur du cadre : 1 commun (gris), 2 rare (vert), 3 mythique (orange), 4 légendaire (jaune). */
function frameRarity(G, cx, cy) {
  const r = at(G, cx, cy + 28, 0), g = at(G, cx, cy + 28, 1), b = at(G, cx, cy + 28, 2);
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b);
  if (hi - lo < 25) return 1;
  if (g > r && g > b) return 2;
  if (r >= g && g > b) return g / r < 0.75 ? 3 : 4;
  return null;
}

/* Chiffres de la quantité : 6 px de large, un tous les 8 px, alignés à droite ; 3 px de plus entre milliers.
   Modèles 8×12 (niveau de gris, cadre noir compris), relevés sur de vraies captures. */
const DIGIT_W = 8, DIGIT_H = 12;
const DIGITS = 'JCoxMjIxLysvSb709L5HMTXc5E9R6NY0b/+VMTKa/2mW/3kwMX7/maz/czEwd/+tsf9zMTF3/62e/3owMX7/mXD/lTIymv9qN93kUFLo2Dc2S8H19b9KNzo3NDMzNjk8OzAyMzMyLiQ6Na///6owJDOJ/8v/qTAnZPvFYf+pMCdWykBg/6kwKS4vL2D/qS8mKCEpYP+pLyYlIShf/6kvKiEfKF//qS8nLTEzYP+pMzEs8P//////2ysxMzMzMzMxMi8yMjIxLCQwhNj27blILWr/uz9p/NcyL2BELTPW/0knJycmM+H/PyQkJS5d/7cxJCcuO97SPC0uMEDSxDcqKC5G2949KhwhR+HyUTMzMjB4////////iC4yMzMzMzIvKS8yMjIwLCg7o+X667ZIL1DlgTpw/tQxLzUxMDPt/DQkKTE2cv63MSMplf//wDgvJCswN3H8wTIoJyQpMs7/TTBHMCgy0f9RlfRxOnD9yDFOuOz756k/LS8wMjMzMCsmHyMgLjIyMTIhIipV/f+KMiInMsf5/4kyLS9u/Z3/iTIsNd6zef+JMjCJ+Ut5/4kuPu+jMXn/iTCh8kEzef+JM83////////CMzMzNHb/iTM2Njc2dv+KNjg4ODY1NDQ4LzIzMzMzMi0x1P//////LDPgqTMzMzIvMu6cLyMhHSMz+5EyMjEsJTv/qtj423IwO6ymSUzd/FYtMDEsMIr/kDFEMigwjv+GUu6vQk3f8UUykt757sJXLSssMjIyMCkgICQwMjMzNDglLjWt/8pGJyoys/+vNSokLoL/uTMoHyQ15vBBMzItJmz/wcv44YAxkv/cTEjR/mCR/40wL3v/m3L/jjAwe/+ONtzcTEfR8UgwRbn18MRXLCgoMDIyLyogLTIzMzMzMi1/////////hX//WTQztP9lf/9ZJz325TIvMC0sgf+aLR8ZGzHP/04kGRkkUf/PMR8eGi6d/4MrHR8fNen4PCMdJShr/7gwHhwlKLn/aykcHCUoLzAuIRwdIiovMTEvKiAuYMjx8chfLUH21EVG1fZCX/+aMjCX/2E33tNERtPbNzFU6///7FUwTvHTSUnV8UuZ/4IuL4L/lpX/gi8ug/+SU/fUSEjU908vX8rx8cleLSgrMDExLykgPzExMjMyLyYyWsXw9LVBLUvz0ElO3dg0kv97LzGO/22f/3oxMY3/kGX/z0dO3P+RMoPk+M3C/2svMDMyP+/lNjExMjO5/4AzMzQ1sf+zNTc4Scz/rTc5Ozo2NDQ1OT89';
let digitModels = null;
function models() {
  if (digitModels) return digitModels;
  const bytes = typeof atob === 'function' ? Uint8Array.from(atob(DIGITS), c => c.charCodeAt(0)) : Uint8Array.from(Buffer.from(DIGITS, 'base64'));
  const per = DIGIT_W * DIGIT_H;
  digitModels = [];
  for (let d = 0; d < 10; d++) {
    const t = bytes.subarray(d * per, (d + 1) * per);
    const keep = [];
    for (let i = 0; i < per; i++) if (t[i] > 150 || t[i] < 90) keep.push(i); // trait du chiffre ou contour noir
    digitModels.push({ d, t, keep });
  }
  return digitModels;
}

/** Fenêtre (niveau de gris = plus petite composante) du k-ième chiffre en partant de la droite. */
export function digitWindow(G, cx, cy, k) {
  const x = cx + 43 - 8 * k - 3 * Math.floor(k / 3), y = cy + 40;
  const out = new Uint8Array(DIGIT_W * DIGIT_H);
  for (let j = 0; j < DIGIT_H; j++) for (let i = 0; i < DIGIT_W; i++) {
    out[j * DIGIT_W + i] = Math.round(Math.min(at(G, x + i, y + j, 0), at(G, x + i, y + j, 1), at(G, x + i, y + j, 2)));
  }
  return out;
}

/** Quantité de la case (1 quand rien n'est écrit, comme dans le jeu). */
function readQty(G, cx, cy) {
  let s = '';
  for (let k = 0; k < 7; k++) {
    const w = digitWindow(G, cx, cy, k);
    let best = null;
    for (const m of models()) {
      let e = 0;
      for (const i of m.keep) e += Math.abs(w[i] - m.t[i]);
      e /= m.keep.length;
      if (!best || e < best.e) best = { d: m.d, e };
    }
    if (best.e > 45) break;
    s = best.d + s;
  }
  return s ? +s : 1;
}

/**
 * Lit un onglet du coffre.
 * @param img { width, height, data }  pixels RVBA (ImageData)
 * @param icons parseIcons(…)
 * @param ressources [{ id, gfx, rarete }]
 * @returns { grid, cells: [{ row, col, qty, gfx, id, dist, rarete }] } ou null si aucune grille
 */
export function readCoffre(img, icons, ressources) {
  const grid = findGrid(img);
  if (!grid) return null;
  const byGfx = new Map();
  for (const r of ressources || []) {
    if (!byGfx.has(r.gfx)) byGfx.set(r.gfx, []);
    byGfx.get(r.gfx).push(r);
  }
  const G = normalize(img, grid);
  const cells = [];
  for (let row = 0; row < grid.rows; row++) {
    for (let col = 0; col < grid.cols; col++) {
      const cx = col * P, cy = row * P;
      if (cx + CELL > G.w || cy + CELL > G.h) continue;
      const sample = iconSample(G, cx, cy);
      if (isEmpty(sample)) continue;
      const qty = readQty(G, cx, cy);
      const [best, second] = matchIcon(sample, icons);
      const cell = { row, col, qty, gfx: null, id: null, dist: +best.d.toFixed(3), gap: +(second.d - best.d).toFixed(3), rarete: frameRarity(G, cx, cy) };
      if (best.d < SURE || (best.d < MAX_DIST && second.d - best.d > MIN_GAP)) {
        cell.gfx = icons.gfx[best.i];
        const cands = byGfx.get(cell.gfx) || [];
        const pick = cands.find(r => r.rarete === cell.rarete || (cell.rarete === 1 && r.rarete === 0)) || cands[0];
        cell.id = pick ? pick.id : null;
      }
      cells.push(cell);
    }
  }
  return { grid, cells };
}

/** Additionne les cases reconnues : id -> quantité. */
export function totals(cells) {
  const t = {};
  for (const c of cells) if (c.id && c.qty > 0) t[c.id] = (t[c.id] || 0) + c.qty;
  return t;
}

export const SLOTS = 100; // cases d'un onglet du coffre (10 × 10)

/** Cases d'un onglet lu : position dans la grille -> [id, quantité] (id 0 = case non reconnue). */
export function cellsToCases(cells, cols = 10) {
  const cases = Array(SLOTS).fill(null);
  for (const c of cells) {
    const i = c.row * cols + c.col;
    if (i < SLOTS) cases[i] = [c.id || 0, c.qty];
  }
  return cases;
}

/** Ressources d'un onglet : id -> quantité. */
export function ongletItems(o) {
  const t = {};
  for (const c of o?.cases || []) if (c && c[0]) t[c[0]] = (t[c[0]] || 0) + c[1];
  return t;
}

/** Total du havre-sac (tous les onglets enregistrés) : id -> quantité. */
export function havresacTotals(hs) {
  const t = {};
  for (const o of hs?.onglets || []) for (const [id, n] of Object.entries(ongletItems(o))) t[id] = (t[id] || 0) + n;
  return t;
}
