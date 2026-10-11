// MIT. SF71: comparison of two native SF70 browser captures, no storage or network calls.
// A provider failure is never interpreted as a deleted merchant listing.
const complete = source => source?.status === 'COMPLETE_GET_CAPTURE';
const string = value => typeof value === 'string' ? value : '';
const identity = row => {
  if (!string(row?.url).trim()) return null;
  return JSON.stringify([row.source, row.url, string(row.method).toUpperCase(),
    string(row.kind), string(row.toolName)]);
};
const optionKey = option => JSON.stringify([
  string(option.network), string(option.scheme), string(option.asset),
  string(option.payTo), string(option.amount),
]);
const decodeOption = key => {
  const [network, scheme, asset, payTo, amount] = JSON.parse(key);
  return { network, scheme, asset, payTo, amount };
};
function optionChanges(before, after) {
  const oldCounts = new Map();
  const newCounts = new Map();
  for (const item of before) {
    const key = optionKey(item);
    oldCounts.set(key, (oldCounts.get(key) ?? 0) + 1);
  }
  for (const item of after) {
    const key = optionKey(item);
    newCounts.set(key, (newCounts.get(key) ?? 0) + 1);
  }
  const removed = [];
  const added = [];
  for (const key of new Set([...oldCounts.keys(), ...newCounts.keys()])) {
    const delta = (newCounts.get(key) ?? 0) - (oldCounts.get(key) ?? 0);
    for (let i = 0; i < -delta; i++) removed.push(decodeOption(key));
    for (let i = 0; i < delta; i++) added.push(decodeOption(key));
  }
  return { added, removed };
}
function indexRows(snapshot, provider) {
  const rows = new Map();
  const collisions = new Set();
  let unkeyed = 0;
  for (const row of snapshot.listings ?? []) {
    if (row?.source !== provider) continue;
    const key = identity(row);
    if (!key) { unkeyed++; continue; }
    if (rows.has(key)) collisions.add(key);
    else rows.set(key, row);
  }
  for (const key of collisions) rows.delete(key);
  return { rows, collisions, unkeyed };
}

export function compareSnapshots(previous, current) {
  const oldSources = new Map((previous?.sources ?? []).map(s => [s.provider, s]));
  const newSources = new Map((current?.sources ?? []).map(s => [s.provider, s]));
  const skippedSources = [];
  const changes = [];
  let ambiguousIdentities = 0;
  let unkeyedListings = 0;
  let truncatedOptionComparisons = 0;
  let comparedSources = 0;
  if (previous?.schema !== current?.schema || previous?.network !== current?.network) {
    return { comparable: false, reason: 'Different native schema or Stellar network',
      comparedSources: 0, skippedSources: [], changes: [], counts: { added: 0, removed: 0, changed: 0 },
      ambiguousIdentities: 0, unkeyedListings: 0, truncatedOptionComparisons: 0 };
  }
  for (const provider of new Set([...oldSources.keys(), ...newSources.keys()])) {
    if (!complete(oldSources.get(provider)) || !complete(newSources.get(provider))) {
      skippedSources.push(provider);
      continue;
    }
    comparedSources++;
    const oldIndex = indexRows(previous, provider);
    const newIndex = indexRows(current, provider);
    unkeyedListings += oldIndex.unkeyed + newIndex.unkeyed;
    const conflicted = new Set([...oldIndex.collisions, ...newIndex.collisions]);
    ambiguousIdentities += conflicted.size;
    for (const key of new Set([...oldIndex.rows.keys(), ...newIndex.rows.keys()])) {
      if (conflicted.has(key)) continue;
      const before = oldIndex.rows.get(key);
      const after = newIndex.rows.get(key);
      const row = after ?? before;
      if (!before || !after) {
        changes.push({ type: before ? 'REMOVED' : 'ADDED', provider, url: row.url,
          method: row.method, toolName: row.toolName, before: before ?? null, after: after ?? null,
          fields: [], addedOptions: [], removedOptions: [] });
        continue;
      }
      const fields = ['label', 'description'].filter(field => string(before[field]) !== string(after[field]));
      let addedOptions = [];
      let removedOptions = [];
      if (before.hiddenPaymentOptions || after.hiddenPaymentOptions) {
        truncatedOptionComparisons++;
        if (before.hiddenPaymentOptions !== after.hiddenPaymentOptions) fields.push('truncated payment option count');
      } else {
        ({ added: addedOptions, removed: removedOptions } = optionChanges(
          before.paymentOptions ?? [], after.paymentOptions ?? []));
      }
      if (fields.length || addedOptions.length || removedOptions.length) {
        changes.push({ type: 'CHANGED', provider, url: row.url, method: row.method,
          toolName: row.toolName, before, after, fields, addedOptions, removedOptions });
      }
    }
  }
  changes.sort((a, b) => a.provider.localeCompare(b.provider) ||
    a.url.localeCompare(b.url) || a.type.localeCompare(b.type));
  return {
    comparable: true, previousAt: previous.observedAt, currentAt: current.observedAt,
    comparedSources, skippedSources, changes,
    counts: Object.fromEntries(['ADDED', 'REMOVED', 'CHANGED'].map(type =>
      [type.toLowerCase(), changes.filter(change => change.type === type).length])),
    ambiguousIdentities, unkeyedListings, truncatedOptionComparisons,
  };
}
