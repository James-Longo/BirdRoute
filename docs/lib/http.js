// Polite JSON fetching from the visitor's browser: per-host spacing, a short memory, retries.
const nextSlot = new Map();
const memory = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(status, host) {
    super(`${host} is not answering right now (${status}). Try again shortly.`);
    this.status = status;
  }
}

export async function getJson(url, { headers = {}, gapMs = 0, keepMin = 30, signal } = {}) {
  const u = new URL(url);
  const hit = memory.get(u.href);
  if (hit && Date.now() - hit.at < keepMin * 60_000) return hit.body;
  for (let attempt = 0; ; attempt++) {
    const at = Math.max(Date.now(), nextSlot.get(u.host) ?? 0);
    nextSlot.set(u.host, at + gapMs);
    await sleep(at - Date.now());
    let res;
    try {
      const timeout = AbortSignal.timeout(30_000);
      res = await fetch(u, { headers, signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    } catch {
      if (attempt < 2) { await sleep(1500 * 2 ** attempt); continue; }
      throw new Error(`Could not reach ${u.host}. Check your connection.`);
    }
    if (res.ok) {
      const body = await res.json();
      memory.set(u.href, { at: Date.now(), body });
      if (memory.size > 800) memory.delete(memory.keys().next().value);
      return body;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < 2) { await sleep(1500 * 2 ** attempt); continue; }
    throw new HttpError(res.status, u.host);
  }
}
