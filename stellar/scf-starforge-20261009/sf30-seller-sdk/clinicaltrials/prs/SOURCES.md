# Original source and license register

## Selected official contract edition

The original acquisition operation is CLINICALTRIALS-SOURCE-CONTRACTS-20261012-1FB3. It retrieved these three official files at approximately 02:51:33 UTC on 12 October 2026. Full response status, final URL, Date, ETag, Last-Modified, Content-Type and byte/hash metadata are retained in [schemas/source-contracts.json](schemas/source-contracts.json). The Protocol import resolves to the same original Results file; there is no additional XSD dependency.

| Original file | Actual header | Bytes | SHA-256 |
|---|---|---:|---|
| ProtocolRecordSchema.xsd | 2018.05.08 | 35,223 | cb4f2036b811146a98f30ee48741e513d569af3193fd7ee2fb143e918c2ab066 |
| RRSUploadSchema.xsd | 2023.03.30 | 32,403 | 2382a9eeb00ccabfab87a0c3b02c0b62586a2ecaf73d8ad7e39379228d28abda |
| clinicaltrials-openapi.yaml | OpenAPI 3.0.3; API 2.0.5 | 80,983 | ba31adaea67e6bb09ff77af5c0c11daf36d5aff7f5d6cbed89f0aab04b297aea |

Official endpoints:

- https://cdn.clinicaltrials.gov/documents/xsd/prs/ProtocolRecordSchema.xsd
- https://cdn.clinicaltrials.gov/documents/xsd/prs/RRSUploadSchema.xsd
- https://clinicaltrials.gov/api/oas/v2

The original NIH/NLM headers and complete comments remain in those files. A schema's old internal version label does not change its verified current acquisition date.

## NLM modernization notice

[ClinicalTrials.gov API Update: Thirteen Deprecated Data Elements in PRS XML](https://www.nlm.nih.gov/pubs/techbull/so26/so26_ctg_prs_api.html), NLM Technical Bulletin, 22 September 2026. The notice explains the current accepted-but-ignored behavior and potential later removal.

The exact selected rule locations are:

| Deprecated name | Source-specific location |
|---|---|
| is_fda_regulated | clinical_study direct child |
| is_section_801 | clinical_study direct child |
| end_date | clinical_study direct child |
| name_title | sponsors / resp_party |
| organization | sponsors / resp_party |
| phone | sponsors / resp_party |
| phone_ext | sponsors / resp_party |
| email | sponsors / resp_party |
| regulatory_authority | oversight_info |
| masking | study_design / interventional_design |
| control | study_design / interventional_design |
| endpoint | study_design / interventional_design |
| outcome_safety_issue | primary_outcome, secondary_outcome, other_outcome |

Thirteen names correspond to fifteen route definitions because the same Outcome type occurs in three collections. Supported replacement identifiers follow the actual XSD, including masked_subject, masked_caregiver, masked_investigator and masked_assessor.

## Original published XML examples

The original source is [shug0131/eudract_pkg](https://github.com/shug0131/eudract_pkg/tree/8c5412f28a316a5e26f7bdc013f24e24f9000633), commit 8c5412f28a316a5e26f7bdc013f24e24f9000633. Package eudract 1.1.1 is dated 15 January 2026. Simon Bond and Beatrice Pantaleo are the authors recorded in its unchanged DESCRIPTION, which declares GPL-2.

| Original path | Retained filename | Bytes | SHA-256 |
|---|---|---:|---|
| inst/extdata/1234.xml | examples/eudract_pkg/1234.xml | 7,853 | b0718215c40d0056bfd0b80ee0aabbeabfd963e40e6e61ec00bc90d095bc7bc0 |
| inst/extdata/ct_safety_upload.xml | examples/eudract_pkg/ct_safety_upload.xml | 58,198 | 354580e032c5121df3a4f338f84fd3d80a942b85d7dd8297cd9ebe839c91faf7 |
| tests/testthat/study_file.xml | examples/eudract_pkg/study_file.xml | 87,762 | 5865b6713f0c810bd930d2eb37470886596011ace82f073ad524066059828059 |

These are the publisher's explicit test-study examples, retained as original source-format inputs. The original XML, DESCRIPTION, source Git hashes and GPL-2 text are included together. [source.json](examples/eudract_pkg/source.json) provides each exact upstream file path and revision.

New component code follows the containing repository's MIT license. The publisher example files retain their separate GPL-2 terms. No upstream R implementation is copied into this Python engine.

## Validation implementation

The component uses lxml's actual XMLSchema engine and a resolver limited to the retained closure. Primary implementation documentation:

- https://lxml.de/validation.html
- https://lxml.de/resolvers.html

Original XML is parsed without DTD loading, entity resolution or network resolution. The native application reports the installed lxml/libxml versions and selected source hashes through doctor().

## Public study capture

The existing 1FB3 source provider owns the actual complete ClinicalTrials.gov capture and exact raw study/page lineage. The first whole portfolio scope is Daiichi Sankyo, results:with, LastUpdatePostDate:desc, page size 50, complete studies, Markdown source. Its official 9 October 2026 data edition contains 165 selected studies. Per-study original JSON and capture/page/version metadata enter this leaf through the accepted direct API. Customer/source packets retain that original provider identity.

## Customer workshare fit

TrialAssure's [partner programs](https://trialassure.com/about/partnerprograms/) and [disclosure services](https://trialassure.com/services/) describe implementation partnership, multiple-registry reuse, QC/review and sponsor delivery. The existing project owns the TrialAssure/MMS company and sender. This source-native validation and reconciliation capability is an implementation workshare into that existing disclosure process.
