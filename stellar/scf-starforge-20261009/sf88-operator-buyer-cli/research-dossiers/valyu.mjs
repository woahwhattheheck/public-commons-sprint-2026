// MIT — Read the maintained Valyu edition through its original workspace.
import { need, object } from '../node/store.mjs';

/**
 * Adapt an existing ValyuStore; acquisition, entitlement and store lifetime stay
 * with that original workspace. Reading never purchases, freezes or imports.
 */
export function createValyuEditionProvider(store) {
  need(store && typeof store.editionView === 'function', 'VALYU_EDITION_STORE_REQUIRED');
  return {
    async read(reference) {
      need(object(reference), 'EDITION_REFERENCE_REQUIRED');
      const editionId = reference.editionId ?? reference.id;
      need(typeof editionId === 'string' && editionId.length > 0, 'EDITION_REFERENCE_REQUIRED');
      const view = await store.editionView(editionId);
      need(object(view) && view.id === editionId && Array.isArray(view.rows), 'VALYU_EDITION_VIEW_INVALID');
      const warnings = Array.isArray(view.warnings) ? view.warnings : [];
      const issues = Array.isArray(view.issues) ? view.issues : [];
      let status;
      if (view.success === false || view.status === 'error') status = 'PROVIDER_ERROR';
      else if (view.status === 'invalid' || issues.length) status = 'PROVIDER_RESPONSE_INVALID';
      else if (!['success', 'empty'].includes(view.status)) status = 'UNAVAILABLE';
      else status = view.rows.some(row => row.contentDisposition === 'withheld') ||
        warnings.length || view.error || view.httpStatus === 206 ||
        view.summary?.providerErrorPresent === true || view.summary?.providerWarningCount > 0
        ? 'PARTIAL' : 'AVAILABLE';
      const items = view.rows.map(row => {
        need(object(row) && typeof row.occurrenceId === 'string' && row.occurrenceId.length > 0,
          'VALYU_OCCURRENCE_REQUIRED');
        const withheld = row.contentDisposition === 'withheld';
        return {
          key: row.occurrenceId, id: row.id,
          title: withheld ? 'Source access restricted' : row.title,
          url: withheld ? '' : row.url, doi: withheld ? '' : row.doi,
          description: withheld ? '' : row.description,
          content: withheld ? '' : row.content,
          publishedAt: withheld ? '' : row.publicationDate,
          authors: withheld ? [] : row.authors,
          citation: withheld ? null : row.citation,
          references: withheld ? null : row.citations?.references,
          metadata: withheld ? {} : row.raw?.metadata ?? {},
          original: withheld ? null : row.raw,
        };
      });
      return {
        status, items,
        usage: { ...view.summary?.usage,
          httpStatus: view.httpStatus ?? null,
          providerWarningCount: view.summary?.providerWarningCount ?? null,
          providerErrorPresent: view.summary?.providerErrorPresent ?? null,
          retainedResultCount: view.summary?.retainedResultCount ?? null,
          withheldResultCount: view.summary?.withheldResultCount ?? null },
        warnings,
        error: view.error ?? (issues.length ? { code: 'VALYU_RESPONSE_ISSUES', issues } : null),
        availableUntil: view.validUntil ?? null,
        retention: view.retentionMode ?? 'ORIGINAL_EDITION_ACCESS',
      };
    },
  };
}
