# Human Services Directory

An installed workspace for importing and refreshing service directories, reviewing the original records, selecting a service destination and handing over a complete editable referral package.

The product connects original Open Referral HSDS source with HL7 FHIR Human Services Directory and the existing Gravity referral workspace. It preserves source records, original relationships, explicit mapping decisions, service availability interpretation and the selected clinical resources through the same operator journey.

## What an operator can complete

- Import complete HSDS JSON, individual CSV tables or CSV archives, FHIR JSON or JSON archives, and retained provider captures.
- Review the original schemas and publisher material alongside complete source rows, relationship targets and SQLite indices.
- Freeze editions, compare successors, and resolve ambiguous identity links explicitly.
- Review the complete mapping preview, apply its retained rules, and inspect every generated resource, source-field cell and finding.
- Select a service using retained criteria, capacity and schedule interpretation, with explicit dispositions for the original candidates.
- Join the chosen directory destination to the exact original Gravity Task and ServiceRequest bindings in a successor edition.
- Prepare a complete handoff, receive it into another editable workspace, reopen it and retain the receiving decision.
- Operate the same workspace through the browser, native CLI, typed SDK, Merchant MCP and installed Applications.

## Product entry points

| Need | Guide |
| --- | --- |
| Build, install and operate the selected product | [OPERATING.md](OPERATING.md) |
| Complete native, browser, connected and installed receiving | [RECEIVING.md](RECEIVING.md) |
| Exact original source versions and retained identities | [SOURCE.json](SOURCE.json) |
| Native source acquisition and index API | [SOURCE_API.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/SOURCE_API.md) |
| Connected SDK, MCP and CLI | [Connected operator](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/connected/README.md) |
| Managed application setup and reopening | [Applications](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/APPLICATIONS.md) |
| Published source attribution | [Source notice](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fhir_directory/SOURCE_NOTICE.md) |

The source selection is `human-services-directory`. Native command: `starforge human-services-directory`. Connected command: `starforge merchant-human-services-directory`. Installed application: **Human Services Directory**.

The product uses the original publisher files and the provider data selected by the operator. Its receiving programmes carry the accepted original inputs forward so a successor run can continue the same workspace and record lineage.
