// Import d'un build depuis l'image du récap Wakfuli. Lancer : npm test
// fixtures/recap-wakfuli-words.json : mots lus par Tesseract.js (français, mode « texte épars ») sur un vrai export du récap.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseRecapWords, matchBuild, pickVersion } from '../web/js/buildimport.js';
import { buildIndex } from '../web/js/craftcore.js';

const read = f => JSON.parse(readFileSync(new URL(f, import.meta.url)));
const data = f => read(`../web/data/${f}`);
const idx = buildIndex(data('data_item.json'), data('data_ressource.json'), data('data_bestiaire.json'));

test('récap Wakfuli : nom et niveau de chaque équipement, sans les autres colonnes', () => {
  const { title, items } = parseRecapWords(read('fixtures/recap-wakfuli-words.json'));
  assert.equal(title, 'Cra 125');
  assert.deepEqual(items.map(x => `${x.name} ${x.level}`), [
    'Coiffe du Chasseur du Froid 125', 'Amulette Flaqueuse 125', 'Plastron Kroa 125', 'Bagus Shushu 125', 'Gelano 65',
    'Bottes Smare Impérial 125', 'Cape de l\'Initié 125', 'Epaulettes du Businessmare 125', 'Ceinturoflake Royale 125',
    'Bouclier du comte Harebourg 125', 'Javaleau 125', 'Emblème de Léviathon 125', 'Porte-bonheur Smare épanoui 125',
  ]);
});

test('récap Wakfuli : « Niv. » et le niveau lus comme deux mots', () => {
  const w = (text, x0, y0, x1) => ({ text, bbox: { x0, y0, x1, y1: y0 + 14 } });
  const { items } = parseRecapWords([w('Javaleau', 450, 100, 520), w('20', 700, 100, 716), w('Niv.', 450, 120, 475), w('125', 479, 120, 500)]);
  assert.deepEqual(items, [{ name: 'Javaleau', level: 125 }]);
});

test('build : objets retrouvés, version au niveau du build et fabricable', () => {
  const { items } = parseRecapWords(read('fixtures/recap-wakfuli-words.json'));
  const { found, unknown } = matchBuild(idx, items);
  assert.deepEqual(unknown, []);
  assert.equal(found.length, 13);
  const pick = Object.fromEntries(found.map(f => [f.pick.nom, f.pick]));
  assert.equal(pick['Coiffe du Chasseur du Froid'].niveau, 125, 'la Légendaire niv. 125, pas la Mythique niv. 120');
  assert.ok(pick['Coiffe du Chasseur du Froid'].recettes?.length);
  assert.equal(pick['Gelano'].niveau, 65);
  // même niveau en Mythique et en Légendaire : la Légendaire fabricable
  assert.equal(pick['Bouclier du comte Harebourg'].rarete, 4);
  assert.equal(pick['Cape de l\'Initié'].rarete, 4);
});

test('build : noms lus avec une erreur ou un mot en trop', () => {
  const { found, unknown } = matchBuild(idx, [{ name: 'Epaulettes duBusinessmare', level: 125 }, { name: '@ Plastron Kroa', level: 125 }, { name: 'zzzz qqqq', level: 50 }]);
  assert.deepEqual(found.map(f => f.pick.nom), ['Epaulettes du Businessmare', 'Plastron Kroa']);
  assert.deepEqual(unknown, ['zzzz qqqq']);
});

test('build : choix de la version', () => {
  const v = (rarete, niveau, craft = true) => ({ rarete, niveau, ...(craft ? { recettes: [{}] } : {}) });
  assert.deepEqual(pickVersion([v(3, 120), v(4, 125)], 125), v(4, 125));
  assert.deepEqual(pickVersion([v(3, 125, false), v(4, 125)], 125), v(4, 125));
  assert.deepEqual(pickVersion([v(4, 125), v(6, 200)], 200), v(6, 200));
});
