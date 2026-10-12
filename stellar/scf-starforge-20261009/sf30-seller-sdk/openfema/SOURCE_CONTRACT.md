# OpenFEMA source contract and portfolio operating model

This workspace uses three original FEMA feeds to assemble a complete selected disaster cohort, retain its source records, review a regional Public Assistance portfolio and publish an immutable customer edition.

## Current source selection

| Workspace kind | Original entity | Version | Original paging key | Business identity |
|---|---|---:|---|---|
| Declarations | DisasterDeclarationsSummaries | 2 | id | disasterNumber + placeCode |
| Applicants | PublicAssistanceApplicants | 1 | id | disasterNumber + applicantId is a join key; duplicate candidates require review |
| Projects | PublicAssistanceFundedProjectsDetails | 2 | gmProjectId | gmProjectId |

The current project dictionary exposes **no id field**. Its primary key is the bigint gmProjectId. Keep it as original numeric text; JavaScript floating-point numbers cannot represent every possible bigint exactly. The applicant dictionary documents no primary key. It has no gmApplicantId field, so gmApplicantId cannot be used to join that endpoint.

Original field responses were retrieved over HTTP on 12 October 2026:

| Original response | Bytes | SHA256 | Retained public repository Git blob |
|---|---:|---|---|
| Project v2 dictionary, 25 fields | 14,207 | fc50820c02221a259d2132816408963255ecd19a84697a118fe981a331e2697c | 1f0ebdb8be786b106db7e002ebb9bec9a77707a5 |
| Applicant v1 dictionary, 11 fields | 5,733 | 5faffb67532711b39bd321acee8ff416f9bef61600b9f6a7f2ed02145544a69c | d153c4c2dd20be6584b9f85e6c2eaa1fa19b6761 |

The project response's original query rundate is 2026-10-12T09:27:29.123Z; the applicant response's is 2026-10-12T09:27:33.960Z. Their count values are zero because those field-discovery calls did not request a count. Both have top1000 and contain the complete field list below that limit. The complete raw responses are retained separately from source-contract.json's extracted field definitions.

Current declarations field metadata was also retrieved over HTTP: 29 fields, 17,161 bytes, SHA256 d0be0b4c11e013cdd9e5095a64fcf4975b18ad83ff7bb3b79a2d76643a52f706. Fields added since the older official notebook include tribalRequest, declarationRequestDate, incidentId, region and designatedIncidentTypes. fipsStateCode and declarationRequestNumber are text.

Every new capture reacquires the exact selected dataset and field metadata. These observations establish the implementation contract; they do not substitute for a later capture's own source responses.

Official endpoints and definitions:

- [Public Assistance projects v2](https://www.fema.gov/openfema-data-page/public-assistance-funded-projects-details-v2)
- [Public Assistance applicants v1](https://www.fema.gov/openfema-data-page/public-assistance-applicants-v1)
- [Disaster declarations v2](https://www.fema.gov/openfema-data-page/Disaster-Declarations-Summaries-v2)
- [OpenFEMA API documentation](https://www.fema.gov/about/openfema/api)
- [Original dataset metadata API](https://www.fema.gov/api/open/v1/OpenFemaDataSets)
- [Original field metadata API](https://www.fema.gov/api/open/v1/OpenFemaDataSetFields)
- [FEMA terms and citation requirements](https://www.fema.gov/about/openfema/terms-conditions)

## What the records represent

A declaration record represents one designated area within a disaster. Count distinct disasterNumber values to count disasters. Joining every project to every area row would multiply its financial values.

The declaration's placeCode distinguishes the declared area. Tribal declarations and reservations require their original placeCode and designatedArea; they do not always have a county FIPS value. A county code000 can represent a statewide designation. Keep tribalRequest visible and preserve designatedIncidentTypes separately from the primary incidentType.

The applicant feed supplies entity names and public organization addresses. Match applicants to projects on the exact disasterNumber and applicantId text. Leading zeroes remain significant. A repeated pair is a set of candidate records requiring review; do not select one silently. A missing applicantId or unmatched applicant must retain the original project and its source coordinates.

The project feed contains obligated project worksheets. FEMA's current description identifies FAC-Trax, including Grants Manager, as the source and explains that source-system migration changed membership. The current file does not enumerate all work still awaiting an initial obligation.

Project county/countyCode describe applicant location. They are not a guaranteed damage-site coordinate. A regional portfolio can group the reported applicant location and declaration geography while retaining that distinction.

The original API's generic id can reset after a full dataset reload. It establishes paging order inside a captured source instance; it cannot join different datasets or identify a continuing business record across editions.

## Preserve the monetary measures

All four amounts use the source's decimal(13,2) type. Keep each original numeric lexeme, then derive exact integer cents for arithmetic. Preserve unknown/null projectAmount separately from zero.

| Field | Source meaning | Operator treatment |
|---|---|---|
| projectAmount | Estimated project cost in dollars, excluding administrative costs, based on the damage survey | Report estimated project cost and its missing-value count |
| federalShareObligated | Grant funding available to the grantee (State) for approved project worksheets | Report the source's federal funding measure |
| totalObligated | Federal share of eligible project amount plus grantee and sub-grantee administrative costs | Report separately from project cost and federalShareObligated |
| mitigationAmount | Proposed Public Assistance amount associated with Section406 mitigation | Report separately; preserve negative adjustments and incomplete coverage noted by FEMA |

The mitigation definition expressly allows negative values from cost adjustments, deobligations and incorrectly categorized cost lines. Negative source amounts belong in review and arithmetic as written.

Do not add these columns together as independent revenue. Do not infer a State/local cost share from a simple subtraction, and do not multiply a reported project cost by an assumed federal-share percentage.

A project row is a current project measure. firstObligationDate and lastObligationDate identify its obligation range; they do not turn that row into a ledger of payment transactions. An edition-to-edition amount delta describes the difference between those retained source observations.

FEMA describes these values as raw grant-system data, potentially different from its official financial reporting systems and USAspending because of reporting periods and business rules. Retain the original source description and dataset terms with the customer edition.

## Select complete linked cohorts

A scope uses named fields:

~~~json
{
  "disasterNumbers": [4724],
  "states": [],
  "declarationDateFrom": null,
  "declarationDateTo": null,
  "pageSize": 1000
}
~~~

At least one disaster, state or declaration-date selector is required. Selectors combine with AND; values within a list combine with OR. The end date includes its full UTC calendar day. A declaration-date start of1953-05-01 can select the complete declared history.

The capture first retrieves all declaration-area records matching that scope. It derives the distinct disasterNumber set and then retrieves all applicant and project records for those disasters. Dates and state selection therefore restrict the disaster cohort without trimming a selected disaster's later project history.

Disaster lists are split into disjoint groups of40 to keep URL size practical. Every group has its own count and pagination record. A record outside that group's scope is rejected as a provider-filter mismatch, even if it belongs to another selected group.

OpenFEMA's ordinary page default is1,000 and its documented maximum is10,000. The first page of each group requests $count=true. Subsequent pages request $count=false and advance by the actual retained row count. A returned zero count on these later pages means the count was not requested.

The API request retains its original metadata, including skip, top, filter, orderby, count, entityname, version, url and rundate. No projection or $select removes provider fields.

Source bodies are stored by SHA256 before parsing. The lossless parser turns every JSON number token into its exact original string, including decimals, exponent notation and large identifiers. Strings, booleans and null preserve their JSON types. Duplicate JSON object keys are rejected because they would otherwise silently replace an earlier field.

## Complete refresh and recovery behavior

Each dataset is bracketed by original dataset metadata before and after paging. Completion requires the same lastDataSetRefresh and global recordCount, complete scoped counts, correct group membership and source-key order.

FEMA's lastDataSetRefresh is an API dataset refresh timestamp. It does not establish that every underlying business record changed. A row's lastRefresh is also an OpenFEMA record update time, not an interchangeable source-system event date.

OpenFEMA has no common transaction token spanning these three datasets. The source edition therefore records each dataset's actual refresh epoch and declares dataset-refresh-bracketed consistency. Preserve missing relationships for review instead of forcing a join.

If the dataset refreshes during acquisition, the capture archives that attempt's references and restarts the affected dataset from its first page. It can repair one additional moving-source attempt within the same call, then retain a resumable paused operation if the provider continues changing. Earlier original pages remain available.

A network interruption resumes under the same24-hex capture identifier. That matches the existing native store's response-journal contract. Successful original responses are reused only within the same dataset generation. Provider Retry-After is retained and honored for that exact URL.

The immutable source edition has a64-hex identifier and sourceSha256. Only a complete three-dataset source edition enters the edition list. An interrupted or partial scan is not used to infer removed projects.

## Native capture API

~~~js
import {openWorkspaceStore} from '../stellar-expert/store.mjs';
import {createOpenFemaCapture} from './capture.mjs';

const store = await openWorkspaceStore('/absolute/private/workspace', {
  schema: 'stellar-forge.openfema-workspace.v1'
});
const capture = createOpenFemaCapture({store});

const operation = await capture.begin({
  id24: '3bda20261012000000000001',
  scope: {disasterNumbers:[4724], pageSize:1000},
  label: 'Regional Public Assistance portfolio'
});

const edition = await capture.run(operation.id, {
  onProgress: async progress => { /* update the existing operator surface */ }
});

for await (const source of capture.rows(edition.id, 'projects')) {
  // source.record is the complete lossless original object.
  // source.sourcePageSha256 identifies its retained source response.
  // source.sourceRow is the zero-based row position in that response.
  // source.sourceUrl is the original request URL.
}

const bundle = await capture.exportBundle(edition.id);
await store.close();
~~~

The factory also exposes status(id24), resume(id24,options), readEdition(id64), importBundle(bundle) and the combined capture({id24,scope,label,...options}) convenience method.

The original store remains the sole writer. Capture owns its capture progress records, completed source editions and editionIds registration. It does not select the operator's active edition or change saved portfolio decisions.

## Portable original-source handover

exportBundle returns schema stellar-forge.openfema-source-bundle.v1. It contains the original source edition and all original dataset metadata, field dictionaries, pages and closing metadata. Each response carries its actual URL, HTTP200 status, observed timestamp, selected original headers, byte count, SHA256 and bodyBase64.

importBundle validates each original response, exact cohort, disjoint pagination, source count, source epoch and dataset version. It then saves the **same original edition object and identifier**. Completed requests are idempotent; an interrupted import continues only with that same bundle.

A genuine external source bundle can supply bodyText instead of bodyBase64 for a valid unchanged UTF-8 response, and can omit an existing edition when it is creating a new captured source edition. The provided acquisition contract uses the same canonical native query URLs so its pagination is directly checkable.

Original response bytes remain available through store.object(sha256). The original edition and each source-row coordinate remain meaningful after closing and reopening a receiving workspace.

## Useful complete portfolio workflows

### Regional recovery portfolio

Select a state/date cohort or explicit disaster list. Inspect the declared areas, then the full associated applicant/project population. Review missing and ambiguous applicant joins, negative adjustments and missing estimated costs. Save a named portfolio with explicit category, process/status, applicant and project-size filters. Publish the reviewed project rows with their original source references.

### Recovery program follow-through

Within an existing selected disaster, review projects by projectProcessStep, projectStatus, firstObligationDate and lastObligationDate. Use transparent operator-selected age or amount thresholds to prioritize attention. Retain the source field and threshold beside every review decision, allowing an analyst to distinguish an operational rule from a FEMA eligibility determination.

### Edition change review

Capture a later complete edition using the same scope. Match projects on gmProjectId, declarations on disasterNumber+placeCode, and applicant candidates on their exact join key. Classify additions, removals, changed source values and unresolved matches. Display monetary deltas separately for all four columns. A project dropped from the current source is a source membership change; its earlier original record remains retained.

### Applicant and mitigation working sets

Build a portfolio for selected reported applicants, categories and project sizes. Keep mitigationAmount alongside federalShareObligated and estimated project cost, without treating mitigation as an extra independent obligation. Retain applicant-location geography and declared-area geography as their respective original fields.

### Customer receiving and merchant publication

Freeze the reviewed edition, exact projected rows, source-response files and review decisions. A second workspace receives the complete source bundle and reopens the same source edition. The original SF30/SF82/SF88 path can publish and deliver the frozen projection while the customer retains source provenance and the complete original inputs.

## Join the existing publisher correctly

The existing stellar-expert/dataset.mjs prepareNativeDataset function is specific to that provider: it calls the Stellar Expert editionRows renderer and embeds its SOURCE_CONTRACT. OpenFEMA supplies its own package writer for dataset.csv, dataset.json, source.json and the exact provenance files.

The maintained generic functions can then be reused:

- queryNativeDataset(store,dataset,query)
- nativePublishers(store)
- prepareNativeRelease(store,{dataset,origin,path,payment,id,runtime,publishers})
- inspectNativeRelease / controlNativeRelease
- inspectBuyer / receiveBuyer / readBuyerOutput

The dataset receipt uses dataset-<24hex>, relativeDirectory datasets/<id>, relativePublisherDirectory datasets/<id>/publisher, its original snapshot, editionId, sourceSha256 and name. A package's source.json lists sourceFiles entries with path, bytes and sha256.

prepareNativeRelease verifies those original byte identities, copies the complete package and invokes the existing publisher.prepare and publisher.release.stage operations. The existing publisher remains the owner of release and buyer state.

Use string columns for preserved original decimal values and identifiers unless a separate explicitly typed exact-arithmetic interface is provided. The native dataset handler should not advertise lexicographic string sorts as numeric financial order.

## Official reference implementation

FEMA's own complete tutorial source establishes pagination, metadata and refresh behavior:

- [Part3: Paging to get data](https://github.com/FEMA/openfema-samples/blob/master/analysis-examples/API_Tutorial_Part_3_PagingToGetData.ipynb), original Git blob aa088d34638192b7a70f09983d5c9997aa71901f
- [Part4: Metadata](https://github.com/FEMA/openfema-samples/blob/master/analysis-examples/API_Tutorial_Part_4_Metadata.ipynb), original Git blob6192e84bece3e13b574db159ff921f0b484b0dd8
- [Part5: Dataset updates](https://github.com/FEMA/openfema-samples/blob/master/analysis-examples/API_Tutorial_Part_5_GettingDatasetUpdates.ipynb), original Git blob27f6af34f51785eda934040be3975b6739f83cd8

The original tutorial repository's license applies to its example source. Retain the separate official FEMA dataset terms and citation link with each data edition.
