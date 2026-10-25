// Test du site dans un vrai navigateur (Chromium via Playwright), en français et en anglais.
// Usage : node scripts/smoke.mjs [url]   (le site doit être servi, ex. npm run serve)
// Vérifie : aucune erreur JavaScript, import d'un lien de liste, liste de courses, overlay (choix de liste,
// onglet Fabrication), alerte des plans, badge et filtre PvP, fenêtre d'import d'un build et, en anglais, qu'aucun texte de l'interface ne reste sans traduction.
import { chromium } from 'playwright';
import { existsSync, readFileSync } from 'node:fs';
import { encodeShare } from '../web/js/craftcore.js';

const base = (process.argv[2] || 'http://127.0.0.1:8080/').replace(/\/?$/, '/');
const items = JSON.parse(readFileSync(new URL('../web/data/data_item.json', import.meta.url))).items;
const craftable = items.filter(i => i.recettes?.length).slice(0, 2);
const link = encodeShare('Test auto', craftable.map(i => ({ id: i.id, qte: 2 })));

const exe = process.env.CHROMIUM_PATH || (existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);
const browser = await chromium.launch(exe ? { executablePath: exe } : {});
const failures = [];
const check = (ok, msg) => { console.log(`${ok ? '✓' : '✗'} ${msg}`); if (!ok) failures.push(msg); };

async function run(lang) {
  const ctx = await browser.newContext({ locale: lang === 'en' ? 'en-GB' : 'fr-FR' });
  // L'overlay s'ouvre dans la page (pas de fenêtre Picture-in-Picture en test).
  await ctx.addInitScript(() => { delete window.documentPictureInPicture; });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.goto(`${base}?lang=${lang}#liste=${link}`);
  await page.waitForSelector('#craftBase tr', { timeout: 15000 }).catch(() => {});
  const rows = await page.locator('#craftBase tr').count();
  check(rows > 0, `[${lang}] lien de liste importé, ${rows} lignes de courses`);

  // Une deuxième liste, pour le choix de la liste dans l'overlay.
  await page.goto(`${base}?lang=${lang}#liste=${encodeShare('Test 2', [{ id: craftable[0].id, qte: 1 }])}`);
  await page.waitForSelector('#craftBase tr', { timeout: 15000 }).catch(() => {});
  await page.click('#craftOverlay');
  const select = page.locator('#overlay [data-ovl-list]');
  await select.waitFor({ timeout: 5000 }).catch(() => {});
  const options = await select.locator('option').count();
  check(options >= 2, `[${lang}] overlay : choix entre ${options} listes`);
  if (options >= 2) {
    const other = await select.locator('option:not(:checked)').last().getAttribute('value');
    await select.selectOption(other);
    check(await page.locator('#overlay [data-ovl-list]').inputValue() === other, `[${lang}] overlay : changement de liste`);
  }
  const fab = page.locator('#overlay [data-ovl-view="fab"]');
  if (await fab.count()) {
    await fab.click();
    check(await page.locator('#overlay .ovl-list li').count() > 0, `[${lang}] overlay : étapes de fabrication`);
  } else check(false, `[${lang}] overlay : onglet Fabrication absent`);

  // Plans : un objet qui demande un plan est signalé ; le cocher dans l'onglet Plans enlève l'alerte.
  // (autre adresse : la page se recharge, ce qui ferme l'overlay)
  await page.goto(`${base}?lang=${lang}&plan=1#liste=${encodeShare('Test plan', [{ id: 19890, qte: 1 }])}`); // Kokordon
  await page.waitForSelector('#craftSteps li[data-id="19890"] .plan-tag', { timeout: 15000 }).catch(() => {});
  check(await page.locator('#craftSteps .plan-tag.miss').count() > 0, `[${lang}] plans : alerte « plan requis »`);
  await page.click('#craftSummary [data-goto-plans]').catch(() => {});
  await page.waitForSelector('#planList .plan-row', { timeout: 5000 }).catch(() => {});
  const tick = page.locator('#planList .plan-row input[data-plan-own]').first();
  check(await tick.count() > 0, `[${lang}] plans : onglet Plans filtré sur la liste`);
  if (await tick.count()) {
    await tick.check();
    await page.click('[data-view="craft"]');
    await page.waitForSelector('#craftSteps .plan-tag.ok', { timeout: 5000 }).catch(() => {});
    check(await page.locator('#craftSteps .plan-tag.ok').count() > 0, `[${lang}] plans : plan coché = plus d'alerte`);
  }

  // PvP : badge dans la recherche, et option pour masquer ces objets.
  await page.click('[data-view="craft"]').catch(() => {});
  await page.fill('#craftSearch', lang === 'en' ? 'watchmin' : 'bienveillante');
  await page.waitForSelector('#craftSuggest li', { timeout: 5000 }).catch(() => {});
  check(await page.locator('#craftSuggest .pvp-tag').count() > 0, `[${lang}] PvP : badge dans la recherche`);
  await page.check('#craftHidePvp');
  await page.focus('#craftSearch');
  await page.fill('#craftSearch', lang === 'en' ? 'watchmi' : 'bienveillant');
  await page.waitForSelector('#craftSuggest li.s-note', { timeout: 5000 }).catch(() => {});
  check(await page.locator('#craftSuggest .pvp-tag').count() === 0 && await page.locator('#craftSuggest li.s-note').count() === 1,
    `[${lang}] PvP : objets masqués de la recherche`);
  await page.uncheck('#craftHidePvp');
  // badge aussi dans les ressources à réunir (La Bienveillante légendaire : Médaille de Bravoure, Galon déchiré)
  await page.goto(`${base}?lang=${lang}&pvp=1#liste=${encodeShare('Test PvP', [{ id: 24674, qte: 1 }])}`);
  await page.waitForSelector('#craftBase .pvp-tag', { timeout: 15000 }).catch(() => {});
  check(await page.locator('#craftBase .pvp-tag').count() >= 2, `[${lang}] PvP : badge dans les ressources à réunir`);
  await page.fill('#craftSearch', '');

  // Import d'un build : la fenêtre s'ouvre (la lecture de l'image est testée dans tests/buildimport.test.mjs).
  await page.click('#craftImport');
  await page.waitForSelector('#buildDlg[open] [data-b-drop]', { timeout: 5000 }).catch(() => {});
  check(await page.locator('#buildDlg[open] [data-b-drop]').count() === 1, `[${lang}] import d'un build : fenêtre ouverte`);
  await page.keyboard.press('Escape');

  if (lang === 'en') {
    for (const v of ['timers', 'monsters', 'plans', 'settings']) await page.click(`[data-view="${v}"]`).catch(() => {});
    const missing = await page.evaluate(() => import('./js/i18n.js').then(m => m.missingKeys()));
    check(!missing.length, `[en] textes traduits${missing.length ? ` (manquants : ${missing.slice(0, 5).join(' | ')})` : ''}`);
  }
  check(!errors.length, `[${lang}] aucune erreur JavaScript${errors.length ? ` : ${errors.join(' | ')}` : ''}`);
  await ctx.close();
}

try {
  await run('fr');
  await run('en');
} finally {
  await browser.close();
}
if (failures.length) { console.error(`\n${failures.length} vérification(s) en échec.`); process.exit(1); }
console.log('\nSite OK.');
