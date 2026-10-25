// Fonctions utilitaires partagées (aucune dépendance au DOM, testables avec Node).
import { t, isEn, locale } from './i18n.js';

/** Minuscules, sans accents, espaces compactés. */
export function norm(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Clé de comparaison tolérante aux erreurs d'OCR : sans accents, apostrophes ni ponctuation. */
export const scanKey = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  .replace(/['’`´]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Distance d'édition entre a et b, arrêtée dès qu'elle dépasse max (renvoie alors max + 1). */
export function lev(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

/** Identifiant stable à partir d'un nom ("Gengas Kin" -> "gengas-kin"). */
export function slug(s) {
  return norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'archimonstre';
}

/** Espaces compactés, sans espaces en bord. */
export function cleanName(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, 80);
}

/**
 * Convertit une durée saisie en secondes. Renvoie null si invalide.
 * Formats : "2h", "1h30", "45m", "45" (minutes), "1:30:00", "90:00", "30s", "1j2h", "25min".
 * Un nombre (ex. 7200) dans le JSON est accepté tel quel, en secondes.
 */
export function parseDuration(input) {
  if (typeof input === 'number') return Number.isFinite(input) && input > 0 ? Math.round(input) : null;
  const t = String(input ?? '').toLowerCase().replace(/\s+/g, '');
  if (!t) return null;
  let total = 0;
  if (t.includes(':')) {
    const parts = t.split(':');
    if (parts.length < 2 || parts.length > 3 || parts.some(p => !/^\d+$/.test(p))) return null;
    const n = parts.map(Number);
    total = n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  } else if (/^\d+$/.test(t)) {
    total = Number(t) * 60;
  } else {
    const re = /(\d+)(j|d|h|min|m|s)?/y;
    let last = '';
    let pos = 0;
    while (pos < t.length) {
      re.lastIndex = pos;
      const m = re.exec(t);
      if (!m) return null;
      const v = Number(m[1]);
      const u = m[2];
      pos = re.lastIndex;
      if (!u) {
        if (pos !== t.length) return null;
        if (last === 'h') total += v * 60;
        else if (last === 'm') total += v;
        else return null;
        break;
      }
      if (u === 'j' || u === 'd') { total += v * 86400; last = 'j'; }
      else if (u === 'h') { total += v * 3600; last = 'h'; }
      else if (u === 'm' || u === 'min') { total += v * 60; last = 'm'; }
      else { total += v; last = 's'; }
    }
  }
  if (!(total > 0) || total > 366 * 86400) return null;
  return total;
}

/** 3725 -> "01:02:05", 90061 -> "1j 01:01:01" */
export function fmtClock(sec) {
  sec = Math.max(0, Math.ceil(sec));
  const j = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const p = n => String(n).padStart(2, '0');
  return (j ? `${j}${isEn ? 'd' : 'j'} ` : '') + `${p(h)}:${p(m)}:${p(s)}`;
}

/** 5400 -> "1h30", 2700 -> "45m", 90 -> "1m30s", 7200 -> "2h" */
export function fmtShort(sec) {
  if (sec == null) return '?';
  const j = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  let out = '';
  if (j) out += `${j}${isEn ? 'd' : 'j'}`;
  if (h) out += `${h}h`;
  if (m) out += h ? String(m).padStart(2, '0') : `${m}m`;
  if (s) out += `${s}s`;
  return out || '0s';
}

/** Durée humaine pour "depuis 3 min". */
export function fmtAgo(sec) {
  sec = Math.max(0, Math.floor(sec));
  if (sec < 60) return t('à l\'instant');
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, '0')}`;
}

export function hhmm(ms) {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** "21:45" ou "demain 08:10" si ce n'est pas aujourd'hui. */
export function whenLabel(ms, now = Date.now()) {
  const d = new Date(ms), n = new Date(now);
  const day = x => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(n)) / 86400000);
  if (diff === 0) return hhmm(ms);
  if (diff === 1) return t('demain {h}', { h: hhmm(ms) });
  if (diff === -1) return t('hier {h}', { h: hhmm(ms) });
  return `${d.toLocaleDateString(locale, { day: 'numeric', month: 'short' })} ${hhmm(ms)}`;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Classement des suggestions : commence par > mot qui commence par > contient. */
export function rankMatches(list, query, limit = 8) {
  const q = norm(query);
  if (!q) return [];
  const out = [];
  for (const m of list) {
    const n = m._key ?? norm(m.name);
    let score = -1;
    if (n === q) score = 0;
    else if (n.startsWith(q)) score = 1;
    else if (n.split(' ').some(w => w.startsWith(q))) score = 2;
    else if (n.includes(q)) score = 3;
    else if (m._extra && m._extra.includes(q)) score = 4;
    if (score >= 0) out.push([score, n, m]);
  }
  out.sort((a, b) => a[0] - b[0] || a[1].localeCompare(b[1]));
  return out.slice(0, limit).map(x => x[2]);
}
