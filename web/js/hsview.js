// Onglet « Havre-sac » : copie du coffre de compte du jeu (onglets sur le côté, grille de 10 × 10 cases).
// Les onglets se remplissent à partir de captures d'écran lues sur l'appareil (havresac.js, rien n'est envoyé),
// ou à la main : clic sur une case vide pour y mettre une ressource, clic sur un objet pour sa fiche et sa quantité.
import { norm, escapeHtml } from './util.js';
import { t, tn, locale } from './i18n.js';
import { loadGamedata, ensureData, itemIcon, itemLabel, openItem } from './craft.js';
import { searchItems, RARITY_CLASS } from './craftcore.js';
import { readCoffre, parseIcons, havresacTotals, ongletItems, cellsToCases, SLOTS } from './havresac.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtN = n => Number(n).toLocaleString(locale);
const TAB_KEY = 'wakforge.hsTab';
const MAX_ONGLETS = 40;
let ctx = null;   // { get, save, toast, native, onChange }
let IDX = null;
let icons = null;
let pending = null; // capture lue, pas encore rangée : { cases, n, total, unknown, same, err, busy }
let query = '';
let activeId = (() => { try { return localStorage.getItem(TAB_KEY) || ''; } catch { return ''; } })();

/* ------------------------------------------------------------ données */

const hs = () => ctx.get();
const activeTab = () => hs().onglets.find(o => o.id === activeId) || hs().onglets[0] || null;
function setActive(id) {
  activeId = id || '';
  try { localStorage.setItem(TAB_KEY, activeId); } catch { /* rien */ }
}
function changed() {
  hs().maj = Date.now();
  ctx.save();
  ctx.onChange?.();
  render();
}
const filled = o => o.cases.filter(Boolean).length;
const emptyCases = () => Array(SLOTS).fill(null);

function nextName() {
  const used = new Set(hs().onglets.map(o => o.nom.toLowerCase()));
  let n = hs().onglets.length + 1;
  while (used.has(t('Onglet {n}', { n }).toLowerCase())) n++;
  return t('Onglet {n}', { n });
}

function addTab(nom, cases = emptyCases()) {
  if (hs().onglets.length >= MAX_ONGLETS) { ctx.toast(t('{n} onglets au maximum.', { n: MAX_ONGLETS }), 'warn'); return null; }
  const now = Date.now();
  const o = { id: 'o' + now.toString(36) + Math.random().toString(36).slice(2, 5), nom: (nom || nextName()).slice(0, 40), date: now, cases };
  hs().onglets.push(o);
  setActive(o.id);
  return o;
}

/** Onglet déjà enregistré qui contient en grande partie les mêmes ressources (même onglet relu plus tard). */
function sameTab(items) {
  const ids = Object.keys(items);
  let best = null, score = 0;
  for (const o of hs().onglets) {
    const mine = ongletItems(o);
    const common = ids.filter(id => mine[id] != null).length;
    const s = common / Math.max(ids.length, Object.keys(mine).length, 1);
    if (s > score) { score = s; best = o; }
  }
  return score >= 0.6 ? best : null;
}

/* ------------------------------------------------------------ fenêtres */

/** Petite fenêtre de l'appli (à la place de confirm/prompt du navigateur). Renvoie true / le texte saisi, ou null. */
function ask({ title, text = '', input = null, ok = t('OK'), danger = false }) {
  const dlg = $('#hsDlg');
  dlg.innerHTML = `<form method="dialog">
    <h2>${escapeHtml(title)}</h2>
    ${text ? `<p>${text}</p>` : ''}
    ${input != null ? `<input type="text" maxlength="40" value="${escapeHtml(input)}" data-ask-input>` : ''}
    <div class="dlg-actions"><span class="spacer"></span>
      <button class="btn" type="button" data-ask-cancel>${t('Annuler')}</button>
      <button class="btn ${danger ? 'danger-fill' : 'primary'}">${escapeHtml(ok)}</button>
    </div></form>`;
  return new Promise(resolve => {
    let done = false;
    const end = v => { if (done) return; done = true; resolve(v); if (dlg.open) dlg.close(); };
    dlg.querySelector('[data-ask-cancel]').onclick = () => end(null);
    dlg.querySelector('form').onsubmit = e => {
      e.preventDefault();
      const inp = dlg.querySelector('[data-ask-input]');
      end(inp ? inp.value.trim() : true);
    };
    dlg.onclose = () => end(null);
    dlg.showModal();
    dlg.querySelector('[data-ask-input]')?.select();
  });
}

/** Case vide (ou non reconnue) : choisir la ressource à y mettre et sa quantité. */
function pickResource(slot) {
  const tab = activeTab();
  const dlg = $('#hsDlg');
  const cur = tab.cases[slot];
  let sel = null;
  dlg.innerHTML = `<div>
    <h2>${cur ? t('Case non reconnue') : t('Ajouter une ressource')}</h2>
    <p class="muted small">${t('Onglet « {nom} », case {n}', { nom: escapeHtml(tab.nom), n: slot + 1 })}</p>
    <input type="search" placeholder="${t('Rechercher une ressource')}" aria-label="${t('Rechercher une ressource')}" data-pick-q>
    <div class="hs-pick" data-pick-list></div>
    <label class="hs-pick-qty">${t('Quantité')} <input type="number" min="0" max="9999999" value="${cur ? cur[1] : 1}" data-pick-n></label>
    <div class="dlg-actions">
      ${cur ? `<button class="btn ghost danger" type="button" data-pick-clear>${t('Vider la case')}</button>` : ''}
      <span class="spacer"></span>
      <button class="btn" type="button" data-pick-cancel>${t('Annuler')}</button>
      <button class="btn primary" type="button" data-pick-ok disabled>${t('Ajouter')}</button>
    </div></div>`;
  const list = dlg.querySelector('[data-pick-list]'), q = dlg.querySelector('[data-pick-q]'), okBtn = dlg.querySelector('[data-pick-ok]');
  const show = () => {
    const found = searchItems(IDX, q.value, { limit: 60 }).filter(o => o._res).slice(0, 12);
    list.innerHTML = found.map(o => `<button type="button" class="hs-pick-row${sel === o.id ? ' on' : ''}" data-pick="${o.id}">${itemIcon(o)}<span>${escapeHtml(o.nom)}</span><span class="muted small">${t('Niv. {n}', { n: o.niveau })}</span></button>`).join('')
      || (q.value.trim() ? `<p class="muted small">${t('Aucune ressource trouvée.')}</p>` : '');
  };
  const save = () => {
    if (!sel) return;
    tab.cases[slot] = [sel, Math.min(9999999, Math.max(0, Math.floor(+dlg.querySelector('[data-pick-n]').value) || 0))];
    dlg.close();
    changed();
  };
  q.oninput = () => { sel = null; okBtn.disabled = true; show(); };
  list.onclick = e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    sel = +b.dataset.pick; okBtn.disabled = false; show();
    dlg.querySelector('[data-pick-n]').focus();
  };
  dlg.querySelector('[data-pick-n]').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); save(); } };
  dlg.querySelector('[data-pick-cancel]').onclick = () => dlg.close();
  const clear = dlg.querySelector('[data-pick-clear]');
  if (clear) clear.onclick = () => { tab.cases[slot] = null; dlg.close(); changed(); };
  okBtn.onclick = save;
  dlg.onclose = null;
  dlg.showModal();
  q.focus();
}

function openSlot(slot) {
  const tab = activeTab();
  if (!tab) return;
  const c = tab.cases[slot];
  if (!c || !c[0] || !IDX.byId.get(c[0])) { pickResource(slot); return; }
  openItem(c[0], {
    qty: {
      label: t('Quantité dans « {nom} »', { nom: tab.nom }),
      value: c[1],
      onSave: n => { tab.cases[slot] = [c[0], n]; changed(); },
      onRemove: () => { tab.cases[slot] = null; changed(); },
    },
  });
}

/* ------------------------------------------------------------ captures */

function loadIcons() {
  if (icons) return icons;
  icons = fetch('data/icones_ressources.bin', { cache: 'no-cache' })
    .then(r => { if (!r.ok) throw new Error(`icones_ressources.bin : ${r.status}`); return r.arrayBuffer(); })
    .then(parseIcons)
    .catch(e => { icons = null; throw e; });
  return icons;
}

async function imagePixels(file) {
  const bmp = await createImageBitmap(file);
  const cv = document.createElement('canvas');
  cv.width = bmp.width; cv.height = bmp.height;
  const g = cv.getContext('2d', { willReadFrequently: true });
  g.drawImage(bmp, 0, 0);
  bmp.close?.();
  return g.getImageData(0, 0, cv.width, cv.height);
}

/** Lit une capture ; le choix de l'onglet (nouveau ou existant à remplacer) reste à faire. */
async function readCapture(file) {
  if (!file || !/^image\//.test(file.type)) { pending = { err: t('Ce fichier n\'est pas une image.') }; render(); return pending; }
  pending = { busy: true };
  render();
  try {
    const [ic, idx] = await Promise.all([loadIcons(), loadGamedata()]);
    IDX = idx;
    const img = await imagePixels(file);
    await new Promise(r => setTimeout(r, 30)); // laisse s'afficher « Lecture… »
    const res = readCoffre(img, ic, [...IDX.byId.values()].filter(o => o._res));
    if (!res || !res.cells.length) {
      pending = { err: t('Coffre introuvable sur cette image. Ouvre le « Coffre de compte » dans le jeu et capture tout l\'écran, sans le redimensionner.') };
    } else {
      const cases = cellsToCases(res.cells); // 10 colonnes, même si la dernière est vide
      const items = ongletItems({ cases });
      if (!Object.keys(items).length) pending = { err: t('Aucune ressource reconnue sur cette capture. La lecture est prévue pour l\'interface du jeu en 1920×1080 : envoie-nous une capture si ton écran est différent.') };
      else {
        pending = {
          cases, n: Object.keys(items).length,
          total: Object.values(items).reduce((a, b) => a + b, 0),
          unknown: res.cells.filter(c => !c.id && c.qty > 0).length,
          same: sameTab(items),
        };
      }
    }
  } catch (e) {
    pending = { err: t('Lecture impossible : {err}', { err: escapeHtml(e?.message || String(e)) }) };
  }
  render();
  return pending;
}

function storeIn(tab) {
  tab.cases = pending.cases;
  tab.date = Date.now();
  setActive(tab.id);
  pending = null;
  changed();
}

/** Ctrl+H dans l'appli PC : capture de la fenêtre du jeu, lue, puis la fenêtre de scan propose
 *  de la ranger dans un nouvel onglet ou à la place d'un onglet existant. */
export async function scanCoffre(r) {
  const tell = (html, kind) => {
    if (ctx.native?.on && window.nativeScanShow) ctx.native.scanShow({ state: 'msg', html, kind });
    else ctx.toast(html, kind);
  };
  if (r.pending) { tell(t('Lecture du coffre…'), ''); return; }
  if (r.error) { tell(escapeHtml(r.error), 'error'); return; }
  try {
    const blob = await fetch(r.capture, { cache: 'no-store' }).then(x => { if (!x.ok) throw new Error(String(x.status)); return x.blob(); });
    const read = await readCapture(new File([blob], 'coffre.png', { type: 'image/png' }));
    if (read.err) { tell(read.err, 'warn'); return; }
    if (!(ctx.native?.on && window.nativeScanShow)) { tell(t('Coffre lu : choisis où le ranger dans l\'onglet Havre-sac.'), 'ok'); return; }
    const tabs = hs().onglets.map(o => ({ id: o.id, nom: o.nom, n: filled(o), same: o === read.same }));
    tabs.sort((a, b) => b.same - a.same);
    ctx.native.scanShow({
      state: 'coffre', mode: 'coffre', tabs, canNew: hs().onglets.length < MAX_ONGLETS,
      html: `<b>${tn(read.n, '{n} ressource reconnue', '{n} ressources reconnues')}</b> · ${tn(read.total, '{n} objet', '{n} objets', { n: fmtN(read.total) })}`,
    });
  } catch (e) {
    tell(t('Lecture impossible : {err}', { err: escapeHtml(e?.message || String(e)) }), 'error');
  }
}

/** Choix fait dans la fenêtre de scan : « new » ou l'identifiant de l'onglet à remplacer. */
window.wfScanCoffre = choice => {
  if (!pending?.cases) return;
  const o = choice === 'new' ? addTab() : hs().onglets.find(x => x.id === choice);
  if (o) storeIn(o);
};

/* ------------------------------------------------------------ affichage */

function renderRead() {
  const el = $('#hsRead');
  if (!pending) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  if (pending.busy) { el.innerHTML = `<div class="build-wait"><span class="sp-spin"></span><span>${t('Lecture de la capture…')}</span></div>`; return; }
  if (pending.err) { el.innerHTML = `<p class="hs-err">${pending.err}</p><button class="btn" type="button" data-hs-cancel>${t('Fermer')}</button>`; return; }
  const act = activeTab();
  const target = pending.same || (act && !filled(act) ? act : null);
  el.innerHTML = `
    <p><b>${tn(pending.n, '{n} ressource reconnue', '{n} ressources reconnues')}</b> · ${tn(pending.total, '{n} objet', '{n} objets', { n: fmtN(pending.total) })}${pending.unknown ? ` · <span class="warn-txt">${tn(pending.unknown, '{n} case non reconnue', '{n} cases non reconnues')}</span>` : ''}</p>
    <div class="hs-save">
      ${target ? `<button class="btn primary" type="button" data-hs-store="${target.id}">${t('Ranger dans « {nom} »', { nom: escapeHtml(target.nom) })}</button>` : ''}
      ${act && act !== target ? `<button class="btn" type="button" data-hs-store="${act.id}">${t('Remplacer « {nom} »', { nom: escapeHtml(act.nom) })}</button>` : ''}
      <button class="btn${target ? '' : ' primary'}" type="button" data-hs-new>${t('Nouvel onglet')}</button>
      <button class="btn ghost" type="button" data-hs-cancel>${t('Annuler')}</button>
    </div>`;
}

function slotHtml(c, i, q) {
  if (!c) return `<button type="button" class="hs-slot empty" data-slot="${i}" aria-label="${t('Case vide')}"></button>`;
  const o = c[0] ? IDX.byId.get(c[0]) : null;
  const dim = q && !(o && norm(o.nom).includes(q)) ? ' dim' : '';
  const n = c[1] === 1 ? '' : fmtN(c[1]);
  if (!o) return `<button type="button" class="hs-slot unknown${dim}" data-slot="${i}" title="${t('Case non reconnue')}"><span class="hs-q">?</span><span class="hs-n">${n}</span></button>`;
  return `<button type="button" class="hs-slot ${RARITY_CLASS[o.rarete] || 'commun'}${c[1] ? '' : ' zero'}${dim}" data-slot="${i}" title="${escapeHtml(o.nom)}">${itemIcon(o)}<span class="hs-n">${n}</span></button>`;
}

function renderCoffre() {
  const tabs = hs().onglets;
  const tab = activeTab();
  if (tab && tab.id !== activeId) setActive(tab.id);
  $('#hsSide').innerHTML = `
    <p class="hs-side-h">${t('Onglets')}</p>
    ${tabs.map(o => `<button type="button" class="hs-tabbtn" data-tab="${o.id}" aria-pressed="${o === tab}"><b>${escapeHtml(o.nom)}</b><span>${filled(o)} / ${SLOTS}</span></button>`).join('')}
    <button type="button" class="hs-tabbtn add" data-hs-add>＋ ${t('Créer un onglet')}</button>`;
  const main = $('#hsMain');
  if (!tab) {
    main.innerHTML = `<p class="muted hs-none">${t('Aucun onglet pour l\'instant : relève ton coffre avec une capture, ou crée un onglet et remplis-le à la main.')}</p>`;
    return;
  }
  const items = ongletItems(tab);
  const total = Object.values(items).reduce((a, b) => a + b, 0);
  const q = norm(query);
  main.innerHTML = `
    <div class="hs-title">
      <h3>${escapeHtml(tab.nom)}</h3>
      <span class="muted small">${t('Relevé le {d}', { d: new Date(tab.date).toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' }) })}</span>
      <span class="spacer"></span>
      <button class="btn ghost" type="button" data-hs-rename>${t('Renommer')}</button>
      <button class="btn ghost danger" type="button" data-hs-del>${t('Supprimer')}</button>
    </div>
    <input id="hsSearch" type="search" placeholder="${t('Rechercher un objet')}" aria-label="${t('Rechercher un objet')}" value="${escapeHtml(query)}">
    <div class="hs-grid">${tab.cases.map((c, i) => slotHtml(c, i, q)).join('')}</div>
    <p class="hs-stats">${t('Nombre d\'objets uniques : {n}', { n: filled(tab) })}<br>${t('Nombre total d\'objets : {n}', { n: fmtN(total) })}</p>`;
}

function renderTable() {
  const tot = havresacTotals(hs());
  const rows = Object.keys(tot).map(Number).map(id => IDX.byId.get(id)).filter(Boolean)
    .sort((a, b) => a.nom.localeCompare(b.nom, locale));
  $('#hsTotals').hidden = !rows.length;
  $('#hsTotalsSum').textContent = t('Total de tous les onglets ({n})', { n: rows.length });
  $('#hsBody').innerHTML = rows.map(o => {
    const where = hs().onglets.filter(x => ongletItems(x)[o.id] != null).map(x => escapeHtml(x.nom)).join(', ');
    return `<tr><td>${itemLabel(o)}</td><td class="num">${fmtN(tot[o.id])}</td><td class="muted small">${where}</td></tr>`;
  }).join('');
}

function render() {
  if ($('#view-havresac').hidden || !IDX) return;
  renderRead();
  renderCoffre();
  renderTable();
}

export async function renderHavresac() {
  if (!(await ensureData('view-havresac'))) return;
  IDX = await loadGamedata();
  render();
}

/* ------------------------------------------------------------ actions */

async function onClick(e) {
  const slot = e.target.closest('[data-slot]');
  if (slot) { openSlot(+slot.dataset.slot); return; }
  const tb = e.target.closest('[data-tab]');
  if (tb) { setActive(tb.dataset.tab); query = ''; render(); return; }
  if (e.target.closest('[data-hs-add]')) {
    const nom = await ask({ title: t('Créer un onglet'), input: nextName(), ok: t('Créer') });
    if (nom != null && addTab(nom || nextName())) changed();
    return;
  }
  const tab = activeTab();
  if (e.target.closest('[data-hs-rename]') && tab) {
    const nom = await ask({ title: t('Renommer l\'onglet'), input: tab.nom, ok: t('Renommer') });
    if (nom) { tab.nom = nom.slice(0, 40); changed(); }
    return;
  }
  if (e.target.closest('[data-hs-del]') && tab) {
    const ok = await ask({ title: t('Supprimer l\'onglet'), text: t('Retirer l\'onglet « {nom} » du havre-sac ?', { nom: escapeHtml(tab.nom) }), ok: t('Supprimer'), danger: true });
    if (ok) { hs().onglets = hs().onglets.filter(x => x !== tab); setActive(hs().onglets[0]?.id); changed(); }
    return;
  }
  const st = e.target.closest('[data-hs-store]');
  if (st && pending?.cases) { const o = hs().onglets.find(x => x.id === st.dataset.hsStore); if (o) storeIn(o); return; }
  if (e.target.closest('[data-hs-new]') && pending?.cases) { const o = addTab(); if (o) storeIn(o); return; }
  if (e.target.closest('[data-hs-cancel]')) { pending = null; render(); }
}

export function initHavresac(context) {
  ctx = context;
  const view = $('#view-havresac');
  view.addEventListener('click', e => { onClick(e); });
  view.addEventListener('change', e => { if (e.target.matches('#hsFile')) { readCapture(e.target.files[0]); e.target.value = ''; } });
  view.addEventListener('input', e => {
    if (!e.target.matches('#hsSearch')) return;
    query = e.target.value;
    const q = norm(query);
    for (const b of view.querySelectorAll('.hs-slot[data-slot]')) {
      const c = activeTab()?.cases[+b.dataset.slot];
      const o = c?.[0] ? IDX.byId.get(c[0]) : null;
      b.classList.toggle('dim', !!q && !!c && !(o && norm(o.nom).includes(q)));
    }
  });
  view.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('#hsDrop')) { e.preventDefault(); $('#hsFile').click(); }
  });
  view.addEventListener('dragover', e => { const z = e.target.closest('#hsDrop'); if (z) { e.preventDefault(); z.classList.add('over'); } });
  view.addEventListener('dragleave', e => e.target.closest('#hsDrop')?.classList.remove('over'));
  view.addEventListener('drop', e => {
    const z = e.target.closest('#hsDrop');
    if (!z) return;
    e.preventDefault();
    z.classList.remove('over');
    readCapture(e.dataTransfer.files[0]);
  });
  // Ctrl+V : capture d'écran copiée (Impr. écran, Win+Maj+S)
  document.addEventListener('paste', e => {
    if (view.hidden || document.querySelector('dialog[open]')) return;
    const f = [...(e.clipboardData?.files || [])].find(x => /^image\//.test(x.type));
    if (f) { e.preventDefault(); readCapture(f); }
  });
}
