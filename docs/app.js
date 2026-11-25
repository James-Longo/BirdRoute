import { plan } from './lib/plan.js';
import { readLifeList } from './lib/lifelist.js';
import { ebird, taxonomy } from './lib/ebird.js';
import { geocode, route, detours } from './lib/routing.js';

const $ = (id) => document.getElementById(id);
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids); return n; };
const map = L.map('map').setView([44.5, -69.5], 7);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors · routes: <a href="https://project-osrm.org">OSRM</a> · <a href="https://www.openstreetmap.org/fixthemap">fix the map</a> · sightings: <a href="https://ebird.org">eBird</a>',
}).addTo(map);
const layer = L.featureGroup().addTo(map);
let bounds = null;
// The map's box changes with the window and the layout; keep Leaflet's idea of it true.
function fit() { if (bounds) map.fitBounds(bounds, { padding: [30, 30], animate: false }); }
new ResizeObserver(() => { map.invalidateSize({ animate: false }); fit(); }).observe($('map'));
let current = null;
let picked = new Set();
let markers = new Map();

const mins = (m) => (m < 60 ? `${Math.round(m)} min` : `${Math.floor(m / 60)} h ${Math.round(m % 60)} min`);
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const gPoint = (p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`;

let life = null;      // { codes: Set, latest }

// ---- eBird key: the visitor's own, kept in this browser.
const KEY = 'birdroute.key';
let key = '';
try { key = localStorage.getItem(KEY) ?? ''; } catch { /* storage unavailable: ask each visit */ }
function showKey() { $('key-form').hidden = !!key; $('key-full').hidden = !key; }
$('key-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const k = $('key').value.trim();
  if (!k) return;
  key = k;
  try { localStorage.setItem(KEY, key); } catch { /* works for this visit */ }
  $('key').value = '';
  say('');
  showKey();
});
$('key-clear').addEventListener('click', () => {
  key = '';
  try { localStorage.removeItem(KEY); } catch { /* nothing saved */ }
  showKey();
});

// ---- Life list: read, compared and kept in this browser only.
const STORE = 'birdroute.life';
const listSay = (text, error = false) => { $('list-msg').textContent = text; $('list-msg').classList.toggle('error', error); };
const month = (t) => new Date(t).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
function showList() {
  $('list-empty').hidden = !!life;
  $('list-full').hidden = !life;
  if (life) $('list-count').textContent = `${life.codes.size} species` + (life.latest ? `, latest ${month(life.latest)}` : '');
}
function loadSaved() {
  try {
    const s = JSON.parse(localStorage.getItem(STORE));
    if (s?.codes?.length) life = { codes: new Set(s.codes), latest: s.latest };
  } catch { /* storage unavailable or damaged: ask for the file again */ }
  showList();
}
$('csv').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  listSay('Reading your list…');
  try {
    const [text, tax] = await Promise.all([file.text(), taxonomy()]);
    const r = readLifeList(text, tax);
    life = { codes: r.codes, latest: r.latest };
    try { localStorage.setItem(STORE, JSON.stringify({ codes: [...r.codes], latest: r.latest })); } catch { /* works for this visit */ }
    showList();
    listSay([
      r.everySighting && 'This is the full eBird export, so species split since you made it can be wrong. Use “Download a fresh list” for accurate results.',
      r.unmatched.length && `Could not match: ${r.unmatched.join(', ')}. These will show as lifers.`,
    ].filter(Boolean).join(' '));
  } catch (err) {
    listSay(err.message, true);
  } finally {
    e.target.value = '';
  }
});
$('forget').addEventListener('click', () => {
  life = null;
  try { localStorage.removeItem(STORE); } catch { /* nothing saved */ }
  showList();
  listSay('');
});

function say(text, error = false) { $('message').textContent = text; $('message').classList.toggle('error', error); }

function step(text, done, total) {
  $('step').textContent = total ? `${text} (${done} of ${total})` : text;
  if (total) { $('bar').max = total; $('bar').value = done; } else $('bar').removeAttribute('value');
}

$('form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!life) { listSay('Add your life list first, so lifers can be told from the rest.', true); $('csv').focus(); return; }
  if (!key) { say('Add your eBird key first.', true); $('key').focus(); return; }
  const f = new FormData(e.target);
  $('go').disabled = true;
  $('results').hidden = true;
  say('');
  $('progress').hidden = false;
  try {
    step('Finding the places');
    const tax = await taxonomy();
    const from = await geocode(f.get('from').trim());
    const to = await geocode(f.get('to').trim());
    const r = await plan({
      from: from.point, to: to.point, lifeCodes: life.codes, taxonomy: tax,
      widthKm: Number(f.get('width')), back: Number(f.get('back')), maxDetour: Number(f.get('detour')),
      personal: f.has('personal'), provisional: f.has('provisional'),
    }, { route, detours, ...ebird(key) }, step);
    show({ ...r, from, to });
  } catch (err) {
    say(err.message, true);
  } finally {
    $('go').disabled = false;
    $('progress').hidden = true;
  }
});

function show(r) {
  current = r;
  picked = new Set();
  layer.clearLayers();
  markers = new Map();
  const line = L.polyline(r.route.line.map(([x, y]) => [y, x]), { color: '#1f6b4a', weight: 5, opacity: 0.8 }).addTo(layer);
  for (const s of r.stops) {
    const m = L.circleMarker([s.point[1], s.point[0]], { radius: Math.min(16, 6 + s.lifers.length * 1.5), weight: 2, color: '#fff', fillColor: '#c2410c', fillOpacity: 0.9 });
    m.bindTooltip(`${s.name}: ${plural(s.lifers.length, 'lifer')}, +${mins(s.detourMin)}`.replace(/[<>&]/g, ''));
    m.on('click', () => document.getElementById(`li-${s.locId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    m.addTo(layer);
    markers.set(s.locId, m);
  }
  bounds = line.getBounds();
  map.invalidateSize({ animate: false });
  fit();
  const f = r.funnel;
  say(r.stops.length
    ? `${plural(new Set(r.stops.flatMap((s) => s.lifers.map((l) => l.code))).size, 'lifer')} at ${plural(r.stops.length, 'stop')} on a ${Math.round(r.route.km)} km drive of ${mins(r.route.min)}.`
    : 'No lifers at stops within those settings. Try more days, a longer detour, or personal locations.');
  $('results').hidden = false;
  document.body.classList.add('has-results');
  const notes = [
    `${plural(f.lifersInCorridor, 'species')} not on your life list reported in the corridor, at ${plural(f.locations, 'location')}.`,
    f.tooFar && `${plural(f.tooFar, 'stop')} past your extra-driving limit.`,
    f.unreachable && `${plural(f.unreachable, 'stop')} with no road found.`,
    f.notTimed && `${plural(f.notTimed, 'lower-ranked location')} not timed.`,
    f.personalSightingsDropped && `${plural(f.personalSightingsDropped, 'sighting')} at personal locations.`,
    f.escapeesDropped && `${plural(f.escapeesDropped, 'sighting')} of escapees.`,
    f.lookupsSkipped && `${plural(f.lookupsSkipped, 'species lookup')} skipped to stay light on eBird, so some places may be missing.`,
  ].filter(Boolean);
  $('funnel').querySelector('ul').replaceChildren(...notes.map((t) => el('li', {}, t)));
  list();
}

function list() {
  const by = {
    score: (a, b) => b.score - a.score, lifers: (a, b) => b.lifers.length - a.lifers.length || a.detourMin - b.detourMin,
    detour: (a, b) => a.detourMin - b.detourMin, route: (a, b) => a.atKm - b.atKm,
  }[$('sort').value];
  $('stops').replaceChildren(...[...current.stops].sort(by).map((s) => {
    const box = el('input', { type: 'checkbox', id: `c-${s.locId}`, checked: picked.has(s.locId) });
    const li = el('li', { id: `li-${s.locId}`, className: picked.has(s.locId) ? 'on' : '' },
      el('div', { className: 'stop-head' }, box, el('label', { htmlFor: box.id }, s.name)),
      el('p', { className: 'muted' }, `${plural(s.lifers.length, 'lifer')} · +${mins(s.detourMin)} · ${Math.round(s.atKm)} km in${s.personal ? ' · personal location' : ''}`),
      el('ul', { className: 'lifers' }, ...s.lifers.map((l) => el('li', {},
        el('a', { href: `https://ebird.org/checklist/${encodeURIComponent(l.subId)}`, target: '_blank', rel: 'noopener' }, l.name),
        `${l.count ? ` (${l.count})` : ''}, ${l.days === 0 ? 'today' : `${plural(l.days, 'day')} ago`}`,
        ...(l.provisional ? [' ', el('span', { className: 'flag' }, 'unconfirmed')] : [])))),
      el('p', { className: 'links' },
        el('a', { href: `https://www.google.com/maps/search/?api=1&query=${gPoint(s.point)}`, target: '_blank', rel: 'noopener' }, 'Map'),
        ...(s.personal ? [] : [el('a', { href: `https://ebird.org/hotspot/${encodeURIComponent(s.locId)}`, target: '_blank', rel: 'noopener' }, 'eBird hotspot')])));
    box.addEventListener('change', () => {
      box.checked ? picked.add(s.locId) : picked.delete(s.locId);
      li.classList.toggle('on', box.checked);
      markers.get(s.locId).setStyle({ fillColor: box.checked ? '#1f6b4a' : '#c2410c' });
      link();
    });
    return li;
  }));
  link();
}

function link() {
  const chosen = current.stops.filter((s) => picked.has(s.locId)).sort((a, b) => a.atKm - b.atKm);
  const u = new URL('https://www.google.com/maps/dir/?api=1&travelmode=driving');
  u.searchParams.set('origin', gPoint(current.from.point));
  u.searchParams.set('destination', gPoint(current.to.point));
  if (chosen.length) u.searchParams.set('waypoints', chosen.slice(0, 9).map((s) => gPoint(s.point)).join('|'));
  $('gmaps').href = u.href;
  $('picked').textContent = chosen.length > 9 ? `Google Maps takes 9 stops; the first 9 of ${chosen.length} are in the link.`
    : chosen.length ? plural(chosen.length, 'stop') + ' chosen' : 'Tick stops to add them.';
}

$('sort').addEventListener('change', list);
loadSaved();
showKey();
