/**
 * KZFR/Creek handoff contract. Pure offline validation: no player, streaming,
 * archive API, WordPress, or donation provider is impersonated or contacted.
 * A site owner must approve any host or link changes before deployment.
 */
export const CANONICAL = Object.freeze({
  site: 'https://kzfr.org/',
  programs: 'https://kzfr.org/programs',
  events: 'https://kzfr.org/events/categories/kzfr',
  archive: 'https://kzfr.studio.creek.org/',
  donate: 'https://kzfr-donate.creek.org/',
  underwrite: 'https://kzfr.org/pages/underwrite'
});

const HOST = Object.freeze({
  site: new Set(['kzfr.org', 'www.kzfr.org']),
  programs: new Set(['kzfr.org', 'www.kzfr.org']),
  events: new Set(['kzfr.org', 'www.kzfr.org']),
  archive: new Set(['kzfr.studio.creek.org']),
  donate: new Set(['kzfr-donate.creek.org']),
  underwrite: new Set(['kzfr.org', 'www.kzfr.org'])
});

export function validateHandoff(handoff) {
  const issues = [];
  if (!handoff || typeof handoff !== 'object' || Array.isArray(handoff)) {
    return ['handoff must be an object'];
  }
  for (const [role, allowed] of Object.entries(HOST)) {
    const raw = handoff[role];
    if (typeof raw !== 'string' || !raw.trim()) {
      issues.push(`${role}: missing URL`);
      continue;
    }
    try {
      const u = new URL(raw);
      if (u.protocol !== 'https:' || !allowed.has(u.hostname.toLowerCase()) ||
          u.username || u.password || u.port || u.search || u.hash) {
        issues.push(`${role}: unapproved origin or URL components`);
      }
      if (/(?:^|\/)\.{1,2}(?:\/|$)/.test(u.pathname) || /%2f|%5c/i.test(raw)) {
        issues.push(`${role}: unsafe path`);
      }
    } catch {
      issues.push(`${role}: malformed URL`);
    }
  }
  if (handoff.audioMode !== 'existing-provider-link') {
    issues.push('audioMode: must preserve the existing provider; no invented stream URL');
  }
  if (handoff.archiveMode !== 'existing-provider-link') {
    issues.push('archiveMode: must preserve the existing Creek archive');
  }
  if (handoff.cms !== 'wordpress-core') {
    issues.push('cms: RFP requires WordPress core');
  }
  return issues;
}

export function validatePrograms(rows) {
  const issues = [];
  if (!Array.isArray(rows)) return ['programs must be an array'];
  const seen = new Set();
  rows.forEach((r, i) => {
    if (!r || typeof r !== 'object' || Array.isArray(r)) {
      issues.push(`program ${i}: invalid object`);
      return;
    }
    if (typeof r.name !== 'string' || !r.name.trim() || r.name.length > 120) {
      issues.push(`program ${i}: invalid name`);
    }
    if (!/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(r.day || '')) {
      issues.push(`program ${i}: invalid day`);
    }
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(r.start || '')) {
      issues.push(`program ${i}: invalid start time`);
    }
    if (!Array.isArray(r.categories) || !r.categories.length ||
        r.categories.some(c => typeof c !== 'string' || !c.trim())) {
      issues.push(`program ${i}: invalid categories`);
    }
    const id = `${r.day}:${r.start}:${r.name}`;
    if (seen.has(id)) issues.push(`program ${i}: duplicate schedule key`);
    seen.add(id);
    // Reject arbitrary show links: schedule data and Creek archives have separate ownership.
    if (r.source !== CANONICAL.programs) issues.push(`program ${i}: unexpected source`);
  });
  return issues;
}

export function selectPrograms(rows, { query = '', category = 'All' } = {}) {
  const q = String(query).trim().toLocaleLowerCase();
  const cat = String(category).toLocaleLowerCase();
  return rows.filter(r =>
    (cat === 'all' || r.categories.some(c => c.toLocaleLowerCase() === cat)) &&
    (!q || `${r.name} ${r.categories.join(' ')}`.toLocaleLowerCase().includes(q))
  );
}
