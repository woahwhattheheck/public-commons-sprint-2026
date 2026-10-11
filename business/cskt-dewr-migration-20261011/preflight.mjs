#!/usr/bin/env node
// Source-based migration preflight: no fetching, publishing, buyer account, or paid infrastructure.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const input = process.argv[2] ?? resolve(here, 'observed-public-content.json');
const output = process.argv[3] ?? resolve(here, 'preflight-report.json');
const data = JSON.parse(readFileSync(input, 'utf8'));
if (!Array.isArray(data.pages) || !data.pages.length) throw new Error('pages must be nonempty');
const expectedOrigin = 'https://csktwatercompact.com';
const canonical = url => {
  if (typeof url !== 'string') throw new Error('URL must be a string');
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.origin !== expectedOrigin || parsed.username || parsed.password) {
    throw new Error(`Untrusted or external site URL: ${url}`);
  }
  if (parsed.search || parsed.hash) throw new Error(`Query/fragment must be approved separately: ${url}`);
  if (/%2f|%5c|%2e/i.test(parsed.pathname)) throw new Error(`Encoded path requires owner review: ${url}`);
  return parsed.origin + parsed.pathname.replace(/\/{2,}/g, '/');
};
const pages = [];
const seen = new Set();
for (const p of data.pages) {
  const source = canonical(p.url);
  if (seen.has(source)) throw new Error(`Repeated public page: ${source}`);
  seen.add(source);
  if (typeof p.evidence !== 'string' || !p.evidence.trim()) throw new Error(`Missing observed primary evidence: ${source}`);
  if (typeof p.observed !== 'string' || !/^2026-\d\d-\d\d$/.test(p.observed)) throw new Error(`Missing observation date: ${source}`);
  if (!['page', 'document'].includes(p.type)) throw new Error(`Unrecognized type: ${source}`);
  if (typeof p.suggestedDestination !== 'string' || !/^\/(?!\/)[a-z0-9._\-/]*\/?$/i.test(p.suggestedDestination)) throw new Error(`Invalid proposed destination: ${source}`);
  if (p.suggestedDestination.includes('..') || p.suggestedDestination.includes('//')) throw new Error(`Unsafe proposed destination: ${source}`);
  const status = p.status ?? null;
  if (status && (typeof status.topic !== 'string' || !['active', 'complete', 'unknown'].includes(status.state))) throw new Error(`Invalid status: ${source}`);
  pages.push({source, title: p.title, type:p.type, observed:p.observed, evidence:p.evidence, evidenceSection:p.evidenceSection,
    destination: p.suggestedDestination, redirectStatus:'PROPOSED_NOT_APPROVED', status,
    ownerDisposition:'DEWR_TO_DECIDE_RETAIN_REVISE_ARCHIVE_REMOVE', accessibilityDisposition:'PENDING_REAL_DOCUMENT_REVIEW'});
}
const byTopic = new Map();
for (const p of pages) {
  if (!p.status || p.status.state==='unknown') continue;
  const topic = p.status.topic;
  if (!byTopic.has(topic)) byTopic.set(topic, []);
  byTopic.get(topic).push({url:p.source,reportedState:p.status.state,sourceQuote:p.evidence});
}
const conflicts = [...byTopic.entries()].filter(([, items])=>new Set(items.map(x=>x.reportedState)).size>1)
  .map(([topic,items])=>({topic,observations:items,decision:'OWNER_MUST_ADJUDICATE_BEFORE_IMPORT_OR_PUBLIC_REDIRECT'}));
const outward = [];
for (const e of data.externalResources ?? []) {
  const u = new URL(e.url);
  if (u.protocol !== 'https:' || !['storymaps.arcgis.com','arcg.is'].includes(u.hostname)) throw new Error(`External GIS host needs buyer review: ${e.url}`);
  outward.push({sourcePage:canonical(e.sourcePage),url:u.href,kind:e.kind,observed:e.observed,ownership:'DEWR_MUST_CONFIRM_ITEM_PUBLIC_ACCESS_AND_RIGHTS',accessibleFallback:'MUST_BE_IMPLEMENTED_AND_REVIEWED'});
}
const result = {
  provenance:'FIRST_PARTY_PUBLISHED_SITE_OBSERVATIONS_ENTERED_2026-10-11',
  mode:'offline_manifest_only_no_live_crawl_no_publish_no_automatic_redirects',
  originalBuyerRfp:'https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf',
  observedPages: pages.length, proposedRedirects:pages.length, inconsistencies:conflicts.length,
  pageInventory:pages, contentConflicts:conflicts, knownGISLinks:outward,
  acceptanceGates:['DEWR supplies complete authoritative source inventory','DEWR decides disposition and new URL per page','Prime documents 3 legitimate 5-year references and scope','DEWR approves every redirect and GIS public item','PDF document accessibility remediated only with authorized originals','Run real CMS import, backup and rollback in buyer-authorized staging','Document signed prime acceptance and ownership handback']
};
writeFileSync(output, JSON.stringify(result, null, 2)+'\n');
process.stdout.write(JSON.stringify({observedPages:result.observedPages, proposedRedirects:result.proposedRedirects, inconsistencies:result.inconsistencies, knownGISLinks:outward.length, output},null,2)+'\n');