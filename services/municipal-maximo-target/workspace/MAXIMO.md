# Maximo target receiving in the municipal workspace

This addon extends the original municipal migration workspace with configured Maximo target acquisition, source-to-target identity mapping, native load preparation, and complete returned-result receiving. It uses the existing project, source editions, comparison, history, report, and editable backup. It also retains the original public municipal capture and refresh interfaces.

The `Maximo target` tab is part of the existing authenticated local operator application. The installed API-key environment variable stays in the server process. The collection worker performs HTTPS GET requests. The prepared Add/Update file is used by the prime's selected integration; receipt of its original result and a subsequent complete target capture are separate saved steps.

## Install the complete current source

Use Python 3.11 or later in the actual existing application environment. Stop that application's server before replacing its source and preserve the current workspace backup. From the public addon directory:

```sh
python install.py --application /absolute/path/to/mcpherson_ks_modular_software_2026 --check
python install.py --application /absolute/path/to/mcpherson_ks_modular_software_2026
python install.py --application /absolute/path/to/mcpherson_ks_modular_software_2026 --check
```

The installer selects exact original source hashes or this same edition's completed postimages. It parses each complete Python source before changing files, retains every changed original, and records its resumable installation in `maximo-install-record`. A differing current application needs an explicit composition onto that current source. The installer does not create a second customer workspace or alter the workspace database.

Run the remaining commands from the existing application directory. `WORKSPACE`, `PROJECT`, and each revision below are the actual saved original values, not newly invented case IDs. The existing UI project detail and normal workspace view expose those values.

## Configure the actual authorized Maximo target

Create a private profile using `maximo-profile.example.json` as a structural example. Replace every example endpoint, object structure, org/site, and field with the actual installation. Record the existing tenant read authorization/reference. The exact API base must be HTTPS and end in `/api` or `/oslc`.

The identity must be the actual compound object key. A common asset mapping may include `orgid`, `siteid`, and `assetnum`, but the selected tenant object structure/schema is authoritative. Do not use repeated municipal business IDs as a substitute for the original municipal source-qualified OBJECTID. The provider `href` is retained unchanged as a resource link, independently of the business key.

Select either a verified actual `source_link` field containing each exact original source ID, or an explicit one-to-one crosswalk. Each crosswalk row contains the compound `native` component list in the configured identity-field order, exact `source_id`, and an explanation. Both may be supplied only when they agree. Unmatched targets remain distinct native records in the comparison; they are not silently discarded.

The `fields` object maps the existing target display/comparison fields to explicit original JSON pointers. Org/site values are checked for every row in both complete observations. The actual original schema is acquired before the first walk and after the second. Configured attributes and aliases must exist in that schema. The collector requests `_dropnulls=0`, the original `_rowstamp`, persistent fields, and each explicitly mapped root selector. It does not invent geometry from scalar coordinates or convert business identifiers into provider links.

Use the existing secret provisioning method to set the profile's `apikey_env` in the operator's environment. The profile stores only the variable's name.

```sh
python -m workspace.maximo_cli --workspace "$WORKSPACE" profile --file /private/selected-profile.json
python -m workspace.maximo_cli --workspace "$WORKSPACE" status --project "$PROJECT"
python -m workspace serve "$WORKSPACE" --port 8766
```

In the app, select the original project → **Maximo target** → configured profile → **Capture complete target**. The same flow is available through:

```sh
python -m workspace.maximo_cli --workspace "$WORKSPACE" capture --project "$PROJECT" --actor "$ACTOR" --operation "$CAPTURE_ID" --profile "$PROFILE_ID" --revision "$REVISION"
python -m workspace.maximo_cli --workspace "$WORKSPACE" resume --operation "$CAPTURE_ID"
python -m workspace.maximo_cli --workspace "$WORKSPACE" status --project "$PROJECT"
```

Retain each original operation ID. A definite transient response or interrupted transfer records the complete available body, status, headers, time, and actual Retry-After floor. Continue the same operation after that floor. Completed ordinary GET steps are reused. A process interruption before a response is recorded can repeat that ordinary read. Stable paging is rejected because those provider pages can expire as delivered.

A permanent provider/schema/population mismatch remains attached to the original operation for inspection. After resolving the actual cause, a separate capture ID creates a new observation edition. Do not change the old profile inside its frozen operation or relabel old responses as a fresh capture.

Two complete ordinary-page walks must produce exactly the same original compound identities and typed record values; each published totalCount must match. All original successful and failed attempts are retained. This provides observed consistency, not an atomic database snapshot. Current configured bounds are up to 50,000 selected rows, 1,000 rows per page, 20 MiB of aggregate original response bytes, and a 32 MiB complete carrier. Choose a useful authorized scope within those complete-source bounds.

## Receive and compare the same target edition

For a READY capture, choose **Complete original target** to download its full carrier. Choose **Receive target edition** to import it into the current project's `target_assets`. Then open **Inputs & mapping**, inspect the actual imported fields/attributes and confirm the target mapping. Review every unmatched source/target row and repeated-business-ID distinction in the existing comparison. The original full Maximo record is retained as `maximo_original_json` so decimal values are not rounded by the browser's number type.

CLI equivalents:

```sh
python -m workspace.maximo_cli --workspace "$WORKSPACE" export-capture --operation "$CAPTURE_ID" --output /private/complete-target.json
python -m workspace.maximo_cli --workspace "$WORKSPACE" receive --project "$PROJECT" --actor "$ACTOR" --operation "$RECEIVE_ID" --capture "$CAPTURE_ID" --revision "$CURRENT_REVISION"
```

Receiving uses the existing workspace writer's original operation replay and revision check. A replay of the same receive ID returns the original result; a new intentional target edition uses a new receive operation and current revision.

## Prepare a native Add or Update

Use the same project's mapped, nonexcluded source population. Confirm the original source mapping and resolve its mapping findings before preparation. The load mapping explicitly selects:

- `action`: `Add` or `Update`;
- `fields`: actual target scalar field → original source JSON pointer (typed attributes are under `/attributes`);
- `constants`: explicit target scalar constants, including the chosen original org/site when appropriate;
- `source_ids`: exact source-ID subset, or `null` for the complete nonexcluded population;
- `allornothing`: whether the provider transaction is all-or-nothing;
- `review_reference`: the original prime mapping/rehearsal review.

A root field must be writable and match the actual acquired schema. Objects and arrays are excluded from this load format. Null requires the schema's explicit permission. Exact original decimal values can come from retained source attributes; numeric constants must pass the same scalar validation. The full identity and selected org/site are present in every prepared row.

Add rejects observed existing identities. Update requires the explicit source-to-native match, preserves its original compound identity, retains the actual resource href, and includes the unchanged original string `_rowstamp`. Its prepared request includes `patchtype: MERGE` to preserve omitted children. The current simplified `_action` bulk shape is used; the historical `_data/_meta` wrapper is not substituted.

```sh
python -m workspace.maximo_cli --workspace "$WORKSPACE" prepare-load --project "$PROJECT" --actor "$ACTOR" --operation "$LOAD_ID" --capture "$CAPTURE_ID" --revision "$CURRENT_REVISION" --mapping /private/reviewed-load-mapping.json --output /private/prepared-maximo-load.json
```

The app provides the same **Prepare retained load** action and downloads the whole prepared request. It retains the source input/hash, source mapping, original target/schema identities, each row's source ID/native key/href/rowstamp, exact body bytes/hash, selected method/URL/headers, and their combined `request_sha256`.

The prime uses those exact selected request semantics through its own authorized integration. API credentials are supplied there. `transactionid` is the original load operation, not a reason to resend an ambiguous mutation: IBM's default duplicate-detection retention is short. Reconcile an ambiguous outcome using the original intent and actual current target; do not generate a new transaction ID to bypass it.

## Receive the actual original bulk response

The result file has exactly these fields:

```json
{
  "prepared_request_sha256": "the prepared request_sha256",
  "request_body_sha256": "the prepared body_sha256",
  "http_status": 200,
  "headers": {"Content-Type": "application/json"},
  "body_base64": "base64 of the complete actual original response body",
  "observed_at": "actual ISO-8601 observation time",
  "provider_reference": "original execution/response source reference"
}
```

Retain the actual HTTP status and all available original response headers. The prepared-request hash binds the selected method, URL, header contract, and body; the body hash binds the exact row order. Do not fabricate a successful response to advance the case.

```sh
python -m workspace.maximo_cli --workspace "$WORKSPACE" receive-load --project "$PROJECT" --actor "$ACTOR" --operation "$RESULT_RECEIVE_ID" --load "$LOAD_ID" --result /private/original-result.json --output /private/received-result-report.json
```

The app's **Receive complete provider result** reads that same full file. HTTP200 is evaluated through every positional `_responsemeta.status` and `_responsedata.Error`. The complete original response is retained even when malformed or incomplete at the semantic level, and ambiguous rows remain unknown. Explicit all-or-nothing failures are displayed as an uncommitted transaction.

Capture a new complete target edition after the prime's actual mutation. Receive it in the same project and use the existing comparison/report to assess the actual result. Reported provider success and independently observed target values remain separate fields.

## Save, reopen, and native receiving

The ordinary **Contract & handoff** export includes complete capture operations/source responses, prepared load/request bytes, and every original returned result/report. The normal editable backup includes the same database tables. Existing mapping, history, public source editions, geometry, repair decisions, work orders, and project IDs remain in the same workspace.

```sh
python -m workspace backup "$WORKSPACE" /private/municipal-with-maximo.zip
python -m workspace restore /private/municipal-with-maximo.zip /private/reopened-municipal-workspace
python -m workspace.maximo_cli --workspace /private/reopened-municipal-workspace status --project "$PROJECT"
python -m workspace.package --output /private/Municipal_Maximo_Operator.zip
```

For the original equipped receiving programme, record the exact installed source manifest and original project. Open the existing app at desktop and phone widths, operate the Maximo tab, inspect retained capture/status/source downloads, receive a genuine target edition where the configured tenant is available, confirm its target mapping, and inspect the ordinary comparison. Prepare an actual reviewed source-bound load. Receive the prime's original result only when it exists. Download the full report/handoff and editable backup, restore into a new directory using the existing command, and reopen the same project and Maximo history there. Retain the actual screen images, complete files and command outputs with the original case.

The visual pass must inspect this installed version and its real controls before describing it as customer-ready. The supplied source has received source review; actual tenant and browser observations are reported by the original receiving environment.

See **MAXIMO_CONTRACT.md** for the IBM primary sources and the precise version, paging, concurrency, bulk and identity decisions.
