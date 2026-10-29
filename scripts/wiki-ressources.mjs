// Télécharge depuis wakfu.wiki.gg les images en jeu des ressources récoltables
// (arbres, minerais, plantes, cultures, bancs) listées sur la page « Resources ».
// Usage : node scripts/wiki-ressources.mjs <dossier de sortie>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://wakfu.wiki.gg/api.php';
const UA = 'WakForge/1.0 (https://wakforge.github.io/; wakforge.contact@protonmail.com)';
const out = process.argv[2] || 'ressources-wiki';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function api(params) {
  const url = API + '?' + new URLSearchParams({ format: 'json', formatversion: '2', ...params });
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (r.ok) return r.json();
    await sleep(2000 * (i + 1));
  }
  throw new Error('API ' + url);
}

const norm = s => s.replace(/_/g, ' ').toLowerCase();

await mkdir(out, { recursive: true });
const pages = new Set();
// 1) Pages liées depuis « Resources » et ses modèles de navigation.
const res = (await api({ action: 'parse', page: 'Resources', prop: 'links|templates|categories' })).parse;
const links = l => l.filter(x => x.ns === 0 && x.exists !== false).forEach(x => pages.add(x.title));
links(res.links || []);
for (const t of (res.templates || []).filter(t => t.ns === 10)) {
  const tp = (await api({ action: 'parse', page: t.title, prop: 'links' })).parse;
  links(tp?.links || []);
}
// 2) Catégories des ressources.
for (const cat of ['Trees', 'Ores', 'Crops', 'Wild plants', 'Wild Plants', 'Shoals', 'Resources', 'Harvestable resources']) {
  let cont = {};
  do {
    const r = await api({ action: 'query', list: 'categorymembers', cmtitle: 'Category:' + cat, cmlimit: '500', cmnamespace: '0', ...cont });
    (r.query?.categorymembers || []).forEach(m => pages.add(m.title));
    cont = r.continue || null;
  } while (cont);
}
console.log(pages.size, 'pages candidates ; modèles :', (res.templates || []).map(t => t.title).join(', '));
const rows = [['page', 'nom_fr', 'fichier', 'url']];
let n = 0;
for (const page of pages) {
  const p = (await api({ action: 'parse', page, prop: 'images|langlinks|categories' })).parse;
  if (!p) continue;
  const cats = (p.categories || []).map(c => c.category.toLowerCase().replace(/_/g, ' ')).join(' ');
  if (!/crop|shoal|plant|tree|\bores?\b|resource/.test(cats)) continue;
  const fr = (p.langlinks || []).find(l => l.lang === 'fr')?.title || '';
  // Images de la ressource elle-même : leur nom commence par le titre de la page (ex. Api_Tree_Juvenile.png).
  const imgs = (p.images || []).filter(f => norm(f).startsWith(norm(page)) && /\.(png|jpe?g|gif|webp)$/i.test(f));
  if (!imgs.length) continue;
  const info = await api({ action: 'query', prop: 'imageinfo', iiprop: 'url', titles: imgs.map(f => 'File:' + f).join('|') });
  const dir = join(out, page.replace(/[\\/:*?"<>|]/g, '_'));
  await mkdir(dir, { recursive: true });
  for (const pg of info.query.pages) {
    const url = pg.imageinfo?.[0]?.url;
    if (!url) continue;
    const file = pg.title.replace(/^File:/, '').replace(/ /g, '_');
    const r = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!r.ok) { console.warn('échec', url); continue; }
    await writeFile(join(dir, file), Buffer.from(await r.arrayBuffer()));
    rows.push([page, fr, file, url]);
    n++;
  }
  console.log(page, '→', imgs.length);
  await sleep(300);
}
const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n');
await writeFile(join(out, 'index.csv'), '﻿' + csv);
console.log(n, 'images téléchargées');
