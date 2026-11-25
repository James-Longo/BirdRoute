import { measure, pointAt, sample, locate } from './geo.js';

const MAX_DIST = 50;          // eBird's search radius limit, km
const MAX_SWEEPS = 120;       // species sweeps along the route
const MAX_FOLLOWUPS = 250;    // per-species location lookups
const MAX_CANDIDATES = 90;    // stops that get a real detour time
const APPROACH_KM = 12;       // where a detour may leave and rejoin the route

async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

/** deps: { route, detours, recentNear, recentSpeciesNear }, replaceable in tests. */
export async function plan(opts, deps, onStep = () => {}) {
  const { from, to, widthKm, back, maxDetour, personal, provisional, lifeCodes, taxonomy, signal } = opts;
  const now = opts.now ?? Date.now();
  const species = new Map(taxonomy.filter((t) => t.category === 'species').map((t) => [t.speciesCode, t]));
  const toSpecies = new Map(taxonomy.map((t) => [t.speciesCode, t.category === 'species' ? t.speciesCode : t.reportAs]));
  const eb = { back, provisional, signal };

  onStep('Routing');
  const r = await deps.route(from, to, signal);
  const cum = measure(r.line);
  const total = cum.at(-1);

  // Circles must cover the whole corridor: half-width w, centres s apart.
  const spacing = Math.max(widthKm, total / MAX_SWEEPS);
  const radius = Math.ceil(Math.hypot(widthKm, spacing / 2));
  if (radius > MAX_DIST) throw new Error('That route is too long to search in one go. Split it into days.');

  // A lifer row: not on the life list, countable, inside the corridor.
  const seen = new Map();  // species -> Set of follow-up segment
  const sightings = new Map(); // `${locId}|${species}` -> row
  const segKm = Math.max(spacing, 2 * Math.sqrt(Math.max(1, MAX_DIST ** 2 - widthKm ** 2)) * 0.6);
  const segCount = Math.max(1, Math.ceil(total / segKm));
  const placeOf = new Map();
  const place = (o) => {
    const k = `${o.lat},${o.lng}`;
    if (!placeOf.has(k)) placeOf.set(k, locate(r.line, cum, [o.lng, o.lat]));
    return placeOf.get(k);
  };
  const inCorridor = new Set();
  const dropped = { personal: 0, escapee: 0 };
  function take(o) {
    const code = toSpecies.get(o.speciesCode);
    if (!code || !species.has(code) || lifeCodes.has(code)) return null;
    if (o.exoticCategory === 'X') { dropped.escapee++; return null; }
    const at = place(o);
    // Before the corridor check: a sweep reaches past the corridor and shows only the
    // latest sighting, so one just outside it can hide others inside.
    if (!seen.has(code)) seen.set(code, new Set());
    seen.get(code).add(Math.min(segCount - 1, Math.floor(at.km / (total / segCount) || 0)));
    if (at.dist > widthKm) return null;
    inCorridor.add(code);
    if (o.locationPrivate && !personal) { dropped.personal++; return code; }
    const key = `${o.locId}|${code}`;
    const old = sightings.get(key);
    if (!old || o.obsDt > old.obsDt) sightings.set(key, { ...o, code });
    return code;
  }

  const sweeps = sample(r.line, cum, spacing);
  let done = 0;
  await pool(sweeps, 4, async (s) => {
    for (const o of await deps.recentNear(s.point, radius, eb)) take(o);
    onStep('Searching eBird along the route', ++done, sweeps.length);
  });

  // A sweep names one place per species, so look up the rest of each lifer's places.
  const jobs = [];
  for (const [code, segs] of seen) for (const seg of segs) jobs.push({ code, seg });
  jobs.sort((a, b) => seen.get(a.code).size - seen.get(b.code).size);
  const skipped = Math.max(0, jobs.length - MAX_FOLLOWUPS);
  const run = jobs.slice(0, MAX_FOLLOWUPS);
  const segLen = total / segCount;
  const segDist = Math.min(MAX_DIST, Math.ceil(Math.hypot(widthKm, segLen / 2)));
  done = 0;
  await pool(run, 4, async ({ code, seg }) => {
    const { point } = pointAt(r.line, cum, (seg + 0.5) * segLen);
    for (const o of await deps.recentSpeciesNear(point, segDist, code, eb)) take({ ...o, speciesCode: code });
    onStep('Finding every place for each lifer', ++done, run.length);
  });

  const stops = new Map();
  for (const o of sightings.values()) {
    const at = place(o);
    if (!stops.has(o.locId)) {
      stops.set(o.locId, {
        locId: o.locId, name: o.locName, point: [o.lng, o.lat], personal: !!o.locationPrivate,
        offKm: at.dist, atKm: at.km, lifers: [],
      });
    }
    const days = Math.max(0, (now - Date.parse(o.obsDt.replace(' ', 'T'))) / 86_400_000);
    stops.get(o.locId).lifers.push({
      code: o.code, name: species.get(o.code).comName, date: o.obsDt, days: Math.floor(days),
      count: o.howMany ?? null, provisional: o.obsValid === false, subId: o.subId,
    });
  }
  // Recent sightings count for more; a bird seen a week ago counts half.
  const weight = (s) => s.lifers.reduce((a, l) => a + 0.5 ** (l.days / 7), 0);
  const all = [...stops.values()];
  all.sort((a, b) => weight(b) / (b.offKm + 5) - weight(a) / (a.offKm + 5));
  const candidates = all.slice(0, MAX_CANDIDATES);

  onStep('Timing detours');
  const mins = await deps.detours(candidates.map((s) => ({
    point: s.point,
    before: pointAt(r.line, cum, Math.max(0, s.atKm - APPROACH_KM)),
    after: pointAt(r.line, cum, Math.min(total, s.atKm + APPROACH_KM)),
  })), signal);
  const kept = [];
  let unreachable = 0, tooFar = 0;
  candidates.forEach((s, i) => {
    if (mins[i] === null) { unreachable++; return; }
    if (mins[i] > maxDetour) { tooFar++; return; }
    s.detourMin = mins[i];
    s.lifers.sort((a, b) => a.days - b.days);
    s.score = weight(s) / (s.detourMin + 20); // 20 min: the birding time itself
    kept.push(s);
  });
  kept.sort((a, b) => b.score - a.score);
  return {
    route: { line: r.line, km: r.km, min: r.min },
    stops: kept,
    lifers: [...inCorridor].map((c) => species.get(c).comName).sort(),
    funnel: {
      lifersInCorridor: inCorridor.size, locations: all.length,
      notTimed: all.length - candidates.length, tooFar, unreachable,
      personalSightingsDropped: dropped.personal, escapeesDropped: dropped.escapee,
      lookupsSkipped: skipped, kept: kept.length,
    },
  };
}
