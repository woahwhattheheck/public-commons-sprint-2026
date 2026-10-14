# Lead records retain their customer-pack scope

## Problem and behavior

A recovered customer case can have an older undelivered pack and a later actually delivered pack. Both may retain the same original company lead ID with different edition-specific facts. Lead records already carry pack_id; the earlier workspace receiver nevertheless enforced a globally unique lead ID and selected the first matching ID across all customer packs.

The maintained engine now identifies a lead record by the pair (pack_id, id). Customer/company identity remains in the original domain, contact and buyer keys. The same lead ID can retain its original facts in more than one pack, while duplicate lead IDs within one pack continue to reject. Edition, delivery, operation, capture and procurement record IDs keep their existing identity rules.

## Complete changes

Four complete modules are changed at both canonical and portable paths:

- lead_fulfillment_core.cjs: validate scoped lead uniqueness; scope mutable receiver lookup, retained edition revision map, lead selection and lead revisions to the selected pack.
- lead_capture_core.cjs: select original capture lead revisions inside the plan's customer pack for validation and creation.
- lead_reconciliation_core.cjs: resolve current targets and retained review revisions inside the source/review pack.
- lead_procurement_core.cjs: resolve original lead snapshots and new procurement associations inside the selected pack.

All original company lead IDs, pack IDs, frozen editions, provider receipts, source documents and historical revision contents remain unchanged. Cross-pack company/contact deduplication and reservation checks remain active for the same customer. Retiring old undelivered reservations is an explicit edition-withdraw event; a delivered edition continues to reject withdrawal.

## Receiving an interrupted case

1. Reopen the original existing collection and preview both complete working records.
2. If the original undelivered pack is present, receive its complete withdrawal-bearing successor first. This preserves the original prepared editions and adds the authorized retirement events.
3. Receive the actual delivered pack through working-record-receive. The current module selects retained lead facts by pack and verifies the actual original edition and message.
4. Save through the existing native receiver. Its actual collection result belongs in the same original case.

A supplied complete workspace record can also be received through workspace-record-receive. Every original entity remains exact; the receiving workspace adds its normal receive operation. A receiving event therefore legitimately changes the whole workspace SHA while the per-pack working-record identities remain exact.

## Focused execution

The actual recovered case reproduced the prior collision. With the four complete modules, the original undelivered record is received, both unused editions are withdrawn, and the actual delivered successor is admitted. Both resulting working-record hashes match their original source. Attempting the same receipt before the explicit withdrawals still rejects all five overlapping reservations.

An isolated update of the shared company ID advanced only the selected pack's lead revision. The other pack, all delivered edition snapshots and the actual provider delivery remained exact. Reopening the whole workspace retained every original entity and appended only one receive operation. Existing UI selectors already resolve leads inside state.selected for the selected customer pack.

## Source continuity

This change composes with complete canonical assembly ownership, single-use private preview receipts, variable five-profile sample-only preparation, complimentary lineage, version3 readable contact labels (both canonical and portable message core), actual Markdown MIME receiving, and lossless full-source archives. Full predecessor bodies accompany the contribution. Customer source and actual delivery records stay in the original private company case.
