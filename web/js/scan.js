// Fenêtre de scan de l'appli PC (scan.html) : affiche l'objet scanné, laisse choisir la rareté
// et la quantité. Le contenu est préparé par la page principale (craft.js, handleScan) ;
// l'objet choisi lui est renvoyé par l'appli PC, qui referme la fenêtre et rend le focus au jeu.
import { escapeHtml } from './util.js';
import { t, locale, translateDom } from './i18n.js';

const $ = (s, r = document) => r.querySelector(s);
const fmtN = n => Number(n).toLocaleString(locale);
translateDom();
const root = $('#scanPop');
const call = (name, ...a) => window[name]?.(...a)?.catch?.(() => {});
const closeWin = () => { pop = null; call('nativeScanClose'); };

let pop = null; // { state, versions, sel, qte, owned, use, … }

// emplacements du bandeau « Possédés » de l'infobulle, dans l'ordre du jeu
const PLACES = [['moi', 'Sur moi'], ['equipe', 'Équipé'], ['coffre', 'Coffre'], ['pacte', 'Pacte']];
const ownedSum = () => PLACES.reduce((a, [k]) => a + (pop.use.has(k) ? pop.owned[k] : 0), 0);
const minQte = () => (pop?.owned ? 0 : 1);

function render() {
  if (!pop) { root.innerHTML = ''; return; }
  const head = `<header class="sp-head"><b>${pop.mode === 'have' ? t('J\'en ai') : t('Scan d\'objet')}</b><button class="ovl-btn" type="button" data-sp-close title="${t('Fermer (Échap)')}" aria-label="${t('Fermer')}">✕</button></header>`;
  if (pop.state === 'loading') {
    root.innerHTML = `<div class="sp">${head}<div class="sp-msg"><span class="sp-spin"></span>${t('Lecture de l\'objet sous la souris…')}</div></div>`;
    return;
  }
  if (pop.state === 'msg') {
    root.innerHTML = `<div class="sp">${head}<div class="sp-msg ${escapeHtml(pop.kind || '')}">${pop.html}</div>
      <footer class="sp-foot">${pop.itemId ? `<button class="btn small" type="button" data-sp-item>${t('Voir la provenance')}</button>` : ''}
        <button class="btn small primary" type="button" data-sp-close>${t('Fermer')}</button></footer></div>`;
    root.querySelector('.sp-foot .primary')?.focus();
    return;
  }
  if (pop.state === 'done') {
    root.innerHTML = `<div class="sp">${head}<div class="sp-msg ok"><span class="sp-check">✓</span>${pop.html}</div></div>`;
    return;
  }
  const o = pop.versions[pop.sel];
  root.innerHTML = `<div class="sp">${head}
    <div class="sp-item">${o.icon}
      <div class="sp-main"><div class="sp-name">${escapeHtml(o.nom)}</div><div class="s-meta">${o.meta}</div></div></div>
    <div class="sp-label">${t('Rareté')}</div>
    <div class="sp-rar" role="radiogroup" aria-label="${t('Rareté')}">${pop.versions.map((v, i) => `<button type="button" role="radio" aria-checked="${i === pop.sel}" data-sp-rar="${i}"><span class="rar-dot ${escapeHtml(v.cls)}"></span>${escapeHtml(v.label)}</button>`).join('')}</div>
    <div class="sp-label">${t('Quantité')}</div>
    <div class="sp-qty"><div class="stepper"><button type="button" data-sp-step="-1" aria-label="${t('Moins')}">−</button>
      <input type="number" min="${minQte()}" max="9999" value="${pop.qte}" data-sp-qte aria-label="${t('Quantité')}">
      <button type="button" data-sp-step="1" aria-label="${t('Plus')}">+</button></div>
      ${pop.mode === 'have' && o.comp ? `<span class="muted">${t('besoin {a} · j\'ai {b}', { a: fmtN(o.comp.need), b: fmtN(o.comp.have) })}</span>`
        : o.inList ? `<span class="muted">${t('déjà {n} dans la liste', { n: fmtN(o.inList) })}</span>` : ''}</div>
    ${pop.owned ? `<div class="sp-label">${t('Possédés en jeu')}</div>
    <div class="sp-own">${PLACES.filter(([k]) => pop.owned[k] > 0).map(([k, l]) => `<button type="button" aria-pressed="${pop.use.has(k)}" data-sp-own="${k}" title="${t('Compter ou non cet emplacement')}">${t(l)} <b>${fmtN(pop.owned[k])}</b></button>`).join('') || `<span class="muted">${t('aucun')}</span>`}</div>` : ''}
    <footer class="sp-foot"><button class="btn small ghost" type="button" data-sp-close>${t('Annuler')}</button>
      ${pop.mode === 'have' && pop.owned
        ? `<button class="btn small primary" type="button" data-sp-have title="${t('Remplacer la quantité de « J\'ai » par celle-ci')}">${t('Mettre à jour « J\'ai »')}</button>`
        : pop.mode === 'have'
        ? `<button class="btn small primary" type="button" data-sp-have title="${t('Ajouter cette quantité à « J\'ai » dans la liste')}">${t('Ajouter à « J\'ai »')}</button>`
        : `<button class="btn small primary" type="button" data-sp-ok>${t('Ajouter à la liste')}</button>`}</footer>
  </div>`;
  const input = root.querySelector('[data-sp-qte]');
  input.focus();
  input.select();
}

function readQte() {
  const v = Math.floor(+root.querySelector('[data-sp-qte]')?.value);
  return Math.min(9999, Math.max(minQte(), Number.isFinite(v) ? v : 1));
}

/** Quantité proposée : ce que le bandeau « Possédés » compte, sinon ce qui manque pour une ressource de la liste, sinon 1. */
const defaultQte = o => (pop?.owned ? Math.min(9999, ownedSum())
  : pop?.mode === 'have' && o.comp?.missing > 0 ? Math.min(9999, o.comp.missing) : 1);

// Ctrl+F (mode « have ») : la quantité va dans « J'ai » ; Ctrl+D : dans les objets à fabriquer
function confirm(have = pop?.mode === 'have') {
  if (pop?.state !== 'choose') return;
  const o = pop.versions[pop.sel];
  if (have ? !o.comp : !o.craftable) return;
  const qte = readQte();
  if (have && pop.owned) {
    call('nativeScanSetHave', o.id, qte);
    pop = { state: 'done', html: t('« J\'ai » : <b>{n} {nom}</b>', { n: fmtN(qte), nom: escapeHtml(o.nom) }) };
    render();
    setTimeout(() => { if (pop?.state === 'done') closeWin(); }, 600);
    return;
  }
  call(have ? 'nativeScanHave' : 'nativeScanAdd', o.id, qte);
  pop = { state: 'done', html: have ? t('<b>+{n} {nom}</b> dans « j\'ai ».', { n: fmtN(qte), nom: escapeHtml(o.nom) }) : t('<b>{n} × {nom}</b> ajouté à la liste.', { n: fmtN(qte), nom: escapeHtml(o.nom) }) };
  render();
  setTimeout(() => { if (pop?.state === 'done') closeWin(); }, 600);
}

/** Change de rareté ; la quantité proposée suit, sauf si elle a été modifiée à la main. */
function selectVersion(i) {
  const before = pop.versions[pop.sel];
  pop.qte = readQte();
  pop.sel = i;
  const now = pop.versions[i];
  if (pop.qte === defaultQte(before)) pop.qte = defaultQte(now);
  render();
}

/** Appelé par l'appli PC : nouvel état à afficher. */
window.wfPop = state => {
  pop = { sel: 0, ...state };
  if (pop.owned) pop.use = new Set(PLACES.map(([k]) => k));
  if (pop.state === 'choose') pop.qte = defaultQte(pop.versions[pop.sel]);
  render();
};

root.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || !pop) return;
  if (b.matches('[data-sp-close]')) { closeWin(); return; }
  if (b.matches('[data-sp-ok]')) { confirm(false); return; }
  if (b.matches('[data-sp-have]')) { confirm(true); return; }
  if (b.matches('[data-sp-item]')) { const id = pop.itemId; pop = null; render(); call('nativeScanItem', id); return; }
  if (b.matches('[data-sp-rar]')) { selectVersion(+b.dataset.spRar); return; }
  if (b.matches('[data-sp-own]')) {
    const k = b.dataset.spOwn;
    if (!pop.use.delete(k)) pop.use.add(k);
    pop.qte = Math.min(9999, ownedSum());
    render();
    return;
  }
  if (b.matches('[data-sp-step]')) {
    const input = root.querySelector('[data-sp-qte]');
    input.value = Math.min(9999, Math.max(minQte(), readQte() + +b.dataset.spStep * (e.shiftKey ? 10 : 1)));
    pop.qte = +input.value;
  }
});
root.addEventListener('input', e => { if (e.target.matches('[data-sp-qte]') && pop) pop.qte = readQte(); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') { e.preventDefault(); closeWin(); return; }
  if (!pop) return;
  if (pop.state === 'msg' && e.key === 'Enter' && !e.target.closest('[data-sp-item]')) { e.preventDefault(); closeWin(); return; }
  if (pop.state !== 'choose') return;
  if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); confirm(); return; }
  if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && pop.versions.length > 1) {
    e.preventDefault();
    selectVersion((pop.sel + (e.key === 'ArrowRight' ? 1 : -1) + pop.versions.length) % pop.versions.length);
  }
});
