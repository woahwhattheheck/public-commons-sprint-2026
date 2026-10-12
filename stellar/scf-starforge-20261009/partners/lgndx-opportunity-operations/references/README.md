# LGNDX source and receiving case

These inputs support the opportunity, teaming and proposal operating workspace. They preserve the company qualification, original award research and one current civilian RFI as separate source roles.

## Company and integration fit

LGNDX publishes `hello@lgndx.com` as its business contact. Its Apollo EVO page describes connecting existing community pipelines and vendor lists; the IX page describes opportunity deadlines, company capability and past-performance records, teaming, and requirement packages. The current IX page offers early access. The published material supplies a functional integration target; the selected community's native exchange format is an implementation input.

The initial workshare adapts one existing community's export/import mapping to the retained research, reviewed requirements, partner decisions and receiving package. The customer keeps its platform, community relationships and operating rules. The local workspace accepts exact source files and operator decisions without depending on an undocumented service endpoint.

Company sources and short source-linked statements are in [lgndx-company-evidence.json](lgndx-company-evidence.json):

- https://lgndx.com/contact
- https://lgndx.com/product/apollo-evo
- https://ix.lgndx.com/
- https://lgndx.com/vertical/applied-rd

A company-published capability remains a draft capability until its owner supplies and reviews the relevant delivery material. The award record remains award background; the recorded award value and period do not establish performance quality or a completed deployment.

## Original award research

The exact existing C79F capture is included as `funded-prime-capture.json` and `funded-prime-response.json`. It has 28 rows and an original retrieval time of 2026-10-11T23:02:37.522553+00:00. The unchanged response is 30,030 bytes with SHA-256 `c0c74c897b95db8657cfe9bd3c1b76526f5ff057ad2966d6f4a0f98c06cd9319`.

Original source: Commons PR33776, merge `2e8cd9d2c6dac61ad76efc6e22300b002325279e`, under `tools/revenue_owner_console_20261010/case_assets/funded-prime-cohort-20261011/`. The response Git blob is `8d0a22e48ab3ab30d7166a25af43785bfbff8730`; the acquisition-record blob is `babf1a5fe44e3147a17d197ccf4fd3901e276fe1`.

LGNDX's original key is `CONT_AWD_47QACA26C0069_4732_-NONE-_-NONE-`, recipient UEI `PZGRB9Q1S7A3`. USAspending records Award Amount USD 285,000, September 25–October 30, 2026, description NATIONAL ARTIFICIAL INTELLIGENCE CENTER, awarded by GSA/FAS and funded by Commerce/International Trade Administration. These fields belong to this award, independently of the company's IX/EVO product statements.

The original acquisition record uses `funded-prime.award-capture/v1`. Its complete request, retrieval time and response identity are retained. It has no separate HTTP-status field. Receiving this record preserves that schema and its original contents.

## Current civilian requirement source

The working opportunity is **MCC Software Development Recompete**, notice **95332427K0001**, official SAM UUID `ec4254f4fdf24f8998bd4e10d5b58050`:

https://sam.gov/workspace/contract/opp/ec4254f4fdf24f8998bd4e10d5b58050/view

SAM identifies it as Sources Sought, with response October 29, 2026 at 18:00 EDT. This working case uses the issued RFI questions to demonstrate actual source intake, coverage review, team decisions and receiving. A company's pursuit decision is entered separately.

The retained government-text files come from the public carrier's **Text version**, after its separately labelled AI summary. The `L<number>` prefixes identify the carrier's original displayed lines. They are retained transcriptions of issued government text, with their own UTF-8 file hashes. Their byte identities belong to those text files.

| File | Original attachment | Role |
| --- | --- | --- |
| `mcc-rfi-government-text.txt` | Request for Information (RFI) - Final.docx | RFI questions and response instructions |
| `mcc-pws-government-text.txt` | Performance Work Statement (PWS) - Final.docx | Supporting performance work statement |
| `mcc-industry-day-excerpt.txt` | RFI_Notice of Intent.docx | Event registration and response instructions |
| `mcc-notice-record.json` | Official SAM notice fields | Notice identity, stage and response date |

Government-text carriers:

- https://govtribe.com/file/government-file/request-for-information-rfi-final-dot-docx
- https://govtribe.com/file/government-file/performance-work-statement-pws-final-dot-docx
- https://govtribe.com/file/government-file/rfi-notice-of-intent-dot-docx

The PWS filename includes Final, while the RFI calls it a draft and the PWS transcript footer says MCC PWS DRAFT. Preserve those original labels. The RFI's question 5.c references deliverables in PWS Section 5.0, while the PWS contents identifies that section as Labor Requirements. PWS references to Appendix B and Section H are also retained as source questions for the responding company.

## Response rules

The JSON and CSV requirement matrix cover all 15 question groups through 34 numbered actionable items, preserving the original nested identifiers. The issued RFI permits an answer or N/A for each question. A blank response therefore remains an open disposition.

The response is limited to 20 pages excluding the cover and table of contents; the capability statement is limited to one page. Question 6 requests deployed operational AI experience and expressly excludes proposed solutions, undeployed pilots and proofs of concept. The engine's `deployed_only` evidence rule is attached only to that source requirement.

SAM's response timestamp is18:00 EDT, represented as22:00 UTC on October 29. The event notice uses EST for October 14 registration and October 15 Industry Day, and says COB for October 29 responses. Both original source strings remain visible. The operator records the interpretation for any actual registration or submission.

## Seed and original source APIs

`operator-seed.json` is a portable intake description. Each source has a symbolic key, exact text, role, URL, media type and hash. Retain sources first, resolve the returned `sources[].id`, then apply requirements, draft capabilities, opportunity and response rules using the current workspace revision and a stable request ID. The seed supplies no approved company capability or pursuit decision.

The maintained research application is pinned to `026815ec63aa998aac8de8106c58e414ee82a927` in `woahwhattheheck/public-commons-sprint-2026`:

- `sf30-seller-sdk/usaspending/workspace.mjs`: `AwardWorkspace(directory,{operator})`; saved queries, exact source-page intake, immutable editions, review, export and restore.
- `sf30-seller-sdk/usaspending/source-import.mjs`: `importRetainedCapture`, `importRetainedDetail`, `importSourceCollection`; reuse original acquisition schemas and bytes.
- `sf30-seller-sdk/usaspending/dossier.mjs`: `receiveUSAspendingEdition(store,dossierId,{workspace|packet,editionId,questionId,expectedRevision})`; exact source signatures and component reuse.
- `sf88-operator-buyer-cli/research-dossiers/dossier.mjs`: `openDossierStore(directory)`; original questions, retained editions, evidence selection, findings, portable export and same-history reopen.

All paths above sit under `stellar/scf-starforge-20261009/`. The original stores keep their own revision, source and recovery semantics. The proposal workspace records additional company, requirement, team and response decisions against those sources.

## Receiving acceptance

The complete receiving operation should retain these exact sources; inspect every original requirement; make explicit answer/N/A and coverage decisions; retain actual source-supported company and partner inputs; record deadlines and source questions; export a complete response/working handoff; and reopen the same package into a receiving workspace.

The receiver must be able to identify which decisions need further source or owner work, inspect the exact original document location, continue its own review, and produce a newer package without changing prior source bytes or prior exported decisions. An agreed customer exchange mapping then connects this package to one existing community pipeline.
