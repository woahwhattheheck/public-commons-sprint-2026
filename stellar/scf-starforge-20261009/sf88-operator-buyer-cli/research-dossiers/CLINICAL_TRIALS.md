# ClinicalTrials source receiving in Research dossiers

This is the Research receiving arm of the maintained ClinicalTrials product. The original `sf30-seller-sdk/clinicaltrials/` operator owns registry requests, capture/resume, lossless whole-study NDJSON, native projection and dataset builds, PRS work, publisher releases and customer packages. Research binds one of its retained cohorts to a saved question, reviews the complete studies, records evidence and findings, and exports the original dossier with its source intact.

The input is the **original `clinicaltrials-workspace.zip`** produced by that operator. The source checkpoint and the same file inside `export_customer` both use `stellar-forge.clinicaltrials-packet.v1`. It includes original captures, raw responses, version observations, complete NDJSON sources, mappings, native build packets, study decisions and retained PRS records. This adapter neither reacquires the registry nor starts another provider workspace.

## Complete browser flow

Start the existing Research application:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/server.mjs \
  --dir /absolute/private/research
```

The host needs Node and Python 3. Python uses its standard `zipfile`, JSON and decimal libraries; no additional Python package or provider credential is required. If necessary, select the installed interpreter with `--clinical-trials-python /absolute/python3`. Open the private URL returned by the original server.

1. Create or select a dossier and save the research question.
2. Open **Trial registry**. Receive the original source ZIP from the existing ClinicalTrials operator or customer package.
3. Select its captured cohort. The pane shows the original query, capture status, provider data timestamp, source hash and native build identities. A partial capture requires an explicit checkbox.
4. Choose the saved question and edition label, then **Prepare cohort review**. The plan binds the original packet SHA, manifest SHA, capture ID, question wording and dossier revision.
5. **Read retained source into review**. This reads the saved packet locally. It verifies every declared member, original page/cursor/receipt identity, exact NDJSON source and complete study values before preparing the Research edition.
6. Review the paged cohort, full protocol/results/annotation/document/derived records and original coverage. Numeric tokens remain unchanged in the full source display; summary numbers are strings. Dates retain their original precision and ACTUAL/ESTIMATED type.
7. **Retain reviewed edition** applies the reviewed source to the original dossier Store. Use the existing **Sources**, **Questions** and **Findings** workflow to select evidence, annotate it and write the report.
8. Export the dossier through the existing HTML/Markdown report or streamed portable JSON/gzip action. Reopen the portable file in the original Research application. The **Original dossier registry editions** section works without the ClinicalTrials console or the temporary receiving operation.
9. Download the **complete provider source packet** from the retained edition whenever the native ClinicalTrials operator needs to receive it. The original compressed bytes and SHA are preserved.

A stopped local read retains the same input and plan. Resume it with the same operation. If the edition was published before the status response was lost, the operation adopts that exact edition. If the original Store completed receiving before the caller lost its response, the saved pending intent is reconciled against the actual original dossier revision. Neither continuation requests registry data again.

## Native command line

The additive entry point is:

```text
stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/clinical-trials-cli.mjs
```

It exposes the same import → prepare → stage → review → receive → retained read/compare → report/portable export → reopen workflow. Run `--help` for all options.

```sh
node clinical-trials-cli.mjs import \
  --dir /absolute/private/research \
  --file /absolute/clinicaltrials-workspace.zip \
  --sha256 ORIGINAL_PACKET_SHA256

node clinical-trials-cli.mjs prepare \
  --dir /absolute/private/research \
  --dossier ORIGINAL_DOSSIER_ID --question ORIGINAL_QUESTION_ID \
  --revision CURRENT_REVISION --source ctsrc_ORIGINAL_PACKET_SHA256 \
  --capture capture-ORIGINAL_UUID --request-id ORIGINAL_REQUEST_UUID \
  --label "Retained registry portfolio"

node clinical-trials-cli.mjs stage \
  --dir /absolute/private/research \
  --operation ct_ORIGINAL_OPERATION_SHA256 --plan-sha256 ORIGINAL_PLAN_SHA256

node clinical-trials-cli.mjs receive \
  --dir /absolute/private/research \
  --operation ct_ORIGINAL_OPERATION_SHA256 \
  --plan-sha256 ORIGINAL_PLAN_SHA256 --edition-sha256 REVIEWED_EDITION_SHA256 \
  --revision CURRENT_DOSSIER_REVISION

node clinical-trials-cli.mjs export-dossier \
  --dir /absolute/private/research --dossier ORIGINAL_DOSSIER_ID \
  --format json.gz --output /absolute/new-dossier.json.gz

node clinical-trials-cli.mjs reopen \
  --dir /absolute/private/receiving-research \
  --file /absolute/new-dossier.json.gz
```

The placeholders are returned by the original actions; do not generate a new request UUID merely to retry an uncertain operation. `inputs`, `review`, `retained`, `retained-review`, `record`, `retained-record`, `compare`, `compare-retained`, `download` and `download-packet` supply the full read/download path. Output files are create-only.

The original provider command remains **`clinicaltrials`**. The proposed optional installed alias for this receiving CLI is **`research-trials`**. Applications should continue to open the same Research dossiers listener.

## Existing console and MCP integration

The Research server retains its original loopback Host/Origin checks and bearer capability from the private `/#token=...` URL. A consumer uses its existing host-selected Research connection; no Clinical provider credential enters a dossier, request body or portable file.

All routes below are under:

```text
/api/dossiers/{originalDossierId}/clinical-trials
```

| Method and suffix | Input or result |
| --- | --- |
| GET `/inputs?after=&limit=30` | Retained original packet metadata and captures; `next` is the next source cursor. |
| POST `/inputs?sha256=HEX&bytes=N` | Raw original ZIP bytes, `Content-Type: application/octet-stream`; returns the same `ctsrc_<packetSHA>` identity. |
| GET `/inputs/{sourceId}` | Original packet, capture and native build metadata. |
| GET `/inputs/{sourceId}/packet` | Exact original provider ZIP. |
| POST `/prepare` | `{requestId,questionId,expectedRevision,sourceId,captureId,label?,allowPartial?}`. Returns `plan.id` and `plan.sha256`. |
| GET `/operations?after=&limit=30` | This dossier's saved receiving operations. |
| POST `/operations/{id}/start` | `{expectedPlanSha256}`; starts or resumes the local retained-source read. |
| POST `/operations/{id}/stop` | `{}`; stops this listener's active local read and awaits its owned child. |
| GET `/operations/{id}?offset=0&limit=50` | Exact operation, prepared source, coverage and paged study summaries. |
| GET `/operations/{id}/record?index=N` | Complete original study text plus its page/capture/source metadata. |
| GET `/operations/{id}/edition` | Complete prepared Research envelope as a download. |
| GET `/operations/{id}/compare?before=ID` | Selected same-question cohort comparison. |
| POST `/operations/{id}/receive` | `{expectedPlanSha256,expectedEditionSha256,expectedRevision}`; original Store receiving and actual revision receipt. |
| GET `/retained` | This dossier's original ClinicalTrials retained editions. |
| GET `/retained/{editionId}?offset=0&limit=50` | Retained source coverage and study summaries after portable reopen. |
| GET `/retained/{editionId}/record?index=N` | Complete original study and its immutable source binding. |
| GET `/retained/{editionId}/edition` | Original retained Research envelope. |
| GET `/retained/{editionId}/packet` | Byte-exact original ClinicalTrials source ZIP from that envelope. |
| GET `/retained/compare?before=ID&after=ID` | Two original retained editions for the same question. |

The Python Clinical operator and its existing MCP can download **`clinicaltrials-workspace.zip` from the selected original `export_customer` result**, using `GET /api/clinical/export?exportId=...&file=clinicaltrials-workspace.zip`, and upload those same bytes to the Research input route. Preserve the original export ID, file SHA and snapshot in the upstream handover. The full outer customer package's `source.json/sourceFiles` remains with the original dataset/publisher receiving engine; this Research arm retains the complete native workspace packet without repackaging or replacing that outer contract.

The existing Research client and MCP retain ownership of generic dossier creation, questions, evidence selection, findings, history, reports and portable upload/download. This leaf adds Clinical cohort intake and typed review to that same Store.

## Source and interpretation

The original API uses full nested study records when `fields` is omitted. Opaque paging tokens belong to the same query/filter/sort scope; an empty page may still have a next token. This receiver validates the captured requests and page chain from the original packet and never issues those requests itself.

Original page bytes and the provider engine's complete NDJSON bytes remain separate. The original NDJSON conversion preserves numeric spelling; Research stores each complete original NDJSON record as text and verifies its bytes/SHA against the original page's NDJSON digest and full source digest. Display indentation does not parse numbers into JavaScript floating-point values.

The complete packet is checked with Python's ZIP reader before intake: canonical declared member paths, no special files or duplicate members, bounded sizes, exact member hashes, exact original cursor/request/receipt bindings and semantic equality of original HTTP study objects and retained NDJSON objects. Retained dossier reads independently bind the original packet manifest, selected capture, per-page source digest and whole-source digest.

Source observations are not medical conclusions. Cohort membership and status describe the selected registry source. A study absent from another selected capture is reported as **absent from that capture**; the tool does not infer withdrawal. Equal provider version observations do not establish a transactional snapshot. Full source text and section-value changes are reported separately.

Current first-party contracts:

- [ClinicalTrials.gov API v2 OpenAPI](https://clinicaltrials.gov/api/oas/v2)
- [ClinicalTrials.gov API documentation](https://clinicaltrials.gov/data-api/api)
- [ClinicalTrials.gov source terms](https://clinicaltrials.gov/about-site/terms-conditions)
- [NLM: API v2 introduction](https://www.nlm.nih.gov/pubs/techbull/ma24/ma24_clinicaltrials_api.html)
- [NLM: API use in place of screen scraping](https://www.nlm.nih.gov/pubs/techbull/ja25/ja25_clinical_trials_screen-scraping.html)

The source packet limit is 128 MiB compressed, with the original 2 GiB declared source-member limit. A prepared Research envelope must fit the original 64 MiB retained-edition limit. The real full portfolio is received from its existing source packet; native acquisition, merchant, projection and PRS capabilities remain in their original maintained modules.
