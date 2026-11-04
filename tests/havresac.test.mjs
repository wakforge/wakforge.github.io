// Havre-sac : lecture de captures du « Coffre de compte ». Lancer : npm test
// fixtures/coffre-*.png : vraies captures (1920×1041, recadrées) de deux onglets du coffre, inventaire compris.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { decodePNG } from '../scripts/lib/png.mjs';
import { findGrid, readCoffre, parseIcons, encodeIcons, totals, ICON_N, cellsToCases, ongletItems, havresacTotals } from '../web/js/havresac.js';

const icons = parseIcons(readFileSync(new URL('../web/data/icones_ressources.bin', import.meta.url)));
const res = JSON.parse(readFileSync(new URL('../web/data/data_ressource.json', import.meta.url))).ressources;
const byId = new Map(res.map(r => [r.id, r]));
const shot = f => decodePNG(readFileSync(new URL(`fixtures/${f}`, import.meta.url)));
const qtyRows = cells => Array.from({ length: 10 }, (_, r) => cells.filter(c => c.row === r).map(c => c.qty));

test('coffre : la grille de 10 colonnes est trouvée, pas celle de l\'inventaire à côté', () => {
  assert.deepEqual(findGrid(shot('coffre-81-156.png')), { x: 422, y: 108, pitch: 63, cols: 10, rows: 10 });
});

test('coffre : quantités de toutes les cases (milliers, « 0 », case sans nombre = 1)', () => {
  const { cells } = readCoffre(shot('coffre-81-156.png'), icons, res);
  assert.deepEqual(qtyRows(cells), [
    [575, 13, 1, 1035, 11, 25, 1301, 75, 26, 39],
    [916, 39, 2, 1354, 36, 24, 1194, 39, 4, 44],
    [36, 0, 3, 79, 10, 7, 357, 15, 6, 44],
    [456, 55, 32, 905, 47, 25, 470, 33, 8, 90],
    [293, 16, 14, 942, 33, 22, 471, 17, 1, 3],
    [0, 7, 7, 1917, 100, 39, 379, 7, 5, 13],
    [43, 41, 21, 609, 29, 10, 1439, 51, 6],
    [100, 8, 15, 2893, 145, 68, 40, 13, 3],
    [55, 3, 17, 2302, 87, 13, 0, 0, 13],
    [462, 19, 18, 388, 18, 7, 39, 3, 0],
  ]);
});

test('coffre : second onglet (capture différente des modèles de chiffres)', () => {
  const { cells } = readCoffre(shot('coffre-12-81.png'), icons, res);
  assert.deepEqual(qtyRows(cells), [
    [3470, 111, 100, 1013, 122, 73, 60, 3, 3],
    [3112, 137, 120, 983, 41, 57, 0, 8, 5],
    [4146, 368, 162, 31, 53, 26, 106, 9, 5],
    [617, 30, 2, 7024, 556, 268, 44, 3, 2],
    [1235, 52, 62, 1197, 57, 25, 252, 23, 1],
    [2522, 89, 93, 1531, 96, 83, 961, 56, 9],
    [871, 90, 52, 1064, 21, 32, 228, 11, 0],
    [634, 53, 68, 878, 28, 27, 99, 5, 2],
    [768, 115, 42, 165, 11, 8, 356, 23, 0],
    [3414, 145, 116, 637, 10, 2, 361, 26, 10],
  ]);
  // toutes les cases sont reconnues, y compris celles à 0 (icône grisée)
  assert.ok(cells.every(c => c.id));
  const name = (r, c) => byId.get(cells.find(x => x.row === r && x.col === c).id)?.nom;
  assert.deepEqual([name(1, 6), name(6, 8), name(8, 8)], ['Bec de Truche', 'Prisme Ectoplasme', 'Violine']);
  const names = cells.filter(c => c.row === 0).map(c => byId.get(c.id)?.nom);
  assert.deepEqual(names, ['Peau de Bouftou', 'Corne de Bouftou', 'Laine Royale', 'Chair de Mort-brûlé', 'Crâne de Mort-brûlé',
    'Ossements d\'Hark Saniss', 'Bec de Corbac', 'Serre de Corbac', 'Etoile Bleue']);
});

test('coffre : icônes reconnues et rareté du cadre (même icône, deux raretés)', () => {
  const { cells } = readCoffre(shot('coffre-81-156.png'), icons, res);
  assert.ok(cells.every(c => c.id));
  const at = (r, c) => byId.get(cells.find(x => x.row === r && x.col === c).id);
  assert.equal(at(0, 0).nom, 'Terre de Slek');
  assert.equal(at(0, 4).nom, 'Cuir Taroudé');
  assert.equal(at(4, 0).nom, 'Cuir de Glagla');
  assert.equal(at(0, 2).rarete, 3); // cadre orange : mythique
  // cases à 0 (icône grisée)
  assert.equal(at(8, 6).nom, 'Fouwwuwe Infectée');
  assert.equal(at(5, 0).nom, 'Poils-plume des Neiges');
  const t = totals(cells);
  assert.equal(t[cells[0].id], 575);
});

test('coffre : mêmes totaux que le jeu (« Nombre d\'objets uniques » et « Nombre total d\'objets »)', () => {
  for (const [f, uniques, total] of [['coffre-81-156.png', 96, 22695], ['coffre-12-81.png', 90, 41586]]) {
    const { cells } = readCoffre(shot(f), icons, res);
    assert.equal(cells.length, uniques, f);
    assert.equal(cells.reduce((s, c) => s + c.qty, 0), total, f);
  }
});

test('onglet : cases à la même place que dans le jeu, total de plusieurs onglets', () => {
  const { cells } = readCoffre(shot('coffre-12-81.png'), icons, res);
  const cases = cellsToCases(cells);
  assert.equal(cases.length, 100);
  assert.equal(cases[9], null);            // 10e colonne vide dans le jeu
  const r1 = cells.find(c => c.row === 1 && c.col === 0);  // 2e ligne : case 10, pas 9
  assert.deepEqual(cases[10], [r1.id, 3112]);
  assert.deepEqual(cases[0], [cells[0].id, 3470]);
  const items = ongletItems({ cases });
  assert.equal(Object.values(items).reduce((a, b) => a + b, 0), 41586);
  const tot = havresacTotals({ onglets: [{ cases }, { cases: [[cells[0].id, 30], null] }] });
  assert.equal(tot[cells[0].id], 3500);
});

test('icônes : encodage puis lecture du fichier', () => {
  const raw = new Uint8Array(ICON_N * ICON_N * 4).fill(200);
  const back = parseIcons(encodeIcons([42, 7], [raw, raw]));
  assert.deepEqual(back.gfx, [42, 7]);
  assert.equal(back.n, 2);
  assert.ok(Math.abs(back.a[0] - 200 / 255) < 1e-6);
});
