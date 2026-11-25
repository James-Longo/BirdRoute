// Geometry on [lon, lat] points. Distances in km; local planar approximation
// is fine at the corridor widths used here (tens of km).
const R = 6371;
const rad = (d) => (d * Math.PI) / 180;

export function distKm([lon1, lat1], [lon2, lat2]) {
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 +
    Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lon2 - lon1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function bearing([lon1, lat1], [lon2, lat2]) {
  const y = Math.sin(rad(lon2 - lon1)) * Math.cos(rad(lat2));
  const x = Math.cos(rad(lat1)) * Math.sin(rad(lat2)) -
    Math.sin(rad(lat1)) * Math.cos(rad(lat2)) * Math.cos(rad(lon2 - lon1));
  return (Math.round((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/** Cumulative km at each vertex of a line. */
export function measure(line) {
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + distKm(line[i - 1], line[i]));
  return cum;
}

/** Point and travel bearing at `km` along the line. */
export function pointAt(line, cum, km) {
  const t = Math.max(0, Math.min(km, cum.at(-1)));
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= t) lo = m; else hi = m; }
  const seg = cum[hi] - cum[lo];
  const f = seg > 0 ? (t - cum[lo]) / seg : 0;
  const a = line[lo], b = line[hi];
  return { point: [a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1])], bearing: bearing(a, b) };
}

/** Evenly spaced points, both ends included. */
export function sample(line, cum, spacingKm) {
  const total = cum.at(-1);
  const n = Math.max(1, Math.ceil(total / spacingKm));
  return Array.from({ length: n + 1 }, (_, i) => {
    const km = (total * i) / n;
    return { km, point: pointAt(line, cum, km).point };
  });
}

/** Nearest place on the line to p: { km along the line, dist off it }. */
export function locate(line, cum, p) {
  const kx = Math.cos(rad(p[1])) * rad(1) * R, ky = rad(1) * R;
  let best = { dist: Infinity, km: 0 };
  for (let i = 1; i < line.length; i++) {
    const ax = (line[i - 1][0] - p[0]) * kx, ay = (line[i - 1][1] - p[1]) * ky;
    const bx = (line[i][0] - p[0]) * kx, by = (line[i][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const f = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const d = Math.hypot(ax + f * dx, ay + f * dy);
    if (d < best.dist) best = { dist: d, km: cum[i - 1] + f * (cum[i] - cum[i - 1]) };
  }
  return best;
}
