// Calculs de la liste de courses (sans DOM : testable avec Node).
import { norm } from './util.js';

export const RARITY_CLASS = ['commun', 'commun', 'rare', 'mythique', 'legendaire', 'relique', 'souvenir', 'epique'];

/** Construit les index à partir de data_item.json, data_ressource.json et data_bestiaire.json. */
export function buildIndex(dItem, dRes, dBest) {
  const byId = new Map();
  const all = [...(dItem?.items || []), ...(dRes?.ressources || [])];
  for (const o of all) {
    o._key = norm(o.nom);
    o._keyEn = norm(o.nom_en);
    o._res = false;
    byId.set(o.id, o);
  }
  for (const o of dRes?.ressources || []) o._res = true;
  const usedIn = new Map();
  for (const o of all) {
    for (const r of o.recettes || []) {
      for (const [id] of r.ingredients) {
        if (!usedIn.has(id)) usedIn.set(id, new Set());
        usedIn.get(id).add(o.id);
      }
    }
  }
  const monsters = (dBest?.monstres || []).map((m, i) => ({
    ...m, _i: i, _key: norm(`${m.nom} ${m.nom_en || ''}`), _extra: norm([m.famille, ...(m.zones || [])].join(' ')),
  }));
  const raretes = dItem?.raretes || dRes?.raretes || {};
  const { plans, planOf } = linkPlans(all);
  return {
    byId, usedIn, monsters, raretes, plans, planOf,
    craftables: all.filter(o => o.recettes?.length),
    searchable: all,
    version: dItem?.version_jeu || '',
    maj: dItem?.maj || '',
  };
}

/* Plans : objets de type « Recette » (« Plan "Kokordon" ») qui s'apprennent une fois et débloquent la recette
 * de l'objet du même nom. Les données du jeu ne relient pas le plan à l'objet : on les relie par le nom français
 * (nomFr / typeFr : noms d'origine gardés quand l'interface passe en anglais), plus quelques cas à la main. */
const PLAN_ALIAS = {
  15992: [16074], // Recette du Casque d'Hazieff -> Casque Hazieff
  20415: [20416], // Recette des Petits Sâblés -> Petits Sâblés
  28820: [28777, 28778, 28779, 28780], // Plan "Trônes de nation" -> les quatre trônes
};
const SOUVENIR = 6;
/** @returns { plans: [{ id, items: [id] }], planOf: Map(id de l'objet -> id du plan) } */
export function linkPlans(all) {
  const frName = o => o.nomFr ?? o.nom;
  const byName = new Map();
  for (const o of all) {
    if (!o.recettes?.length) continue;
    const k = norm(frName(o));
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k).push(o);
  }
  const found = [];
  for (const p of all) {
    if ((p.typeFr ?? p.type) !== 'Recette') continue;
    const name = norm(frName(p));
    const souvenir = /\(souvenir\)$/.test(name);
    const target = name.replace(/\s*\(souvenir\)$/, '').replace(/^(plan\s+|recette\s+(du|des|de la|de|d')\s*)/, '').replace(/^"|"$/g, '').trim();
    const items = PLAN_ALIAS[p.id] ? PLAN_ALIAS[p.id].filter(id => all.some(o => o.id === id && o.recettes?.length))
      : (byName.get(target) || []).filter(o => !souvenir || o.rarete === SOUVENIR).map(o => o.id);
    if (items.length) found.push({ id: p.id, items, souvenir });
  }
  const planOf = new Map();
  // le plan « Souvenir » passe avant le plan normal pour les objets Souvenir
  for (const p of [...found].sort((a, b) => b.souvenir - a.souvenir)) for (const id of p.items) if (!planOf.has(id)) planOf.set(id, p.id);
  return { plans: found.map(({ id }) => ({ id, items: [...planOf].filter(([, pid]) => pid === id).map(([i]) => i) })).filter(p => p.items.length), planOf };
}

/** Plans à apprendre pour une liste : [{ id (du plan), items: [ids des fabrications concernées] }], plans possédés exclus. */
export function missingPlans(index, crafts, owned = {}) {
  const out = new Map();
  for (const x of crafts) {
    const p = x.runs > 0 && index.planOf?.get(x.id);
    if (!p || owned[p]) continue;
    if (!out.has(p)) out.set(p, { id: p, items: [] });
    out.get(p).items.push(x.id);
  }
  return [...out.values()];
}

/** Recette utilisée par défaut : la première qui n'est pas une amélioration. */
export function mainRecipe(o) {
  if (!o?.recettes?.length) return null;
  return o.recettes.find(r => !r.amelioration) || o.recettes[0];
}

/** Recherche d'objets : nom FR, puis nom EN. */
export function searchItems(index, query, { limit = 12, craftableOnly = false, hidePvp = false } = {}) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  const pool = craftableOnly ? index.craftables : index.searchable;
  for (const o of pool) {
    if (hidePvp && o.pvp) continue;
    let s = -1;
    if (o._key === q) s = 0;
    else if (o._key.startsWith(q)) s = 1;
    else if (o._key.split(' ').some(w => w.startsWith(q))) s = 2;
    else if (o._key.includes(q)) s = 3;
    else if (o._keyEn && o._keyEn.includes(q)) s = 4;
    if (s >= 0) out.push([s, o]);
  }
  out.sort((a, b) => a[0] - b[0] || (b[1].recettes ? 1 : 0) - (a[1].recettes ? 1 : 0)
    || a[1].niveau - b[1].niveau || a[1].rarete - b[1].rarete || a[1]._key.localeCompare(b[1]._key));
  return out.slice(0, limit).map(x => x[1]);
}

/**
 * Calcule la liste de courses.
 * @param index    résultat de buildIndex
 * @param targets  [{ id, qte }]
 * @param opts     { stock: {id: n}, buy: {id: true} }  buy = ne pas fabriquer cet objet
 * @returns { base: [{id, need, have, missing}], crafts: [{id, need, have, runs, recipe}], jobs: {métier: niveau}, unknown: [id] }
 */
export function computeList(index, targets, { stock = {}, buy = {} } = {}) {
  const { byId } = index;
  const expandable = id => {
    const o = byId.get(id);
    return !!(o && mainRecipe(o) && !buy[id]);
  };

  // 1) ordre topologique (parents avant enfants) des objets à fabriquer
  const order = [];
  const state = new Map(); // 1 = en cours, 2 = fini
  const cyclic = new Set();
  const visit = id => {
    const s = state.get(id);
    if (s === 2) return;
    if (s === 1) { cyclic.add(id); return; }
    state.set(id, 1);
    if (expandable(id) && !cyclic.has(id)) {
      for (const [ing] of mainRecipe(byId.get(id)).ingredients) visit(ing);
    }
    state.set(id, 2);
    order.push(id);
  };
  for (const t of targets) visit(t.id);
  order.reverse();

  // 2) propagation des besoins
  const need = new Map();
  for (const t of targets) need.set(t.id, (need.get(t.id) || 0) + Math.max(0, Math.floor(t.qte) || 0));
  const base = [], crafts = [], unknown = [];
  const jobs = {};
  for (const id of order) {
    const n = need.get(id) || 0;
    if (n <= 0) continue;
    const have = Math.min(n, Math.max(0, Math.floor(stock[id] || 0)));
    const net = n - have;
    const o = byId.get(id);
    if (!o) { unknown.push(id); continue; }
    if (expandable(id) && !cyclic.has(id)) {
      const recipe = mainRecipe(o);
      const yieldQ = recipe.quantite || 1;
      const runs = Math.ceil(net / yieldQ);
      crafts.push({ id, need: n, have, runs, recipe });
      if (runs > 0) {
        jobs[recipe.metier] = Math.max(jobs[recipe.metier] || 0, recipe.niveau);
        for (const [ing, q] of recipe.ingredients) need.set(ing, (need.get(ing) || 0) + runs * q);
      }
    } else {
      base.push({ id, need: n, have, missing: net });
    }
  }
  // Fabrication : les plus « profonds » d'abord (on fabrique les composants avant l'objet final).
  crafts.reverse();
  return { base, crafts, jobs, unknown };
}

/** Comment obtenir une ressource, en court. */
export function sourcesOf(o, { maxDrops = 3, maxTrap = 2 } = {}) {
  const out = [];
  const seen = new Set();
  const trap = [];
  for (const h of o.recolte || []) {
    if (h.metier === 'Trappeur') { trap.push(h); continue; }
    const k = `${h.metier}|${h.niveau}|${h.source}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ kind: 'recolte', metier: h.metier, niveau: h.niveau, source: h.source, taux: h.taux });
  }
  trap.sort((a, b) => a.niveau - b.niveau);
  for (const h of trap.slice(0, maxTrap)) out.push({ kind: 'trappeur', niveau: h.niveau, monstre: h.source });
  if (trap.length > maxTrap) out.push({ kind: 'more', count: trap.length - maxTrap, label: 'monstres (trappeur)' });
  const drops = [...(o.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
  for (const d of drops.slice(0, maxDrops)) out.push({ kind: 'drop', monstre: d.monstre, taux: d.taux });
  if (drops.length > maxDrops) out.push({ kind: 'more', count: drops.length - maxDrops, label: 'monstres' });
  if (o.recettes?.length) out.push({ kind: 'recette', metier: mainRecipe(o).metier, niveau: mainRecipe(o).niveau });
  return out;
}

/** Ids des objets qu'un monstre peut donner (drops + trappeur). */
export function monsterItemIds(m) {
  const ids = [];
  for (const d of m.drops || []) if (d.id) ids.push(d.id);
  for (const d of m.trappeur?.items || []) if (d.id) ids.push(d.id);
  return ids;
}

/**
 * Coût unitaire d'un objet d'après les prix saisis (kamas) : prix d'achat, coût de fabrication
 * (ingrédients au meilleur prix, divisé par la quantité produite) et le moins cher des deux.
 * Une valeur inconnue vaut null (prix manquant pour l'objet ou l'un de ses ingrédients).
 * @returns (id) => { buy, craft, best }
 */
export function costIndex(index, prices = {}) {
  const memo = new Map();
  const cost = id => {
    if (memo.has(id)) return memo.get(id);
    const p = +prices[id] > 0 ? +prices[id] : null;
    const out = { buy: p, craft: null, best: p };
    memo.set(id, out); // une recette circulaire s'arrête ici
    const r = mainRecipe(index.byId.get(id));
    if (r) {
      let sum = 0;
      for (const [ing, q] of r.ingredients) {
        const c = cost(ing).best;
        if (c == null) { sum = null; break; }
        sum += c * q;
      }
      if (sum != null) {
        out.craft = sum / (r.quantite || 1);
        out.best = p == null ? out.craft : Math.min(p, out.craft);
      }
    }
    return out;
  };
  return cost;
}

/* Lien de partage d'une liste : #liste=<base64url du JSON {v, n, c: [[id, qte]…]}> (rien n'est envoyé à un serveur). */
const b64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function encodeShare(nom, cibles) {
  const json = JSON.stringify({ v: 1, n: String(nom || '').slice(0, 40), c: cibles.slice(0, 200).map(t => [t.id, t.qte]) });
  return b64url(new TextEncoder().encode(json));
}
/** Décode un lien (ou juste le code) ; renvoie { nom, cibles } ou null. */
export function decodeShare(text) {
  const m = String(text || '').match(/(?:#liste=)?([A-Za-z0-9_-]{8,})\s*$/);
  if (!m) return null;
  try {
    const bin = atob(m[1].replace(/-/g, '+').replace(/_/g, '/'));
    const data = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, ch => ch.charCodeAt(0))));
    if (!data || data.v !== 1 || !Array.isArray(data.c)) return null;
    const cibles = data.c.map(([id, qte]) => ({ id: Math.floor(+id), qte: Math.floor(+qte) })).filter(t => t.id > 0 && t.qte > 0);
    return cibles.length ? { nom: typeof data.n === 'string' ? data.n : '', cibles } : null;
  } catch { return null; }
}

/* Bandeau « Possédés : 458 🎒 0 🛡 117 🧰 0 🐉 » en haut de l'infobulle du jeu, lu par l'OCR :
 * quantités sur soi, équipées, au coffre et au pacte, dans cet ordre (les icônes ne sont pas lues).
 * Renvoie { moi, equipe, coffre, pacte, total } ou null si le bandeau est absent ou illisible. */
export const OWNED_PLACES = ['moi', 'equipe', 'coffre', 'pacte'];
export function parseOwned(lines) {
  const L = (lines || []).map(l => String(l).normalize('NFD').replace(/[̀-ͯ]/g, ''));
  const i = L.findIndex(l => /\bpossed|\bowned\b/i.test(l));
  if (i < 0) return null;
  let text = L[i].replace(/^.*?(possed\w*|owned)\s*:?/i, '');
  // l'OCR coupe parfois la rangée en plusieurs lignes : on prend la suite tant qu'elle n'a pas de mot
  for (let j = i + 1; j < Math.min(L.length, i + 4) && !/[a-z]{3}/i.test(L[j]); j++) text += ' ' + L[j];
  const read = loose => {
    const nums = [];
    for (let w of text.split(/\s+/)) {
      if (loose && /^[Oo]$/.test(w)) w = '0';
      const m = w.match(/^[^\d\w]?(\d+)[^\d]{0,2}$/);
      if (m) nums.push(m[1]);
    }
    // séparateur de milliers (« 1 234 ») : on recolle tant qu'il y a trop de nombres
    for (let k = 0; nums.length > 4 && k < nums.length - 1;) {
      if (nums[k].length <= 3 && nums[k + 1].length === 3 && nums[k] !== '0') nums.splice(k, 2, nums[k] + nums[k + 1]);
      else k++;
    }
    return nums.length === 4 ? nums.map(Number) : null;
  };
  const n = read(true) || read(false);
  if (!n) return null;
  const out = Object.fromEntries(OWNED_PLACES.map((p, k) => [p, n[k]]));
  out.total = n.reduce((a, b) => a + b, 0);
  return out;
}
