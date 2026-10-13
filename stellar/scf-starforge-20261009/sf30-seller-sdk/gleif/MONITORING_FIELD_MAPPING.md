# GLEIF counterparty transfer: source meanings

Reviewed 2026-10-13 against the maintained GLEIF Level 1 documentation, FollowTheMoney schemas and country implementation, and this application's original GLEIF and Monitoring source.

## Projection contract

Keep the complete original GLEIF resource and its capture/page identity alongside the FtM projection. The projection is a search and review input; customer decisions and source fields remain separate records.

| Original GLEIF JSON:API value | FtM destination | Application behavior |
| --- | --- | --- |
| resource.id / attributes.lei | leiCode | Retain the full validated LEI. Use an explicit portfolio-local entity ID derived from that LEI, stable across selected source editions. |
| entity.legalName.name | name | Retain the original name. Preserve its language separately with the original resource. |
| entity.otherNames with type PREVIOUS_LEGAL_NAME | previousName | Keep historical names separate from current alternate names. |
| Other explicit alternate/trading names and transliterated names | alias | Preserve source type and language in the companion. Do not invent abbreviations. |
| entity.registeredAs | registrationNumber | Retain entity.registeredAt authority identity in the companion so a local registration number is interpretable. |
| entity.status | status | Project the entity's own reported status. Keep entity status NULL unprojected, with the source value retained. |
| registration.status | Companion only | LEI maintenance/registration status is not the entity's operating status. |
| entity.jurisdiction | Companion only in this edition | Preserve the complete original country/subdivision code. This conservative handover does not guess the receiving service's normalized jurisdiction. |
| entity.legalAddress / headquartersAddress | address | Format original address lines, routing, city, region, postal code and country without losing a source field. Retain each structured address under its explicit original role in the companion. |
| attributes.bic | Companion only in this edition | Preserve exact identifiers. A later explicit mapping may use the supported swiftBic property. |
| Actual retained source URL and publisher | Full source and mapping companion | Retain original page URLs, observations and publisher. No customer/source relationship is inferred. |

The conservative default schema is LegalEntity. GLEIF's broad entity categories alone do not prove a for-profit corporation. FollowTheMoney's Company schema has a more specific corporate/asset meaning; use it only where the captured classification justifies it.

GLEIF's entity.creationDate is the entity's establishment date. LEI initialRegistrationDate is the first identifier registration date. Keep them distinct. A field named incorporationDate should not acquire a first-LEI date. Preserve legal-form codes and their source namespace; translate a code into a form label only using an explicitly retained corresponding official code-list entry.

## Jurisdiction and address handling

GLEIF permits both two-letter countries and ISO subdivision jurisdictions. The maintained FtM country type delegates normalization to rigour territory data. Its current published table maps US-DE to us and AE-DU to ae. Exact source jurisdiction therefore remains a first-class companion value even if the search projection has only a country. Do not fabricate a richer normalized jurisdiction or infer jurisdiction from headquarters.

The original Monitoring receiver accepts FtM-shaped string-array properties without loading the complete FollowTheMoney model. A structurally accepted value is consequently not evidence that the installed matching service has normalized or recognized that value. Keep the mapping explicit and inspect the receiving service result.

Two role-labelled addresses may have identical text. Preserve both original roles even when the projected address strings deduplicate. Optional Address entities add complexity to the portfolio population and must not accidentally become independent screened counterparties; the companion provides the structured detail without adding such entries.

## Selection and review behavior

A handover freezes exact capture identities, original resource identities and source-specific review versions before creating output. Duplicate LEIs across selected editions require explicit edition selection when their source differs; do not silently combine incompatible current names, addresses or status. Each downstream portfolio entry links back to the selected original record and included review.

The original Monitoring resolution property defaults do not list leiCode. The explicit “Use LEI in this case monitoring draft” action adds it to the original case's monitoring policy, while preserving the other draft fields and earlier saved cases. This is separate from the native yente service profile. Candidate results still pass through the existing customer identity and relevance decisions.

## Primary references

- [GLEIF Level 1 LEI-CDF 3.1 fields](https://www.gleif.org/en/lei-data/access-and-use-lei-data/level-1-data-lei-cdf-3-1-format)
- [GLEIF API](https://www.gleif.org/en/lei-data/gleif-api) and its [official API documentation](https://documenter.getpostman.com/view/7679680/SVYrrxuU)
- [FtM LegalEntity](https://followthemoney.tech/explorer/schemata/LegalEntity/), [Company](https://followthemoney.tech/explorer/schemata/Company/) and [Address](https://followthemoney.tech/explorer/schemata/Address/)
- [FtM country semantics and supported projection table](https://followthemoney.tech/explorer/types/country/)
- Maintained implementation inspected: [country.py](https://github.com/opensanctions/followthemoney/blob/main/followthemoney/types/country.py), [LegalEntity.yaml](https://github.com/opensanctions/followthemoney/blob/main/followthemoney/schema/LegalEntity.yaml), [Thing.yaml](https://github.com/opensanctions/followthemoney/blob/main/followthemoney/schema/Thing.yaml), [Company.yaml](https://github.com/opensanctions/followthemoney/blob/main/followthemoney/schema/Company.yaml)
