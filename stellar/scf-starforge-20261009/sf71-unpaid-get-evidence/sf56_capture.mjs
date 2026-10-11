// MIT. Normalize saved native SF56 raw-page evidence without fetching a provider.
// The original SF56 analyzer remains the single source of admission and pagination rules.
import {analyzePages, PROVIDER, NETWORK} from '../sf56-live-catalog-diff/catalog.mjs';

export function normalizeSf56Capture(capture, report) {
  if (capture?.source !== PROVIDER || report?.network !== NETWORK ||
      report?.catalog?.endpoint !== PROVIDER + '/discovery/resources') {
    throw new TypeError('SF56 original provider, network or catalog endpoint mismatch');
  }
  if (!Array.isArray(capture.pages) || capture.pages.length === 0 || capture.pages.length > 200 ||
      typeof capture.capturedAt !== 'string') {
    throw new TypeError('Expected bounded original SF56 capture.json pages');
  }
  // Deliberately require original UTF-8 HTTP body strings, not a reserialized
  // JSON payload or a flattened snapshot impersonating source capture.
  for (const [i, page] of capture.pages.entries()) {
    if (!page || page.offset !== i * 100 || typeof page.body !== 'string' ||
        !page.body.length || Buffer.byteLength(page.body, 'utf8') > 4 * 1024 * 1024) {
      throw new TypeError('SF56 raw page body or offset invalid');
    }
  }
  const inspected = analyzePages(capture.pages, {
    source: capture.source, network: report.network, capturedAt: capture.capturedAt
  });
  const invalid = new Set(inspected.quarantined.map(row => row.index));
  const pages = [], rawRows = [];
  let index = 0;
  for (const [pageIndex, page] of capture.pages.entries()) {
    const parsed = JSON.parse(page.body); // validated by original analyzePages
    // Mirror the original SF56 fetcher's pagination rule. A non-final short
    // page followed by a later offset is not a contiguous provider capture,
    // even when the eventual row count happens to equal pagination.total.
    if (pageIndex < capture.pages.length - 1 && parsed.items.length !== 100) {
      throw new Error('Premature short page in saved original provider capture');
    }
    const accepted = [];
    for (const row of parsed.items) {
      rawRows.push(row);
      if (!invalid.has(index)) accepted.push(row);
      index++;
    }
    pages.push({items: accepted});
  }
  return {
    envelope: {url: report.catalog.endpoint, observedAt: inspected.capturedAt,
      complete: true, pages},
    rawRows,
    audit: {
      captureFormat: 'SF56_NATIVE_RAW_PAGE_BODIES',
      capturedAt: inspected.capturedAt,
      source: inspected.source,
      declaredTotal: inspected.declaredTotal,
      originalPageSha256: inspected.pageHashes,
      quarantinedRows: inspected.quarantinedCount,
      duplicateResourceRows: inspected.quarantined.filter(row =>
        row.reasons?.includes('DUPLICATE_RESOURCE_ACROSS_PAGES')).length,
      sourceTrust: inspected.sourceTrust,
      paymentVerified: false
    }
  };
}

