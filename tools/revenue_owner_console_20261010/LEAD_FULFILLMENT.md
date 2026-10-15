# Lead fulfillment and delivery

The complete [Lead Cohort Toolkit](lead_cohort_toolkit/README.md) prepares original researched cohorts, four customer formats and ZIPs, useful messages, actual delivery records and lossless source archives.

Run its native commands from `lead_cohort_toolkit/`. The adjacent `lead_fulfillment_core.cjs`, capture, reconciliation, procurement and related modules expose the same complete engine for a host application. They resolve their shared helpers from `../../host/`. This addition provides the portable command course and canonical engine modules; the existing host chooses its own routes and persistence.

## Receiving complete records

Use `previewWorkingRecord(ledger, record)` to inspect a retained working or workspace record. Use `applyLeadFulfillment` with the original `working-record-receive` or `workspace-record-receive` request and the current root hash. `createLeadFulfillmentAssembly` owns a detached collection for complete source assembly. Saved operation IDs retain exact request semantics across retries.

Lead facts are identified by `(pack_id, id)`. The same original company lead ID may appear in several customer packs while each retains its full facts and frozen editions. Same-pack duplicates still reject. Customer/company reservation checks remain separate: explicitly retire an obsolete undelivered edition before receiving an overlapping new pack. Delivered editions retain their original body, source, provider receipt and files. See [receiving guidance](lead_cohort_toolkit/source/PACK_SCOPED_LEAD_RECORDS.md).

The current message renderer places complete profiles and openings before the chosen commercial terms and uses readable contact labels. Customer titles are explicit. Historical records without the optional title keep their earlier exports. Source selection can point to the exact retained article or changelog without changing company identity.

### Reconciling retained customer sources

The existing retained-source preview and apply course also accepts `customer_files`, `customer_packages`, `customer_package_exports`, and `customer_contacts` in `choices.assets`. Select the original supporting-file histories, frozen package and export, contact history, and any missing edition or delivery references together. The normal workspace receiver validates the complete candidate before saving it; a missing dependency or divergent history leaves the current workspace unchanged.

Supporting-file revisions and contact-event histories can advance only along their original prefix. Receiving an older copy preserves the newer current history. Completed reviews remain readable after a compatible later continuation. Frozen packages and original export bytes keep their exact identities. A retained native SENT receipt stays with its original contact and delivery; reconciliation does not send another message.

Run the focused component checks from the repository root with `node --test tests/lead_reconciliation_customer_assets.test.cjs`.

## License and source

These canonical lead modules, their `capture/capture_core.cjs` helper and the added connected MIME/contact/archive helpers are distributed with the toolkit under [Apache-2.0](lead_cohort_toolkit/LICENSE). Existing public shared SHA, gzip and ZIP modules remain at their current source. Every retained portable dependency is included, so its reproducible runtime is independent of future shared-host changes.
