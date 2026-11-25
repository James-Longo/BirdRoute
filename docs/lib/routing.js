// The only file that knows the routing and geocoding providers.
import { getJson } from './http.js';

const OSRM = 'https://router.project-osrm.org';
const NOMINATIM = 'https://nominatim.openstreetmap.org/search';
const fmt = (p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/** Address or "lat, lon" to a place. */
export async function geocode(q, signal) {
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) return { label: q.trim(), point: [Number(m[2]), Number(m[1])] };
  const u = new URL(NOMINATIM);
  u.search = new URLSearchParams({ q, format: 'jsonv2', limit: '1' });
  const [hit] = await getJson(u, { gapMs: 1100, signal });
  if (!hit) throw new Error(`Could not find "${q}". Try adding a town or state.`);
  return { label: hit.display_name, point: [Number(hit.lon), Number(hit.lat)] };
}

export async function route(from, to, signal) {
  const u = `${OSRM}/route/v1/driving/${fmt(from)};${fmt(to)}?overview=full&geometries=geojson`;
  let d;
  try { d = await getJson(u, { gapMs: 1100, signal }); } catch (e) {
    if (e.status !== 400) throw e;
    d = {};
  }
  const r = d.routes?.[0];
  if (!r) throw new Error('No driving route between those places.');
  return { line: r.geometry.coordinates, km: r.distance / 1000, min: r.duration / 60 };
}

/**
 * Extra minutes for each stop, against driving the same stretch without it. Each stop
 * is { before, after, point }, where before and after are { point, bearing } on the
 * route. Bearings keep a motorway point on the carriageway being driven.
 */
export async function detours(stops, signal) {
  const out = [];
  for (let i = 0; i < stops.length; i += 30) {
    out.push(...await batch(stops.slice(i, i + 30), signal));
  }
  return out;
}

async function batch(stops, signal) {
  const n = stops.length;
  const coords = [...stops.map((s) => s.before.point), ...stops.map((s) => s.point), ...stops.map((s) => s.after.point)];
  const dirs = [...stops.map((s) => s.before.bearing), ...stops.map(() => null), ...stops.map((s) => s.after.bearing)];
  const range = (a, b) => Array.from({ length: b - a }, (_, i) => a + i).join(';');
  const base = `${OSRM}/table/v1/driving/${coords.map(fmt).join(';')}` +
    `?sources=${range(0, 2 * n)}&destinations=${range(n, 3 * n)}`;
  const withDirs = `${base}&bearings=${dirs.map((d) => (d === null ? '' : `${d},60`)).join(';')}`;
  const opts = { gapMs: 1100, signal };
  let t;
  try { t = await getJson(withDirs, opts); } catch (e) {
    if (e.status !== 400) throw e;
    t = await getJson(base, opts); // no road matched a bearing
  }
  return stops.map((_, i) => {
    const toStop = t.durations[i][i];            // before -> stop
    const fromStop = t.durations[n + i][n + i];  // stop -> after
    const direct = t.durations[i][n + i];        // before -> after
    if (toStop === null || fromStop === null || direct === null) return null;
    return Math.max(0, (toStop + fromStop - direct) / 60);
  });
}
