// Import d'un build depuis une image : l'export « Récap » de Wakfuli (ou une capture de cet onglet).
// Le texte est lu dans le navigateur (Tesseract.js, rien n'est envoyé) ; ici, sans DOM (testable avec Node),
// on retrouve les équipements à partir des mots lus et de leur position, puis les objets correspondants.
import { scanKey, lev } from './util.js';

const LEVEL = /^(niv|lvl|lv|level)\b\.?,?\s*(\d{1,3})?$/i;

/**
 * Équipements d'un récap : chaque objet y est écrit sur deux lignes, son nom puis « Niv. 125 » juste en dessous.
 * On part donc de chaque « Niv. » et on prend les mots de la ligne du dessus qui commencent au même endroit
 * (les autres colonnes du récap, plus à droite, sont ignorées).
 * @param words [{ text, bbox: { x0, y0, x1, y1 } }]  mots lus par l'OCR
 * @returns { title: en-tête du build (« Cra 125 ») ou '', items: [{ name, level }] }
 */
export function parseRecapWords(words) {
  const ws = (words || []).filter(w => w?.text?.trim() && w.bbox);
  const items = [];
  let title = '';
  for (const n of ws) {
    const text = n.text.trim();
    const m = text.replace(/(\D)(\d)/, '$1 $2').match(LEVEL);
    if (!m) continue;
    const b = n.bbox;
    const h = Math.max(4, b.y1 - b.y0);
    let level = m[2] ? +m[2] : null;
    if (level == null) {
      // « Niv. » et « 125 » lus comme deux mots
      const num = ws.find(w => w !== n && /^\d{1,3}$/.test(w.text.trim()) && w.bbox.x0 >= b.x1 && w.bbox.x0 - b.x1 < h * 1.5
        && Math.abs(w.bbox.y0 - b.y0) < h / 2);
      if (num) level = +num.text.trim();
    }
    if (!level || level > 245) continue;
    const above = ws.filter(w => w !== n && w.bbox.y1 <= b.y0 + h * 0.3 && w.bbox.y1 >= b.y0 - h * 2.2 && w.bbox.x0 >= b.x0 - h * 1.2)
      .sort((p, q) => p.bbox.x0 - q.bbox.x0);
    const name = [];
    let last = null;
    for (const w of above) {
      if (!last && w.bbox.x0 > b.x0 + h * 1.5) break; // rien d'aligné au-dessus
      if (last && w.bbox.x0 - last.bbox.x1 > h * 1.5) break; // colonne suivante
      name.push(w.text.trim());
      last = w;
    }
    if (!name.length) continue;
    // l'en-tête du personnage (« Cra 125 » puis « Niv. 125 ») n'est pas un objet
    if (name.length > 1 && name.at(-1) === String(level)) title ||= name.join(' ');
    else items.push({ name: name.join(' '), level });
  }
  return { title, items };
}

/** Index des équipements (et autres objets non ressources) par nom, en français et en anglais. */
function nameIndex(index) {
  if (index._buildNames) return index._buildNames;
  const byKey = new Map();
  for (const o of index.searchable) {
    if (o._res) continue;
    for (const k of new Set([scanKey(o.nomFr ?? o.nom), scanKey(o.nom), scanKey(o.nom_en)])) {
      if (k.length < 3) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(o);
    }
  }
  index._buildNames = { byKey, keys: [...byKey.keys()] };
  return index._buildNames;
}

/** Nom lu -> objets de ce nom (toutes raretés), en tolérant quelques erreurs de lecture. */
function findByName(index, name) {
  const { byKey, keys } = nameIndex(index);
  const l = scanKey(name);
  if (l.length < 3) return null;
  if (byKey.has(l)) return byKey.get(l);
  // l'icône de l'objet est parfois lue comme un mot en trop au début
  const words = l.split(' ');
  for (let i = 1; i < Math.min(3, words.length); i++) {
    const k = words.slice(i).join(' ');
    if (k.length >= 5 && byKey.has(k)) return byKey.get(k);
  }
  const max = Math.max(1, Math.floor(l.length / 8));
  let best = null;
  for (const k of keys) {
    if (Math.abs(k.length - l.length) > max) continue;
    const d = lev(l, k, max);
    if (d <= max && (!best || d < best.d)) best = { k, d };
  }
  return best ? byKey.get(best.k) : null;
}

const SOUVENIR = 6;
/** Version la plus probable : même niveau que dans le build, fabricable, puis la rareté la plus haute (Légendaire avant Mythique). */
export function pickVersion(versions, level) {
  const craft = o => (o.recettes?.length ? 1 : 0);
  return [...versions].sort((a, b) => Math.abs(a.niveau - level) - Math.abs(b.niveau - level)
    || craft(b) - craft(a) || (a.rarete === SOUVENIR) - (b.rarete === SOUVENIR) || b.rarete - a.rarete)[0];
}

/**
 * Objets du build.
 * @returns { found: [{ name, level, versions: [objets du même nom], pick }], unknown: [nom lu] }
 */
export function matchBuild(index, entries) {
  const found = [];
  const unknown = [];
  for (const e of entries || []) {
    const versions = findByName(index, e.name);
    if (!versions) { unknown.push(e.name); continue; }
    const sorted = [...versions].sort((a, b) => a.rarete - b.rarete || a.niveau - b.niveau);
    found.push({ name: e.name, level: e.level, versions: sorted, pick: pickVersion(sorted, e.level) });
  }
  return { found, unknown };
}
