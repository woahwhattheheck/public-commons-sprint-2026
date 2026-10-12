# SAM.gov notice and source contract

Reviewed 12 October 2026. The implementation follows the [GSA Get Opportunities Public API guide](https://open.gsa.gov/api/get-opportunities-public-api/). Machine-readable field and acquisition details are retained in [references/gsa-opportunities-contract.json](references/gsa-opportunities-contract.json).

## Query and complete page capture

Use the production GET endpoint `https://api.sam.gov/opportunities/v2/search` with the selected existing account's `api_key`. Keep that value on the host and retain its nonsecret reference in the operation. The provider applies daily limits according to account role; the guide does not state one universal request allowance.

Both `postedFrom` and `postedTo` are mandatory. They use `MM/dd/yyyy` and a window of at most one year. A paired response-deadline window, `rdlfrom` and `rdlto`, has the same one-year limit. Solicitation number, notice ID, title, organization, geography, procurement type, set-aside, NAICS and classification fields refine that selected window.

The `offset` is a **zero-based page index**. Advance it by one for the next page. The maximum `limit` is 1,000 and its documented default is one record. The operator selects a positive explicit page size and retains the actual `totalRecords`, `offset`, `limit` and `opportunitiesData` from each returned response. The saved query, completed page identities and next page index travel with a resumed operation.

The current guide marks `deptname` and `subtier` deprecated, and `status` as forthcoming. Use the current organization fields and inspect the actual returned notice status. The retired procurement codes `f` and `l` do not become new query choices; the guide directs fair-opportunity queries to the justification code `u`.

## Notice, description and attachments

Keep each original notice object and every unknown provider field in its captured source. The stable notice identity is `noticeId`; solicitation number, current and original type, organization hierarchy, archive fields, set-aside, award, contact, performance location and links remain inspectable.

The issued response table and examples contain spelling differences. In particular, the table prints `reponseDeadLine`, while its JSON examples use `responseDeadLine`. Preserve the actual returned key and value. The original deadline text, a separately reviewed timezone interpretation and the resulting operating deadline belong to the same notice edition.

The `description` field is a URL to a separate source. Follow the actual returned URL and apply the host's existing API key as the guide specifies. A missing description is a recorded provider outcome. The `resourceLinks` array supplies attachment download URLs; retain the actual selected file, response time, status, media type and filename with its complete byte identity. The listing, description and each file are separate source observations.

Some guide examples use legacy URL prefixes. Production search follows the current v2 endpoint, and description/resource retrieval follows the actual returned source link. An HTML portal page is recorded in its own source format. An extracted DOCX text version and the downloaded DOCX file retain distinct identities and locators.

## Retained editions and review

GSA describes the API as returning the latest active version, with active notices refreshed daily and archived notices weekly. Full published version history belongs to SAM.gov Data Services. The operating workspace keeps every captured edition and any explicitly received historical package. Its version coverage comes from those retained inputs.

A later capture can change the deadline, status, description or attachment set. Keep the earlier source and make the change visible for a named review. The selected edition and its source decisions feed the original LGNDX opportunity and research-dossier workspace, where requirement numbering, source quotations, coverage decisions and response rules retain their source links.

## Acquisition and publication records

The operation records the selected environment, redacted query, nonsecret account reference, actual timestamps, status and applicable provider retry/reset fields, plus original response bytes and SHA-256. Credentials stay out of browser URLs, operational logs and delivered manifests. If the actual provider body echoes an access secret, retain that original privately and identify the secret-free published view as a derived file.

The guide lists success, missing data, bad query and internal-error outcomes, and describes invalid or absent API keys and absent description content. Continue from the actual saved operation after resolving its returned cause. These records allow the next operator to receive the same captures and continue the original work.

## MCC reference intake

The selected actual notice is [MCC 95332427K0001](https://sam.gov/workspace/contract/opp/ec4254f4fdf24f8998bd4e10d5b58050/view), notice ID `ec4254f4fdf24f8998bd4e10d5b58050`. Its source acquisition remains in the [original request](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791769136276139?thread_ts=1791759228.107759), continued through the [same owner's source return](https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791773057199599?thread_ts=1791759228.107759).

The issued files are Request for Information (RFI) - Final.docx, Performance Work Statement (PWS) - Final.docx, and RFI_Notice of Intent.docx. The existing LGNDX seven-source seed already retains the government text in its observed text format and the exact public notice record. An original API response, description or DOCX returned by the same acquisition adds its own complete source identity and revision links.

The prepared query selects that notice within 1–12 October 2026. Original provider response fields and files are adopted when the existing source operation returns; the query plan itself remains an operating input.

## Source authority

[GSA API guide](https://open.gsa.gov/api/get-opportunities-public-api/): Overview; Version Control - v2; Authentication and API Keys; request and response parameter tables; examples; HTTP response codes and error messages.

[Original MCC notice](https://sam.gov/workspace/contract/opp/ec4254f4fdf24f8998bd4e10d5b58050/view): issued opportunity and attachment selection. Source-specific response rules continue in the original LGNDX reference packet and response workbook.
