// Onglets « Craft » (liste de courses) et « Bestiaire » + fiche objet.
import { norm, escapeHtml, scanKey, lev } from './util.js';
import { t, tn, isEn, locale, jobName, rarityLabel, monsterTypeName, trapActionName } from './i18n.js';
import { parseRecapWords, matchBuild } from './buildimport.js';
import { buildIndex, computeList, costIndex, searchItems, sourcesOf, mainRecipe, missingPlans, monsterItemIds, encodeShare, decodeShare, parseOwned, RARITY_CLASS } from './craftcore.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtN = n => Number(n).toLocaleString(locale);
const fmtK = n => `${fmtN(Math.round(n))} kamas`;
// Icônes de métier actuelles du jeu (web/icons/metiers), émoji en secours.
const JOB_FILE = {
  Paysan: 'paysan', Forestier: 'forestier', Herboriste: 'herboriste', Mineur: 'mineur', Pêcheur: 'pecheur',
  Trappeur: 'trappeur', Boulanger: 'boulanger', Cuisinier: 'cuisinier', Armurier: 'armurier', Bijoutier: 'bijoutier',
  Tailleur: 'tailleur', Maroquinier: 'maroquinier', Ébéniste: 'ebeniste', "Maitre d'Armes": 'maitre-armes',
};
const JOB_EMOJI = {
  Paysan: '🌾', Forestier: '🌲', Herboriste: '🌿', Mineur: '⛏️', Pêcheur: '🎣', Trappeur: '🪤',
  Boulanger: '🥖', Cuisinier: '🍲', Armurier: '🛡️', Bijoutier: '💍', Tailleur: '🧵', Maroquinier: '👢',
  Ébéniste: '🪵', "Maitre d'Armes": '⚔️',
};
function jobIcon(metier, fallback = '🔨') {
  const f = JOB_FILE[metier];
  if (!f) return JOB_EMOJI[metier] || fallback;
  const emo = JOB_EMOJI[metier] || fallback;
  return `<img class="job-ico" src="icons/metiers/${f}.png" alt="" title="${escapeHtml(jobName(metier))}" onerror="this.replaceWith(document.createTextNode('${emo}'))">`;
}

let IDX = null;
let loading = null;
let ctx = null; // { getCraft, saveCraft, toast, showView }

/* ------------------------------------------------------------ chargement */

export function loadGamedata() {
  if (IDX) return Promise.resolve(IDX);
  if (loading) return loading;
  const get = f => fetch(`data/${f}.json`, { cache: 'no-cache' }).then(r => {
    if (!r.ok) throw new Error(`${f}.json : ${r.status}`);
    return r.json();
  });
  // version anglaise : textes anglais du jeu (facultatifs : sans eux, seuls les noms sont traduits)
  const en = isEn ? get('data_en').catch(() => ({})) : null;
  loading = Promise.all([...['data_item', 'data_ressource', 'data_bestiaire'].map(get), en])
    .then(([a, b, c, e]) => { if (e) toEnglish(a, b, c, e); IDX = buildIndex(a, b, c); return IDX; })
    .catch(e => { loading = null; throw e; });
  return loading;
}

/** Passe les données en anglais : noms (le français reste cherchable), types, effets, familles, zones, lieux de récolte.
 * Les métiers restent en français en interne (clés des niveaux enregistrés) et sont traduits à l'affichage. */
function toEnglish(dItem, dRes, dBest, en) {
  const tr = (table, v) => (v && table?.[v]) || v;
  const monEn = new Map();
  for (const m of dBest?.monstres || []) {
    if (m.nom_en) { monEn.set(m.nom, m.nom_en); [m.nom, m.nom_en] = [m.nom_en, m.nom]; }
    if (m.famille) m.famille = tr(en.familles, m.famille);
    if (m.zones) m.zones = m.zones.map(z => tr(en.zones, z));
    for (const d of [...(m.drops || []), ...(m.trappeur?.items || [])]) if (!d.id && d.nom_en) d.nom = d.nom_en;
  }
  for (const o of [...(dItem?.items || []), ...(dRes?.ressources || [])]) {
    o.nomFr = o.nom; o.typeFr = o.type; // les plans sont reliés à leur objet par le nom français
    if (o.nom_en) [o.nom, o.nom_en] = [o.nom_en, o.nom];
    o.type = tr(en.types, o.type);
    if (en.stats?.[o.id]) o.stats = en.stats[o.id];
    for (const d of o.drops || []) d.monstre = monEn.get(d.monstre) || d.monstre;
    for (const h of o.recolte || []) h.source = h.metier === 'Trappeur' ? (monEn.get(h.source) || h.source) : tr(en.sources, h.source);
  }
}

async function ensureData(viewId) {
  const view = $(`#${viewId}`);
  const load = view.querySelector('.loading');
  const body = view.querySelector('.view-body');
  if (IDX) { load.hidden = true; body.hidden = false; return true; }
  load.hidden = false;
  body.hidden = true;
  load.textContent = t('Chargement des données du jeu…');
  try {
    await loadGamedata();
    load.hidden = true;
    body.hidden = false;
    return true;
  } catch (e) {
    load.innerHTML = `${t('Impossible de charger les données du jeu ({err}).', { err: escapeHtml(e.message) })}<br>
      <button class="btn small" type="button">${t('Réessayer')}</button>`;
    load.querySelector('button').onclick = () => ensureData(viewId).then(ok => ok && ({ 'view-craft': renderCraft, 'view-plans': renderPlans }[viewId] || renderMonsters)());
    return false;
  }
}

/* ------------------------------------------------------------ petits rendus */

const rarityName = r => rarityLabel(IDX?.raretes?.[r] || '');
// Icônes officielles (CDN Ankama) et portraits (wakfu.wiki.gg), chargés à la demande.
const ITEM_IMG = (gfx, size = 64) => `https://static.ankama.com/wakfu/portal/game/item/${size}/${gfx}.png`;
const MONSTER_IMG = (file, px = 80) => `https://wakfu.wiki.gg/images/thumb/${encodeURIComponent(file)}/${px}px-${encodeURIComponent(file)}`;
const imgFallback = `onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'ico-ph'}))"`;
export function itemIcon(o, { size = 64, cls = '' } = {}) {
  const r = RARITY_CLASS[o?.rarete] || 'commun';
  if (!o?.gfx) return `<span class="ico ico-ph ${r} ${cls}"></span>`;
  return `<span class="ico ${r} ${cls}" title="${escapeHtml(rarityName(o.rarete))}"><img src="${ITEM_IMG(o.gfx, size)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" ${imgFallback}></span>`;
}
export function monsterPortrait(m, { px = 80, cls = '' } = {}) {
  if (!m?.image) return `<span class="portrait ph ${cls}" aria-hidden="true">${escapeHtml((m?.nom || '?')[0])}</span>`;
  return `<span class="portrait ${cls}"><img src="${MONSTER_IMG(m.image, px)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.classList.add('ph');this.remove()"></span>`;
}
function itemLabel(o, { link = true } = {}) {
  if (!o) return '<span class="muted">?</span>';
  const inner = `${itemIcon(o)}<span class="lbl">${escapeHtml(o.nom)}</span>`;
  return link ? `<button class="item-link" type="button" data-item="${o.id}">${inner}</button>` : `<span class="item-name">${inner}</span>`;
}
let monsterNames = null;
function monsterByName(name) {
  if (!IDX) return null;
  if (!monsterNames) { monsterNames = new Map(); for (const m of IDX.monsters) if (!monsterNames.has(m.nom)) monsterNames.set(m.nom, m); }
  return monsterNames.get(name) || null;
}
// Niveaux de métier saisis par le joueur (Réglages) : renvoie son niveau s'il est trop bas, sinon null.
const myJobs = () => ctx?.jobs?.() || {};
function tooLow(metier, niveau) {
  const l = myJobs()[metier];
  return l != null && l < niveau ? l : null;
}
// Plans déjà appris (onglet Plans) ; planTag : rappel sur une fabrication qui demande un plan.
const myPlans = () => ctx?.plans?.() || {};
function planTag(id, { action = true } = {}) {
  const p = IDX.planOf.get(id);
  if (!p) return '';
  const plan = IDX.byId.get(p);
  if (myPlans()[p]) return `<span class="plan-tag ok" title="${escapeHtml(t('Plan appris : {nom}', { nom: plan.nom }))}">📜 ✓</span>`;
  return `<span class="plan-tag miss"><button class="link" type="button" data-item="${p}" title="${escapeHtml(t('Il faut avoir appris {nom} : voir où le trouver', { nom: plan.nom }))}">📜 ${t('Plan requis')}</button>`
    + `${action ? ` · <button class="link" type="button" data-plan-own="${p}" title="${t('Je l\'ai déjà appris')}">${t('je l\'ai')}</button>` : ''}</span>`;
}

/* Regroupement des ressources à réunir (au choix, mémorisé sur l'appareil) :
 * par niveau (liste simple), par provenance (métier de récolte ou famille du monstre) ou par monstre. */
const GROUP_KEY = 'wakforge.craftGroup';
let groupMode = 'niveau';
try { groupMode = localStorage.getItem(GROUP_KEY) || 'niveau'; } catch { /* rien */ }
// Objets PvP (achetés ou améliorés avec des jetons PvP) : badge, et option pour les masquer de la recherche.
const PVP_KEY = 'wakforge.hidePvp';
let hidePvp = false;
try { hidePvp = localStorage.getItem(PVP_KEY) === '1'; } catch { /* rien */ }
const pvpTag = o => (o?.pvp ? `<span class="pvp-tag" title="${escapeHtml(t('Objet PvP : s\'achète ou s\'améliore avec des jetons PvP (Médaille de Bravoure, Galon déchiré)'))}">⚔ PvP</span>` : '');
function monsterGroup(name) {
  const m = monsterByName(name);
  return { key: `m:${name}`, html: `<button class="link" type="button" data-monster="${escapeHtml(name)}" title="${t('Voir le monstre')}">${m?.image ? monsterPortrait(m, { px: 40, cls: 'mini' }) : '⚔'} ${escapeHtml(name)}</button>` };
}
function groupOf(o, bought) {
  const harvest = (o.recolte || []).filter(h => h.metier !== 'Trappeur').sort((a, b) => a.niveau - b.niveau);
  const trap = (o.recolte || []).filter(h => h.metier === 'Trappeur').sort((a, b) => a.niveau - b.niveau);
  const drops = [...(o.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
  if (groupMode === 'monstre') {
    if (drops.length) return monsterGroup(drops[0].monstre);
    if (trap.length) return monsterGroup(trap[0].source);
  }
  if (harvest.length) return { key: `j:${harvest[0].metier}`, html: `${jobIcon(harvest[0].metier, '•')} ${escapeHtml(jobName(harvest[0].metier))}` };
  if (trap.length) return { key: 'j:Trappeur', html: `${jobIcon('Trappeur')} ${jobName('Trappeur')}` };
  if (drops.length) {
    const fam = monsterByName(drops[0].monstre)?.famille;
    return fam ? { key: `f:${fam}`, html: `⚔ ${escapeHtml(fam)}` } : monsterGroup(drops[0].monstre);
  }
  if (bought && mainRecipe(o)) return { key: 'z:craft', html: `🔨 ${t('Fabricables, mis dans les courses')}`, last: 1 };
  return { key: 'z:market', html: t('Marché / autre (provenance inconnue)'), last: 2 };
}
/** rows triés -> [{ g, rows }] (un seul groupe sans en-tête en mode « niveau »). */
function groupRows(rows, acheter) {
  if (groupMode === 'niveau') return [{ g: null, rows }];
  const map = new Map();
  for (const b of rows) {
    const g = groupOf(b.o, !!acheter[b.id]);
    if (!map.has(g.key)) map.set(g.key, { g, rows: [] });
    map.get(g.key).rows.push(b);
  }
  const left = x => x.rows.filter(b => b.missing > 0).length;
  return [...map.values()].sort((a, b) => (a.g.last || 0) - (b.g.last || 0) || (left(b) > 0) - (left(a) > 0)
    || b.rows.length - a.rows.length || a.g.key.localeCompare(b.g.key));
}
const groupCount = rows => { const n = rows.filter(b => b.missing > 0).length; return n ? t('{n} à réunir', { n }) : t('tout est réuni ✓'); };

function srcHtml(s) {
  if (s.kind === 'recolte') {
    const low = tooLow(s.metier, s.niveau);
    return `<span class="src recolte${low != null ? ' low' : ''}" title="${escapeHtml(t('{job} niveau {lvl}', { job: jobName(s.metier), lvl: s.niveau }))}${low != null ? ` ${escapeHtml(t('(tu es niveau {n})', { n: low }))}` : ''}">${jobIcon(s.metier, '•')} ${escapeHtml(jobName(s.metier))} ${s.niveau}`
      + `${s.source ? ` · ${escapeHtml(s.source)}` : ''}${s.taux ? ` (${s.taux} %)` : ''}${low != null ? ' 🔒' : ''}</span>`;
  }
  if (s.kind === 'drop') {
    const m = monsterByName(s.monstre);
    return `<button class="src drop" type="button" data-monster="${escapeHtml(s.monstre)}" title="${t('Voir le monstre')}">${m?.image ? monsterPortrait(m, { px: 40, cls: 'mini' }) : '⚔'} ${escapeHtml(s.monstre)}${s.taux != null ? ` ${s.taux} %` : ''}</button>`;
  }
  if (s.kind === 'trappeur') {
    const m = monsterByName(s.monstre);
    return `<button class="src recolte" type="button" data-monster="${escapeHtml(s.monstre)}" title="${t('Voir le monstre')}">${jobIcon('Trappeur')} ${m?.image ? monsterPortrait(m, { px: 40, cls: 'mini' }) : ''} ${jobName('Trappeur')} ${s.niveau} · ${escapeHtml(s.monstre)}</button>`;
  }
  if (s.kind === 'more') return `<span class="src more">+${s.count} ${escapeHtml(t(s.label || 'monstres'))}</span>`;
  if (s.kind === 'recette') return `<span class="src recette">${jobIcon(s.metier, '🔨')} ${t('fabricable ({job} {lvl})', { job: escapeHtml(jobName(s.metier)), lvl: s.niveau })}</span>`;
  return '';
}

/* ------------------------------------------------------------ recherche (artisanat) */

let sugg = [];
let suggIdx = -1;

function renderCraftSuggest() {
  const input = $('#craftSearch');
  const box = $('#craftSuggest');
  sugg = searchItems(IDX, input.value, { limit: 10, hidePvp });
  const hidden = hidePvp ? searchItems(IDX, input.value, { limit: 400 }).filter(o => o.pvp).length : 0;
  box.innerHTML = sugg.map((o, i) => {
    const r = mainRecipe(o);
    const meta = [o.type, t('Niv. {n}', { n: o.niveau }), rarityName(o.rarete)].filter(Boolean).join(' · ');
    const chip = r ? `<span class="chip">${jobIcon(r.metier, '🔨')} ${escapeHtml(jobName(r.metier))} ${r.niveau}</span>` : `<span class="chip unknown">${t('non fabricable')}</span>`;
    return `<li role="option" data-i="${i}" aria-selected="${i === suggIdx}">
      <div class="s-main"><div class="s-name">${itemLabel(o, { link: false })}${pvpTag(o)}</div><div class="s-meta">${escapeHtml(meta)}</div></div>${chip}</li>`;
  }).join('') + (hidden ? `<li class="s-note muted small" aria-disabled="true">${tn(hidden, '{n} objet PvP masqué', '{n} objets PvP masqués')}</li>` : '');
  const open = (sugg.length > 0 || hidden > 0) && document.activeElement === input;
  box.hidden = !open;
  box.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
}

function addTarget(o, qte = 1) {
  if (!o) return;
  if (!mainRecipe(o)) {
    openItem(o.id);
    ctx.toast(t('{nom} ne se fabrique pas : voir sa provenance.', { nom: escapeHtml(o.nom) }), 'warn');
    return;
  }
  const c = ctx.getCraft();
  const cur = c.cibles.find(x => x.id === o.id);
  if (cur) cur.qte += qte; else c.cibles.push({ id: o.id, qte });
  ctx.saveCraft();
  renderCraft();
  ctx.toast(t('<b>{nom}</b> ajouté à la liste.', { nom: escapeHtml(o.nom) }), 'ok');
}

/* ------------------------------------------------------------ artisanat */

export async function renderCraft() {
  if (!(await ensureData('view-craft'))) return;
  renderCraftLists();
  const c = ctx.getCraft();
  c.cibles = c.cibles.filter(x => IDX.byId.has(x.id));
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });

  // objectifs
  $('#craftEmpty').hidden = c.cibles.length > 0;
  $('#craftResults').hidden = c.cibles.length === 0;
  $('#craftTargets').innerHTML = c.cibles.map(tg => {
    const o = IDX.byId.get(tg.id);
    const r = mainRecipe(o);
    return `<div class="target" data-id="${o.id}">
      <div class="t-main">${itemLabel(o)}${pvpTag(o)}<div class="s-meta">${escapeHtml(o.type)} · ${t('Niv. {n}', { n: o.niveau })} · ${jobIcon(r.metier, '')} ${escapeHtml(jobName(r.metier))} ${r.niveau} ${planTag(o.id, { action: false })}</div></div>
      <div class="stepper"><button type="button" data-step="-1" aria-label="${t('Moins')}">−</button>
        <input type="number" min="1" max="9999" value="${tg.qte}" data-qte aria-label="${t('Quantité')}">
        <button type="button" data-step="1" aria-label="${t('Plus')}">+</button></div>
      <button class="icon-btn del" type="button" data-remove title="${t('Retirer')}" aria-label="${t('Retirer')}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button>
    </div>`;
  }).join('');
  if (!c.cibles.length) { renderOverlay(); return; }

  // résumé
  const missingCount = res.base.filter(b => b.missing > 0).length;
  const prix = ctx.prices();
  const cost = costIndex(IDX, prix);
  const toBuy = res.base.filter(b => b.missing > 0);
  const unpriced = toBuy.filter(b => !prix[b.id]).length;
  const left = toBuy.reduce((sum, b) => sum + (prix[b.id] || 0) * b.missing, 0);
  const jobs = Object.entries(res.jobs).sort((a, b) => b[1] - a[1]);
  const lowCrafts = res.crafts.filter(x => x.runs > 0 && tooLow(x.recipe.metier, x.recipe.niveau) != null).length;
  const plansLeft = missingPlans(IDX, res.crafts, myPlans()).length;
  $('#craftSummary').innerHTML = `
    <div class="stat"><b>${res.base.length}</b><span>${t('ressources')}</span></div>
    <div class="stat"><b>${missingCount}</b><span>${t('encore à réunir')}</span></div>
    <div class="stat"><b>${res.crafts.filter(x => x.runs > 0).length}</b><span>${t('fabrications')}</span></div>
    <div class="stat" title="${t('Ce qui reste à réunir, au prix saisi dans la colonne Prix')}"><b>${left ? fmtN(Math.round(left)) : '—'}</b><span>${t('kamas restants')}${unpriced && toBuy.length ? ` · ${t('{n} sans prix', { n: unpriced })}` : ''}</span></div>
    <div class="jobs">${jobs.map(([j, l]) => {
      const mine = myJobs()[j];
      const cls = mine == null ? '' : mine < l ? ' low' : ' ok';
      return `<button class="chip job${cls}" type="button" data-job="${escapeHtml(j)}" title="${mine == null ? t('Clique pour indiquer ton niveau') : t('Ton niveau : {n}. Clique pour le changer', { n: mine })}">${jobIcon(j, '')} ${escapeHtml(jobName(j))} ${l}${mine != null && mine < l ? ` <span class="mine">· ${t('toi {n}', { n: mine })}</span>` : mine != null ? ' ✓' : ''}</button>`;
    }).join('')}${lowCrafts ? `<span class="jobs-warn">🔒 ${tn(lowCrafts, '{n} fabrication au-dessus de ton niveau', '{n} fabrications au-dessus de ton niveau')}</span>`
      : !Object.keys(myJobs()).length ? `<span class="jobs-hint">${t('Clique sur un métier pour indiquer ton niveau.')}</span>` : ''}${plansLeft
      ? `<button class="jobs-warn link" type="button" data-goto-plans title="${t('Voir les plans dans l\'onglet Plans')}">📜 ${tn(plansLeft, '{n} plan à obtenir', '{n} plans à obtenir')}</button>` : ''}</div>`;

  // ressources
  const hideDone = $('#craftHideDone').checked;
  const rows = res.base
    .map(b => ({ ...b, o: IDX.byId.get(b.id) }))
    .sort((a, b) => (b.missing > 0) - (a.missing > 0) || a.o.niveau - b.o.niveau || a.o._key.localeCompare(b.o._key));
  $('#craftGroup').value = groupMode;
  const groups = groupRows(rows, c.acheter);
  $('#craftBase').innerHTML = groups.map(({ g, rows: gr }) => {
    const shown = gr.filter(b => !hideDone || b.missing > 0);
    if (!shown.length) return '';
    return (g ? `<tr class="grp"><th colspan="6"><span class="grp-name">${g.html}</span><span class="grp-count">${groupCount(gr)}</span></th></tr>` : '')
      + shown.map(b => {
    const bought = !!c.acheter[b.id];
    const srcs = sourcesOf(b.o).filter(s => !(s.kind === 'recette' && !bought));
    const p = prix[b.id] || 0;
    const mk = bought ? cost(b.id).craft : null;
    const mkTxt = mk != null ? t('fabriquer : {k}/u', { k: fmtK(mk) }) : '';
    const vs = mk != null && p ? (mk < p ? ` · <span class="cheaper">${t('fabriquer : {k}/u, moins cher', { k: fmtK(mk) })}</span>` : ` · ${mkTxt}`)
      : mk != null ? ` · ${mkTxt}` : '';
    return `<tr class="${b.missing > 0 ? '' : 'done'}" data-id="${b.id}">
      <td class="name">${itemLabel(b.o)}${pvpTag(b.o)}<div class="sub">${t('Niv. {n}', { n: b.o.niveau })} · ${escapeHtml(rarityName(b.o.rarete))}${bought ? ` · <button class="link" type="button" data-craft-again>${t('fabriquer à nouveau')}</button>` : ''}${vs}</div></td>
      <td class="num"><b>${fmtN(b.need)}</b></td>
      <td class="num"><input class="have" type="number" min="0" value="${c.stock[b.id] || 0}" data-have aria-label="${t('J\'en ai')}"></td>
      <td class="num ${b.missing > 0 ? 'miss' : 'ok'}">${b.missing > 0 ? fmtN(b.missing) : '✓'}</td>
      <td class="num price"><input class="have" type="number" min="0" step="1" value="${p || ''}" placeholder="—" data-price aria-label="${t('Prix unitaire en kamas')}" title="${t('Prix unitaire (HDV) en kamas')}">${p && b.missing > 0 ? `<div class="sub">${fmtK(p * b.missing)}</div>` : ''}</td>
      <td class="where"><div class="srcs">${srcs.map(srcHtml).join('') || `<span class="muted small">${t('provenance inconnue (marché)')}</span>`}</div></td>
    </tr>`;
      }).join('');
  }).join('') || `<tr><td colspan="6" class="empty-small">${t('Tout est réuni 🎉')}</td></tr>`;

  renderOverlay();

  // étapes
  $('#craftSteps').innerHTML = res.crafts.map(x => {
    const o = IDX.byId.get(x.id);
    const isTarget = c.cibles.some(tg => tg.id === x.id);
    const yieldQ = x.recipe.quantite || 1;
    const k = cost(x.id);
    let cmp = '';
    if (k.craft != null && k.buy != null) {
      cmp = k.buy < k.craft
        ? `<span class="cost cheaper">${t('acheter : {a}/u, moins cher que fabriquer ({b}/u)', { a: fmtK(k.buy), b: fmtK(k.craft) })}</span>`
        : `<span class="cost">${t('fabriquer : {a}/u, moins cher qu\'acheter ({b}/u)', { a: fmtK(k.craft), b: fmtK(k.buy) })}</span>`;
    } else if (k.craft != null) cmp = `<span class="cost">${t('fabriquer : {k}/u', { k: fmtK(k.craft) })}</span>`;
    const low = x.runs > 0 ? tooLow(x.recipe.metier, x.recipe.niveau) : null;
    return `<li class="${x.runs === 0 ? 'done' : ''}${low != null ? ' locked' : ''}" data-id="${x.id}">
      <span class="job"${low != null ? ` title="${escapeHtml(t('Tu es {job} niveau {n} : il te faut le niveau {lvl} (ou acheter l\'objet)', { job: jobName(x.recipe.metier), n: low, lvl: x.recipe.niveau }))}"` : ''}>${jobIcon(x.recipe.metier, '🔨')} ${escapeHtml(jobName(x.recipe.metier))} ${x.recipe.niveau}${low != null ? ` <span class="lvl-low">🔒 ${t('toi {n}', { n: low })}</span>` : ''}</span>
      <span class="what">${x.runs > 0 ? `<b>${fmtN(x.runs)}×</b>` : '<b>✓</b>'} ${itemLabel(o)}${pvpTag(o)}${x.runs > 0 ? planTag(x.id) : ''}${yieldQ > 1 ? ` <span class="muted small">${t('({n} par fabrication)', { n: yieldQ })}</span>` : ''}
        ${x.have ? `<span class="muted small">· ${t('{n} déjà en stock', { n: fmtN(x.have) })}</span>` : ''}${cmp}</span>
      <span class="step-actions">
        <input class="have" type="number" min="0" value="${c.stock[x.id] || 0}" data-have title="${t('Déjà en stock')}" aria-label="${t('Déjà en stock')}">
        <input class="have" type="number" min="0" step="1" value="${prix[x.id] || ''}" placeholder="${t('Prix')}" data-price title="${t('Prix unitaire à l\'HDV (kamas), pour comparer avec la fabrication')}" aria-label="${t('Prix unitaire en kamas')}">
        ${isTarget ? '' : `<button class="btn small ghost" type="button" data-buy title="${t('Ne pas fabriquer : l\'ajouter aux courses')}">${t('Acheter')}</button>`}
      </span>
    </li>`;
  }).join('');
}

/** Onglets des listes de craft (une liste par projet : « Panoplie 200 », « Reroll »…). */
function renderCraftLists() {
  const L = ctx.lists;
  const all = L.all();
  $('#craftLists').innerHTML = all.map(l => `<span class="list-tab${l.active ? ' active' : ''}">
      <button type="button" role="tab" data-list="${escapeHtml(l.id)}" aria-selected="${l.active}" title="${l.active ? t('Double-clic pour renommer') : t('Ouvrir cette liste')}">${escapeHtml(l.nom)}<span class="list-count">${l.count}</span></button>
      ${l.active ? `<button class="list-act" type="button" data-list-rename title="${t('Renommer')}" aria-label="${t('Renommer la liste')}">✎</button>
      ${all.length > 1 ? `<button class="list-act" type="button" data-list-delete title="${t('Supprimer cette liste')}" aria-label="${t('Supprimer la liste')}">×</button>` : ''}` : ''}
    </span>`).join('')
    + (all.length < L.max ? `<button class="btn small ghost list-new" type="button" data-list-new title="${t('Créer une autre liste de craft')}">+ ${t('Nouvelle liste')}</button>` : '');
}

function bindCraftLists() {
  const L = ctx.lists;
  const activeId = () => L.all().find(l => l.active)?.id;
  const rename = () => {
    const nom = prompt(t('Nom de la liste :'), L.activeName());
    if (nom != null && L.rename(activeId(), nom)) renderCraft();
  };
  const box = $('#craftLists');
  box.addEventListener('click', e => {
    const tab = e.target.closest('[data-list]');
    if (tab) { if (L.switch(tab.dataset.list)) renderCraft(); return; }
    if (e.target.closest('[data-list-rename]')) { rename(); return; }
    if (e.target.closest('[data-list-new]')) {
      const nom = prompt(t('Nom de la nouvelle liste :'), t('Liste {n}', { n: L.all().length + 1 }));
      if (nom != null && L.create(nom)) { renderCraft(); $('#craftSearch').focus(); }
      return;
    }
    if (e.target.closest('[data-list-delete]')) {
      const nom = L.activeName();
      const undo = L.remove(activeId());
      if (!undo) return;
      renderCraft();
      ctx.toastUndo(t('Liste <b>{nom}</b> supprimée.', { nom: escapeHtml(nom) }), () => { undo(); renderCraft(); });
    }
  });
  box.addEventListener('dblclick', e => { if (e.target.closest('[data-list][aria-selected="true"]')) rename(); });
}

function bindCraft() {
  bindCraftLists();
  const input = $('#craftSearch');
  input.addEventListener('input', () => {
    // un lien de partage collé dans la recherche importe la liste
    if (/#liste=/.test(input.value) && ctx.importShared?.(input.value)) { input.value = ''; renderCraftSuggest(); return; }
    suggIdx = input.value.trim() ? 0 : -1;
    renderCraftSuggest();
  });
  input.addEventListener('focus', () => IDX && renderCraftSuggest());
  input.addEventListener('blur', () => setTimeout(() => { $('#craftSuggest').hidden = true; }, 150));
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); suggIdx = Math.min(sugg.length - 1, suggIdx + 1); renderCraftSuggest(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); suggIdx = Math.max(0, suggIdx - 1); renderCraftSuggest(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const o = sugg[Math.max(0, suggIdx)];
      if (o) { addTarget(o, Math.max(1, +$('#craftQty').value || 1)); input.value = ''; $('#craftQty').value = 1; suggIdx = -1; renderCraftSuggest(); }
    } else if (e.key === 'Escape') { input.value = ''; renderCraftSuggest(); }
  });
  $('#craftSuggest').addEventListener('mousedown', e => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    addTarget(sugg[+li.dataset.i], Math.max(1, +$('#craftQty').value || 1));
    input.value = ''; $('#craftQty').value = 1; renderCraftSuggest();
  });

  $('#craftTargets').addEventListener('click', e => {
    const row = e.target.closest('.target');
    if (!row) return;
    const c = ctx.getCraft();
    const tg = c.cibles.find(x => x.id === +row.dataset.id);
    if (!tg) return;
    if (e.target.closest('[data-step]')) {
      tg.qte = Math.max(1, tg.qte + +e.target.closest('[data-step]').dataset.step);
      ctx.saveCraft(); renderCraft();
    } else if (e.target.closest('[data-remove]')) {
      c.cibles = c.cibles.filter(x => x !== tg);
      ctx.saveCraft(); renderCraft();
    }
  });
  $('#craftTargets').addEventListener('change', e => {
    if (!e.target.matches('[data-qte]')) return;
    const c = ctx.getCraft();
    const tg = c.cibles.find(x => x.id === +e.target.closest('.target').dataset.id);
    if (tg) { tg.qte = Math.max(1, Math.min(9999, Math.floor(+e.target.value) || 1)); ctx.saveCraft(); renderCraft(); }
  });

  const onHave = e => {
    if (!e.target.matches('[data-have]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    const c = ctx.getCraft();
    const v = Math.max(0, Math.floor(+e.target.value) || 0);
    if (v) c.stock[id] = v; else delete c.stock[id];
    ctx.saveCraft(); renderCraft();
  };
  const onPrice = e => {
    if (!e.target.matches('[data-price]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    const prix = ctx.prices();
    const v = Math.min(1e10, Math.max(0, Math.round(+e.target.value) || 0));
    if (v) prix[id] = v; else delete prix[id];
    ctx.saveCraft(); renderCraft();
  };
  for (const box of [$('#craftBase'), $('#craftSteps')]) {
    box.addEventListener('change', onHave);
    box.addEventListener('change', onPrice);
  }
  $('#craftSteps').addEventListener('click', e => {
    if (!e.target.closest('[data-buy]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    ctx.getCraft().acheter[id] = true;
    ctx.saveCraft(); renderCraft();
    ctx.toast(t('{nom} passe dans les courses (à acheter ou réunir tel quel).', { nom: escapeHtml(IDX.byId.get(id).nom) }));
  });
  $('#craftBase').addEventListener('click', e => {
    if (!e.target.closest('[data-craft-again]')) return;
    const id = +e.target.closest('[data-id]').dataset.id;
    delete ctx.getCraft().acheter[id];
    ctx.saveCraft(); renderCraft();
  });
  $('#craftHideDone').addEventListener('change', renderCraft);
  $('#craftHidePvp').checked = hidePvp;
  $('#craftHidePvp').addEventListener('change', e => {
    hidePvp = e.target.checked;
    try { localStorage.setItem(PVP_KEY, hidePvp ? '1' : '0'); } catch { /* rien */ }
    suggIdx = -1;
    renderCraftSuggest();
  });
  $('#craftGroup').addEventListener('change', e => {
    groupMode = e.target.value;
    try { localStorage.setItem(GROUP_KEY, groupMode); } catch { /* rien */ }
    renderCraft();
  });
  $('#craftSummary').addEventListener('click', e => {
    if (e.target.closest('[data-goto-plans]')) { planFilter('list'); return; }
    const chip = e.target.closest('[data-job]');
    if (!chip) return;
    const j = chip.dataset.job;
    const v = prompt(t('Ton niveau en {job} (vide pour ne pas l\'indiquer) :', { job: jobName(j) }), myJobs()[j] || '');
    if (v == null) return;
    ctx.setJob(j, v);
    renderCraft();
  });
  $('#craftShare').addEventListener('click', async () => {
    const c = ctx.getCraft();
    if (!c.cibles.length) return;
    const url = `${ctx.shareBase()}#liste=${encodeShare(ctx.lists.activeName(), c.cibles)}`;
    try {
      await navigator.clipboard.writeText(url);
      ctx.toast(t('Lien de la liste copié : envoie-le, il s\'ouvre sur le site et s\'importe en un clic.'), 'ok');
    } catch { prompt(t('Lien de partage de la liste :'), url); }
  });
  $('#craftOverlay').addEventListener('click', () => openOverlay());
  $('#craftClear').addEventListener('click', () => {
    const c = ctx.getCraft();
    if (!c.cibles.length) return;
    const saved = JSON.parse(JSON.stringify(c));
    c.cibles = []; c.stock = {}; c.acheter = {};
    ctx.saveCraft(); renderCraft();
    ctx.toastUndo(t('Liste vidée.'), () => { Object.assign(c, saved); ctx.saveCraft(); renderCraft(); });
  });
  $('#craftCopy').addEventListener('click', async () => {
    const c = ctx.getCraft();
    const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
    const lines = [...(ctx.lists.all().length > 1 ? [t('Liste : {nom}', { nom: ctx.lists.activeName() }), ''] : []), t('Objectifs :'), ...c.cibles.map(tg => `- ${tg.qte} × ${IDX.byId.get(tg.id).nom}`), '', t('À réunir :')];
    const prix = ctx.prices();
    let total = 0;
    for (const b of res.base.filter(x => x.missing > 0)) {
      const p = prix[b.id];
      total += (p || 0) * b.missing;
      lines.push(`- ${b.missing} × ${IDX.byId.get(b.id).nom}${p ? ` (${fmtK(p * b.missing)})` : ''}`);
    }
    if (total) lines.push(t('Total : {k}', { k: fmtK(total) }));
    lines.push('', t('Fabrications :'));
    for (const x of res.crafts.filter(y => y.runs > 0)) lines.push(`- ${x.runs} × ${IDX.byId.get(x.id).nom} (${jobName(x.recipe.metier)} ${x.recipe.niveau})`);
    try { await navigator.clipboard.writeText(lines.join('\n')); ctx.toast(t('Liste copiée.'), 'ok'); }
    catch { ctx.toast(t('Copie impossible dans ce navigateur.'), 'error'); }
  });
}

/* ------------------------------------------------------------ monstres */

let monsterLimit = 40;
let openMonsters = new Set();

export async function renderMonsters() {
  if (!(await ensureData('view-monsters'))) return;
  const q = norm($('#monsterSearch').value);
  const type = $('#monsterType').value;
  let list = IDX.monsters;
  let byItem = null;
  if (q) {
    // monstres dont le nom, la famille ou la zone correspond… ou qui droppent un objet correspondant
    const itemIds = new Set(searchItems(IDX, q, { limit: 400 }).filter(o => o._key.includes(q)).map(o => o.id));
    byItem = itemIds;
    list = list.filter(m => m._key.includes(q) || m._extra.includes(q) || monsterItemIds(m).some(id => itemIds.has(id)));
  }
  if (type) list = list.filter(m => (m.type || 'Monstre') === type);
  $('#monsterCount').textContent = tn(list.length, '{n} monstre', '{n} monstres', { n: fmtN(list.length) });
  const shown = list.slice(0, monsterLimit);
  $('#monsterList').innerHTML = shown.map(m => {
    const lv = m.niveau_min != null ? (m.niveau_max && m.niveau_max !== m.niveau_min ? `${m.niveau_min}–${m.niveau_max}` : `${m.niveau_min}`) : '?';
    const open = openMonsters.has(m._i) || shown.length === 1;
    const drops = [...(m.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
    const archi = m.type === 'Archimonstre' ? ctx.archiInfo?.(m) : null;
    const match = byItem ? [...drops, ...(m.trappeur?.items || []).map(x => ({ ...x, trap: true }))].filter(d => d.id && byItem.has(d.id)) : [];
    return `<article class="mcard ${open ? 'open' : ''}" data-m="${m._i}">
      <button class="mhead" type="button" aria-expanded="${open}">
        ${monsterPortrait(m)}
        <span class="mname">${escapeHtml(m.nom)}</span>${m.nom_en ? `<span class="men">${escapeHtml(m.nom_en)}</span>` : ''}
        ${m.type && m.type !== 'Monstre' ? `<span class="tag ${m.type === 'Archimonstre' ? 'perso' : 'custom'}">${escapeHtml(monsterTypeName(m.type))}</span>` : ''}
        ${archi ? `<span class="chip ${archi.running ? 'running' : archi.duration ? '' : 'spawn'}">${archi.running ? t('en cours') : escapeHtml(archi.duration || archi.spawn || t('durée ?'))}</span>` : ''}
        <span class="mlv">${t('Niv. {n}', { n: lv })}</span>
        <span class="mmeta">${escapeHtml([m.famille, (m.zones || []).slice(0, 2).join(', ')].filter(Boolean).join(' · '))}</span>
        ${match.length ? `<span class="mmatch">${match.slice(0, 2).map(d => (d.trap ? '🪤 ' : `${t('droppe')} `) + escapeHtml(IDX.byId.get(d.id).nom) + (d.taux != null ? ` (${d.taux} %)` : '')).join(', ')}</span>` : ''}
        <span class="chev" aria-hidden="true">▾</span>
      </button>
      ${open ? `<div class="mbody">
        ${archi ? `<div class="archi-bar">
          <span>⏱ ${archi.duration ? `${t('Réapparition :')} <b>${escapeHtml(archi.duration)}</b>${archi.overridden ? ` <span class="tag perso">${t('durée perso')}</span>` : ''}` : escapeHtml(archi.spawn ? t('Pas de timer ({x})', { x: archi.spawn }) : t('Durée inconnue'))}</span>
          <span class="archi-actions">
            <button class="btn small primary" type="button" data-archi-launch="${escapeHtml(archi.id)}">${archi.running ? t('Relancer le timer') : t('Lancer le timer')}</button>
            <button class="btn small" type="button" data-archi-edit="${escapeHtml(archi.id)}">${t('Modifier la durée')}</button>
          </span>
        </div>` : ''}
        ${m.zones?.length ? `<p class="small"><span class="muted">${t('Zones :')}</span> ${escapeHtml(m.zones.join(', '))}</p>` : ''}
        ${drops.length ? `<h4>Drops</h4><ul class="drops">${drops.map(d => {
          const o = d.id && IDX.byId.get(d.id);
          return `<li>${o ? itemLabel(o) : `<span class="muted" title="${escapeHtml(d.nom_en)}">${escapeHtml(d.nom || `${d.nom_en} (en)`)}</span>`}<span class="rate">${d.taux != null ? `${d.taux} %` : ''}</span></li>`;
        }).join('')}</ul>` : `<p class="muted small">${t('Aucun drop connu.')}</p>`}
        ${m.trappeur ? `<h4>${jobIcon('Trappeur')} ${jobName('Trappeur')} ${m.trappeur.niveau}</h4><ul class="drops">${m.trappeur.items.map(d => {
          const o = d.id && IDX.byId.get(d.id);
          return `<li>${o ? itemLabel(o) : escapeHtml(d.nom || d.nom_en || '?')}<span class="rate">${escapeHtml(trapActionName(d.action || ''))}</span></li>`;
        }).join('')}</ul>` : ''}
      </div>` : ''}
    </article>`;
  }).join('') || `<p class="empty-small">${t('Aucun monstre ne correspond.')}</p>`;
  $('#monsterMore').hidden = list.length <= monsterLimit;
}

function bindMonsters() {
  let tmr;
  $('#monsterSearch').addEventListener('input', () => {
    clearTimeout(tmr);
    tmr = setTimeout(() => { monsterLimit = 40; openMonsters = new Set(); renderMonsters(); }, 120);
  });
  $('#monsterType').addEventListener('change', () => { monsterLimit = 40; renderMonsters(); });
  $('#monsterMore').addEventListener('click', () => { monsterLimit += 60; renderMonsters(); });
  $('#monsterList').addEventListener('click', e => {
    if (e.target.closest('[data-item]')) return;
    const launch = e.target.closest('[data-archi-launch]');
    if (launch) { ctx.archiLaunch?.(launch.dataset.archiLaunch); return; }
    const edit = e.target.closest('[data-archi-edit]');
    if (edit) { ctx.archiEdit?.(edit.dataset.archiEdit); return; }
    const head = e.target.closest('.mhead');
    if (!head) return;
    const i = +head.closest('.mcard').dataset.m;
    if (openMonsters.has(i)) openMonsters.delete(i); else openMonsters.add(i);
    renderMonsters();
  });
}

export function showMonster(name) {
  $('#monsterSearch').value = name;
  $('#monsterType').value = '';
  monsterLimit = 40;
  openMonsters = new Set();
  const m = IDX?.monsters.find(x => x.nom === name);
  if (m) openMonsters.add(m._i);
  ctx.showView('monsters');
}

/* ------------------------------------------------------------ plans */

const planCheck = (p, label = t('Je l\'ai appris')) => `<label class="check plan-own"><input type="checkbox" data-plan-own="${p}"${myPlans()[p] ? ' checked' : ''}> ${label}</label>`;
const planOfId = id => IDX.plans.find(p => p.id === id);
function planUnlocks(p) {
  const [first, ...rest] = p.items.map(i => IDX.byId.get(i));
  const r = mainRecipe(first);
  return `${itemLabel(first)}${rest.map(o => `<button class="item-link alt" type="button" data-item="${o.id}" title="${escapeHtml(`${o.nom} · ${rarityName(o.rarete)}`)}">${itemIcon(o)}</button>`).join('')}`
    + ` <span class="chip">${jobIcon(r.metier, '🔨')} ${escapeHtml(jobName(r.metier))} ${r.niveau}</span>`;
}
/** Encadré de la fiche objet : plan nécessaire pour cet objet, ou objets que ce plan débloque. */
function planSection(o) {
  const p = IDX.planOf.get(o.id);
  if (p) return `<p class="plan-box${myPlans()[p] ? ' ok' : ''}">📜 ${t('Se fabrique après avoir appris')} ${itemLabel(IDX.byId.get(p))} ${planCheck(p)}</p>`;
  const plan = planOfId(o.id);
  if (plan) return `<p class="plan-box${myPlans()[o.id] ? ' ok' : ''}">📜 ${t('Débloque la recette :')} ${planUnlocks(plan)} ${planCheck(o.id)}</p>`;
  return '';
}

let planLimit = 60;
/** Onglet Plans : tous les plans du jeu, à cocher quand on les a appris. */
export async function renderPlans() {
  if (!(await ensureData('view-plans'))) return;
  const q = norm($('#planSearch').value);
  const filter = $('#planFilter').value;
  const owned = myPlans();
  const c = ctx.getCraft();
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
  const forList = new Set(res.crafts.filter(x => x.runs > 0).map(x => IDX.planOf.get(x.id)).filter(Boolean));
  let list = IDX.plans.map(p => ({ ...p, o: IDX.byId.get(p.id) }));
  if (q) list = list.filter(p => [p.id, ...p.items].some(i => { const o = IDX.byId.get(i); return o._key.includes(q) || o._keyEn?.includes(q); }));
  if (filter === 'list') list = list.filter(p => forList.has(p.id));
  else if (filter === 'missing') list = list.filter(p => !owned[p.id]);
  else if (filter === 'owned') list = list.filter(p => owned[p.id]);
  list.sort((a, b) => forList.has(b.id) - forList.has(a.id) || !!owned[a.id] - !!owned[b.id] || a.o._key.localeCompare(b.o._key));
  const nOwned = IDX.plans.filter(p => owned[p.id]).length;
  $('#planCount').textContent = `${tn(list.length, '{n} plan', '{n} plans', { n: fmtN(list.length) })} · ${t('{a} appris sur {b}', { a: nOwned, b: IDX.plans.length })}`;
  $('#planList').innerHTML = list.slice(0, planLimit).map(p => {
    const drops = [...(p.o.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
    return `<div class="plan-row${owned[p.id] ? ' owned' : ''}" data-id="${p.id}">
      <label class="plan-tick" title="${t('Je l\'ai appris')}"><input type="checkbox" data-plan-own="${p.id}"${owned[p.id] ? ' checked' : ''} aria-label="${escapeHtml(t('{nom} : appris', { nom: p.o.nom }))}"></label>
      <div class="plan-main">
        <div>${itemLabel(p.o)}${forList.has(p.id) ? ` <span class="tag ${owned[p.id] ? 'perso' : 'custom'}">${t('dans ta liste')}</span>` : ''}</div>
        <div class="plan-unlocks"><span class="muted small">${t('Débloque :')}</span> ${planUnlocks(p)}</div>
      </div>
      <div class="srcs">${drops.slice(0, 3).map(d => srcHtml({ kind: 'drop', ...d })).join('')}${drops.length > 3 ? `<span class="src more">+${drops.length - 3} ${escapeHtml(t('monstres'))}</span>` : ''}${!drops.length ? `<span class="muted small">${t('provenance inconnue (quête, boutique, marché…)')}</span>` : ''}</div>
    </div>`;
  }).join('') || `<p class="empty-small">${filter === 'list' && !forList.size ? t('Aucune fabrication de ta liste ne demande de plan.') : t('Aucun plan ne correspond.')}</p>`;
  $('#planMore').hidden = list.length <= planLimit;
}
function planFilter(v) {
  $('#planSearch').value = '';
  $('#planFilter').value = v;
  planLimit = 60;
  ctx.showView('plans');
}
function setPlan(id, v) {
  ctx.setPlan(id, v);
  if (!$('#view-craft').hidden) renderCraft(); else renderOverlay();
  if (!$('#view-plans').hidden) renderPlans();
  if ($('#itemDlg').open) { const sc = $('#itemDlg').scrollTop; openItem(itemShown).then(() => { $('#itemDlg').scrollTop = sc; }); }
  ctx.toast(v ? t('Plan noté comme appris : {nom}', { nom: escapeHtml(IDX.byId.get(id).nom) }) : t('Plan retiré : {nom}', { nom: escapeHtml(IDX.byId.get(id).nom) }), v ? 'ok' : '');
}
function bindPlans() {
  let tmr;
  $('#planSearch').addEventListener('input', () => { clearTimeout(tmr); tmr = setTimeout(() => { planLimit = 60; renderPlans(); }, 120); });
  $('#planFilter').addEventListener('change', () => { planLimit = 60; renderPlans(); });
  $('#planMore').addEventListener('click', () => { planLimit += 100; renderPlans(); });
  // cases « appris » (onglet Plans, fiche objet) et boutons « je l'ai » (étapes de fabrication)
  document.addEventListener('change', e => {
    const el = e.target.closest('input[data-plan-own]');
    if (el) setPlan(+el.dataset.planOwn, el.checked);
  });
  document.addEventListener('click', e => {
    const el = e.target.closest('button[data-plan-own]');
    if (el) setPlan(+el.dataset.planOwn, true);
  });
}

/* ------------------------------------------------------------ fiche objet */

let itemShown = null;

export async function openItem(id) {
  await loadGamedata();
  const o = IDX.byId.get(id);
  if (!o) return;
  itemShown = id;
  const dlg = $('#itemDlg');
  const r = mainRecipe(o);
  const used = [...(IDX.usedIn.get(id) || [])].map(x => IDX.byId.get(x)).filter(Boolean)
    .sort((a, b) => a.niveau - b.niveau);
  const drops = [...(o.drops || [])].sort((a, b) => (b.taux ?? 0) - (a.taux ?? 0));
  const harvest = (o.recolte || []);
  $('#itemBody').innerHTML = `
    <div class="item-head">
      ${itemIcon(o, { size: 115, cls: 'big' })}
      <div>
        <span class="rar-badge ${RARITY_CLASS[o.rarete] || 'commun'}">${escapeHtml(rarityName(o.rarete))}</span>
        <h2>${escapeHtml(o.nom)}${pvpTag(o)}</h2>
        <p class="muted small">${escapeHtml(o.type)} · ${t('Niveau {n}', { n: o.niveau })}${o.nom_en ? ` · <i>${escapeHtml(o.nom_en)}</i>` : ''}</p>
      </div>
    </div>
    ${planSection(o)}
    ${o.stats?.length ? `<div class="stats">${o.stats.map(s => `<span>${escapeHtml(s)}</span>`).join('')}</div>` : ''}
    ${(o.recettes || []).map(rec => `<section><h4>${jobIcon(rec.metier, '🔨')} ${t('Recette')} · ${escapeHtml(jobName(rec.metier))} ${rec.niveau}${rec.amelioration ? ` · ${t('amélioration')}` : ''}${rec.quantite > 1 ? ` · ${t('donne {n}', { n: rec.quantite })}` : ''}</h4>
      <ul class="drops">${rec.ingredients.map(([iid, q]) => `<li>${itemLabel(IDX.byId.get(iid))}<span class="rate">× ${q}</span></li>`).join('')}</ul></section>`).join('')}
    ${harvest.length ? `<section><h4>${t('Récolte')}</h4><div class="srcs">${harvest.slice(0, 15).map(h => srcHtml(h.metier === 'Trappeur' ? { kind: 'trappeur', niveau: h.niveau, monstre: h.source } : { kind: 'recolte', ...h })).join('')}${harvest.length > 15 ? `<span class="src more">+${harvest.length - 15}</span>` : ''}</div></section>` : ''}
    ${drops.length ? `<section><h4>Drops (${drops.length})</h4><div class="srcs">${drops.slice(0, 15).map(d => srcHtml({ kind: 'drop', ...d })).join('')}${drops.length > 15 ? `<span class="src more">+${drops.length - 15}</span>` : ''}</div></section>` : ''}
    ${!r && !harvest.length && !drops.length ? `<p class="muted small">${t('Provenance inconnue dans les données (boutique, quête, marché…).')}</p>` : ''}
    ${used.length ? `<section><h4>${t('Utilisé dans ({n})', { n: used.length })}</h4><div class="used">${used.slice(0, 30).map(u => itemLabel(u)).join('')}${used.length > 30 ? `<span class="muted small">+${used.length - 30}</span>` : ''}</div></section>` : ''}
    <div class="dlg-actions">
      ${r ? `<button class="btn primary" type="button" data-add>+ ${t('Ajouter à la liste')}</button>` : ''}
      <button class="btn" type="button" data-close>${t('Fermer')}</button>
    </div>`;
  const add = $('#itemBody [data-add]');
  if (add) add.onclick = () => { addTarget(o, 1); dlg.close(); };
  if (!dlg.open) dlg.showModal();
  dlg.scrollTop = 0;
}

/* ------------------------------------------------------------ import d'un build (image du récap Wakfuli)
 * Le texte de l'image est lu dans le navigateur avec Tesseract.js, chargé à la première utilisation
 * (quelques Mo avec le français) ; buildimport.js retrouve ensuite les équipements. Rien n'est envoyé. */

const TESSERACT_JS = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist/tesseract.min.js';
let ocrWorker = null;
let ocrProgress = null;
let build = null; // { state: pick | read | list, err, msg, title, rows: [{ versions, sel, on }], unknown, newList }

function loadTesseract() {
  if (window.Tesseract) return Promise.resolve(window.Tesseract);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = TESSERACT_JS;
    s.onload = () => resolve(window.Tesseract);
    s.onerror = () => { s.remove(); reject(new Error(t('module de lecture indisponible, vérifie ta connexion'))); };
    document.head.append(s);
  });
}

/** Mots lus dans l'image, avec leur position. */
async function readImage(file) {
  const T = await loadTesseract();
  if (!ocrWorker) {
    ocrWorker = T.createWorker('fra', 1, { logger: m => ocrProgress?.(m) })
      .then(async w => { await w.setParameters({ tessedit_pageseg_mode: '11' }); return w; }) // texte épars : colonnes du récap
      .catch(e => { ocrWorker = null; throw e; });
  }
  const w = await ocrWorker;
  // petite image : agrandie, l'OCR lit mal les petits caractères
  const bmp = await createImageBitmap(file);
  const k = bmp.width < 1000 ? 2 : 1;
  const cv = document.createElement('canvas');
  cv.width = bmp.width * k; cv.height = bmp.height * k;
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const { data } = await w.recognize(cv, {}, { blocks: true });
  return (data.blocks || []).flatMap(b => b.paragraphs.flatMap(p => p.lines.flatMap(l => l.words)));
}

export async function openBuildImport() {
  await loadGamedata();
  build = { state: 'pick' };
  renderBuild();
  const dlg = $('#buildDlg');
  if (!dlg.open) dlg.showModal();
}

async function importBuildImage(file) {
  if (!file || !/^image\//.test(file.type)) { build = { state: 'pick', err: t('Ce fichier n\'est pas une image.') }; renderBuild(); return; }
  build = { state: 'read', msg: t('Chargement du module de lecture…') };
  renderBuild();
  ocrProgress = m => {
    if (build?.state !== 'read') return;
    const pct = m.progress ? ` ${Math.round(m.progress * 100)} %` : '';
    const msg = m.status === 'recognizing text' ? t('Lecture de l\'image…') + pct : t('Chargement du module de lecture…') + pct;
    const el = $('#buildBody [data-b-msg]');
    if (el) el.textContent = msg;
  };
  try {
    const { title, items } = parseRecapWords(await readImage(file));
    const { found, unknown } = matchBuild(IDX, items);
    if (!found.length) {
      build = { state: 'pick', err: t('Aucun équipement trouvé dans cette image. Utilise l\'export en image de l\'onglet « Récap » de Wakfuli (ou une capture de cet onglet) : chaque objet doit y apparaître avec son nom et son niveau.') };
    } else {
      const L = ctx.lists;
      build = {
        state: 'list', title, unknown,
        rows: found.map(f => ({ versions: f.versions, sel: f.versions.indexOf(f.pick), on: !!mainRecipe(f.pick) })),
        newList: ctx.getCraft().cibles.length > 0 && L.all().length < L.max,
      };
    }
  } catch (e) {
    build = { state: 'pick', err: t('Lecture impossible : {err}', { err: escapeHtml(e?.message || String(e)) }) };
  }
  renderBuild();
}

function renderBuild() {
  const body = $('#buildBody');
  if (!build) { body.innerHTML = ''; return; }
  const head = `<h2>${t('Importer un build')}</h2>`;
  if (build.state === 'read') {
    body.innerHTML = `${head}<div class="build-wait"><span class="sp-spin"></span><span data-b-msg>${escapeHtml(build.msg)}</span></div>
      <p class="hint-line">${t('La première fois, le module de lecture de texte se télécharge (quelques Mo). L\'image reste sur ton appareil.')}</p>`;
    return;
  }
  if (build.state === 'pick') {
    body.innerHTML = `${head}
      <p>${t('Sur <a href="https://wakfuli.com/builder" target="_blank" rel="noopener">Wakfuli</a>, ouvre ton build, onglet <b>Récap</b>, puis exporte-le en image. Wak\'Forge y lit le nom et le niveau de chaque équipement.')}</p>
      <label class="build-drop" data-b-drop tabindex="0">
        <b>${t('Dépose l\'image ici')}</b>
        <span>${t('ou clique pour la choisir, ou colle-la avec Ctrl+V')}</span>
        <input type="file" accept="image/*" data-b-file hidden>
      </label>
      ${build.err ? `<p class="error">${build.err}</p>` : ''}
      <div class="dlg-actions"><button class="btn" type="button" data-close>${t('Fermer')}</button></div>`;
    return;
  }
  const L = ctx.lists;
  const n = build.rows.filter(r => r.on).length;
  const listName = build.title || t('Build importé');
  body.innerHTML = `${head}
    <p>${tn(build.rows.length, '{n} équipement trouvé. Décoche ce que tu as déjà, et vérifie la rareté.', '{n} équipements trouvés. Décoche ce que tu as déjà, et vérifie la rareté.')}</p>
    <ul class="build-list">${build.rows.map((r, i) => {
      const o = r.versions[r.sel];
      const rec = mainRecipe(o);
      const meta = [escapeHtml(o.type), t('Niv. {n}', { n: o.niveau }),
        rec ? `${jobIcon(rec.metier, '')} ${escapeHtml(jobName(rec.metier))} ${rec.niveau}` : `<span class="muted">${t('ne se fabrique pas')}</span>`].join(' · ');
      const ver = r.versions.length > 1
        ? `<select class="select small" data-b-ver aria-label="${t('Rareté')}">${r.versions.map((v, j) => `<option value="${j}"${j === r.sel ? ' selected' : ''}>${escapeHtml(rarityName(v.rarete) || rarityLabel('Commun'))} · ${t('Niv. {n}', { n: v.niveau })}${v.recettes?.length ? '' : ` (${t('ne se fabrique pas')})`}</option>`).join('')}</select>`
        : `<span class="chip">${escapeHtml(rarityName(o.rarete) || rarityLabel('Commun'))}</span>`;
      return `<li class="${rec ? '' : 'off'}" data-b="${i}">
        <input type="checkbox" data-b-on${r.on ? ' checked' : ''}${rec ? '' : ' disabled'} aria-label="${t('Ajouter à la liste')}">
        <div class="b-main"><div class="b-name">${itemLabel(o)}${pvpTag(o)}</div><div class="s-meta">${meta}</div></div>
        ${ver}
      </li>`;
    }).join('')}</ul>
    ${build.unknown.length ? `<p class="build-unknown">${t('Non reconnu : {noms}', { noms: build.unknown.map(u => `« ${escapeHtml(u)} »`).join(', ') })}</p>` : ''}
    ${L.all().length < L.max ? `<label class="check"><input type="checkbox" data-b-newlist${build.newList ? ' checked' : ''}> ${t('Dans une nouvelle liste « {nom} »', { nom: escapeHtml(listName) })}</label>` : ''}
    <div class="dlg-actions">
      <button class="link" type="button" data-b-again>${t('Autre image')}</button>
      <span class="spacer"></span>
      <button class="btn" type="button" data-close>${t('Annuler')}</button>
      <button class="btn primary" type="button" data-b-add${n ? '' : ' disabled'}>${tn(n, 'Ajouter {n} objet', 'Ajouter {n} objets')}</button>
    </div>`;
}

function addBuild() {
  const rows = build.rows.filter(r => r.on && mainRecipe(r.versions[r.sel]));
  if (!rows.length) return;
  const nom = build.title || t('Build importé');
  if (build.newList && !ctx.lists.create(nom)) return;
  const c = ctx.getCraft();
  for (const r of rows) {
    const o = r.versions[r.sel];
    const cur = c.cibles.find(x => x.id === o.id);
    if (cur) cur.qte += 1; else c.cibles.push({ id: o.id, qte: 1 });
  }
  ctx.saveCraft();
  build = null;
  $('#buildDlg').close();
  ctx.showView?.('craft');
  renderCraft();
  ctx.toast(tn(rows.length, '<b>{n}</b> objet du build ajouté à la liste.', '<b>{n}</b> objets du build ajoutés à la liste.'), 'ok');
}

function bindBuild() {
  const dlg = $('#buildDlg');
  const body = $('#buildBody');
  $('#craftImport').addEventListener('click', () => openBuildImport());
  body.addEventListener('change', e => {
    if (e.target.matches('[data-b-file]')) { importBuildImage(e.target.files[0]); return; }
    if (e.target.matches('[data-b-newlist]')) { build.newList = e.target.checked; return; }
    const li = e.target.closest('[data-b]');
    if (!li) return;
    const r = build.rows[+li.dataset.b];
    if (e.target.matches('[data-b-on]')) r.on = e.target.checked;
    if (e.target.matches('[data-b-ver]')) { r.sel = +e.target.value; r.on = !!mainRecipe(r.versions[r.sel]); }
    renderBuild();
  });
  body.addEventListener('click', e => {
    if (e.target.closest('[data-b-add]')) addBuild();
    else if (e.target.closest('[data-b-again]')) { build = { state: 'pick' }; renderBuild(); }
  });
  body.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[data-b-drop]')) { e.preventDefault(); body.querySelector('[data-b-file]').click(); }
  });
  body.addEventListener('dragover', e => {
    const z = e.target.closest('[data-b-drop]');
    if (!z) return;
    e.preventDefault();
    z.classList.add('over');
  });
  body.addEventListener('dragleave', e => e.target.closest('[data-b-drop]')?.classList.remove('over'));
  body.addEventListener('drop', e => {
    if (!e.target.closest('[data-b-drop]')) return;
    e.preventDefault();
    importBuildImage(e.dataTransfer.files[0]);
  });
  // Ctrl+V : image copiée (export Wakfuli ouvert dans un onglet, outil Capture…)
  document.addEventListener('paste', e => {
    if (!dlg.open || build?.state !== 'pick') return;
    const f = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); importBuildImage(f); }
  });
  dlg.addEventListener('close', () => { if (build?.state !== 'read') build = null; });
}

/* ------------------------------------------------------------ init */

export { decodeShare };

export function initCraft(context) {
  ctx = context;
  bindCraft();
  bindBuild();
  bindMonsters();
  bindPlans();
  // liens objet / monstre partout dans l'appli
  document.addEventListener('click', e => {
    const it = e.target.closest('[data-item]');
    if (it) { e.preventDefault(); openItem(+it.dataset.item); return; }
    const mo = e.target.closest('[data-monster]');
    if (mo) {
      e.preventDefault();
      $('#itemDlg').open && $('#itemDlg').close();
      showMonster(mo.dataset.monster);
    }
  });
}

export function gamedataInfo() {
  return IDX ? { version: IDX.version, maj: IDX.maj } : null;
}

/* ------------------------------------------------------------ overlay (liste de courses compacte)
 * Trois façons de l'afficher :
 *  - appli PC : la fenêtre passe en petit format, toujours au premier plan (transparence réglable) ;
 *  - Chrome / Edge : une fenêtre « Picture-in-Picture » qui reste au-dessus des autres applis ;
 *  - autres navigateurs : la page elle-même passe en vue compacte.
 */

const OVL_KEY = 'wakforge.overlay.v1';
let ovl = { mode: null, root: null, win: null };
let ovlPrefs = { hideDone: false, opacity: 100, view: 'courses' }; // view : courses | fab (étapes de fabrication)
let ovlLeft = null; // ressources restantes au dernier rendu : passage automatique aux étapes quand tout est réuni
try { Object.assign(ovlPrefs, JSON.parse(localStorage.getItem(OVL_KEY) || localStorage.getItem('wakup.overlay.v1') || '{}')); } catch { /* rien */ }
const saveOvlPrefs = () => { try { localStorage.setItem(OVL_KEY, JSON.stringify(ovlPrefs)); } catch { /* rien */ } };

export const overlayOpen = () => !!ovl.mode;

function srcShort(s) {
  if (s.kind === 'recolte') return `${jobIcon(s.metier, '')} ${escapeHtml(jobName(s.metier))} ${s.niveau}${s.source ? ` · ${escapeHtml(s.source)}` : ''}`;
  if (s.kind === 'trappeur') return `${jobIcon('Trappeur', '')} ${escapeHtml(s.monstre)}`;
  if (s.kind === 'drop') return `⚔ ${escapeHtml(s.monstre)}${s.taux != null ? ` ${s.taux} %` : ''}`;
  if (s.kind === 'more') return `+${s.count}`;
  if (s.kind === 'recette') return `${jobIcon(s.metier, '🔨')} ${escapeHtml(jobName(s.metier))} ${s.niveau}`;
  return '';
}

export async function openOverlay() {
  if (ovl.mode) { ovl.win?.focus?.(); return; }
  if (!(await ensureData('view-craft'))) return;
  const pip = !ctx.native?.on && window.documentPictureInPicture;
  if (pip) {
    try {
      const win = await window.documentPictureInPicture.requestWindow({ width: 360, height: 580 });
      const head = win.document.head;
      head.insertAdjacentHTML('beforeend', `<meta name="referrer" content="no-referrer"><title>Wak\'Forge – ${escapeHtml(t('courses'))}</title>`);
      head.append(Object.assign(win.document.createElement('base'), { href: new URL('.', location.href).href }));
      // copie des styles : règles recopiées telles quelles (même origine), lien sinon (polices Google)
      for (const sheet of document.styleSheets) {
        try {
          const style = win.document.createElement('style');
          style.textContent = [...sheet.cssRules].map(r => r.cssText).join('\n');
          head.append(style);
        } catch {
          if (sheet.href) {
            const link = win.document.createElement('link');
            link.rel = 'stylesheet'; link.href = sheet.href;
            head.append(link);
          }
        }
      }
      win.document.body.className = 'ovl-pip';
      const root = win.document.createElement('div');
      root.id = 'overlay';
      win.document.body.append(root);
      ovl = { mode: 'pip', root, win };
      win.addEventListener('pagehide', () => { ovl = { mode: null, root: null, win: null }; ctx.onOverlay?.(false); });
      bindOverlay(root);
      renderOverlay();
      ctx.onOverlay?.(true);
      return;
    } catch (e) {
      console.warn('Picture-in-Picture indisponible', e);
    }
  }
  const root = $('#overlay');
  root.hidden = false;
  document.body.classList.add('overlay-mode');
  ovl = { mode: 'inline', root, win: null };
  if (!root.dataset.bound) { bindOverlay(root); root.dataset.bound = '1'; }
  ctx.native?.overlay(true, Math.round(ovlPrefs.opacity * 2.55));
  renderOverlay();
  ctx.onOverlay?.(true);
}

export function closeOverlay() {
  if (ovl.mode === 'pip') { ovl.win.close(); return; }
  if (ovl.mode !== 'inline') return;
  ovl.root.hidden = true;
  ovl.root.innerHTML = '';
  document.body.classList.remove('overlay-mode');
  ctx.native?.overlay(false, 255);
  ovl = { mode: null, root: null, win: null };
  ctx.onOverlay?.(false);
  ctx.showView?.('craft');
}

function setStock(id, v) {
  const c = ctx.getCraft();
  v = Math.max(0, Math.floor(v) || 0);
  if (v) c.stock[id] = v; else delete c.stock[id];
  ctx.saveCraft();
  renderCraft();
}

function bindOverlay(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.matches('[data-ovl-close]')) { closeOverlay(); return; }
    if (b.matches('[data-ovl-hide]')) { ovlPrefs.hideDone = !ovlPrefs.hideDone; saveOvlPrefs(); renderOverlay(); return; }
    if (b.matches('[data-ovl-view]')) { ovlPrefs.view = b.dataset.ovlView; saveOvlPrefs(); renderOverlay(); return; }
    const li = b.closest('[data-id]');
    if (!li) return;
    const id = +li.dataset.id;
    const have = ctx.getCraft().stock[id] || 0;
    const need = +li.dataset.need;
    const step = e.shiftKey ? 10 : 1;
    if (b.matches('[data-inc]')) setStock(id, have + step);
    else if (b.matches('[data-dec]')) setStock(id, have - step);
    else if (b.matches('[data-done]')) setStock(id, have >= need ? 0 : need);
  });
  // liste affichée : même choix que les onglets de l'appli
  root.addEventListener('change', e => {
    if (!e.target.matches('[data-ovl-list]')) return;
    ovlLeft = null;
    if (ctx.lists.switch(e.target.value)) renderCraft();
  });
  root.addEventListener('input', e => {
    if (!e.target.matches('[data-ovl-opacity]')) return;
    ovlPrefs.opacity = +e.target.value;
    saveOvlPrefs();
    ctx.native?.overlay(true, Math.round(ovlPrefs.opacity * 2.55));
    const out = root.querySelector('[data-ovl-opacity-val]');
    if (out) out.textContent = `${ovlPrefs.opacity} %`;
  });
}

export function renderOverlay() {
  if (!ovl.mode || !IDX) return;
  const root = ovl.root;
  const c = ctx.getCraft();
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
  const rows = res.base
    .map(b => ({ ...b, o: IDX.byId.get(b.id) }))
    .sort((a, b) => (b.missing > 0) - (a.missing > 0) || a.o.niveau - b.o.niveau || a.o._key.localeCompare(b.o._key));
  const left = rows.filter(b => b.missing > 0).length;
  const crafts = res.crafts.filter(x => x.runs > 0 || x.have > 0);
  const craftsLeft = res.crafts.filter(x => x.runs > 0).length;
  // dès que la dernière ressource est réunie, on passe aux étapes de fabrication
  if (ovlLeft > 0 && left === 0 && craftsLeft) { ovlPrefs.view = 'fab'; saveOvlPrefs(); }
  ovlLeft = left;
  const fab = ovlPrefs.view === 'fab' && crafts.length > 0;
  const shown = rows.filter(b => !ovlPrefs.hideDone || b.missing > 0);
  const targets = c.cibles.map(tg => `${fmtN(tg.qte)}× ${escapeHtml(IDX.byId.get(tg.id).nom)}`).join(' · ');
  const scrollTop = root.querySelector('.ovl-list')?.scrollTop || 0;
  const lists = ctx.lists.all();
  const title = lists.length > 1
    ? `<select class="ovl-select" data-ovl-list aria-label="${t('Liste affichée')}" title="${t('Liste affichée')}">${lists.map(l => `<option value="${escapeHtml(l.id)}"${l.active ? ' selected' : ''}>${escapeHtml(l.nom)} (${l.count})</option>`).join('')}</select>`
    : `<b>${t('Liste de courses')}</b>`;
  const status = fab
    ? (craftsLeft ? tn(craftsLeft, '{n} fabrication à faire', '{n} fabrications à faire') : t('tout est fabriqué 🎉'))
    : rows.length ? (left ? t('{a} sur {b} à réunir', { a: left, b: rows.length }) : t('tout est réuni 🎉')) : t('vide');
  const qty = (have, need) => `<span class="ovl-count"><b>${fmtN(Math.min(have, need))}</b>/${fmtN(need)}</span>`;
  const doneBtn = done => `<button class="ovl-done" type="button" data-done title="${done ? t('Remettre à zéro') : t('J\'ai tout')}" aria-label="${done ? t('Remettre à zéro') : t('J\'ai tout')}">${done ? '✓' : '○'}</button>`;
  const courses = groupRows(shown, c.acheter).map(({ g, rows: gr }) => (g ? `<li class="ovl-group"><span>${g.html.replace(/<\/?button[^>]*>/g, '')}</span><span class="grp-count">${groupCount(gr)}</span></li>` : '') + gr.map(b => {
    const have = c.stock[b.id] || 0;
    const done = b.missing <= 0;
    const srcs = sourcesOf(b.o).filter(s => !(s.kind === 'recette' && !c.acheter[b.id])).slice(0, 2).map(srcShort).filter(Boolean);
    return `<li class="${done ? 'done' : ''}" data-id="${b.id}" data-need="${b.need}">
        ${itemIcon(b.o, { size: 42 })}
        <div class="ovl-main"><div class="ovl-name" title="${escapeHtml(b.o.nom)}">${escapeHtml(b.o.nom)}${pvpTag(b.o)}</div>
          <div class="ovl-src">${srcs.join(' · ') || t('marché')}</div></div>
        <div class="ovl-qty">
          <button type="button" data-dec title="${t('−1 (Maj : −10)')}" aria-label="${t('Moins')}">−</button>
          ${qty(have, b.need)}
          <button type="button" data-inc title="${t('+1 (Maj : +10)')}" aria-label="${t('Plus')}">+</button>
        </div>
        ${doneBtn(done)}
      </li>`;
  }).join('')).join('') || `<li class="ovl-empty">${rows.length ? t('Tout est réuni 🎉') : (ctx.native?.on ? t('Liste vide : dans WAKFU, survole un objet et appuie sur Ctrl+D pour l\'ajouter.') : t('Ajoute des objets dans l\'onglet Craft.'))}</li>`;
  // étapes : cocher une fabrication la met « en stock » (ses ingrédients ne sont alors plus comptés)
  const steps = crafts.filter(x => !ovlPrefs.hideDone || x.runs > 0).map(x => {
    const o = IDX.byId.get(x.id);
    const done = x.runs === 0;
    const low = done ? null : tooLow(x.recipe.metier, x.recipe.niveau);
    return `<li class="${done ? 'done' : ''}${low != null ? ' locked' : ''}" data-id="${x.id}" data-need="${x.need}">
        ${itemIcon(o, { size: 42 })}
        <div class="ovl-main"><div class="ovl-name" title="${escapeHtml(o.nom)}">${done ? '' : `<b>${fmtN(x.runs)}×</b> `}${escapeHtml(o.nom)}${pvpTag(o)}</div>
          <div class="ovl-src">${jobIcon(x.recipe.metier, '🔨')} ${escapeHtml(jobName(x.recipe.metier))} ${x.recipe.niveau}${low != null ? ` · 🔒 ${t('toi {n}', { n: low })}` : ''}${!done && IDX.planOf.get(x.id) && !myPlans()[IDX.planOf.get(x.id)] ? ` · 📜 ${t('plan requis')}` : ''}</div></div>
        ${qty(c.stock[x.id] || 0, x.need)}
        ${doneBtn(done)}
      </li>`;
  }).join('') || `<li class="ovl-empty">${t('tout est fabriqué 🎉')}</li>`;
  root.innerHTML = `<div class="ovl">
    <header class="ovl-head">
      <div class="ovl-title">${title}<span>${status}</span></div>
      <button class="ovl-btn ${ovlPrefs.hideDone ? 'on' : ''}" type="button" data-ovl-hide title="${ovlPrefs.hideDone ? t('Afficher ce que j\'ai déjà') : t('Masquer ce que j\'ai déjà')}" aria-pressed="${ovlPrefs.hideDone}">✓</button>
      ${ovl.mode === 'pip' ? '' : `<button class="ovl-btn" type="button" data-ovl-close title="${t('Revenir à l\'appli complète')}">⤢</button>`}
    </header>
    ${crafts.length ? `<div class="ovl-tabs" role="tablist">
      <button type="button" role="tab" data-ovl-view="courses" aria-selected="${!fab}">${t('Courses')}${left ? ` <span class="list-count">${left}</span>` : ' ✓'}</button>
      <button type="button" role="tab" data-ovl-view="fab" aria-selected="${fab}">${t('Fabrication')}${craftsLeft ? ` <span class="list-count">${craftsLeft}</span>` : ' ✓'}</button>
    </div>` : ''}
    ${targets ? `<p class="ovl-targets" title="${targets}">${targets}</p>` : ''}
    <ul class="ovl-list">${fab ? steps : courses}</ul>
    ${ctx.native?.on ? `<footer class="ovl-foot"><label>${t('Opacité')} <input type="range" min="40" max="100" step="5" value="${ovlPrefs.opacity}" data-ovl-opacity></label><span data-ovl-opacity-val>${ovlPrefs.opacity} %</span></footer>` : ''}
  </div>`;
  const list = root.querySelector('.ovl-list');
  if (list) list.scrollTop = scrollTop;
}

/* ------------------------------------------------------------ scan d'objet (Ctrl+D dans le jeu, appli PC)
 * L'appli PC capture l'écran autour de la souris et le lit avec l'OCR de Windows ;
 * ici on retrouve l'objet à partir des lignes lues, puis on l'ajoute à la liste.
 */

let scanIdx = null;
function scanIndex() {
  if (scanIdx) return scanIdx;
  const byKey = new Map();
  // noms français et anglais : le jeu peut être dans l'une ou l'autre langue
  for (const o of IDX.searchable) {
    for (const k of new Set([scanKey(o.nom), scanKey(o.nom_en)])) {
      if (k.length < 3) continue;
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push(o);
    }
  }
  scanIdx = { byKey, keys: [...byKey.keys()] };
  return scanIdx;
}

/** Trouve le nom d'objet le plus probable parmi les lignes lues. Exporté pour les tests. */
export function matchScan(lines) {
  const { byKey, keys } = scanIndex();
  const raw = (lines || []).map(scanKey).filter(l => l.length >= 3);
  // un nom long peut être coupé sur deux lignes dans l'infobulle
  const cands = raw.map((l, i) => ({ l, i }));
  raw.forEach((l, i) => { if (raw[i + 1]) cands.push({ l: `${l} ${raw[i + 1]}`, i }); });
  let best = null;
  const offer = (key, score, i) => {
    if (!best || score > best.score || (score === best.score && i < best.i)) best = { key, score, i };
  };
  for (const { l, i } of cands) {
    if (byKey.has(l)) { offer(l, 1000 + l.length, i); continue; }
    for (const k of keys) {
      if (k.length >= 5 && l.length > k.length && ` ${l} `.includes(` ${k} `)) offer(k, 500 + k.length, i);
    }
    if (l.length >= 5) {
      const max = Math.max(1, Math.floor(l.length / 8));
      for (const k of keys) {
        if (k.length < 5 || Math.abs(k.length - l.length) > max) continue;
        const d = lev(l, k, max);
        if (d <= max) offer(k, 300 + k.length - 20 * d, i);
      }
    }
  }
  return best ? byKey.get(best.key) : null;
}

/* Fenêtre de scan : l'appli PC ouvre une petite fenêtre séparée (scan.html) à côté de la souris.
 * Ici on retrouve l'objet et on lui envoie quoi afficher ; l'objet choisi revient par wfScanAdd
 * et la liste se met à jour en arrière-plan (ou dans l'overlay), sans ramener l'appli devant. */

/** Rareté écrite dans l'infobulle (« Légendaire »…) : sert à présélectionner la bonne version. */
function guessVersion(versions, lines) {
  const text = ` ${(lines || []).map(scanKey).join(' ')} `;
  const i = versions.findIndex(v => {
    const k = scanKey(rarityName(v.rarete));
    return k && text.includes(` ${k} `);
  });
  return i;
}

/** Composants de la liste active (ressources et fabrications intermédiaires) : id -> { need, have }. */
function listComponents() {
  const c = ctx.getCraft();
  const res = computeList(IDX, c.cibles, { stock: c.stock, buy: c.acheter });
  const comp = new Map();
  for (const b of res.base) comp.set(b.id, { need: b.need, have: c.stock[b.id] || 0 });
  for (const x of res.crafts) if (!c.cibles.some(tg => tg.id === x.id)) comp.set(x.id, { need: x.need, have: c.stock[x.id] || 0 });
  return comp;
}

function scanChoice(versions, lines, comp, mode = '') {
  const inList = new Map(ctx.getCraft().cibles.map(tg => [tg.id, tg.qte]));
  let sel = guessVersion(versions, lines);
  if (sel < 0) sel = Math.max(0, versions.findIndex(v => comp.has(v.id)));
  const labels = versions.map(v => rarityName(v.rarete) || rarityLabel('Commun'));
  return {
    state: 'choose',
    mode,
    sel,
    // Ctrl+F : le bandeau « Possédés » de l'infobulle donne la quantité déjà en jeu, par emplacement
    owned: mode === 'have' ? parseOwned(lines) : null,
    versions: versions.map((o, i) => {
      const r = mainRecipe(o);
      const k = comp.get(o.id);
      const dup = labels.filter(l => l === labels[i]).length > 1;
      return {
        id: o.id,
        nom: o.nom,
        label: labels[i] + (dup ? ` · ${t('Niv. {n}', { n: o.niveau })}` : ''),
        cls: RARITY_CLASS[o.rarete] || 'commun',
        icon: itemIcon(o, { cls: 'big' }),
        meta: `${escapeHtml(o.type)} · ${t('Niv. {n}', { n: o.niveau })}${r ? ` · ${jobIcon(r.metier, '')} ${escapeHtml(jobName(r.metier))} ${r.niveau}` : ''}`,
        inList: inList.get(o.id) || 0,
        craftable: !!r,
        comp: k ? { need: k.need, have: k.have, missing: Math.max(0, k.need - k.have) } : null,
      };
    }),
  };
}

// réponses de la fenêtre de scan (appli PC)
window.wfScanAdd = (id, qte) => addTarget(IDX?.byId.get(id), Math.min(9999, Math.max(1, Math.floor(qte) || 1)));
window.wfScanItem = id => openItem(id);
// « J'en ai » : la ressource scannée s'ajoute au stock de la liste active
window.wfScanHave = (id, qte) => {
  const o = IDX?.byId.get(id);
  if (!o) return;
  const c = ctx.getCraft();
  c.stock[id] = Math.min(999999, (c.stock[id] || 0) + Math.max(1, Math.floor(qte) || 1));
  ctx.saveCraft();
  renderCraft();
};
// « J'en ai » d'après le bandeau « Possédés » : la quantité remplace celle de « J'ai »
window.wfScanSetHave = (id, qte) => {
  if (!IDX?.byId.get(id)) return;
  const c = ctx.getCraft();
  c.stock[id] = Math.min(999999, Math.max(0, Math.floor(qte) || 0));
  ctx.saveCraft();
  renderCraft();
};

export async function handleScan(r) {
  if (!r) return;
  const win = !!ctx.native?.scanShow && window.nativeScanShow;
  const tell = (msg, kind, plain, itemId) => {
    if (win) { ctx.native.scanShow({ state: 'msg', html: msg, kind, itemId }); return; }
    ctx.toast(msg, kind);
    if (!document.hasFocus()) ctx.native?.notify("Wak'Forge", plain);
  };
  if (r.pending) { if (!win) ctx.toast(t('Scan de l\'objet…')); return; }
  if (r.error) { tell(escapeHtml(r.error), 'error', r.error); return; }
  try { await loadGamedata(); } catch { tell(t('Données du jeu indisponibles.'), 'error', t('Données du jeu indisponibles.')); return; }
  const found = matchScan(r.lines);
  if (!found) {
    tell(t('Aucun objet reconnu : place la souris sur l\'objet pour afficher son infobulle, puis refais Ctrl+D.'), 'warn', t('Aucun objet reconnu sous la souris.'));
    return;
  }
  const craftable = found.filter(o => mainRecipe(o)).sort((a, b) => a.rarete - b.rarete || a.niveau - b.niveau);
  const name = found[0].nom;
  if (r.mode === 'have') {
    // Ctrl+F : la ressource s'ajoute à « j'ai » si elle fait partie de la liste active
    const comp = listComponents();
    const usable = found.filter(o => comp.has(o.id)).sort((a, b) => a.rarete - b.rarete || a.niveau - b.niveau);
    const where = ctx.lists.all().length > 1 ? t('ta liste « {nom} »', { nom: ctx.lists.activeName() }) : t('ta liste');
    if (!usable.length) {
      const target = found.some(o => ctx.getCraft().cibles.some(tg => tg.id === o.id));
      tell(target
        ? t('<b>{nom}</b> est un objectif de {liste}, pas une ressource à réunir.', { nom: escapeHtml(name), liste: escapeHtml(where) })
        : t('<b>{nom}</b> ne fait pas partie des ressources de {liste}. Pour l\'ajouter à fabriquer, utilise Ctrl+D.', { nom: escapeHtml(name), liste: escapeHtml(where) }),
      'warn', t('{nom} ne fait pas partie des ressources de {liste}.', { nom: name, liste: where }), found[0].id);
      return;
    }
    if (win) { ctx.native.scanShow(scanChoice(usable, r.lines, comp, 'have')); return; }
    const k = comp.get(usable[0].id);
    const owned = parseOwned(r.lines);
    if (owned) {
      window.wfScanSetHave(usable[0].id, owned.total);
      tell(t('<b>{nom}</b> : « J\'ai » mis à {n} (bandeau « Possédés » du jeu).', { nom: escapeHtml(usable[0].nom), n: owned.total.toLocaleString(locale) }), 'ok', t('{nom} : « J\'ai » mis à {n}.', { nom: usable[0].nom, n: owned.total.toLocaleString(locale) }));
      return;
    }
    window.wfScanHave(usable[0].id, Math.max(1, k.need - k.have));
    tell(t('<b>{nom}</b> ajouté à « J\'ai ».', { nom: escapeHtml(usable[0].nom) }), 'ok', t('{nom} ajouté à « J\'ai ».', { nom: usable[0].nom }));
    return;
  }
  if (win && craftable.length) { ctx.native.scanShow(scanChoice(craftable, r.lines, new Map())); return; }
  if (!craftable.length) {
    tell(t('<b>{nom}</b> ne se fabrique pas. Si c\'est une ressource de ta liste, utilise Ctrl+F pour l\'ajouter à « J\'ai ».', { nom: escapeHtml(name) }), 'warn', t('{nom} ne se fabrique pas.', { nom: name }), found[0].id);
    if (!win) openItem(found[0].id);
    return;
  }
  if (craftable.length === 1) {
    addTarget(craftable[0], 1);
    if (!document.hasFocus()) ctx.native?.notify("Wak'Forge", t('Ajouté à la liste : {nom}', { nom: name }));
  } else {
    // plusieurs versions (raretés) du même nom : on laisse choisir
    ctx.showView?.('craft');
    const input = $('#craftSearch');
    input.value = name;
    suggIdx = 0;
    renderCraftSuggest();
    input.focus();
    tell(t('Plusieurs versions de <b>{nom}</b> : choisis la bonne dans la liste.', { nom: escapeHtml(name) }), 'warn', t('Plusieurs versions de « {nom} » : choisis dans Wak\'Forge.', { nom: name }));
  }
}
