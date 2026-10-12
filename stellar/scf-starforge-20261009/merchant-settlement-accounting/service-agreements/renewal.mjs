// MIT. Receive original accepted operational renewal material in the financial workspace.
import {validateServiceRenewalHandover} from '../../sf74-merchant-support-console/service-renewals.mjs';
import {need} from '../receivables/core.mjs';

/** The operational owner validates the full retained lifecycle and its sealed bytes. */
export async function acceptedServiceRenewal(value) {
  if (value.renewalJson === undefined) return null;
  let original;
  try { original = JSON.parse(value.renewalJson); }
  catch { need(false, 'AGREEMENT_RENEWAL_JSON_INVALID', 'Choose the complete original service-renewal JSON export.'); }
  const handover = await validateServiceRenewalHandover(original);
  need(handover.acceptedHead && handover.materials.quote && handover.materials.acceptance,
    'AGREEMENT_RENEWAL_ACCEPTANCE_REQUIRED', 'Choose a service renewal with its retained accepted quotation and customer response.');
  const quote = Buffer.from(handover.materials.quote.data, 'base64');
  const response = Buffer.from(handover.materials.acceptance.data, 'base64');
  need(quote.equals(Buffer.from(value.quoteContent, 'utf8')) &&
    response.equals(Buffer.from(value.responseContent, 'utf8')),
    'AGREEMENT_RENEWAL_MATERIAL_CHANGED',
    'Keep the exact original quotation and accepted response from this service renewal.', 409);
  const acceptedTerms = handover.activeTerms ?? handover.proposedContinuation;
  return {sha256: handover.sha256, acceptedHead: structuredClone(handover.acceptedHead),
    financialJoin: structuredClone(handover.financialJoin),
    servicePeriod: {effectiveFrom: acceptedTerms.effectiveFrom, effectiveUntil: acceptedTerms.effectiveUntil}};
}

/** A changed export seal does not create a second accepted continuation. */
export function assertRenewalAssignment(agreements, agreement, renewal) {
  if (!renewal) {
    need(!agreement.editions.some(edition => edition.renewal),
      'AGREEMENT_RENEWAL_SOURCE_REQUIRED',
      'Keep this joined calendar with a complete accepted service-renewal handover when amending its terms.', 409);
    return;
  }
  const lineage = renewal.financialJoin;
  for (const edition of agreement.editions) {
    const earlier = edition.renewal?.financialJoin;
    need(!earlier || earlier.caseId === lineage.caseId && earlier.agreementId === lineage.agreementId,
      'AGREEMENT_RENEWAL_LINEAGE_CHANGED',
      'Keep this financial calendar with its original service case and agreement.', 409);
  }
  for (const existing of agreements) {
    if (existing.id === agreement.id) continue;
    const edition = existing.editions.find(row => {
      const prior = row.renewal;
      return prior && prior.financialJoin.caseId === lineage.caseId &&
        prior.financialJoin.agreementId === lineage.agreementId &&
        prior.acceptedHead.id === renewal.acceptedHead.id &&
        prior.acceptedHead.revision === renewal.acceptedHead.revision &&
        prior.acceptedHead.sha256 === renewal.acceptedHead.sha256;
    });
    if (edition) {
      const error = Object.assign(new Error('This accepted service renewal already belongs to agreement ' +
        existing.reference + ' (' + existing.id + '). Open that original calendar.'), {
        code: 'AGREEMENT_RENEWAL_ALREADY_ASSIGNED', status: 409,
        details: {agreementId: existing.id, sourceId: edition.sourceId, editionId: edition.id}
      });
      throw error;
    }
  }
}
