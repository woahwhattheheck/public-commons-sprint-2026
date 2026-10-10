#!/usr/bin/env node
// Offline, source-snapshot-to-target-snapshot website acceptance checker.
// No crawling, network, logins, uploads, PII, payments or claims of a live audit.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const MAX_PAGES = 50000;
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const nonempty = (v, name, limit = 4096) => {
  if (typeof v !== 'string' || !v.trim() || v.length > limit || /[\x00-\x1f\x7f]/.test(v)) throw new Error(`invalid ${name}`);
  return v;
};
function origin(value) {
  const u = new URL(nonempty(value, 'site origin', 512));
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
    u.pathname !== '/' || u.port || !u.hostname.includes('.') || /^(?:localhost|127\.|10\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(u.hostname)) {
    throw new Error('site origin must be a public HTTPS origin');
  }
  return u.origin;
}
function route(path) {
  nonempty(path, 'page path', 2048);
  if (!path.startsWith('/') || path.startsWith('//') || path.includes('\\') || path.includes('?') || path.includes('#') || /%(?:2f|5c|00)/i.test(path)) throw new Error('page path must be a pathname only');
  const parsed = new URL(path, 'https://example.org');
  if (parsed.pathname !== path) throw new Error('noncanonical page path');
  return path;
}
function href(value, siteOrigin) {
  nonempty(value, 'action href');
  const u = new URL(value, siteOrigin);
  if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.port) throw new Error('unsafe action href');
  if (u.search && /(?:access_token|session|api_key|auth|password|token)=/i.test(u.search)) throw new Error('action href contains a credential-like query');
  return u.origin === siteOrigin ? `INTERNAL:${u.pathname}${u.search}` : `EXTERNAL:${u.origin}${u.pathname}${u.search}`;
}
function inventory(input, label) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error(`missing ${label} inventory`);
  const siteOrigin = origin(input.origin);
  if (!Array.isArray(input.pages) || input.pages.length > MAX_PAGES) throw new Error(`invalid ${label} pages`);
  const pages = new Map();
  for (const p of input.pages) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) throw new Error('invalid page row');
    const path = route(p.path);
    if (pages.has(path)) throw new Error(`duplicate page path: ${path}`);
    if (!Number.isInteger(p.status) || p.status < 100 || p.status > 599) throw new Error(`invalid HTTP status at ${path}`);
    if (!Number.isInteger(p.h1Count) || p.h1Count < 0 || p.h1Count > 100) throw new Error(`invalid heading count at ${path}`);
    if (!Number.isInteger(p.imagesWithoutAlt) || p.imagesWithoutAlt < 0 || p.imagesWithoutAlt > 1000000) throw new Error(`invalid missing-alt count at ${path}`);
    pages.set(path, {path, status:p.status, h1Count:p.h1Count, imagesWithoutAlt:p.imagesWithoutAlt});
  }
  if (!Array.isArray(input.actions) || input.actions.length > 10000) throw new Error(`invalid ${label} actions`);
  const actions = new Map();
  for (const a of input.actions) {
    if (!a || typeof a !== 'object' || Array.isArray(a)) throw new Error('invalid action row');
    const id = nonempty(a.id, 'action ID', 100);
    if (!/^[a-z][a-z0-9-]*$/.test(id) || actions.has(id)) throw new Error('invalid or duplicate action ID');
    actions.set(id, href(a.href,siteOrigin));
  }
  return {origin:siteOrigin,pages,actions};
}
export function compareSnapshots(before, after) {
  const old = inventory(before,'baseline'), next = inventory(after,'candidate');
  const issues=[];
  const put=(severity,code,scope,detail)=>issues.push({severity,code,scope,detail});
  for(const [path,b] of old.pages) {
    const a=next.pages.get(path);
    if (!a) {put('BLOCKER','PAGE_MISSING',path,'Baseline pathname not present in candidate');continue;}
    if(b.status<400 && a.status>=400) put('BLOCKER','PAGE_HTTP_REGRESSION',path,`HTTP ${b.status} → ${a.status}`);
    if(b.h1Count>0 && a.h1Count===0) put('REVIEW','HEADING_LOSS',path,'Baseline contained H1; candidate has none');
    if(a.imagesWithoutAlt>b.imagesWithoutAlt) put('REVIEW','ALT_REGRESSION',path,`Missing alt ${b.imagesWithoutAlt} → ${a.imagesWithoutAlt}`);
  }
  for(const [id,oldHref] of old.actions) {
    const current=next.actions.get(id);
    if(current===undefined) put('BLOCKER','ACTION_MISSING',id,'Critical resident, landlord or staff action absent');
    else if(oldHref!==current) put('BLOCKER','ACTION_TARGET_CHANGED',id,`Expected ${oldHref}; candidate ${current}`);
  }
  issues.sort((a,b)=>a.scope.localeCompare(b.scope)||a.code.localeCompare(b.code));
  const blockers=issues.filter(i=>i.severity==='BLOCKER').length;
  return {kind:'offline-website-migration-acceptance',baselineOrigin:old.origin,candidateOrigin:next.origin,
    baselinePages:old.pages.size,candidatePages:next.pages.size,baselineCriticalActions:old.actions.size,
    candidateCriticalActions:next.actions.size,blockers,reviews:issues.length-blockers,
    status:blockers?'HOLD':issues.length?'REVIEW':'PASS_PRELIMINARY',
    note:'A pass covers supplied snapshot assertions only; browser WCAG, auth, portal/payments, load and human review remain separate acceptance gates.',issues};
}
export function analyzeFiles(beforePath,afterPath) {
  const a=readFileSync(beforePath),b=readFileSync(afterPath);
  const report=compareSnapshots(JSON.parse(a),JSON.parse(b));
  return {...report,baselineSha256:createHash('sha256').update(a).digest('hex'),candidateSha256:createHash('sha256').update(b).digest('hex')};
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  if(process.argv.length!==4){console.error('Usage: node acceptance.mjs <baseline-snapshot.json> <candidate-snapshot.json>');process.exitCode=2;}
  else try {
    const report=analyzeFiles(process.argv[2],process.argv[3]);console.log(JSON.stringify(report,null,2));
    process.exitCode=report.blockers?1:0;
  } catch(e){console.error(`Invalid inventory: ${e.message}`);process.exitCode=2;}
}
