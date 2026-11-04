// Régénère web/data/icones_ressources.bin : l'icône de chaque ressource, réduite en 16×16,
// pour reconnaître les cases du coffre de havre-sac sur une capture d'écran (web/js/havresac.js).
//
// Usage : node scripts/havresac-icones.mjs     (Node 18 ou plus récent)
// Seules les icônes absentes du fichier sont téléchargées (les autres sont gardées telles quelles).
// Lancé aussi par .github/workflows/gamedata.yml après la mise à jour des données.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { decodePNG } from './lib/png.mjs';
import { ICON_N, parseIcons, encodeIcons } from '../web/js/havresac.js';

const out = new URL('../web/data/icones_ressources.bin', import.meta.url);
const res = JSON.parse(readFileSync(new URL('../web/data/data_ressource.json', import.meta.url), 'utf8')).ressources;
const wanted = [...new Set(res.map(r => r.gfx).filter(g => g > 0))].sort((a, b) => a - b);

const have = new Map();
if (existsSync(out)) {
  const old = parseIcons(readFileSync(out));
  const per = ICON_N * ICON_N * 4;
  old.gfx.forEach((g, i) => have.set(g, old.raw.subarray(i * per, (i + 1) * per)));
}

const SOURCES = [
  g => `https://static.ankama.com/wakfu/portal/game/item/64/${g}.png`,
  g => `https://raw.githubusercontent.com/Vertylo/wakassets/main/items/${g}.png`,
];
async function fetchIcon(g) {
  for (const src of SOURCES) {
    try {
      const r = await fetch(src(g));
      if (r.ok) return Buffer.from(await r.arrayBuffer());
    } catch { /* source suivante */ }
  }
  return null;
}

/** Réduction par moyenne de blocs, pondérée par l'opacité (pas de halo sombre autour de l'objet). */
function shrink(img) {
  const N = ICON_N, o = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const x0 = Math.floor(x * img.width / N), x1 = Math.floor((x + 1) * img.width / N);
    const y0 = Math.floor(y * img.height / N), y1 = Math.floor((y + 1) * img.height / N);
    let r = 0, g = 0, b = 0, a = 0, n = 0;
    for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
      const i = (yy * img.width + xx) * 4, al = img.data[i + 3];
      r += img.data[i] * al; g += img.data[i + 1] * al; b += img.data[i + 2] * al; a += al; n++;
    }
    const k = (y * N + x) * 4;
    if (a) { o[k] = r / a; o[k + 1] = g / a; o[k + 2] = b / a; }
    o[k + 3] = a / n;
  }
  return o;
}

const todo = wanted.filter(g => !have.has(g));
let missing = 0;
for (let i = 0; i < todo.length; i += 16) {
  await Promise.all(todo.slice(i, i + 16).map(async g => {
    const buf = await fetchIcon(g);
    try { if (buf) { have.set(g, shrink(decodePNG(buf))); return; } } catch { /* icône illisible */ }
    missing++;
  }));
}
const keep = wanted.filter(g => have.has(g));
writeFileSync(out, encodeIcons(keep, keep.map(g => have.get(g))));
console.log(`· ${keep.length} icônes de ressources (${todo.length - missing} téléchargées, ${missing} introuvables)`);
