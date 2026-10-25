import {
  norm, slug, cleanName, parseDuration, fmtClock, fmtShort, whenLabel, escapeHtml, rankMatches,
} from './util.js';
import { createSync } from './sync.js';
import { t as tr, tn, isEn, lang, setLang, translateDom, jobName } from './i18n.js';
import { initCraft, renderCraft, renderMonsters, renderPlans, gamedataInfo, monsterPortrait, overlayOpen, handleScan, decodeShare } from './craft.js';

/** Portrait de l'archimonstre (wakfu.wiki.gg), ou son initiale s'il n'y en a pas. */
const archiPortrait = (m, px, cls) => monsterPortrait({ image: m?.image, nom: m?.name }, { px, cls: `archi ${cls}` });

const APP_VERSION = '2.23.0';
const STORE_KEY = 'archimonstres.state.v1';
const DEVICE_KEY = 'archimonstres.device.v1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// L'appli PC (WebView2) injecte ces fonctions avant le chargement de la page.
const native = {
  on: typeof window.nativeSchedule === 'function',
  schedule: (...a) => window.nativeSchedule?.(...a)?.catch?.(() => {}),
  topmost: on => window.nativeSetTopmost?.(on)?.catch?.(() => {}),
  notify: (t, b) => window.nativeNotify?.(t, b)?.catch?.(() => {}),
  overlay: (on, alpha) => window.nativeOverlay?.(on, alpha)?.catch?.(() => {}),
  scanEnable: on => window.nativeScanEnable?.(on)?.catch?.(() => {}),
  scanShow: state => window.nativeScanShow?.(state)?.catch?.(() => {}),
  openURL: url => window.nativeOpenURL?.(url)?.catch?.(() => {}),
  scanStatus: () => (window.nativeScanStatus ? window.nativeScanStatus().catch(() => null) : Promise.resolve(null)),
};

/* =================================================================== état */

const defaultSettings = () => ({ sound: true, volume: 0.7, soonMin: 5, notify: true });
const defaultCraft = () => ({ cibles: [], stock: {}, acheter: {} });
function sanitizeCraft(raw) {
  const c = defaultCraft();
  if (!raw || typeof raw !== 'object') return c;
  const seen = new Set();
  for (const t of Array.isArray(raw.cibles) ? raw.cibles : []) {
    const id = Math.floor(+t?.id), qte = Math.floor(+t?.qte);
    if (id > 0 && qte > 0 && !seen.has(id) && c.cibles.length < 200) { seen.add(id); c.cibles.push({ id, qte: Math.min(qte, 9999) }); }
  }
  for (const [id, n] of Object.entries(raw.stock || {})) {
    const v = Math.floor(+n);
    if (+id > 0 && v > 0) c.stock[+id] = Math.min(v, 999999);
  }
  for (const [id, v] of Object.entries(raw.acheter || {})) if (+id > 0 && v) c.acheter[+id] = true;
  return c;
}
const craftEmpty = c => !c.cibles.length && !Object.keys(c.stock).length;
const MAX_LISTES = 20;
// métiers du jeu (récolte puis artisanat), pour « Mes métiers »
const JOBS = ['Paysan', 'Forestier', 'Herboriste', 'Mineur', 'Pêcheur', 'Trappeur',
  'Boulanger', 'Cuisinier', 'Armurier', 'Bijoutier', 'Tailleur', 'Maroquinier', 'Ébéniste', "Maitre d'Armes"];
const newListId = () => 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function defaultState() {
  const craft = defaultCraft();
  return {
    version: 1,
    custom: {},     // id -> { name, min, max, family, zone, level }   archimonstres ajoutés
    overrides: {},  // id -> { min, max }                               durées perso pour ceux du fichier
    timers: {},     // id -> { name, start, min, max }                  ms / secondes
    craft,          // liste de craft active (même objet que son entrée dans « listes »)
    listes: [{ id: 'l1', nom: tr('Ma liste'), craft }],  // toutes les listes de craft
    listeActive: 'l1',
    prix: {},       // id -> prix unitaire en kamas (commun à toutes les listes)
    metiers: {},    // métier -> niveau du joueur
    plans: {},      // id du plan -> true : plans déjà appris
    settings: defaultSettings(),
    updatedAt: 0,
  };
}

/** Listes de craft : « craft » reste la liste active (les anciennes versions ne connaissent qu'elle). */
function sanitizeListes(s, raw) {
  s.listes = [];
  const seen = new Set();
  for (const l of Array.isArray(raw.listes) ? raw.listes : []) {
    const id = String(l?.id || '').slice(0, 40);
    if (!id || seen.has(id) || s.listes.length >= MAX_LISTES) continue;
    seen.add(id);
    s.listes.push({ id, nom: cleanName(String(l.nom || '')).slice(0, 40) || 'Liste', craft: sanitizeCraft(l.craft) });
  }
  let act = s.listes.find(l => l.id === raw.listeActive) || s.listes[0];
  if (!act) { act = { id: 'l1', nom: tr('Ma liste'), craft: null }; s.listes.push(act); }
  if (raw.craft || !act.craft) act.craft = sanitizeCraft(raw.craft);
  s.craft = act.craft;
  s.listeActive = act.id;
}

function sanitizeState(raw) {
  const s = defaultState();
  if (!raw || typeof raw !== 'object') return s;
  const dur = v => parseDuration(v);
  for (const [id, c] of Object.entries(raw.custom || {})) {
    if (!c?.name) continue;
    s.custom[id] = {
      name: cleanName(c.name), min: dur(c.min), max: dur(c.max),
      family: cleanName(c.family || ''), zone: cleanName(c.zone || ''),
      level: Number.isFinite(+c.level) && +c.level > 0 ? Math.round(+c.level) : null,
    };
  }
  for (const [id, o] of Object.entries(raw.overrides || {})) {
    const min = dur(o?.min);
    if (min) s.overrides[id] = { min, max: dur(o.max) };
  }
  for (const [id, t] of Object.entries(raw.timers || {})) {
    const min = dur(t?.min);
    if (t?.name && Number.isFinite(+t.start) && min) {
      s.timers[id] = { name: cleanName(t.name), start: +t.start, min, max: dur(t.max) };
    }
  }
  sanitizeListes(s, raw);
  for (const [id, v] of Object.entries(raw.prix || {})) {
    const n = Math.round(+v);
    if (+id > 0 && n > 0) s.prix[+id] = Math.min(n, 1e10);
  }
  for (const [m, v] of Object.entries(raw.metiers || {})) {
    const n = Math.round(+v);
    if (JOBS.includes(m) && n > 0) s.metiers[m] = Math.min(n, 300);
  }
  for (const [id, v] of Object.entries(raw.plans || {})) if (+id > 0 && v) s.plans[+id] = true;
  const st = raw.settings || {};
  s.settings = {
    sound: st.sound !== false,
    volume: Number.isFinite(+st.volume) ? Math.min(1, Math.max(0, +st.volume)) : 0.7,
    soonMin: Number.isFinite(+st.soonMin) ? Math.min(120, Math.max(0, Math.round(+st.soonMin))) : 5,
    notify: st.notify !== false,
  };
  s.updatedAt = +raw.updatedAt || 0;
  return s;
}

function loadJSON(key, fallback) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
}
function storeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

let state = sanitizeState(loadJSON(STORE_KEY, null));
// Réglages propres à cet appareil (non synchronisés).
const device = Object.assign({ topmost: false, scan: true, notified: {} }, loadJSON(DEVICE_KEY, {}));
// résultat du scan d'objet (Ctrl+D dans le jeu), envoyé par l'appli PC
window.wfScan = r => handleScan(r);
let sync = { enabled: false, user: null, schedulePush() {}, async pushNow() {} };

function persist({ touch = true, push = true } = {}) {
  if (touch) state.updatedAt = Date.now();
  storeJSON(STORE_KEY, state);
  if (push) sync.schedulePush();
  scheduleNative();
}
function persistDevice() {
  // On ne garde que les clés des timers encore présents.
  const keep = {};
  for (const [id, t] of Object.entries(state.timers)) {
    const k = notifKey(id, t);
    if (device.notified[k]) keep[k] = 1;
  }
  device.notified = keep;
  storeJSON(DEVICE_KEY, device);
}

const notifKey = (id, t) => `${id}@${t.start}`;
/** Timers déjà terminés à l'ouverture : pas d'alerte rétroactive. */
function markPastAsNotified() {
  const now = Date.now();
  for (const [id, t] of Object.entries(state.timers)) {
    const k = notifKey(id, t);
    if (!(k in device.notified) && t.start + t.min * 1000 <= now) device.notified[k] = 1;
  }
  persistDevice();
}

/* =================================================================== données */

let dataFile = { archimonstres: [] };
let dataMonsters = [];   // depuis data/data_archimonstre.json

async function loadData() {
  try {
    const res = await fetch('data/data_archimonstre.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    dataFile = await res.json();
  } catch (e) {
    console.warn('data_archimonstre.json illisible', e);
    toast(tr('Fichier de données introuvable : seule ta liste perso est disponible.'), 'warn');
  }
  const seen = new Set();
  dataMonsters = [];
  for (const m of dataFile.archimonstres || []) {
    const name = cleanName(m.nom || m.name);
    if (!name) continue;
    const id = slug(name);
    if (seen.has(id)) continue;
    seen.add(id);
    const nameEn = cleanName(m.nom_en || '');
    dataMonsters.push({
      // l'id reste tiré du nom français (timers et durées perso enregistrés) ; le nom affiché suit la langue
      id, name: isEn && nameEn ? nameEn : name, otherName: isEn ? name : nameEn,
      family: cleanName(m.famille || m.family || ''),
      zone: cleanName(m.zone || ''),
      level: parseLevel(m.niveau),
      min: parseDuration(m.timer ?? m.timer_min ?? null),
      max: parseDuration(m.timer_max ?? null),
      spawn: spawnLabel(m),
      note: m.note || '',
      image: typeof m.image === 'string' ? m.image.trim() : '',
    });
  }
}

function parseLevel(v) {
  if (v == null || v === '') return null;
  if (Number.isFinite(+v) && +v > 0) return Math.round(+v);
  return cleanName(String(v)).slice(0, 20) || null;
}

/** Mode d'apparition lisible pour les archimonstres sans timer. */
function spawnLabel(m) {
  switch (m.apparition) {
    case 'donjon': return tr('Donjon');
    case 'challenge': return m.challenge ? `${tr('Challenge')} ${cleanName(m.challenge)}` : tr('Challenge');
    case 'stele': return tr('Stèle de Moon');
    default: return '';
  }
}

/** Liste complète : fichier + ajouts perso, avec durées perso appliquées. */
function catalog() {
  const map = new Map();
  for (const d of dataMonsters) {
    const o = state.overrides[d.id];
    map.set(d.id, {
      ...d, source: 'data',
      fileMin: d.min, fileMax: d.max,
      min: o?.min ?? d.min, max: o ? o.max : d.max,
      overridden: !!o,
    });
  }
  for (const [id, c] of Object.entries(state.custom)) {
    if (map.has(id)) continue;
    map.set(id, { id, ...c, source: 'custom', overridden: false });
  }
  const list = [...map.values()];
  for (const m of list) {
    m._key = norm(m.name);
    m._extra = norm(`${m.family} ${m.zone} ${m.otherName || ''}`);
  }
  list.sort((a, b) => a._key.localeCompare(b._key));
  return list;
}
let CATALOG = [];
const refreshCatalog = () => { CATALOG = catalog(); };
const byId = id => CATALOG.find(m => m.id === id);

/* =================================================================== timers */

function phaseOf(t, now) {
  const minEnd = t.start + t.min * 1000;
  const maxEnd = t.max && t.max > t.min ? t.start + t.max * 1000 : null;
  if (now >= minEnd) return maxEnd && now < maxEnd ? 'window' : 'ready';
  if (minEnd - now <= state.settings.soonMin * 60000) return 'soon';
  return 'running';
}

function startTimer(m, offsetMin = 0) {
  const start = Date.now() - Math.max(0, offsetMin) * 60000;
  state.timers[m.id] = { name: m.name, start, min: m.min, max: m.max && m.max > m.min ? m.max : null };
  const t = state.timers[m.id];
  if (t.start + t.min * 1000 <= Date.now()) device.notified[notifKey(m.id, t)] = 1;
  persist();
  persistDevice();
  renderTimers(true);
  const at = whenLabel(t.start + t.min * 1000);
  toast(tr('<b>{nom}</b> lancé · prochaine apparition dès {at}', { nom: escapeHtml(m.name), at }), 'ok');
}

function removeTimer(id) {
  const t = state.timers[id];
  if (!t) return;
  delete state.timers[id];
  persist();
  persistDevice();
  renderTimers(true);
  toastUndo(tr('{nom} retiré.', { nom: escapeHtml(t.name) }), () => {
    state.timers[id] = t;
    persist();
    renderTimers(true);
  });
}

function restartTimer(id) {
  const m = byId(id) || (state.timers[id] && { id, ...state.timers[id] });
  if (m?.min) startTimer(m);
}

/** L'appli PC programme les alertes elle-même (fiable même fenêtre réduite). */
function scheduleNative() {
  if (!native.on) return;
  const now = Date.now();
  const items = [];
  for (const [id, t] of Object.entries(state.timers)) {
    const at = t.start + t.min * 1000;
    if (at <= now) continue;
    const title = t.max && t.max > t.min ? tr('{nom} peut apparaître', { nom: t.name }) : tr('{nom} est disponible !', { nom: t.name });
    items.push({ id: notifKey(id, t), title, at });
  }
  native.schedule(items, !!state.settings.sound);
}

/* =================================================================== alertes */

let audioCtx = null;
function audio() {
  if (!audioCtx) {
    const C = window.AudioContext || window.webkitAudioContext;
    if (!C) return null;
    audioCtx = new C();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(() => {});
  return audioCtx;
}
['pointerdown', 'keydown'].forEach(ev => document.addEventListener(ev, () => audio(), { once: true, capture: true }));

function playChime() {
  const a = audio();
  if (!a) return;
  const vol = state.settings.volume;
  let t = a.currentTime + 0.02;
  for (let r = 0; r < 2; r++) {
    for (const f of [783.99, 1046.5, 1318.51]) {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = 'triangle';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, 0.3 * vol), t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + 0.55);
      t += 0.14;
    }
    t += 0.3;
  }
}

function alertTimer(id, t, phase) {
  const title = phase === 'window' ? tr('{nom} peut apparaître', { nom: t.name }) : tr('{nom} est disponible !', { nom: t.name });
  toast(`⚔ <b>${escapeHtml(title)}</b>`, 'ok', 8000);
  const card = $(`.card[data-id="${CSS.escape(id)}"]`);
  card?.classList.add('flash');
  if (native.on) return; // son + notification gérés par l'appli PC
  if (state.settings.sound) playChime();
  if (state.settings.notify && 'Notification' in window && Notification.permission === 'granted') {
    const opts = { body: "Wak'Forge", icon: 'icons/icon-192.png', tag: id };
    const plain = () => { try { new Notification(title, opts); } catch { /* rien */ } };
    if (navigator.serviceWorker?.getRegistration) {
      navigator.serviceWorker.getRegistration()
        .then(reg => (reg ? reg.showNotification(title, opts) : plain()))
        .catch(plain);
    } else plain();
  }
}

/* =================================================================== rendu des timers */

const ICON = {
  restart: '<svg viewBox="0 0 24 24"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
  remove: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5v14l11-7z"/></svg>',
};

let lastSignature = '';

function sortedTimers(now) {
  return Object.entries(state.timers).map(([id, t]) => {
    const phase = phaseOf(t, now);
    const minEnd = t.start + t.min * 1000;
    const maxEnd = t.max && t.max > t.min ? t.start + t.max * 1000 : null;
    return { id, t, phase, minEnd, maxEnd };
  }).sort((a, b) => a.minEnd - b.minEnd);
}

function metaLine(id) {
  const m = byId(id);
  if (!m) return '';
  return [m.family, m.zone, m.level ? tr('Niv. {n}', { n: m.level }) : ''].filter(Boolean).join(' · ');
}

function cardHtml(x) {
  return `<article class="card ${x.phase}" data-id="${escapeHtml(x.id)}">
    <div class="card-head">
      ${archiPortrait(byId(x.id) || { name: x.t.name }, 96, 'card-pic')}
      <h3>${escapeHtml(x.t.name)}</h3>
      <div class="actions">
        <button class="icon-btn" data-act="restart" title="${tr('Relancer')}" aria-label="${tr('Relancer')} ${escapeHtml(x.t.name)}">${ICON.restart}</button>
        <button class="icon-btn del" data-act="remove" title="${tr('Retirer')}" aria-label="${tr('Retirer')} ${escapeHtml(x.t.name)}">${ICON.remove}</button>
      </div>
    </div>
    <p class="meta">${escapeHtml(metaLine(x.id))}</p>
    <div class="label"></div>
    <div class="time"></div>
    <div class="bar"><span></span></div>
    <div class="card-foot"><span class="when"></span><span class="muted dur">${escapeHtml(fmtShort(x.t.min))}${x.maxEnd ? '–' + escapeHtml(fmtShort(x.t.max)) : ''}</span></div>
  </article>`;
}

function renderTimers(force = false) {
  const now = Date.now();
  const items = sortedTimers(now);
  const done = items.filter(x => x.phase === 'ready' || x.phase === 'window');
  const waiting = items.filter(x => x.phase === 'running' || x.phase === 'soon');
  const sig = done.map(x => x.id + x.phase).join('|') + '#' + waiting.map(x => x.id).join('|');

  if (force || sig !== lastSignature) {
    lastSignature = sig;
    $('#readyList').innerHTML = done.map(cardHtml).join('');
    $('#runningList').innerHTML = waiting.map(cardHtml).join('');
    $('#readyGroup').hidden = !done.length;
    $('#runningGroup').hidden = !waiting.length;
    $('#emptyState').hidden = items.length > 0;
    const parts = [];
    if (waiting.length) parts.push(tr('{n} en attente', { n: waiting.length }));
    if (done.length) parts.push(tn(done.length, '{n} disponible', '{n} disponibles'));
    $('#summary').textContent = parts.join(' · ');
    const badge = $('#readyBadge');
    badge.hidden = !done.length;
    badge.textContent = done.length;
    document.title = (done.length ? `(${done.length}) ` : '') + tr("Wak'Forge – Craft & bestiaire Wakfu");
  }
  updateCardValues(items, now);
}

function updateCardValues(items, now) {
  for (const x of items) {
    const card = $(`.card[data-id="${CSS.escape(x.id)}"]`);
    if (!card) continue;
    if (!card.classList.contains(x.phase)) {
      card.classList.remove('running', 'soon', 'window', 'ready');
      card.classList.add(x.phase);
    }
    let label, time, pct, when;
    if (x.phase === 'ready') {
      const since = x.maxEnd || x.minEnd;
      label = tr('Disponible depuis');
      time = fmtClock((now - since) / 1000);
      pct = 100;
      when = tr('depuis {h}', { h: whenLabel(since, now) });
    } else if (x.phase === 'window') {
      label = tr('Peut apparaître · max dans');
      time = fmtClock((x.maxEnd - now) / 1000);
      pct = ((now - x.minEnd) / (x.maxEnd - x.minEnd)) * 100;
      when = tr('au plus tard {h}', { h: whenLabel(x.maxEnd, now) });
    } else {
      label = x.phase === 'soon' ? tr('Bientôt') : tr('Restant');
      time = fmtClock((x.minEnd - now) / 1000);
      pct = ((now - x.t.start) / (x.minEnd - x.t.start)) * 100;
      when = x.maxEnd
        ? tr('entre {a} et {b}', { a: whenLabel(x.minEnd, now), b: whenLabel(x.maxEnd, now) })
        : tr('dispo dès {h}', { h: whenLabel(x.minEnd, now) });
    }
    setText(card.querySelector('.label'), label);
    setText(card.querySelector('.time'), time);
    setText(card.querySelector('.when'), when);
    card.querySelector('.bar span').style.width = `${Math.min(100, Math.max(0, pct)).toFixed(2)}%`;
  }
}
const setText = (el, v) => { if (el && el.textContent !== v) el.textContent = v; };

function tick() {
  const now = Date.now();
  let dirty = false;
  for (const [id, t] of Object.entries(state.timers)) {
    const k = notifKey(id, t);
    if (device.notified[k]) continue;
    if (now >= t.start + t.min * 1000) {
      device.notified[k] = 1;
      dirty = true;
      alertTimer(id, t, phaseOf(t, now));
    }
  }
  if (dirty) persistDevice();
  renderTimers();
}

$('#readyList').parentElement.parentElement.addEventListener('click', e => {
  const btn = e.target.closest('[data-act]');
  const card = e.target.closest('.card');
  if (!btn || !card) return;
  if (btn.dataset.act === 'restart') restartTimer(card.dataset.id);
  if (btn.dataset.act === 'remove') removeTimer(card.dataset.id);
});

/* =================================================================== recherche */

const search = $('#search');
const suggest = $('#suggest');
let suggestions = [];
let activeIdx = -1;

function highlight(name, q) {
  const n = norm(name);
  const i = n.indexOf(norm(q));
  if (!q || i < 0) return escapeHtml(name);
  // les longueurs normalisées correspondent caractère par caractère (accents retirés)
  const len = norm(q).length;
  return escapeHtml(name.slice(0, i)) + '<mark>' + escapeHtml(name.slice(i, i + len)) + '</mark>' + escapeHtml(name.slice(i + len));
}

function renderSuggest() {
  const q = search.value;
  suggestions = rankMatches(CATALOG, q, 8);
  const exact = suggestions.some(m => m._key === norm(q));
  const items = suggestions.map((m, i) => {
    const running = state.timers[m.id];
    const chip = running ? `<span class="chip running">${tr('en cours')}</span>`
      : m.min ? `<span class="chip">${escapeHtml(fmtShort(m.min))}${m.max ? '–' + escapeHtml(fmtShort(m.max)) : ''}</span>`
        : m.spawn ? `<span class="chip spawn">${escapeHtml(m.spawn)}</span>`
          : `<span class="chip unknown">${tr('durée ?')}</span>`;
    const meta = [m.family, m.zone, m.level ? tr('Niv. {n}', { n: m.level }) : ''].filter(Boolean).join(' · ');
    return `<li role="option" id="sg-${i}" data-i="${i}" aria-selected="${i === activeIdx}">
      ${archiPortrait(m, 64, 'sugg-pic')}<div class="s-main"><div class="s-name">${highlight(m.name, q)}</div>${meta ? `<div class="s-meta">${escapeHtml(meta)}</div>` : ''}</div>${chip}</li>`;
  });
  if (cleanName(q) && !exact) {
    items.push(`<li role="option" data-i="new" aria-selected="${activeIdx === suggestions.length}">
      <div class="s-main"><div class="s-name s-new">${tr('+ Ajouter « {nom} »', { nom: escapeHtml(cleanName(q)) })}</div>
      <div class="s-meta">${tr('Nouvel archimonstre, on te demandera sa durée')}</div></div></li>`);
  }
  suggest.innerHTML = items.join('');
  const open = items.length > 0 && document.activeElement === search;
  suggest.hidden = !open;
  search.setAttribute('aria-expanded', String(open));
  const act = suggest.querySelector('[aria-selected="true"]');
  if (act) { act.scrollIntoView({ block: 'nearest' }); search.setAttribute('aria-activedescendant', act.id || ''); }
}

function setActive(i) {
  const max = suggest.children.length - 1;
  activeIdx = Math.max(0, Math.min(max, i));
  renderSuggest();
}

search.addEventListener('input', () => { activeIdx = search.value.trim() ? 0 : -1; renderSuggest(); });
search.addEventListener('focus', renderSuggest);
search.addEventListener('blur', () => setTimeout(() => { suggest.hidden = true; search.setAttribute('aria-expanded', 'false'); }, 150));
search.addEventListener('keydown', e => {
  if (e.key === 'ArrowDown') { e.preventDefault(); setActive(activeIdx + 1); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(activeIdx - 1); }
  else if (e.key === 'Enter') { e.preventDefault(); launchFromSearch(); }
  else if (e.key === 'Tab' && !e.shiftKey && suggestions[activeIdx]) {
    e.preventDefault();
    search.value = suggestions[activeIdx].name;
    renderSuggest();
  } else if (e.key === 'Escape') { search.value = ''; activeIdx = -1; renderSuggest(); }
});
suggest.addEventListener('mousedown', e => {
  const li = e.target.closest('li');
  if (!li) return;
  e.preventDefault();
  activeIdx = li.dataset.i === 'new' ? suggestions.length : +li.dataset.i;
  launchFromSearch();
});
$('#launchBtn').addEventListener('click', launchFromSearch);
document.addEventListener('keydown', e => {
  if (e.key === '/' && !['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) && !document.querySelector('dialog[open]')) {
    // « / » : aller dans la recherche de l'onglet ouvert (timers par défaut)
    e.preventDefault();
    const field = { craft: '#craftSearch', monsters: '#monsterSearch' }[[...document.querySelectorAll('.view')].find(x => !x.hidden)?.id.slice(5)];
    if (field) $(field).focus();
    else { showView('timers'); search.focus(); }
  }
});

async function launchFromSearch() {
  const text = cleanName(search.value);
  const offset = Math.max(0, Math.min(1440, +$('#offset').value || 0));
  let m = null;
  if (activeIdx >= 0 && activeIdx < suggestions.length) m = suggestions[activeIdx];
  if (!m && text) m = CATALOG.find(x => x._key === norm(text)) || null;
  if (!m && !text) { search.focus(); return; }

  if (!m) {
    const d = await askDuration({
      title: tr('Nouvel archimonstre'),
      text: tr('« {nom} » n\'est pas encore dans la liste. Quelle est la durée de son timer ?', { nom: text }),
    });
    if (!d) { search.focus(); return; }
    const id = slug(text);
    state.custom[id] = { name: text, min: d.min, max: d.max, family: '', zone: '', level: null };
    refreshCatalog();
    m = byId(id);
  } else if (!m.min) {
    const d = await askDuration({ title: m.name, text: noTimerText(m) });
    if (!d) { search.focus(); return; }
    setDuration(m, d);
    m = byId(m.id);
  }
  startTimer(m, offset);
  search.value = '';
  $('#offset').value = 0;
  activeIdx = -1;
  renderSuggest();
  renderBestiary();
  search.focus();
}

function noTimerText(m) {
  return m.spawn
    ? tr('{nom} n\'apparaît pas sur un timer ({x}). Quelle durée veux-tu utiliser ?', { nom: m.name, x: m.spawn })
    : tr('Le fichier de données n\'indique pas encore de durée pour cet archimonstre. Laquelle utiliser ?');
}

function setDuration(m, d) {
  if (m.source === 'custom') Object.assign(state.custom[m.id], { min: d.min, max: d.max });
  else state.overrides[m.id] = { min: d.min, max: d.max };
  refreshCatalog();
}

/* =================================================================== dialogues */

function openDialog(dlg) {
  dlg.showModal();
  return new Promise(resolve => {
    const close = () => { dlg.removeEventListener('close', close); resolve(dlg.returnValue); };
    dlg.addEventListener('close', close);
  });
}
document.addEventListener('click', e => {
  const c = e.target.closest('[data-close]');
  if (c) c.closest('dialog').close('cancel');
});
// clic sur le fond = fermer
$$('dialog').forEach(d => d.addEventListener('mousedown', e => { if (e.target === d) d.close('cancel'); }));

function readDurations(minEl, maxEl, errEl, required = true) {
  const min = parseDuration(minEl.value);
  const maxTxt = maxEl.value.trim();
  const max = maxTxt ? parseDuration(maxTxt) : null;
  let err = '';
  if ((required && !min) || (!required && minEl.value.trim() && !min)) err = tr('« {x} » n\'est pas une durée reconnue.', { x: minEl.value || '' });
  else if (maxTxt && !max) err = tr('Durée max « {x} » non reconnue.', { x: maxTxt });
  else if (max && min && max <= min) err = tr('La durée max doit être plus longue que la durée.');
  errEl.hidden = !err;
  errEl.textContent = err;
  return err ? null : { min, max };
}

async function askDuration({ title, text, min = '', max = '' }) {
  const dlg = $('#durationDlg');
  $('#durationTitle').textContent = title;
  $('#durationText').textContent = text;
  const minEl = $('#durationMin'), maxEl = $('#durationMax'), err = $('#durationError');
  minEl.value = min; maxEl.value = max; err.hidden = true;
  let result = null;
  const onSubmit = e => {
    result = readDurations(minEl, maxEl, err);
    if (!result) e.preventDefault();
  };
  dlg.querySelector('form').addEventListener('submit', onSubmit);
  setTimeout(() => minEl.focus(), 30);
  const rv = await openDialog(dlg);
  dlg.querySelector('form').removeEventListener('submit', onSubmit);
  return rv === 'ok' ? result : null;
}

async function editMonster(id) {
  const m = id ? byId(id) : null;
  const dlg = $('#monsterDlg');
  const f = {
    name: $('#mName'), min: $('#mMin'), max: $('#mMax'),
    family: $('#mFamily'), zone: $('#mZone'), level: $('#mLevel'),
  };
  const err = $('#monsterError');
  const isData = m?.source === 'data';
  $('#monsterTitle').textContent = m ? m.name : tr('Ajouter un archimonstre');
  f.name.value = m?.name || '';
  f.min.value = m?.min ? fmtShort(m.min) : '';
  f.max.value = m?.max ? fmtShort(m.max) : '';
  f.family.value = m?.family || '';
  f.zone.value = m?.zone || '';
  f.level.value = m?.level || '';
  for (const k of ['name', 'family', 'zone', 'level']) f[k].disabled = isData;
  $('#monsterHint').textContent = isData
    ? (m.fileMin ? tr('Archimonstre du fichier de données (durée du fichier : {d}). Ta durée perso est prioritaire.', { d: fmtShort(m.fileMin) + (m.fileMax ? '–' + fmtShort(m.fileMax) : '') })
      : tr('Archimonstre du fichier de données (pas de durée dans le fichier). Ta durée perso est prioritaire.'))
    : tr('Archimonstre perso : il n\'existe que dans ta liste.');
  $('#monsterReset').hidden = !(isData && m.overridden);
  $('#monsterReset').textContent = tr('Rétablir la durée du fichier');
  err.hidden = true;

  let res = null;
  const form = dlg.querySelector('form');
  const onSubmit = e => {
    const name = cleanName(f.name.value);
    if (!isData && !name) { err.hidden = false; err.textContent = tr('Indique un nom.'); e.preventDefault(); return; }
    const newId = isData ? m.id : slug(name);
    if (!isData && newId !== m?.id && CATALOG.some(x => x.id === newId)) {
      err.hidden = false; err.textContent = tr('Un archimonstre porte déjà ce nom.'); e.preventDefault(); return;
    }
    const d = readDurations(f.min, f.max, err, !isData);
    if (!d) { e.preventDefault(); return; }
    res = { name, newId, d };
  };
  const onReset = () => {
    delete state.overrides[m.id];
    dlg.close('reset');
  };
  form.addEventListener('submit', onSubmit);
  $('#monsterReset').addEventListener('click', onReset);
  setTimeout(() => (isData ? f.min : f.name).focus(), 30);
  const rv = await openDialog(dlg);
  form.removeEventListener('submit', onSubmit);
  $('#monsterReset').removeEventListener('click', onReset);

  if (rv === 'reset') { refreshCatalog(); persist(); renderBestiary(); toast(tr('Durée du fichier rétablie.')); return; }
  if (rv !== 'ok' || !res) return;
  if (isData) {
    if (res.d.min) state.overrides[m.id] = { min: res.d.min, max: res.d.max };
    else delete state.overrides[m.id];
  } else {
    const lvl = Math.round(+f.level.value);
    const entry = {
      name: res.name, min: res.d.min, max: res.d.max,
      family: cleanName(f.family.value), zone: cleanName(f.zone.value),
      level: lvl > 0 ? lvl : null,
    };
    if (m && m.id !== res.newId) {
      delete state.custom[m.id];
      if (state.timers[m.id]) { state.timers[res.newId] = { ...state.timers[m.id], name: res.name }; delete state.timers[m.id]; }
    }
    state.custom[res.newId] = entry;
  }
  refreshCatalog();
  persist();
  renderBestiary();
  renderTimers(true);
  toast(tr('Enregistré.'), 'ok');
}

function deleteCustom(id) {
  const c = state.custom[id];
  if (!c) return;
  delete state.custom[id];
  const t = state.timers[id];
  delete state.timers[id];
  refreshCatalog();
  persist();
  renderBestiary();
  renderTimers(true);
  toastUndo(tr('{nom} supprimé de ta liste.', { nom: escapeHtml(c.name) }), () => {
    state.custom[id] = c;
    if (t) state.timers[id] = t;
    refreshCatalog(); persist(); renderBestiary(); renderTimers(true);
  });
}

/* =================================================================== bestiaire */

function renderBestiary() {
  const lvl = m => (typeof m.level === 'number' ? m.level : parseInt(m.level, 10)) || 9999;
  const rows = CATALOG.filter(m => m.source === 'custom' || m.overridden)
    .sort((a, b) => lvl(a) - lvl(b) || a._key.localeCompare(b._key));
  $('#bestiaryEmpty').hidden = rows.length > 0;
  $('#bestiaryWrap').hidden = rows.length === 0;
  $('#bestiaryBody').innerHTML = rows.map(m => {
    const dur = m.min ? escapeHtml(fmtShort(m.min) + (m.max ? ' – ' + fmtShort(m.max) : ''))
      : m.spawn ? `<span class="chip spawn">${escapeHtml(m.spawn)}</span>` : `<span class="chip unknown">${tr('à définir')}</span>`;
    const tags = (m.source === 'custom' ? `<span class="tag custom">${tr('perso')}</span>` : '')
      + (m.overridden ? `<span class="tag perso">${tr('durée perso')}</span>` : '');
    return `<tr data-id="${escapeHtml(m.id)}">
      <td class="name"><div class="archi-name">${archiPortrait(m, 64, 'row-pic')}<div>${escapeHtml(m.name)}${tags}${m.family ? `<div class="sub">${escapeHtml(m.family)}</div>` : ''}</div></div></td>
      <td class="dim">${escapeHtml(m.zone || '—')}</td>
      <td class="num dim">${m.level ?? '—'}</td>
      <td>${dur}</td>
      <td class="row-actions">
        <button class="icon-btn" data-act="launch" title="${tr('Lancer le timer')}" aria-label="${tr('Lancer')} ${escapeHtml(m.name)}">${ICON.play}</button>
        <button class="icon-btn" data-act="edit" title="${tr('Modifier')}" aria-label="${tr('Modifier')} ${escapeHtml(m.name)}">${ICON.edit}</button>
        ${m.source === 'custom' ? `<button class="icon-btn del" data-act="delete" title="${tr('Supprimer')}" aria-label="${tr('Supprimer')} ${escapeHtml(m.name)}">${ICON.remove}</button>` : ''}
      </td></tr>`;
  }).join('');
  const total = dataMonsters.length, withTimer = dataMonsters.filter(d => d.min).length;
  $('#dataInfo').textContent = tn(total, '{n} archimonstre dans le fichier de données', '{n} archimonstres dans le fichier de données')
    + (total ? ` ${tr('({n} avec durée)', { n: withTimer })}` : '')
    + tr(', {n} ajouté(s) par toi', { n: Object.keys(state.custom).length })
    + (dataFile.maj ? ` · ${tr('données mises à jour le {d}', { d: dataFile.maj })}` : '') + '.';
  const note = isEn ? dataFile.remarque_en || dataFile.remarque : dataFile.remarque;
  $('#dataNote').textContent = note || '';
  $('#dataNote').hidden = !note;
  const src = String(dataFile.source || '');
  const url = src.match(/https?:\/\/\S+/)?.[0];
  $('#dataSource').innerHTML = src
    ? tr('Source :') + ' ' + (url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(src.replace(url, '').replace(/[\s:]+$/, ''))}</a>` : escapeHtml(src))
    : '';
}

$('#addMonsterBtn').addEventListener('click', () => editMonster(null));
$('#bestiaryBody').addEventListener('click', async e => {
  const btn = e.target.closest('[data-act]');
  const row = e.target.closest('tr');
  if (!btn || !row) return;
  const m = byId(row.dataset.id);
  if (!m) return;
  if (btn.dataset.act === 'edit') editMonster(m.id);
  if (btn.dataset.act === 'delete') deleteCustom(m.id);
  if (btn.dataset.act === 'launch') launchArchi(m.id);
});

/** Lance le timer d'un archimonstre (en demandant la durée s'il n'en a pas), puis affiche les timers. */
async function launchArchi(id) {
  let m = byId(id);
  if (!m) return;
  if (!m.min) {
    const d = await askDuration({ title: m.name, text: noTimerText(m) });
    if (!d) return;
    setDuration(m, d);
    m = byId(id);
    persist();
    renderBestiary();
  }
  startTimer(m);
  showView('timers');
}

/** Archimonstre de la liste des timers qui correspond à une fiche du bestiaire (portrait ou nom). */
const looseKey = s => norm(String(s || '')).replace(/[^a-z0-9]+/g, ' ').trim();
function archiForMonster(mon) {
  if (!mon || mon.type !== 'Archimonstre') return null;
  const keys = [mon.nom, mon.nom_en].filter(Boolean).map(looseKey);
  return CATALOG.find(a => a.source === 'data' && a.image && a.image === mon.image)
    || CATALOG.find(a => keys.includes(looseKey(a.name))) || null;
}
function archiInfo(mon) {
  const a = archiForMonster(mon);
  if (!a) return null;
  return {
    id: a.id,
    duration: a.min ? fmtShort(a.min) + (a.max ? '–' + fmtShort(a.max) : '') : '',
    spawn: a.spawn, overridden: a.overridden, running: !!state.timers[a.id],
  };
}

/* =================================================================== vues */

function showView(name) {
  for (const tab of $$('.tab')) tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  for (const v of $$('.view')) v.hidden = v.id !== `view-${name}`;
  if (name === 'settings') { renderSettings(); renderBestiary(); }
  if (name === 'craft') renderCraft().then(() => { const i = $('#craftSearch'); if (i && !matchMedia('(max-width: 760px)').matches) i.focus(); renderGameSource(); });
  if (name === 'monsters') renderMonsters();
  if (name === 'plans') renderPlans();
  try { sessionStorage.setItem('archimonstres.view', name); } catch { /* rien */ }
  if (name === 'timers') setTimeout(() => search.focus(), 0);
}
$$('.tab').forEach(t => t.addEventListener('click', () => showView(t.dataset.view)));

/* =================================================================== réglages */

// Réglages : indique si l'appli PC reconnaît la fenêtre du jeu (pour le scan Ctrl+D)
let scanStatusTimer = null;
async function refreshScanStatus() {
  const el = $('#scanStatus');
  if (!el || $('#view-settings').hidden || !native.on) { clearInterval(scanStatusTimer); scanStatusTimer = null; return; }
  const st = await native.scanStatus();
  if (!st) { el.textContent = ''; return; }
  if (!st.enabled) { el.textContent = tr('Scan désactivé.'); el.className = 'scan-status'; return; }
  if (!st.exe && !st.title) {
    el.textContent = tr('Passe sur la fenêtre de WAKFU puis reviens ici : l\'appli indiquera si elle reconnaît le jeu.');
    el.className = 'scan-status';
    return;
  }
  const what = `${st.exe || tr('programme inconnu')}${st.title ? ` « ${st.title} »` : ''}`;
  el.textContent = st.game && st.regFailed
    ? tr('Dernière fenêtre active : {w}, reconnue comme le jeu, mais Windows refuse Ctrl+D ou Ctrl+F : un autre programme utilise déjà ce raccourci.', { w: what })
    : st.game
    ? tr('✓ Dernière fenêtre active : {w}, reconnue comme le jeu. Ctrl+D et Ctrl+F y sont actifs.', { w: what })
    : tr('Dernière fenêtre active : {w}, ce n\'est pas le jeu. Passe sur WAKFU puis reviens vérifier.', { w: what });
  el.className = `scan-status ${st.game && !st.regFailed ? 'ok' : ''}`;
}

function renderSettings() {
  if (native.on && !scanStatusTimer) { refreshScanStatus(); scanStatusTimer = setInterval(refreshScanStatus, 1000); }
  const s = state.settings;
  $('#setSound').checked = s.sound;
  $('#setVolume').value = s.volume;
  $('#setVolume').disabled = !s.sound;
  $('#setSoon').value = s.soonMin;
  $('#setNotify').checked = s.notify;
  $('#setTopmost').checked = device.topmost;
  $('#setScan').checked = device.scan;
  $$('.desktop-only').forEach(el => { el.hidden = !native.on; });
  $$('.web-only').forEach(el => { el.hidden = native.on; });
  const permBtn = $('#notifPermBtn');
  if (native.on) {
    $('#notifText').textContent = tr('Notification Windows quand un timer se termine (gérée par l\'appli PC).');
    permBtn.hidden = true;
  } else if (!('Notification' in window)) {
    $('#notifText').textContent = tr('Ce navigateur ne gère pas les notifications.');
    permBtn.hidden = true;
  } else {
    const p = Notification.permission;
    permBtn.hidden = p === 'granted' || !s.notify;
    permBtn.textContent = p === 'denied' ? tr('Bloquées par le navigateur') : tr('Autoriser');
    permBtn.disabled = p === 'denied';
    $('#notifText').textContent = p === 'granted'
      ? tr('Une notification système quand un timer se termine.')
      : tr('Une notification système quand un timer se termine (autorisation du navigateur requise).');
  }
  renderJobSettings();
  $('#setLang').value = lang;
  $('#aboutText').innerHTML = `Version ${APP_VERSION}${native.on ? ` · ${tr('appli PC')}` : ''} · `
    + `${tr('Projet de fan communautaire, non affilié à Ankama')} · <a href="mentions-legales.html${isEn ? '#en' : ''}">${tr('Mentions légales')}</a>`;
}

// niveaux de métier du joueur (Réglages) : la liste de craft s'en sert pour signaler ce qui est hors de portée
function renderJobSettings() {
  const grid = $('#jobsGrid');
  if (!grid) return;
  const focused = document.activeElement?.dataset?.job;
  grid.innerHTML = JOBS.map(m => `<label class="job-input"><span>${escapeHtml(jobName(m))}</span>`
    + `<input type="number" class="num-input" min="0" max="300" placeholder="—" data-job="${escapeHtml(m)}" value="${state.metiers[m] || ''}"></label>`).join('');
  if (focused) grid.querySelector(`[data-job="${CSS.escape(focused)}"]`)?.focus();
}
$('#jobsGrid').addEventListener('change', e => {
  const m = e.target.dataset.job;
  if (!m) return;
  const n = Math.min(300, Math.max(0, Math.round(+e.target.value) || 0));
  if (n) state.metiers[m] = n; else delete state.metiers[m];
  persist();
  renderJobSettings();
  renderCraft();
});

$('#setLang').addEventListener('change', e => setLang(e.target.value));

const setSetting = (k, v) => { state.settings[k] = v; persist(); renderSettings(); };
$('#setSound').addEventListener('change', e => setSetting('sound', e.target.checked));
$('#setVolume').addEventListener('change', e => setSetting('volume', +e.target.value));
$('#setVolume').addEventListener('input', e => { state.settings.volume = +e.target.value; });
$('#testSound').addEventListener('click', () => { playChime(); if (native.on) native.notify("Wak'Forge", tr('Test de notification')); });
$('#setSoon').addEventListener('change', e => {
  setSetting('soonMin', Math.min(120, Math.max(0, Math.round(+e.target.value || 0))));
  renderTimers(true);
});
$('#setNotify').addEventListener('change', e => setSetting('notify', e.target.checked));
$('#notifPermBtn').addEventListener('click', async () => {
  try { await Notification.requestPermission(); } catch { /* rien */ }
  renderSettings();
});
$('#setScan').addEventListener('change', e => {
  device.scan = e.target.checked;
  storeJSON(DEVICE_KEY, device);
  native.scanEnable(device.scan);
});
$('#setTopmost').addEventListener('change', e => {
  device.topmost = e.target.checked;
  persistDevice();
  native.topmost(device.topmost);
});

$('#exportBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ app: 'wakforge', ...state }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `archimonstres-sauvegarde-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
$('#importBtn').addEventListener('click', () => $('#importFile').click());
$('#importFile').addEventListener('change', async e => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = text.trimStart().startsWith('{') ? sanitizeState(JSON.parse(text)) : fromLegacyTxt(text);
    mergeInto(incoming);
    refreshCatalog(); markPastAsNotified(); persist();
    renderTimers(true); renderBestiary();
    toast(tr('Import terminé.'), 'ok');
  } catch (err) {
    toast(tr('Import impossible : {err}', { err: escapeHtml(err.message) }), 'error');
  }
});

/** Ancien format de l'exe v1 : M<TAB>nom<TAB>secondes / T<TAB>nom<TAB>fin<TAB>durée */
function fromLegacyTxt(text) {
  const s = defaultState();
  for (const line of text.split(/\r?\n/)) {
    const [k, name, a, b] = line.split('\t');
    if (!name) continue;
    const id = slug(name);
    if (k === 'M' && +a > 0) s.custom[id] = { name: cleanName(name), min: +a, max: null, family: '', zone: '', level: null };
    if (k === 'T' && +a > 0 && +b > 0) s.timers[id] = { name: cleanName(name), start: (+a - +b) * 1000, min: +b, max: null };
  }
  if (!Object.keys(s.custom).length && !Object.keys(s.timers).length) throw new Error(tr('fichier non reconnu'));
  return s;
}

/** Fusion : on garde tout, le timer le plus récent gagne. */
function mergeInto(other) {
  const known = new Set(dataMonsters.map(d => d.id));
  for (const [id, c] of Object.entries(other.custom)) {
    if (known.has(id)) { if (c.min && !state.overrides[id]) state.overrides[id] = { min: c.min, max: c.max }; }
    else state.custom[id] = { ...state.custom[id], ...c };
  }
  Object.assign(state.overrides, other.overrides);
  for (const [id, t] of Object.entries(other.timers)) {
    if (!state.timers[id] || t.start > state.timers[id].start) state.timers[id] = t;
  }
  if (!craftEmpty(other.craft)) setActiveCraft(other.craft);
  addMissingLists(other);
  Object.assign(state.prix, other.prix);
  for (const [m, v] of Object.entries(other.metiers)) state.metiers[m] = Math.max(state.metiers[m] || 0, v);
  Object.assign(state.plans, other.plans);
}

/** Remplace le contenu de la liste active. */
function setActiveCraft(craft) {
  state.craft = craft;
  const act = state.listes.find(l => l.id === state.listeActive);
  if (act) act.craft = craft;
}
/* Gestion des listes de craft (onglet Craft). */
const craftLists = {
  all: () => state.listes.map(l => ({ id: l.id, nom: l.nom, count: l.craft.cibles.length, active: l.id === state.listeActive })),
  activeName: () => state.listes.find(l => l.id === state.listeActive)?.nom || '',
  max: MAX_LISTES,
  switch(id) {
    const l = state.listes.find(x => x.id === id);
    if (!l || l.id === state.listeActive) return false;
    state.listeActive = l.id; state.craft = l.craft;
    persist();
    return true;
  },
  create(nom, craft = defaultCraft()) {
    if (state.listes.length >= MAX_LISTES) return false;
    const l = { id: newListId(), nom: cleanName(nom).slice(0, 40) || tr('Nouvelle liste'), craft };
    state.listes.push(l);
    state.listeActive = l.id; state.craft = l.craft;
    persist();
    return true;
  },
  rename(id, nom) {
    const l = state.listes.find(x => x.id === id);
    nom = cleanName(nom || '').slice(0, 40);
    if (!l || !nom) return false;
    l.nom = nom;
    persist();
    return true;
  },
  /** Supprime une liste (jamais la dernière) ; renvoie de quoi annuler. */
  remove(id) {
    const i = state.listes.findIndex(x => x.id === id);
    if (i < 0 || state.listes.length < 2) return null;
    const [l] = state.listes.splice(i, 1);
    const wasActive = l.id === state.listeActive;
    if (wasActive) { const n = state.listes[Math.min(i, state.listes.length - 1)]; state.listeActive = n.id; state.craft = n.craft; }
    persist();
    return () => {
      if (state.listes.some(x => x.id === l.id) || state.listes.length >= MAX_LISTES) return;
      state.listes.splice(Math.min(i, state.listes.length), 0, l);
      if (wasActive) { state.listeActive = l.id; state.craft = l.craft; }
      persist();
    };
  },
};
/** Ajoute les listes non vides de « other » qu'on n'a pas encore (fusion, import). */
function addMissingLists(other) {
  for (const l of other.listes) {
    if (l.id === other.listeActive || state.listes.length >= MAX_LISTES || craftEmpty(l.craft)) continue;
    if (!state.listes.some(x => x.id === l.id)) state.listes.push(l);
  }
}

$('#resetBtn').addEventListener('click', () => {
  if (!confirm(tr('Effacer tous tes timers, durées perso et archimonstres ajoutés ?') + (sync.user ? `\n${tr('Cela s\'applique aussi à ton compte.')}` : ''))) return;
  const settings = state.settings;
  const { craft, listes, listeActive, prix, metiers, plans } = state;
  state = defaultState();
  Object.assign(state, { settings, craft, listes, listeActive, prix, metiers, plans });
  refreshCatalog(); persist(); persistDevice();
  renderTimers(true); renderBestiary();
  toast(tr('Tout a été effacé.'));
});

/* =================================================================== compte */

let syncState = 'local', syncDetail = '';

function renderAccountButton() {
  const dot = $('#syncDot');
  dot.dataset.state = sync.user ? syncState : (sync.enabled ? 'local' : (syncState === 'error' ? 'error' : 'local'));
  $('#accountLabel').textContent = sync.user ? sync.user.email : (sync.enabled ? tr('Se connecter') : tr('Mode local'));
  $('#accountBtn').title = syncDetail || (sync.user ? tr('Synchronisé') : tr('Données enregistrées sur cet appareil'));
}

function accountView(mode = 'login', msg = null) {
  const body = $('#accountBody');
  if (!sync.enabled) {
    body.innerHTML = `<h2>${tr('Mode local')}</h2>
      <p>${syncDetail ? escapeHtml(syncDetail) : tr('Les comptes ne sont pas activés sur cette version.')}</p>
      <p>${tr('Tes timers et ta liste sont enregistrés sur cet appareil. Pour les retrouver ailleurs, utilise <b>Réglages → Exporter / Importer</b>, ou active les comptes (voir le README du projet, section « Connexion »).')}</p>
      <div class="dlg-actions"><button class="btn primary" data-close>OK</button></div>`;
    return;
  }
  if (sync.user) {
    const st = { ok: tr('Synchronisé ✓'), sync: tr('Synchronisation…'), error: tr('Erreur : {err}', { err: syncDetail }), local: tr('En attente') }[syncState] || '';
    body.innerHTML = `<h2>${tr('Mon compte')}</h2>
      <div class="account-card"><div class="avatar">${escapeHtml((sync.user.email || '?')[0].toUpperCase())}</div>
        <div><b>${escapeHtml(sync.user.email)}</b><div class="muted small">${escapeHtml(st)}</div></div></div>
      <p class="small">${tr('Tes timers, durées perso et ajouts sont synchronisés en direct entre tous tes appareils (site et appli PC).')}</p>
      <div class="dlg-actions">
        <button class="btn" id="accSyncNow" type="button">${tr('Synchroniser')}</button>
        <span class="spacer"></span>
        <button class="btn danger" id="accLogout" type="button">${tr('Se déconnecter')}</button>
        <button class="btn primary" data-close>${tr('Fermer')}</button>
      </div>`;
    $('#accSyncNow').onclick = () => sync.pushNow();
    $('#accLogout').onclick = async () => {
      try { await sync.signOut(); $('#accountDlg').close(); toast(tr('Déconnecté. Tes données restent sur cet appareil.')); }
      catch (e) { toast(escapeHtml(e.message), 'error'); }
    };
    return;
  }
  if (mode === 'recovery') {
    body.innerHTML = `<form id="accForm"><h2>${tr('Nouveau mot de passe')}</h2>
      <label class="field"><span>${tr('Nouveau mot de passe')}</span><input id="accPass" type="password" autocomplete="new-password" minlength="6" required></label>
      <p class="error" id="accErr" hidden></p>
      <div class="dlg-actions"><button class="btn" type="button" data-close>${tr('Annuler')}</button><button class="btn primary">${tr('Enregistrer')}</button></div></form>`;
    $('#accForm').onsubmit = async e => {
      e.preventDefault();
      try { await sync.updatePassword($('#accPass').value); $('#accountDlg').close(); toast(tr('Mot de passe modifié.'), 'ok'); }
      catch (err) { $('#accErr').hidden = false; $('#accErr').textContent = err.message; }
    };
    return;
  }
  const isLogin = mode === 'login', isForgot = mode === 'forgot';
  body.innerHTML = `<form id="accForm">
    <h2>${isForgot ? tr('Mot de passe oublié') : tr('Garde tes timers partout')}</h2>
    ${isForgot ? `<p>${tr('On t\'envoie un lien pour choisir un nouveau mot de passe.')}</p>`
      : `<p>${tr('Connecte-toi pour retrouver tes timers et ta liste sur le site et l\'appli PC.')}</p>
      <div class="seg" role="group"><button type="button" data-mode="login" aria-pressed="${isLogin}">${tr('Connexion')}</button>
      <button type="button" data-mode="signup" aria-pressed="${!isLogin}">${tr('Créer un compte')}</button></div>`}
    <label class="field"><span>${tr('E-mail')}</span><input id="accEmail" type="email" autocomplete="email" required></label>
    ${isForgot ? '' : `<label class="field"><span>${tr('Mot de passe')}</span><input id="accPass" type="password" ${isLogin ? '' : 'minlength="6"'}
      autocomplete="${isLogin ? 'current-password' : 'new-password'}" required></label>`}
    ${isLogin ? `<button class="link" type="button" data-mode="forgot">${tr('Mot de passe oublié ?')}</button>` : ''}
    <p class="${msg?.ok ? 'success' : 'error'}" id="accErr" ${msg ? '' : 'hidden'}>${msg ? escapeHtml(msg.text) : ''}</p>
    <div class="dlg-actions">
      ${isForgot ? `<button class="btn ghost" type="button" data-mode="login">${tr('Retour')}</button><span class="spacer"></span>` : ''}
      <button class="btn" type="button" data-close>${tr('Annuler')}</button>
      <button class="btn primary" id="accSubmit">${isForgot ? tr('Envoyer le lien') : isLogin ? tr('Se connecter') : tr('Créer mon compte')}</button>
    </div></form>`;
  body.querySelectorAll('[data-mode]').forEach(b => { b.onclick = () => accountView(b.dataset.mode); });
  const form = $('#accForm');
  form.onsubmit = async e => {
    e.preventDefault();
    const email = $('#accEmail').value.trim();
    const pass = $('#accPass')?.value;
    const err = $('#accErr');
    const btn = $('#accSubmit');
    btn.disabled = true;
    err.hidden = true;
    try {
      if (isForgot) { await sync.resetPassword(email); accountView('login', { ok: true, text: tr('Lien envoyé, regarde tes mails.') }); return; }
      if (isLogin) { await sync.signIn(email, pass); $('#accountDlg').close(); toast(tr('Connecté ✓'), 'ok'); return; }
      const data = await sync.signUp(email, pass);
      if (data?.session) { $('#accountDlg').close(); toast(tr('Compte créé ✓'), 'ok'); }
      else accountView('login', { ok: true, text: tr('Compte créé ! Clique sur le lien reçu par e-mail, puis connecte-toi.') });
    } catch (ex) {
      err.hidden = false;
      err.className = 'error';
      err.textContent = ex.message;
    } finally { btn.disabled = false; }
  };
  setTimeout(() => $('#accEmail')?.focus(), 30);
}

$('#accountBtn').addEventListener('click', () => { accountView('login'); $('#accountDlg').showModal(); });

// Lien de téléchargement de l'appli PC (masqué dans l'appli elle-même) : rappel de l'alerte Windows au clic.
$('#downloadBtn').hidden = native.on;
$('#downloadBtn').addEventListener('click', () => {
  toast(tr('<b>Windows va afficher une alerte</b>, c\'est normal : l\'exe n\'est pas signé. Si le navigateur bloque le téléchargement : <b>⋯ → Conserver</b>. Au lancement : <b>Informations complémentaires → Exécuter quand même</b> (une seule fois).'), 'warn', 15000);
});

function applyRemote(remote, merge) {
  const r = sanitizeState(remote);
  if (merge) {
    const local = state;
    state = r;
    // fusion de ce qui existait déjà sur cet appareil
    for (const [id, c] of Object.entries(local.custom)) if (!state.custom[id]) state.custom[id] = c;
    for (const [id, o] of Object.entries(local.overrides)) if (!state.overrides[id]) state.overrides[id] = o;
    for (const [id, t] of Object.entries(local.timers)) {
      if (!state.timers[id] || t.start > state.timers[id].start) state.timers[id] = t;
    }
    if (craftEmpty(state.craft) && !craftEmpty(local.craft)) setActiveCraft(local.craft);
    addMissingLists(local);
    for (const [id, v] of Object.entries(local.prix)) if (!state.prix[id]) state.prix[id] = v;
    for (const [m, v] of Object.entries(local.metiers)) state.metiers[m] = Math.max(state.metiers[m] || 0, v);
    Object.assign(state.plans, local.plans);
    state.updatedAt = Date.now();
    markPastAsNotified();
    refreshCatalog();
    persist({ touch: false, push: false });
  } else {
    state = r;
    markPastAsNotified();
    refreshCatalog();
    persist({ touch: false, push: false });
  }
  renderTimers(true);
  if (!$('#view-settings').hidden) { renderSettings(); renderBestiary(); }
  if (!$('#view-craft').hidden || overlayOpen()) renderCraft();
  if (!$('#view-plans').hidden) renderPlans();
}

/* =================================================================== toasts */

function toast(html, kind = '', ms = 3500) {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = html;
  $('#toasts').append(el);
  const kill = () => { el.classList.add('out'); setTimeout(() => el.remove(), 260); };
  const timer = setTimeout(kill, ms);
  el.addEventListener('click', e => { if (!e.target.closest('button')) { clearTimeout(timer); kill(); } });
  while ($('#toasts').children.length > 4) $('#toasts').firstElementChild.remove();
  return el;
}
function toastUndo(html, undo) {
  const el = toast(`${html} <button class="link" type="button">${tr('Annuler')}</button>`, '', 6000);
  el.querySelector('button').addEventListener('click', () => { undo(); el.remove(); });
}

/* =================================================================== mise à jour (appli PC) */

// L'appli PC vérifie la dernière release GitHub ; « Mettre à jour » télécharge le nouvel exe,
// le met à la place de l'ancien et relance l'appli.
const SITE_URL = 'https://wakforge.github.io/';
const RELEASES_API = 'https://api.github.com/repos/wakforge/wakforge.github.io/releases/latest';
const RELEASES_PAGE = 'https://github.com/wakforge/wakforge.github.io/releases/latest';
const verParts = v => String(v || '').replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
function isNewer(a, b) {
  const x = verParts(a), y = verParts(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}
let update = null; // { tag, url, page }
let updateHidden = false; // « Plus tard » : plus de bandeau jusqu'au prochain lancement

async function checkUpdate() {
  if (!native.on || updateHidden || update?.busy) return;
  let current = APP_VERSION;
  try { const v = await window.nativeVersion?.(); if (/^v?\d+\.\d+/.test(v || '')) current = v; } catch { /* rien */ }
  let rel;
  try {
    const r = await fetch(RELEASES_API, { headers: { Accept: 'application/vnd.github+json' }, cache: 'no-store' });
    if (!r.ok) return;
    rel = await r.json();
  } catch { return; } // hors ligne : on réessaiera plus tard
  const tag = rel?.tag_name;
  if (!tag || rel.draft || rel.prerelease || !isNewer(tag, current)) return;
  const asset = (rel.assets || []).find(x => /\.exe$/i.test(x.name || ''));
  update = { tag, url: asset?.browser_download_url || '', page: rel.html_url || RELEASES_PAGE };
  $('#updateText').innerHTML = tr('<b>Wak\'Forge {v}</b> est disponible (tu as la {cur}).', { v: escapeHtml(tag), cur: escapeHtml(current.replace(/^v?/, 'v')) });
  $('#updateGo').textContent = update.url ? tr('Mettre à jour') : tr('Voir la nouvelle version');
  $('#updateGo').disabled = false;
  $('#updateLater').hidden = false;
  $('#updateBar').hidden = false;
}

$('#updateGo').addEventListener('click', () => {
  if (!update) return;
  if (!update.url || update.failed || !window.nativeUpdate) { native.openURL(update.page); return; }
  update.busy = true;
  $('#updateGo').disabled = true;
  $('#updateGo').textContent = tr('Téléchargement…');
  $('#updateLater').hidden = true;
  $('#updateText').innerHTML = tr('Téléchargement de <b>Wak\'Forge {v}</b>… L\'appli va redémarrer toute seule.', { v: escapeHtml(update.tag) });
  window.nativeUpdate(update.url).catch(e => window.wfUpdateFailed(String(e?.message || e)));
});
$('#updateLater').addEventListener('click', () => { updateHidden = true; $('#updateBar').hidden = true; });
// appelé par l'appli PC si la mise à jour automatique échoue : on propose le téléchargement manuel
window.wfUpdateFailed = msg => {
  if (!update) return;
  update.busy = false;
  update.failed = true;
  $('#updateText').innerHTML = tr('Mise à jour impossible : {err}. Tu peux télécharger <b>WakForge.exe</b> à la main.', { err: escapeHtml(msg) });
  $('#updateGo').textContent = tr('Ouvrir la page de téléchargement');
  $('#updateGo').disabled = false;
  $('#updateLater').hidden = false;
};

/* =================================================================== démarrage */

function renderGameSource() {
  const g = gamedataInfo();
  $('#craftSource').innerHTML = g
    ? tr('Données du jeu : version {v} (CDN Ankama et textes du jeu), drops et monstres : {wiki} (CC BY-SA). Mise à jour : {d}.', { v: escapeHtml(g.version), d: escapeHtml(g.maj), wiki: '<a href="https://wakfu.wiki.gg" target="_blank" rel="noopener">wakfu.wiki.gg</a>' })
    : '';
}

/** Importe une liste reçue par lien (#liste=…) comme nouvelle liste, après confirmation. */
function importShared(text) {
  const d = decodeShare(text);
  if (!d) { toast(tr('Ce lien de liste est invalide ou incomplet.'), 'error'); return false; }
  const nom = cleanName(d.nom || '').slice(0, 40) || tr('Liste partagée');
  const n = d.cibles.length;
  if (!confirm(tn(n, 'Importer la liste partagée « {nom} » ({n} objet) ?', 'Importer la liste partagée « {nom} » ({n} objets) ?', { nom })
    + `\n${tr('Elle s\'ajoute à tes listes, sans toucher aux autres.')}`)) return true;
  if (!craftLists.create(nom, sanitizeCraft({ cibles: d.cibles }))) {
    toast(tr('Tu as déjà {n} listes : supprimes-en une pour importer celle-ci.', { n: MAX_LISTES }), 'warn');
    return true;
  }
  showView('craft');
  renderCraft();
  toast(tr('Liste <b>{nom}</b> importée.', { nom: escapeHtml(nom) }), 'ok');
  return true;
}
function checkSharedHash() {
  if (!/^#liste=/.test(location.hash)) return;
  const h = location.hash;
  history.replaceState(null, '', location.pathname + location.search);
  importShared(h);
}

async function main() {
  translateDom();
  if (isEn) $$('a[href="mentions-legales.html"]').forEach(a => { a.href = 'mentions-legales.html#en'; });
  initCraft({
    getCraft: () => state.craft,
    lists: craftLists,
    prices: () => state.prix,
    jobs: () => state.metiers,
    setJob: (m, v) => {
      const n = Math.min(300, Math.max(0, Math.round(+v) || 0));
      if (!JOBS.includes(m)) return;
      if (n) state.metiers[m] = n; else delete state.metiers[m];
      persist();
      renderJobSettings();
    },
    plans: () => state.plans,
    setPlan: (id, v) => {
      if (v) state.plans[id] = true; else delete state.plans[id];
      persist();
    },
    importShared,
    shareBase: () => (native.on || location.protocol === 'file:' ? (window.ARCHI_CONFIG?.siteUrl || SITE_URL) : location.origin + location.pathname),
    archiInfo,
    native,
    archiLaunch: launchArchi,
    archiEdit: async id => { await editMonster(id); renderMonsters(); },
    saveCraft: () => persist(),
    toast, toastUndo,
    showView,
  });
  await loadData();
  refreshCatalog();
  markPastAsNotified();
  renderTimers(true);
  renderSettings();
  renderAccountButton();
  // le Craft est la page d'accueil ; on revient sur le dernier onglet ouvert pendant la session
  let v = 'craft';
  try { v = sessionStorage.getItem('archimonstres.view') || 'craft'; } catch { /* rien */ }
  showView($(`#view-${v}`) ? v : 'craft');
  // lien de partage d'une liste (#liste=…), à l'ouverture ou collé dans la barre d'adresse
  setTimeout(checkSharedHash, 300);
  window.addEventListener('hashchange', checkSharedHash);
  setInterval(tick, 250);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
  if (native.on) {
    native.topmost(device.topmost);
    native.scanEnable(device.scan);
    scheduleNative();
    setTimeout(checkUpdate, 4000);
    setInterval(checkUpdate, 6 * 3600 * 1000);
  }

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === '127.0.0.1' || location.hostname === 'localhost')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  sync = await createSync({
    config: window.ARCHI_CONFIG || {},
    getState: () => state,
    applyRemote,
    onStatus: (s, detail = '') => { syncState = s; syncDetail = detail; renderAccountButton(); },
    onUser: () => {
      renderAccountButton();
      if ($('#accountDlg').open && sync.user) accountView();
    },
    onRecovery: () => { accountView('recovery'); if (!$('#accountDlg').open) $('#accountDlg').showModal(); },
  });
  renderAccountButton();
}

// Synchronisation entre onglets ouverts sur le même appareil.
window.addEventListener('storage', e => {
  if (e.key !== STORE_KEY || !e.newValue) return;
  try {
    const s = sanitizeState(JSON.parse(e.newValue));
    if (s.updatedAt > state.updatedAt) {
      state = s; markPastAsNotified(); refreshCatalog(); renderTimers(true);
      if (!$('#view-craft').hidden || overlayOpen()) renderCraft();
    }
  } catch { /* rien */ }
});

main();
