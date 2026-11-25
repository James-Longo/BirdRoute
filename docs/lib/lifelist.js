// Life list to eBird species codes. Runs in the visitor's browser; nothing is uploaded.
// Reads eBird's life-list CSV (Countable is 1 for what counts) or the full
// "My eBird Data" export, which carries every sighting.
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (c !== '\r') cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

const time = (d) => Date.parse(/^\d{4}-\d\d-\d\d$/.test(d) ? `${d}T12:00` : d);

/** Returns { codes, unmatched, renamed, latest, everySighting }, or throws a message fit for the page. */
export function readLifeList(text, taxonomy) {
  const [head = [], ...rows] = parseCsv(text);
  const col = (name) => head.findIndex((h) => h.trim().toLowerCase() === name);
  const iSci = col('scientific name'), iCom = col('common name');
  const iCount = col('countable'), iDate = col('date');
  if (iSci < 0 && iCom < 0) throw new Error('That file has no species name column. Is it the eBird life-list CSV?');
  const at = (r, i) => (i < 0 ? '' : (r[i] ?? '').trim());

  const bySci = new Map(taxonomy.map((t) => [t.sciName, t]));
  const byCom = new Map(taxonomy.map((t) => [t.comName, t]));
  const names = new Map();
  let latest = null;
  for (const r of rows) {
    if (iCount >= 0 && at(r, iCount) !== '1') continue;
    const sci = at(r, iSci), com = at(r, iCom);
    if (!sci && !com) continue;
    names.set(`${sci}|${com}`, [sci, com]);
    const t = time(at(r, iDate));
    if (Number.isFinite(t) && (latest === null || t > latest)) latest = t;
  }
  const codes = new Set(), unmatched = [], renamed = [];
  for (const [sci, com] of names.values()) {
    // Exact name, then the common name (survives genus changes), then the species a
    // subspecies group belongs to.
    let t = sci ? bySci.get(sci) : byCom.get(com);
    const fallback = t ? null : byCom.get(com) ?? byCom.get(com.replace(/ \(.*\)$/, '')) ?? null;
    if (fallback && sci) renamed.push(`${com}: ${sci} is now ${fallback.sciName}`);
    t ??= fallback;
    if (!t) {
      // A spuh or slash cannot be a lifer, so only a possible species is worth reporting.
      const name = sci || com;
      if (!/\bsp\.|\//.test(name) && !/ x /.test(name)) unmatched.push(sci && com ? `${com} (${sci})` : name);
      continue;
    }
    if (t.category === 'species') codes.add(t.speciesCode);
    // Subspecies groups and forms count as their species. Domestic birds do not, except
    // the feral pigeon.
    else if (t.reportAs && (t.category !== 'domestic' || t.reportAs === 'rocpig')) codes.add(t.reportAs);
  }
  if (!codes.size) throw new Error('No countable species found in that file.');
  return { codes, unmatched, renamed, latest, everySighting: iCount < 0 };
}
