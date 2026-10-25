// Tests des calculs de craft (liste de courses et coûts). Lancer : npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex, computeList, costIndex, searchItems, mainRecipe, missingPlans, encodeShare, decodeShare, parseOwned } from '../web/js/craftcore.js';

// Mini jeu de données : A = 2 B + 1 C (produit 1) ; B = 3 C (produit 2) ; C et D sont des ressources.
const item = (id, nom, recettes) => ({ id, nom, nom_en: '', niveau: 1, rarete: 0, type: 'Test', ...(recettes ? { recettes } : {}) });
const recipe = (ingredients, quantite = 1, extra = {}) => ({ metier: 'Tailleur', niveau: 10, quantite, ingredients, ...extra });
const mini = () => buildIndex({ items: [
  item(1, 'Objet A', [recipe([[2, 2], [3, 1]])]),
  item(2, 'Composant B', [recipe([[3, 3]], 2)]),
  item(5, 'Objet E', [recipe([[4, 1]], 1, { amelioration: true }), recipe([[3, 5]])]),
] }, { ressources: [item(3, 'Ressource C'), item(4, 'Ressource D')] }, { monstres: [] });

const byId = list => Object.fromEntries(list.map(x => [x.id, x]));

test('liste de courses : ingrédients et recettes intermédiaires', () => {
  const res = computeList(mini(), [{ id: 1, qte: 3 }]);
  const crafts = byId(res.crafts), base = byId(res.base);
  assert.equal(crafts[1].runs, 3);
  assert.equal(crafts[2].need, 6);
  assert.equal(crafts[2].runs, 3, 'B est produit par 2 : 6 B = 3 fabrications');
  assert.equal(base[3].need, 3 + 3 * 3, '3 C pour A + 9 C pour B');
  assert.deepEqual(res.jobs, { Tailleur: 10 });
  assert.equal(res.crafts.at(-1).id, 1, 'l\'objet final est fabriqué en dernier');
});

test('liste de courses : stock déjà possédé', () => {
  const res = computeList(mini(), [{ id: 1, qte: 3 }], { stock: { 2: 4, 3: 5 } });
  const crafts = byId(res.crafts), base = byId(res.base);
  assert.equal(crafts[2].runs, 1, '6 B - 4 en stock = 2 B = 1 fabrication');
  assert.equal(base[3].need, 3 + 3);
  assert.equal(base[3].missing, 1);
});

test('liste de courses : composant acheté au lieu d\'être fabriqué', () => {
  const res = computeList(mini(), [{ id: 1, qte: 1 }], { buy: { 2: true } });
  const base = byId(res.base);
  assert.equal(base[2].need, 2);
  assert.equal(base[3].need, 1);
  assert.ok(!res.crafts.some(x => x.id === 2));
});

test('recette par défaut : pas une amélioration', () => {
  const idx = mini();
  assert.deepEqual(mainRecipe(idx.byId.get(5)).ingredients, [[3, 5]]);
});

test('coût de revient : fabriquer ou acheter', () => {
  const idx = mini();
  const cost = costIndex(idx, { 3: 10, 2: 50 });
  assert.equal(cost(3).best, 10);
  assert.deepEqual(cost(2), { buy: 50, craft: 15, best: 15 }, 'B : 3 C / 2 = 15 kamas, moins cher que 50');
  assert.equal(cost(1).craft, 2 * 15 + 10);
  assert.equal(costIndex(idx, {})(1).best, null, 'sans prix, coût inconnu');
});

test('données réelles : chaque recette pointe vers des objets connus', () => {
  const read = f => JSON.parse(readFileSync(new URL(`../web/data/${f}`, import.meta.url), 'utf8'));
  const idx = buildIndex(read('data_item.json'), read('data_ressource.json'), read('data_bestiaire.json'));
  const missing = [];
  for (const o of idx.craftables) {
    for (const [id] of mainRecipe(o).ingredients) if (!idx.byId.has(id)) missing.push(`${o.nom} → ${id}`);
  }
  assert.ok(missing.length < idx.craftables.length * 0.01, `ingrédients inconnus : ${missing.slice(0, 5).join(', ')}`);
  const res = computeList(idx, [{ id: 2023, qte: 1 }]); // Boufbottes
  assert.ok(res.base.length > 0 && res.crafts.some(x => x.id === 2023));
});

test('plans : reliés à l\'objet du même nom, Souvenir à part', () => {
  const plan = (id, nom) => ({ ...item(id, nom), type: 'Recette' });
  const sv = (id, nom) => ({ ...item(id, nom, [recipe([[3, 1]])]), rarete: 6 });
  const idx = buildIndex({ items: [
    item(1, 'Objet A', [recipe([[2, 2], [3, 1]])]),
    item(2, 'Composant B', [recipe([[3, 3]], 2)]),
    sv(6, 'Objet A'),
    plan(10, 'Plan "Objet A"'), plan(11, 'Plan "Objet A" (Souvenir)'), plan(12, 'Plan "Introuvable"'),
  ] }, { ressources: [item(3, 'Ressource C')] }, { monstres: [] });
  assert.equal(idx.planOf.get(1), 10);
  assert.equal(idx.planOf.get(6), 11, 'l\'objet Souvenir demande le plan Souvenir');
  assert.equal(idx.planOf.get(2), undefined);
  assert.deepEqual(idx.plans.map(p => p.id), [10, 11], 'un plan sans objet est ignoré');
  const res = computeList(idx, [{ id: 1, qte: 1 }]);
  assert.deepEqual(missingPlans(idx, res.crafts), [{ id: 10, items: [1] }]);
  assert.deepEqual(missingPlans(idx, res.crafts, { 10: true }), [], 'plan déjà possédé');
  assert.deepEqual(missingPlans(idx, computeList(idx, [{ id: 1, qte: 1 }], { stock: { 1: 1 } }).crafts), [], 'objet déjà fabriqué');
});

test('données réelles : les plans du jeu sont presque tous reliés', () => {
  const read = f => JSON.parse(readFileSync(new URL(`../web/data/${f}`, import.meta.url), 'utf8'));
  const dItem = read('data_item.json');
  const idx = buildIndex(dItem, read('data_ressource.json'), read('data_bestiaire.json'));
  const total = dItem.items.filter(o => o.type === 'Recette').length;
  assert.ok(idx.plans.length >= total * 0.9, `${idx.plans.length} plans reliés sur ${total}`);
  assert.ok(idx.planOf.has(19890), 'Kokordon demande son plan');
});

test('lien de partage : aller-retour et liens invalides', () => {
  const code = encodeShare('Panoplie « été »', [{ id: 23852, qte: 1 }, { id: 12894, qte: 2 }]);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeShare(`https://wakforge.github.io/#liste=${code}`);
  assert.deepEqual(back, { nom: 'Panoplie « été »', cibles: [{ id: 23852, qte: 1 }, { id: 12894, qte: 2 }] });
  assert.deepEqual(decodeShare(code), back, 'le code seul suffit');
  assert.equal(decodeShare('https://wakforge.github.io/'), null);
  assert.equal(decodeShare('#liste=pas-du-json-du-tout'), null);
});

test('recherche : option pour masquer les objets PvP', () => {
  const idx = buildIndex({ items: [{ ...item(1, 'La Bienveillante'), pvp: true }, item(2, 'La Bienveillante du Bouftou')] });
  assert.deepEqual(searchItems(idx, 'bienveillante').map(o => o.id), [1, 2]);
  assert.deepEqual(searchItems(idx, 'bienveillante', { hidePvp: true }).map(o => o.id), [2]);
});

test('données réelles : objets PvP repérés', () => {
  const read = f => JSON.parse(readFileSync(new URL(`../web/data/${f}`, import.meta.url), 'utf8'));
  const items = read('data_item.json').items;
  const pvp = items.filter(o => o.pvp);
  assert.ok(pvp.length > 250, `${pvp.length} objets PvP`);
  assert.ok(pvp.some(o => o.nom === 'La Bienveillante'));
  assert.ok(!items.find(o => o.id === 2021).pvp); // Amulette du Bouftou
});

test('bandeau « Possédés » de l\'infobulle : sur moi, équipé, coffre, pacte', () => {
  const ok = { moi: 458, equipe: 0, coffre: 117, pacte: 0, total: 575 };
  assert.deepEqual(parseOwned(['Possédés : 458 0 117 0', 'Commun', 'Croquette Maléfique']), ok);
  assert.deepEqual(parseOwned(['Possédés : 458 @ 0 Ö 117 B 0 €', 'Commun']), ok, 'icônes lues comme des signes');
  assert.deepEqual(parseOwned(['Possedes : 458', '0', '117 0', 'Commun']), ok, 'rangée coupée en plusieurs lignes');
  assert.deepEqual(parseOwned(['Possédés : 1 234 0 117 O']), { moi: 1234, equipe: 0, coffre: 117, pacte: 0, total: 1351 });
  assert.equal(parseOwned(['Commun', 'Croquette Maléfique']), null);
  assert.equal(parseOwned(['Possédés : 458 0 117']), null, 'incomplet : on ne devine pas');
});
