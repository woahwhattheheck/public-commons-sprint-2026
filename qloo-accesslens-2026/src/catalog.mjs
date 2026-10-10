// ALL entries in this default catalog are fictional and are NEVER real-world accessibility assertions.
export const fixtureCatalog = Object.freeze([
  { id: 'venue-a', qloo_id: 'demo-place-a', name: 'Riverview Arts Hall (fictional)', city: 'Example City', capacity: 140, step_free: true, low_sensory: false, accessible_toilet: true, cost_usd: 22, audit_source: 'SYNTHETIC fixture', audit_date: '2026-10-09' },
  { id: 'venue-b', qloo_id: 'demo-place-b', name: 'Quiet Lantern Studio (fictional)', city: 'Example City', capacity: 55, step_free: true, low_sensory: true, accessible_toilet: true, cost_usd: 18, audit_source: 'SYNTHETIC fixture', audit_date: '2026-10-09' },
  { id: 'venue-c', qloo_id: 'demo-place-c', name: 'Hilltop Sound Lab (fictional)', city: 'Example City', capacity: 220, step_free: false, low_sensory: false, accessible_toilet: false, cost_usd: 12, audit_source: 'SYNTHETIC fixture', audit_date: '2026-10-09' },
  { id: 'venue-d', qloo_id: 'demo-place-d', name: 'Glasshouse Gallery (fictional)', city: 'Example City', capacity: 65, step_free: true, low_sensory: true, accessible_toilet: false, cost_usd: 0, audit_source: 'SYNTHETIC fixture', audit_date: '2026-10-09' },
  { id: 'venue-e', qloo_id: 'demo-place-e', name: 'Garden Stage (fictional)', city: 'Example City', capacity: 90, step_free: true, low_sensory: true, accessible_toilet: true, cost_usd: 28, audit_source: 'SYNTHETIC fixture', audit_date: '2026-10-09' },
  { id: 'venue-f', qloo_id: 'demo-place-f', name: 'Canal Cinema (fictional)', city: 'Example City', capacity: 38, step_free: true, low_sensory: true, accessible_toilet: true, cost_usd: 9, audit_source: 'SYNTHETIC fixture', audit_date: '2026-10-09' },
]);

// UTC calendar-day identity, not Date.parse's permissive rollover semantics.
export function auditUtcDay(dateString) {
  if (typeof dateString !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(dateString)) {
    throw new Error('invalid ISO audit calendar date');
  }
  const millis = Date.parse(dateString + 'T00:00:00.000Z');
  if (!Number.isFinite(millis) || new Date(millis).toISOString().slice(0, 10) !== dateString) {
    throw new Error('invalid ISO audit calendar date');
  }
  return Math.floor(millis / 86400000);
}

export function validateCatalog(rows) {
  if (!Array.isArray(rows) || rows.length === 0 || rows.length > 80) throw new Error('catalog must contain 1–80 audited venues');
  const seen = new Set();
  return rows.map((v, idx) => {
    if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error(`venue ${idx} is invalid`);
    for (const k of ['id','qloo_id','name','city','audit_source','audit_date']) {
      if (typeof v[k] !== 'string' || !v[k].trim() || v[k].length > 180) throw new Error(`venue ${idx} missing ${k}`);
    }
    if (seen.has(v.qloo_id)) throw new Error('duplicate Qloo place ID');
    seen.add(v.qloo_id);
    for (const k of ['step_free','low_sensory','accessible_toilet']) {
      if (typeof v[k] !== 'boolean') throw new Error(`venue ${idx} missing audited ${k}`);
    }
    if (!Number.isSafeInteger(v.capacity) || v.capacity < 1 || v.capacity > 100000) throw new Error(`venue ${idx} invalid capacity`);
    if (typeof v.cost_usd !== 'number' || !Number.isFinite(v.cost_usd) || v.cost_usd < 0 || v.cost_usd > 100000) throw new Error(`venue ${idx} invalid cost`);
    try { auditUtcDay(v.audit_date); } catch { throw new Error(`venue ${idx} invalid audit date`); }
    return Object.freeze({id:v.id,qloo_id:v.qloo_id,name:v.name,city:v.city,capacity:v.capacity,
      step_free:v.step_free,low_sensory:v.low_sensory,accessible_toilet:v.accessible_toilet,
      cost_usd:v.cost_usd,audit_source:v.audit_source,audit_date:v.audit_date});
  });
}

export const fixtureInsights = Object.freeze(['demo-place-c','demo-place-a','demo-place-d','demo-place-b','demo-place-f','demo-place-e']);
