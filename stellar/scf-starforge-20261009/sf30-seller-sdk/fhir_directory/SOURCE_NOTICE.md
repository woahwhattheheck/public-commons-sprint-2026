# Original directory source and attribution

This product includes exact retained publisher source for Open Referral HSDS and the HL7 FHIR Human Services Directory guide. The original source, its release identity, byte lengths, Git objects and per-member hashes are retained in `directory-original-source.json`. The code checks that complete original envelope before using the schemas.

## Open Referral HSDS 3.3.1

- Publisher: Open Referral.
- Original repository: https://github.com/openreferral/specification
- Original release: https://github.com/openreferral/specification/releases/tag/v3.3.1
- Selected source commit: `606a72cc3ddd80f890b6422bc7bd53392764775a`.
- Release published: 2026-09-09.
- Retained original files: 85, including all 24 table schemas and their original examples and documentation.
- Original license: Creative Commons Attribution-ShareAlike 4.0 International, https://creativecommons.org/licenses/by-sa/4.0/.

Attribution: Open Referral, Human Services Data Specification, version 3.3.1. Exact retained source remains identifiable as publisher material. Authored implementation guidance and source-to-target migration decisions are identified separately in the product's mapping guidance. Redistribution or adaptation of the licensed publisher material retains the original attribution, license and change identification.

The selected release tag and commit identify this source. Version strings inside original publisher files remain unchanged, including the original data package version. The product preserves those original strings alongside the release identity.

## HL7 FHIR Human Services Directory 1.0.0 STU1

- Publisher: HL7 International and the contributors identified by the original guide.
- Published guide: https://hl7.org/fhir/us/hsds/
- Original repository: https://github.com/HL7/FHIR-IG-Human-Services-Directory
- Selected source commit: `ff9fff7902343f1640c0d3a4cf098a62a3e1c054`.
- Guide release: `1.0.0-STU1`; FHIR version `4.0.1`.
- Retained original authoring files: 20.
- Declared original license: CC0-1.0, https://creativecommons.org/publicdomain/zero/1.0/.

Published whole-file archives:

- https://hl7.org/fhir/us/hsds/examples.json.zip
- https://hl7.org/fhir/us/hsds/definitions.json.zip

The published HSD mapping references HSDS 2.0.1. The product retains those original mappings and separately records the explicit migration decisions used with the selected HSDS 3.3.1 source. Generated resources retain the reviewed mapping and source edition identities.

## Retained source envelope

`directory-original-source.json` contains 105 complete original files. Its exact UTF-8 byte identity is:

```text
SHA-256  e3312d1577709bb455c50331023f47f61f8527de417e7db7bf09b7f7dd244e27
Git blob e3d464bb382eee470658b40d97710ab4c3ca9439
```

The envelope is consumed as its original bytes. Reformatting or reconstructing it changes that retained identity. Original member content can be downloaded from the directory guidance view and native complete-file API.

## Inherited Gravity and healthcare source

The selected product also includes the original Gravity referral and eLTSS/FHIR source required to continue the clinical workspace. Their original notices and source manifests remain in the inherited product directories:

- `products/gravity-referrals/SOURCE.json` and `fhir_referral/SOURCE_NOTICE.md`.
- `products/healthcare-interoperability/SOURCE.json` and its source notices.

Project implementation files retain their declared project license. Provider data imported by an operator retains its own publisher, origin, source URL, scope and original file identity. [The product source manifest](../../../../products/human-services-directory/SOURCE.json) ties the implementation to the selected publisher source.
