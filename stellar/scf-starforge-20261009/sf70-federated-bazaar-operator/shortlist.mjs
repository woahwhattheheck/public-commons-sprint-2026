// MIT. Browser-local comparison of exact, independently observed advertisements.
export const SHORTLIST_LIMIT = 6;
const fields = ['network', 'scheme', 'asset', 'payTo', 'amount'];
const operationFields = ['url', 'kind', 'method', 'toolName', 'routeTemplate'];
const same = (a, b, keys) => keys.every(key => a?.[key] === b?.[key]);

export function selectionKey(snapshot, listing, optionIndex) {
  const source = snapshot?.sources?.find(item => item.provider === listing.source);
  return JSON.stringify([snapshot?.network, source?.endpoint, source?.observedAt,
    listing.source, listing.sourceRow, optionIndex, listing.paymentOptions?.[optionIndex]]);
}

export function selectOffer(snapshot, listing, optionIndex) {
  const source = snapshot?.sources?.find(item => item.provider === listing.source);
  if (source?.status !== 'COMPLETE_GET_CAPTURE' || !source.observedAt ||
      !Number.isInteger(optionIndex) || optionIndex < 0 || !listing.paymentOptions?.[optionIndex])
    throw new Error('Select an option from a completed source observation.');
  return structuredClone({
    key: selectionKey(snapshot, listing, optionIndex),
    capturedNetwork: snapshot.network,
    source,
    listing,
    optionIndex,
    // Keep the entire individual projected tuple. Never convert an amount to Number.
    option: listing.paymentOptions[optionIndex],
  });
}

export function selectionStatus(selected, snapshot, refreshFailed = false) {
  const source = snapshot?.sources?.find(item => item.provider === selected.source.provider);
  if (refreshFailed) return { kind: 'unavailable', label: 'Latest refresh unavailable',
    detail: 'Retained source observation; freshness could not be checked.' };
  if (!source || source.status !== 'COMPLETE_GET_CAPTURE')
    return { kind: 'unavailable', label: 'Source unavailable in latest capture',
      detail: 'Retained source observation; no absence or price change is inferred.' };
  if (snapshot.network !== selected.capturedNetwork || source.endpoint !== selected.source.endpoint)
    return { kind: 'earlier', label: 'Different source scope',
      detail: 'This selection belongs to its original provider endpoint and network.' };
  if (source.observedAt === selected.source.observedAt)
    return { kind: 'current', label: 'Selected from latest source capture',
      detail: 'Provider advertisement only. Seller terms have not been confirmed.' };
  if (!selected.listing.url) return { kind: 'earlier', label: 'Earlier observation; URL undeclared',
    detail: 'The original selection cannot be matched to a newer operation.' };
  const matches = (snapshot.listings ?? []).filter(row => row.source === source.provider &&
    same(row, selected.listing, operationFields));
  if (matches.length > 1) return { kind: 'earlier', label: 'Earlier observation; ambiguous operation',
    detail: 'More than one latest row declares this operation. No automatic match was made.' };
  if (!matches.length) return { kind: 'changed', label: 'Operation not in latest source capture',
    detail: 'The original selection is retained. This is not a claim that the seller disappeared.' };
  if (matches[0].paymentOptions.some(option => same(option, selected.option, fields)))
    return { kind: 'earlier', label: 'Earlier observation; same tuple seen again',
      detail: 'Original capture time retained. Select the latest card to compare the new observation.' };
  if (matches[0].hiddenPaymentOptions) return { kind: 'earlier', label: 'Earlier observation; latest options incomplete',
    detail: 'Undisplayed alternatives prevent a complete comparison.' };
  return { kind: 'changed', label: 'Selected tuple not in latest source capture',
    detail: 'The original terms are retained. Review the latest listing before making a decision.' };
}

export function shortlistDocument(selections, snapshot, refreshFailed = false) {
  return {
    schema: 'SCF-SF70/advertised-offer-shortlist-v1',
    exportedAt: new Date().toISOString(),
    interpretation: 'Independent provider advertisements for human comparison. Not live seller quotes, equivalent services, purchase approval or payment evidence. Amounts are original projected atomic-unit strings, not converted currencies.',
    persistence: 'Explicit local file export; selections survive catalog refreshes, but browser reload or closing the page clears them.',
    merchantRequests: 0, payments: 0, signatures: 0,
    selections: selections.map(selected => ({ ...structuredClone(selected),
      latestObservationStatus: selectionStatus(selected, snapshot, refreshFailed) })),
  };
}
