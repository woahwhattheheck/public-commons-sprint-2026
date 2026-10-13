// MIT. Independent per-file entered drafts, retained in this original browser window.
export function configurationDrafts(storage, workspaceId, homeId) {
  const prefix = 'starforge-managed-config-file:' + encodeURIComponent(workspaceId) + ':' + encodeURIComponent(homeId) + ':';
  const key = path => prefix + encodeURIComponent(path);
  function read(path) {
    const value = JSON.parse(storage.getItem(key(path)) ?? 'null');
    if (value && (value.workspaceId !== workspaceId || value.homeId !== homeId || value.path !== path))
      throw new Error('Retained configuration draft identity changed.');
    return value;
  }
  function write(value) {
    if (value.workspaceId !== workspaceId || value.homeId !== homeId || typeof value.path !== 'string')
      throw new Error('Configuration draft identity is required.');
    storage.setItem(key(value.path), JSON.stringify(value));
    return value;
  }
  function list() {
    const result = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name?.startsWith(prefix)) result.push(read(decodeURIComponent(name.slice(prefix.length))));
    }
    return result.sort((a, b) => a.path.localeCompare(b.path));
  }
  function remove(path, expected) {
    const prior = read(path);
    if (JSON.stringify(prior) !== JSON.stringify(expected)) throw new Error('The retained draft changed; reopen it before discarding.');
    storage.removeItem(key(path));
  }
  function migrate() {
    const legacyKey = 'starforge-managed-config-' + workspaceId + '-' + homeId;
    const encoded = storage.getItem(legacyKey), legacy = JSON.parse(encoded ?? 'null');
    if (legacy?.homeId !== homeId || typeof legacy.path !== 'string' || typeof legacy.draftContent !== 'string') return;
    const existing = read(legacy.path);
    const next = existing ? { ...existing, legacySources: [...new Set([...(existing.legacySources ?? []), encoded])] } :
      { schema: 'stellar-forge.managed-configuration-draft.v1', workspaceId, homeId, path: legacy.path,
        base: { homeId, path: legacy.path, exists: legacy.exists ?? legacy.sha256 !== null,
          sha256: legacy.sha256, content: legacy.content ?? '', bytes: legacy.bytes ?? 0 },
        content: legacy.draftContent, pending: null, migrated: true, legacySources: [encoded] };
    write(next);
    // Retain every old byte in the new per-file record before retiring the
    // matching old slot. A changed original slot is never removed.
    if (JSON.stringify(read(legacy.path)) !== JSON.stringify(next))
      throw new Error('The received per-file legacy draft did not reopen exactly.');
    if (storage.getItem(legacyKey) === encoded) storage.removeItem(legacyKey);
  }
  return { read, write, list, remove, migrate };
}
export function configurationDifference(before, after) {
  const left = before.split('\n'), right = after.split('\n');
  let prefix = 0, suffix = 0;
  while (prefix < left.length && prefix < right.length && left[prefix] === right[prefix]) prefix++;
  while (suffix < left.length - prefix && suffix < right.length - prefix &&
    left[left.length - 1 - suffix] === right[right.length - 1 - suffix]) suffix++;
  return { equal: before === after, firstChangedLine: prefix + 1,
    beforeLines: left.length, afterLines: right.length,
    removedLines: left.length - prefix - suffix, addedLines: right.length - prefix - suffix };
}
