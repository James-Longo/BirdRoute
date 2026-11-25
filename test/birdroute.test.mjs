import test from 'node:test';
import assert from 'node:assert/strict';
import { distKm, measure, locate, sample, pointAt } from '../docs/lib/geo.js';
import { parseCsv, readLifeList } from '../docs/lib/lifelist.js';
import { plan } from '../docs/lib/plan.js';

const tax = [
  { sciName: 'Nannus hiemalis', comName: 'Winter Wren', speciesCode: 'winwre3', category: 'species' },
  { sciName: 'Melospiza melodia', comName: 'Song Sparrow', speciesCode: 'sonspa', category: 'species' },
  { sciName: 'Melospiza melodia melodia', comName: 'Song Sparrow (Eastern)', speciesCode: 'sonspa1', category: 'issf', reportAs: 'sonspa' },
  { sciName: 'Anas sp.', comName: 'duck sp.', speciesCode: 'ducksp', category: 'spuh' },
  { sciName: 'Alle alle', comName: 'Dovekie', speciesCode: 'doveki', category: 'species' },
  { sciName: 'Bubo scandiacus', comName: 'Snowy Owl', speciesCode: 'snoowl1', category: 'species' },
];

test('geometry', () => {
  const line = [[-70, 44], [-69, 44], [-68, 44]];
  const cum = measure(line);
  assert.ok(Math.abs(cum.at(-1) - distKm(line[0], line[2])) < 0.5);
  const near = locate(line, cum, [-69, 44.1]);
  assert.ok(Math.abs(near.dist - 11.1) < 0.2);
  assert.ok(Math.abs(near.km - cum[1]) < 0.5);
  assert.ok(sample(line, cum, 20).length >= cum.at(-1) / 20);
  assert.equal(pointAt(line, cum, 10).bearing, 90);
});

test('life list follows renames and rolls up groups, and ignores spuhs', () => {
  const csv = '\uFEFFScientific Name,Common Name,Date,Location\r\n' +
    'Troglodytes hiemalis,Winter Wren,2020-01-01,"Bog, ""north"""\r\n' +
    'Melospiza melodia melodia/atlantica,Song Sparrow (melodia/atlantica),2021-01-01,x\r\n' +
    'Anas sp.,duck sp.,2022-01-01,x\r\n';
  assert.equal(parseCsv(csv)[1][3], 'Bog, "north"');
  const l = readLifeList(csv, tax);
  assert.deepEqual([...l.codes].sort(), ['sonspa', 'winwre3']);
  assert.deepEqual(l.unmatched, []);
  assert.equal(new Date(l.latest).getFullYear(), 2022);
});

test('eBird life-list CSV: only countable rows count, and its dates are read', () => {
  const head = 'Row #,Taxon Order,Category,Common Name,Scientific Name,Count,Location,S/P,Date,LocID,SubID,Exotic,Countable';
  const l = readLifeList(`${head}\n1,1,species,Dovekie,Alle alle,2,X,US-ME,20 Nov 2026,L1,S1,,1\n,2,species,Snowy Owl,Bubo scandiacus,1,X,US-ME,21 Nov 2026,L1,S1,X,0\n`, tax);
  assert.deepEqual([...l.codes], ['doveki']);
  assert.equal(new Date(l.latest).getDate(), 20);
});

test('a wrong file is refused in plain words, and unknown species are reported', () => {
  assert.throws(() => readLifeList('a,b\n1,2\n', tax), /species name column/);
  assert.throws(() => readLifeList('Scientific Name,Common Name\nAnas sp.,duck sp.\n', tax), /No countable/);
  const l = readLifeList('Scientific Name,Common Name\nAlle alle,Dovekie\nGone bird,Lost Bird\n', tax);
  assert.deepEqual(l.unmatched, ['Lost Bird (Gone bird)']);
});

const line = [[-70, 44], [-69, 44]];
const obs = (o) => ({ locId: 'L1', locName: 'Point', lat: 44.02, lng: -69.5, obsDt: '2026-11-24 08:00', howMany: 1, obsValid: true, locationPrivate: false, subId: 'S1', ...o });
const run = (near, perSpecies, over = {}) => plan({
  from: line[0], to: line[1], widthKm: 10, back: 14, maxDetour: 30, personal: false, provisional: true,
  lifeCodes: new Set(['sonspa', 'winwre3']), taxonomy: tax, now: Date.parse('2026-11-25T12:00'), ...over,
}, {
  route: async () => ({ line, km: 80, min: 60 }),
  detours: async (s) => s.map((x) => (x.point[1] > 44.05 ? 45 : 8)),
  recentNear: async () => near,
  recentSpeciesNear: async (p, d, code) => perSpecies[code] ?? [],
});

test('keeps only lifers, and adds the places a sweep does not name', async () => {
  const r = await run(
    [obs({ speciesCode: 'sonspa1' }), obs({ speciesCode: 'ducksp' }), obs({ speciesCode: 'doveki' })],
    { doveki: [obs({ speciesCode: 'doveki' }), obs({ speciesCode: 'doveki', locId: 'L2', lat: 44.01, lng: -69.7 })] });
  assert.deepEqual(r.lifers, ['Dovekie']);
  assert.deepEqual(r.stops.map((s) => s.locId).sort(), ['L1', 'L2']);
  assert.equal(r.stops[0].lifers.length, 1);
});

test('drops far, private, escaped and off-corridor sightings, and counts them', async () => {
  const r = await run([
    obs({ speciesCode: 'doveki', locId: 'far', lat: 44.06 }),
    obs({ speciesCode: 'snoowl1', locId: 'yard', locationPrivate: true }),
    obs({ speciesCode: 'snoowl1', locId: 'esc', exoticCategory: 'X' }),
    obs({ speciesCode: 'doveki', locId: 'off', lat: 44.5 }),
  ], {});
  assert.equal(r.stops.length, 0);
  assert.equal(r.funnel.tooFar, 1);
  assert.equal(r.funnel.locations, 1);
  assert.ok(r.funnel.personalSightingsDropped > 0);
  assert.ok(r.funnel.escapeesDropped > 0);
  const p = await run([obs({ speciesCode: 'snoowl1', locId: 'yard', locationPrivate: true })], {}, { personal: true });
  assert.equal(p.stops[0].personal, true);
});

test('a latest sighting outside the corridor does not hide nearer ones', async () => {
  const r = await run([obs({ speciesCode: 'doveki', locId: 'off', lat: 44.12 })],
    { doveki: [obs({ speciesCode: 'doveki', locId: 'off', lat: 44.12 }), obs({ speciesCode: 'doveki', locId: 'near' })] });
  assert.deepEqual(r.stops.map((s) => s.locId), ['near']);
});

test('a list with common names only is still read', () => {
  const l = readLifeList('Common Name,Date\nDovekie,2026-11-18\nSong Sparrow (Eastern),2026-11-19\nduck sp.,2026-11-19\n', tax);
  assert.deepEqual([...l.codes].sort(), ['doveki', 'sonspa']);
  assert.deepEqual(l.unmatched, []);
});
