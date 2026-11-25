import { getJson } from './http.js';

const BASE = 'https://api.ebird.org/v2';

/** eBird calls with the visitor's own key, sent only to eBird and only as a header. */
export function ebird(key) {
  async function get(path, params) {
    const u = new URL(BASE + path);
    u.search = new URLSearchParams(params);
    try {
      return await getJson(u, { headers: { 'X-eBirdApiToken': key }, gapMs: 130 });
    } catch (e) {
      if (e.status === 403) throw new Error('eBird did not accept that key. Check it and save it again.');
      throw e;
    }
  }
  const params = ([lon, lat], dist, o) => ({
    lat: lat.toFixed(2), lng: lon.toFixed(2), dist: Math.min(50, dist + 1), back: o.back, includeProvisional: o.provisional,
  });
  return {
    /** One row per species: its latest sighting near a point. */
    recentNear: (pt, dist, o) => get('/data/obs/geo/recent', params(pt, dist, o)),
    /** Recent sightings of one species near a point, across locations. */
    recentSpeciesNear: (pt, dist, code, o) => get(`/data/obs/geo/recent/${encodeURIComponent(code)}`, params(pt, dist, o)),
  };
}

let taxPromise = null;
/** Species names, fetched once a visit. Needs no key. */
export function taxonomy() {
  taxPromise ??= getJson(`${BASE}/ref/taxonomy/ebird?fmt=json&locale=en`, { keepMin: 600 })
    .then((all) => all.map(({ sciName, comName, speciesCode, category, reportAs }) => ({ sciName, comName, speciesCode, category, reportAs })))
    .catch((e) => { taxPromise = null; throw e; });
  return taxPromise;
}
