// SPDX-License-Identifier: MIT
// A live place must retain a real provider-supplied immutable identifier.
// Never substitute a position-derived ID for missing provider identity.
export function providerEntityId(entity) {
  if (!entity || typeof entity !== 'object' || Array.isArray(entity)) return null;
  const raw = entity.entity_id ?? entity.id;
  if (typeof raw !== 'string' || !raw || raw.trim() !== raw ||
      /[\x00-\x1f\x7f]/u.test(raw)) return null;
  return raw;
}
