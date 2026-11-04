// Onglet « Havre-sac » : relevé du coffre de compte à partir de captures d'écran du jeu.
// L'image est lue sur l'appareil (havresac.js) ; rien n'est envoyé.
import { norm, escapeHtml } from './util.js';
import { t, tn, locale } from './i18n.js';
import { loadGamedata, ensureData, itemIcon, itemLabel } from './craft.js';
import { readCoffre, parseIcons, havresacTotals } from './havresac.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtN = n => Number(n).toLocaleString(locale);
let ctx = null;   // { get, save, toast, native, onChange }
let IDX = null;
let icons = null;
let pending = null; // capture lue, pas encore enregistrée : { cells, items, unknown, err, busy }
let query = '';

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

async function readCapture(file, { auto = false } = {}) {
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
      const items = {};
      for (const c of res.cells) if (c.id) items[c.id] = (items[c.id] || 0) + c.qty;
      const unknown = res.cells.filter(c => !c.id && c.qty > 0).length;
      if (!Object.keys(items).length) pending = { err: t('Aucune ressource reconnue sur cette capture. La lecture est prévue pour l\'interface du jeu en 1920×1080 : envoie-nous une capture si ton écran est différent.') };
      else pending = { cells: res.cells, items, unknown, nom: sameTab(items)?.nom || defaultName() };
    }
  } catch (e) {
    pending = { err: t('Lecture impossible : {err}', { err: escapeHtml(e?.message || String(e)) }) };
  }
  const read = pending;
  if (auto && read.items) save(read.nom);
  else render();
  return read;
}

/** Onglet déjà enregistré qui contient en grande partie les mêmes ressources (même onglet relu plus tard). */
function sameTab(items) {
  const ids = Object.keys(items);
  let best = null, score = 0;
  for (const o of ctx.get().onglets) {
    const mine = Object.keys(o.items);
    const common = ids.filter(id => o.items[id] != null).length;
    const s = common / Math.max(ids.length, mine.length, 1);
    if (s > score) { score = s; best = o; }
  }
  return score >= 0.6 ? best : null;
}

/** Ctrl+H dans l'appli PC : capture de la fenêtre du jeu, lue et enregistrée directement. */
export async function scanCoffre(r) {
  const tell = (html, kind) => {
    if (ctx.native?.on && window.nativeScanShow) ctx.native.scanShow({ state: 'msg', html, kind });
    else ctx.toast(html, kind);
  };
  if (r.pending) { tell(t('Lecture du coffre…'), ''); return; }
  if (r.error) { tell(escapeHtml(r.error), 'error'); return; }
  try {
    const blob = await fetch(r.capture, { cache: 'no-store' }).then(x => { if (!x.ok) throw new Error(String(x.status)); return x.blob(); });
    const read = await readCapture(new File([blob], 'coffre.png', { type: 'image/png' }), { auto: true });
    if (read.err) { tell(read.err, 'warn'); return; }
    const n = Object.keys(read.items).length;
    tell(t('Havre-sac : onglet « {nom} » relevé ({n} ressources). Renomme-le dans l\'onglet Havre-sac si besoin.', { nom: escapeHtml(read.nom), n }), 'ok');
  } catch (e) {
    tell(t('Lecture impossible : {err}', { err: escapeHtml(e?.message || String(e)) }), 'error');
  }
}

function defaultName() {
  const used = new Set(ctx.get().onglets.map(o => o.nom.toLowerCase()));
  let n = ctx.get().onglets.length + 1;
  while (used.has(t('Onglet {n}', { n }).toLowerCase())) n++;
  return t('Onglet {n}', { n });
}

function save(name) {
  const hs = ctx.get();
  const nom = ((name ?? $('#hsName')?.value ?? '').trim() || defaultName()).slice(0, 40);
  const now = Date.now();
  const same = hs.onglets.find(o => o.nom.toLowerCase() === nom.toLowerCase());
  if (same) Object.assign(same, { nom, date: now, items: pending.items });
  else hs.onglets.push({ id: 'o' + now.toString(36), nom, date: now, items: pending.items });
  hs.maj = now;
  ctx.save();
  ctx.onChange?.();
  pending = null;
  if (name == null) ctx.toast(t('Onglet « {nom} » enregistré. « J\'ai » est mis à jour dans tes listes de craft.', { nom: escapeHtml(nom) }), 'ok');
  render();
}

function remove(id) {
  const hs = ctx.get();
  const o = hs.onglets.find(x => x.id === id);
  if (!o || !confirm(t('Retirer l\'onglet « {nom} » du havre-sac ?', { nom: o.nom }))) return;
  hs.onglets = hs.onglets.filter(x => x.id !== id);
  hs.maj = Date.now();
  ctx.save();
  ctx.onChange?.();
  render();
}

function renderRead() {
  const el = $('#hsRead');
  if (!pending) { el.innerHTML = ''; el.hidden = true; return; }
  el.hidden = false;
  if (pending.busy) { el.innerHTML = `<div class="build-wait"><span class="sp-spin"></span><span>${t('Lecture de la capture…')}</span></div>`; return; }
  if (pending.err) { el.innerHTML = `<p class="hs-err">${pending.err}</p>`; return; }
  const ids = Object.keys(pending.items).map(Number);
  const total = ids.reduce((s, id) => s + pending.items[id], 0);
  const cells = pending.cells.filter(c => c.id).map(c => {
    const o = IDX.byId.get(c.id);
    return `<span class="hs-cell" title="${escapeHtml(o?.nom || '')}">${itemIcon(o)}<b>${fmtN(c.qty)}</b></span>`;
  }).join('');
  const names = ctx.get().onglets.map(o => `<option value="${escapeHtml(o.nom)}">`).join('');
  el.innerHTML = `
    <p><b>${tn(ids.length, '{n} ressource reconnue', '{n} ressources reconnues')}</b> · ${tn(total, '{n} objet', '{n} objets', { n: fmtN(total) })}${pending.unknown ? ` · <span class="warn-txt">${tn(pending.unknown, '{n} case non reconnue', '{n} cases non reconnues')}</span>` : ''}</p>
    <div class="hs-cells">${cells}</div>
    <div class="hs-save">
      <label>${t('Nom de l\'onglet')} <input id="hsName" list="hsNames" maxlength="40" value="${escapeHtml(pending.nom)}"></label>
      <datalist id="hsNames">${names}</datalist>
      <button class="btn" type="button" data-hs-cancel>${t('Annuler')}</button>
      <button class="btn primary" type="button" data-hs-save>${t('Enregistrer cet onglet')}</button>
    </div>
    <p class="hint-line">${t('Même nom qu\'un onglet déjà enregistré : il est remplacé. Avec deux comptes, nomme-les par exemple « Compte 2 · 12-81 ».')}</p>`;
}

function renderTabs() {
  const hs = ctx.get();
  $('#hsTabs').innerHTML = hs.onglets.length
    ? hs.onglets.map(o => `<span class="chip hs-tab"><b>${escapeHtml(o.nom)}</b> · ${tn(Object.keys(o.items).length, '{n} ressource', '{n} ressources')} · ${new Date(o.date).toLocaleDateString(locale)}
        <button class="icon-btn del" type="button" data-hs-del="${o.id}" title="${t('Retirer')}" aria-label="${t('Retirer')}"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg></button></span>`).join('')
    : `<p class="muted">${t('Aucun onglet enregistré pour l\'instant.')}</p>`;
}

function renderTable() {
  const hs = ctx.get();
  const tot = havresacTotals(hs);
  const q = norm(query);
  const rows = Object.keys(tot).map(Number).map(id => IDX.byId.get(id)).filter(Boolean)
    .filter(o => !q || norm(o.nom).includes(q))
    .sort((a, b) => a.nom.localeCompare(b.nom, locale));
  $('#hsCount').textContent = tn(rows.length, '{n} ressource', '{n} ressources');
  $('#hsBody').innerHTML = rows.map(o => {
    const where = hs.onglets.filter(x => x.items[o.id] != null).map(x => escapeHtml(x.nom)).join(', ');
    return `<tr><td>${itemLabel(o)}</td><td class="num">${fmtN(tot[o.id])}</td><td class="muted small">${where}</td></tr>`;
  }).join('');
  $('#hsTableWrap').hidden = !Object.keys(tot).length;
}

function render() {
  if ($('#view-havresac').hidden || !IDX) return;
  renderRead();
  renderTabs();
  renderTable();
}

export async function renderHavresac() {
  if (!(await ensureData('view-havresac'))) return;
  IDX = await loadGamedata();
  render();
}

export function initHavresac(context) {
  ctx = context;
  const view = $('#view-havresac');
  view.addEventListener('change', e => { if (e.target.matches('#hsFile')) { readCapture(e.target.files[0]); e.target.value = ''; } });
  view.addEventListener('input', e => { if (e.target.matches('#hsSearch')) { query = e.target.value; renderTable(); } });
  view.addEventListener('click', e => {
    if (e.target.closest('[data-hs-save]')) save(null);
    else if (e.target.closest('[data-hs-cancel]')) { pending = null; render(); } else {
      const d = e.target.closest('[data-hs-del]');
      if (d) remove(d.dataset.hsDel);
    }
  });
  view.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('#hsDrop')) { e.preventDefault(); $('#hsFile').click(); }
    if (e.key === 'Enter' && e.target.matches('#hsName')) save(null);
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
