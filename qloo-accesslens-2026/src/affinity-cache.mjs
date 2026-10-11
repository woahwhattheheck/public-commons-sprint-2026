// Only completed Qloo affinity is reused. Plans and operator audit decisions are not.
// Each instance belongs to one immutable server API configuration and credential.
export class AffinityCache {
  #entries = new Map();
  #ttlMs;
  #maxEntries;
  #clock;
  #wallClock;

  constructor({ttlMs=120_000, maxEntries=16,
    clock=()=>performance.now(), wallClock=()=>new Date().toISOString()}={}) {
    if (!Number.isSafeInteger(ttlMs) || ttlMs<0 || ttlMs>300_000) throw new Error('invalid affinity reuse interval');
    if (!Number.isSafeInteger(maxEntries) || maxEntries<1 || maxEntries>32) throw new Error('invalid affinity cache bound');
    this.#ttlMs=ttlMs; this.#maxEntries=maxEntries;
    this.#clock=clock; this.#wallClock=wallClock;
  }

  #key(seed) {
    // Exactly the normalized effective GET /search query. Do not merge different
    // casing, Unicode forms or aliases that might produce different provider data.
    if (typeof seed!=='string' || !seed.trim()) throw new Error('invalid artist seed');
    return seed.trim();
  }

  #view(entry, reused, now) {
    return {
      affinity:entry.affinity,
      providerCapture:{capturedAtUTC:entry.capturedAtUTC,
        ageMs:Math.max(0,Math.floor(now-entry.capturedAt)),
        reuseWindowMs:this.#ttlMs, reused}
    };
  }

  lookup(seed) {
    const key=this.#key(seed), entry=this.#entries.get(key);
    if (!entry) return null;
    const now=this.#clock(), age=now-entry.capturedAt;
    if (age<0 || age>=this.#ttlMs) { this.#entries.delete(key); return null; }
    // LRU affects eviction only; reads never extend the capture's freshness.
    this.#entries.delete(key); this.#entries.set(key,entry);
    return this.#view(entry,true,now);
  }

  remember(seed, affinity) {
    const key=this.#key(seed);
    // Keep only the adapter's parsed IDs and resolved artist, never a key, raw
    // provider body, patron constraints, catalog or completed recommendation.
    const retained=Object.freeze({
      artist:Object.freeze({id:affinity.artist.id,name:affinity.artist.name}),
      rankedPlaceIds:Object.freeze([...affinity.rankedPlaceIds]),
      qlooRequests:affinity.qlooRequests
    });
    const now=this.#clock();
    const entry={affinity:retained,capturedAt:now,capturedAtUTC:this.#wallClock()};
    this.#entries.delete(key);
    // Bound retained payload per entry too; a large valid result still serves
    // this request but is not retained. TTL zero disables reuse entirely.
    if (this.#ttlMs>0 && JSON.stringify(retained).length*2<=262_144) {
      for (const [k,v] of this.#entries) {
        const age=now-v.capturedAt;
        if (age<0 || age>=this.#ttlMs) this.#entries.delete(k);
      }
      this.#entries.set(key,entry);
      while (this.#entries.size>this.#maxEntries) this.#entries.delete(this.#entries.keys().next().value);
    }
    return this.#view(entry,false,now);
  }
}
