# QWC publication review and portable receiving

This operator connects an original QGIS/QWC publication to its actual map, feature information, print and role-specific responses. It keeps the original files and requests, explains differences between publication editions, and carries the review into a new editable workspace.

The installed application runs with Python 3.11 or later on Linux and uses the Python standard library. Open its local address in a current browser. Node, Playwright and Chromium are needed only for the complete automated browser receiving operation described below.

## Open the operator

Keep the complete software directory together, including static/ and both source-contract documents.

~~~sh
python3 -B server.py --workspace ./review-data --title "QWC publication review" --port 8784
~~~

Open http://127.0.0.1:8784. The startup JSON also gives the selected address and original workspace ID. To reopen the same workspace, use the same command without --title. Port 0 selects an available local port and reports it in the startup JSON.

Enter the operator name in the application. It records who made each decision. The application is a local review workspace; the existing QWC deployment supplies the original service identity and permissions.

The application sections are:

| Section | Work performed |
| --- | --- |
| Publications | Retain an original publication plan and selected source files; inspect its original publication, roles and request checks. |
| Native responses | Capture the selected requests or import an existing original response with its exact metadata; open original map, feature information and PDF bytes. |
| Operator review | Save a decision and note against the selected capture revision; keep unfinished notes while other work completes. |
| Edition comparison | Compare source publication bindings, native capabilities, fields and values, map/print bytes, evaluations and operator decisions. |
| Handover history | Download the report or a complete editable archive, including full software and the retained original source/response files. |

The local server accepts operations through one worker. Closing it waits for its accepted work and active downloads before releasing the process. Keep its foreground process under the existing host's native job owner.

## Select the original publication

The producer supplies its completed publication.json and the original relative files named by that manifest. PUBLICATION_CONTRACT.md describes the exact publisher interface. The acceptance input binds the raw publication.json SHA-256, original publication ID, QGIS workspace/revision/project, source package, QWC tenant, selected role views and service URL.

The same service URL may serve several editions. Each edition therefore has its own immutable publication manifest and review run ID. The publisher writes the service keyword:

~~~text
starforge-publication:PUBLICATION_ID
~~~

The adapter requires that exact keyword in the native capabilities and project-settings checks, including each selected role. A response from a stale deployment is retained with its actual result and a review issue.

Create a UTF-8 review profile from the actual publication, native capabilities/project settings and agreed acceptance scope. Its schema is starforge.stac-qwc-review-profile.v1.

~~~json
{
  "schema": "starforge.stac-qwc-review-profile.v1",
  "run_id": "publication-edition-one",
  "title": "Selected publication — first edition",
  "principal_references": {
    "existing-analyst-view": "THE_ORIGINAL_NONSECRET_PRINCIPAL_REFERENCE"
  },
  "source_files": [
    "THE_ACTUAL_RELATIVE_CONFIG_PATH_FROM_PUBLICATION_FILES"
  ],
  "checks": [],
  "notes": "The agreed extent, layers, fields, layouts and role behavior for this edition."
}
~~~

This is a configuration template. Replace the selected paths and principal references with the original inputs; supply the actual checks described below. Anonymous role views need no principal entry. Choose only source_files that exist in publication.json's files inventory. The adapter verifies every selected file's raw length and SHA-256 before copying it. It always retains the original publication manifest and review profile.

Use the adapter:

~~~sh
python3 -B publication_plan.py \
  --publication /absolute/original-edition/publication.json \
  --expected-sha256 THE_ACTUAL_PUBLICATION_SHA256 \
  --profile /absolute/selected-review-profile.json \
  --out /absolute/new-review-input
~~~

It produces:

| File | Meaning |
| --- | --- |
| acceptance-plan.json | The full original publication binding, selected request checks and role expectations. |
| sources/ | Exact original manifest, profile and selected configuration/source files. |
| session-bindings.json | Nonsecret role IDs, principal references and names of existing session environment variables. |
| acceptance-input.json | The same plan plus absolute local source paths for the command interface. |

In Publications, select acceptance-plan.json and its retained source files. The browser lets the operator match each selected file to its exact source name. Keep relative source names from the generated sources object, including subdirectories. An existing run with identical selected input reuses its original captures and history.

The source manifest is a binding and inspection input. The producer's complete QGIS project/data package and its QWC deployment/rollback package remain the corresponding native GIS and service handovers. Deliver those original packages alongside this review package when commissioning a complete installation.

## Define the actual native checks

Each check has id, title, operation, params, expect and optional role_expectations. The selected operation is one of GetCapabilities, GetProjectSettings, GetMap, GetFeatureInfo or GetPrint. The collector performs the original service request and retains status, safe observed headers, request parameters, role/principal reference, publication binding, retrieval time, length and SHA-256 with the complete response body.

A role_expectations entry replaces the generic expect object for that role. State the complete desired role expectation in that entry. The adapter adds the original publication keyword and that role's expectedLayerNames to metadata checks.

| Operation | Required selection and useful expectations |
| --- | --- |
| GetCapabilities | Native map/layer names, queryability, CRS, publication keyword, permitted or forbidden layers. The adapter inserts this check if it is absent. |
| GetProjectSettings | The same publication metadata plus the actual native ComposerTemplate and ComposerMap names needed for print. |
| GetMap | Actual LAYERS, CRS or SRS, BBOX, WIDTH, HEIGHT, FORMAT, and any selected STYLES. Check the returned PNG dimensions and review its actual appearance. |
| GetFeatureInfo | The same map selection plus QUERY_LAYERS, INFO_FORMAT and the selected I/J or X/Y pixel. Through this QWC OGC proxy, LAYERS must equal QUERY_LAYERS and INFO_FORMAT is text/xml. |
| GetPrint | Actual TEMPLATE, FORMAT=application/pdf and each selected map item's mapN:EXTENT and related parameters. Review the original returned PDF and its map/content. |

The WMS service is the existing gateway's /ows/<project-relative-name> route. Select its actual URL from the publication. /ows/api/ is the service documentation route.

### Coordinates and native print layouts

Use the actual server version, CRS and native request convention. In WMS 1.3.0, EPSG:4326 uses latitude/longitude wire order; CRS:84 uses longitude/latitude. WMS 1.1.1 uses SRS and X/Y feature-info coordinates; WMS 1.3.0 uses CRS and I/J.

QGIS 3.40 also applies the WMS 1.3.0 axis inversion to a print map item's EXTENT when its destination CRS has inverted axes. Select actual ComposerMap names from GetProjectSettings and provide every required map extent. An assumed map0 or a copied global extent can address the wrong native layout.

The original source locators, including QGIS's renderer branch implementing that behavior, are in QWC_SOURCE_CONTRACTS.md.

### Denials and protected fields

QWC can return an XML ServiceExceptionReport with HTTP 200 for a denied or unknown service, layer or print template. Selecting a successful HTTP status alone is insufficient. The operator parses the original response and retains its native exception code/message.

Use denial_codes when the selected role is expected to receive a specific native denial:

~~~json
{
  "status": [200],
  "denial_codes": ["LayerNotDefined"]
}
~~~

The actual exception must be present. A successful map or feature response under that expectation produces EXPECTED_DENIAL_MISSING. The review keeps the original returned bytes.

Other supported expectations include:

- status: allowed integer HTTP statuses.
- media_types: selected response media types.
- image_size: the exact [width, height] for the selected map.
- required_layers, forbidden_layers and queryable_layers: actual native WMS names.
- required_templates and required_crs: actual native names.
- required_keywords: exact native service keywords.
- minimum_features and feature_ids: the expected actual feature count/IDs.
- xml_root: the selected native XML root, optionally in {namespace}LocalName notation.
- required_attributes and forbidden_attributes: exact returned attribute names.
- attribute_rules: role-specific layer, feature and group-path rules.

An attribute rule can select the original returned layer name, optional feature ID and exact nested group path:

~~~json
{
  "layer": "THE_ACTUAL_RETURNED_LAYER_NAME",
  "group_path": ["THE_ACTUAL_NATIVE_FORM_GROUP"],
  "required": ["THE_ACTUAL_REQUIRED_DISPLAY_NAME"],
  "forbidden": ["THE_ACTUAL_PROTECTED_DISPLAY_NAME"],
  "allowed": ["THE_COMPLETE_AGREED_ATTRIBUTE_NAME_SET"]
}
~~~

Omit a selector only when the rule should apply across that dimension. An explicit empty allowed array permits no matching fields. QGIS may expose display aliases or configured value representations, so select the names and values from the actual native project/profile. The model retains full group paths, attribute order, duplicate names, string feature IDs and original values. Raster attributes remain attached to their original layer without a fabricated feature ID.

The original QWC XML filter removes direct feature attributes. Nested form groups and raster attributes therefore need the same explicit acceptance traversal. This operator inspects them against the selected field rules and keeps their original XML.

Plain text, HTML or an unsupported feature structure cannot establish a field-policy result. If attribute expectations require a structured model that the response does not provide, the result is REVIEW with FIELD_STRUCTURE_UNAVAILABLE. A supported native XML result with zero features remains a valid empty structured response.

## Use existing role sessions

The publisher's roleViews identify the selected request views. A private view names its original headersEnvironment and the review profile supplies its nonsecret principal reference. A view ID is not itself an account identity.

The native capture adapter reads the named environment value as a JSON object containing the existing Authorization or Cookie header. Use the host's current authorized session source. The values stay in the capture process and are excluded from the review state, source selection and portable archive.

For the interactive server, --sessions selects an existing private regular JSON file. Its entries are keyed by the same role ID:

~~~json
{
  "existing-analyst-view": {
    "role_id": "existing-analyst-view",
    "principal_reference": "THE_ORIGINAL_NONSECRET_PRINCIPAL_REFERENCE",
    "headers": {
      "Authorization": "THE_EXISTING_AUTHORIZED_HEADER_VALUE"
    }
  }
}
~~~

Keep that actual file mode 0600 outside the receiving/export directories:

~~~sh
python3 -B server.py --workspace ./review-data --port 8784 \
  --sessions /absolute/private/original-role-sessions.json
~~~

The server rereads the selected file when an operation needs a session. Completed original captures reopen and repeat under their original operation IDs without fresh credentials or another provider request. A new capture uses its own operation ID and the currently selected original session.

## Capture or import original responses

In Native responses, select the publication run, check and role. Capture runs the selected native request. Capture all uses stable per-check/per-role operations for the selected action. A provider error is retained as that operation's outcome.

Import original response takes two files: the exact body and its original JSON metadata. The metadata must bind:

1. The actual request URL and parameters.
2. The selected role ID and original nonsecret principal reference.
3. The original publication binding, or the exact original plan SHA that contains that binding.
4. The original body length/SHA when its descriptor is present.

The same URL and role can serve several publications; they do not suffice to import another edition's response. A mismatched publication produces IMPORTED_PUBLICATION_CHANGED. The whole original metadata file is retained as imported-metadata.json alongside the body and the new import receipt. Use the original nonsecret capture receipt, with session header values kept in their existing private source.

The browser can reopen a downloaded map, inspect the native structured/text output and download the exact PDF. Reports distinguish automatic evaluation from the operator's saved decision. A REVIEW result identifies an actual mismatch or a requested inspection; opening the bytes and deciding the result is part of the work.

### Interrupted browser work and review conflicts

The browser commits complete pending operation payloads to IndexedDB before submitting them. A reload reopens the same pending operation ID and input. Large source and response files remain in that browser database instead of exceeding localStorage's much smaller quota.

Each unfinished review note retains its original base revision. Refreshing, importing another response or completing a different decision preserves the note. If another revision was saved, review the current capture and explicitly rebase the retained draft before saving. The application keeps a later edit made while a save is in flight.

Browser drafts are local to this workspace and receiving-archive identity. They are not saved operator decisions until the server accepts them. Export after saving the decisions that belong in the handover.

## Compare publication editions

Select the before and after run IDs in Edition comparison. The operator compares the actual retained inputs and latest captures for each check/role pair.

The comparison records:

- Original publication/source bindings and selected request changes.
- Native layers, CRS, layout and service metadata.
- Feature IDs, attribute names, group paths, exact values and their ordering.
- Raw map/print/body hash changes and automatic evaluation issues.
- Saved operator review decisions.

The original bodies remain downloadable, including byte changes that are best assessed visually. A role-policy check uses the actual returned fields rather than assuming that the native proxy has already filtered them.

For a rollback review, the publisher first restores the original project/configuration through its original deployment operation. Capture that real service selection in a new review run while retaining the preceding runs. The acceptance operator does not rewrite the deployment or identity configuration.

## Export and open a new receiving workspace

Handover history creates a complete editable ZIP under a new export operation. It includes:

- The consistent original review state, operation history and decisions.
- Every retained publication plan and selected source file.
- Original native/imported response bodies and their metadata.
- A readable publication-review.html.
- All application, adapter, native journey, browser and documentation source.
- A manifest with each member's exact length and SHA-256.

The same completed export ID returns the same retained archive. A lost final receipt can be reconstructed only from the exact frozen member selection and matching archive bytes.

Receive it into a new directory:

~~~sh
python3 -B server.py \
  --receive /absolute/QWC_Publication_Review_ORIGINAL_ID.zip \
  --expected-sha256 THE_ACTUAL_ARCHIVE_SHA256 \
  --workspace /absolute/new-qwc-receiver
~~~

The receiver verifies the complete archive inventory and every member before opening the new directory. Then start its own included software:

~~~sh
python3 -B /absolute/new-qwc-receiver/software/server.py \
  --workspace /absolute/new-qwc-receiver/workspace --port 8784
~~~

The original workspace ID, publication/capture IDs, source hashes and decisions survive receiving. The receiving context names the exact imported archive. Its snapshot can include the original export operation's RUNNING history because the snapshot was taken during that export. The UI labels this retained history; it does not wait on the prior machine's process or convert it into an invented local completion.

A new receiving export gets a new operation ID. Calls that attempt to resume a historical imported operation receive its retained-history outcome. Keep the original imported archive as the source of that receiving context.

## Run the complete original native customer journey

The native driver joins the producer's actual deployment sequence. It has two phases: capture each original service edition while deployed, then finish the operator, comparison and receiving workflow over those exact responses.

Use one original journey directory, operation_id and actor for the complete operation. Keep the first and second publication manifests/profile files separate, with distinct run_id and capture_id values.

### Capture the first deployed edition

~~~json
{
  "schema": "starforge.stac-qwc-native-review-journey.v1",
  "operation_id": "THE_ORIGINAL_COMPLETE_CUSTOMER_OPERATION",
  "actor": "THE_SELECTED_OPERATOR",
  "directory": "/absolute/private/original-qwc-native-journey",
  "capture_id": "first-edition",
  "title": "QWC publication review",
  "publication": "/absolute/first-publication/publication.json",
  "profile": "/absolute/first-review-profile.json",
  "expected_publication_sha256": "THE_ACTUAL_FIRST_MANIFEST_SHA256"
}
~~~

~~~sh
python3 -B native_journey.py capture --config /absolute/capture-first.json
~~~

The producer then completes its original source refresh, native QGIS save, QWC generation, deployment and reload. Capture the second actual publication with the same journey identity and directory, a new capture_id and review run, and its exact manifest/profile bindings:

~~~sh
python3 -B native_journey.py capture --config /absolute/capture-second.json
~~~

Each complete phase means all selected original response files are retained. Its review_count separately records results requiring review. If a native request fails, preserve its original operation and use an explicitly new capture_id for the later selected attempt. Completed request reuse performs no fresh transport.

### Finish the operator and fresh receiver

The complete workflow selects two distinct original publications and includes all five native operations in both profiles. It needs actual successful capabilities, a visible native map and an original PDF among the retained results to operate those customer paths.

~~~json
{
  "schema": "starforge.stac-qwc-native-review-journey.v1",
  "operation_id": "THE_ORIGINAL_COMPLETE_CUSTOMER_OPERATION",
  "actor": "THE_SELECTED_OPERATOR",
  "directory": "/absolute/private/original-qwc-native-journey",
  "capture_ids": ["first-edition", "second-edition"],
  "browser_timeout": 300,
  "browser": {
    "node": "/absolute/existing/node",
    "playwright_module": "/absolute/existing/playwright/index.mjs",
    "chrome": "/absolute/existing/chrome-headless-shell"
  }
}
~~~

~~~sh
python3 -B native_journey.py finish --config /absolute/finish-receiving.json
~~~

This one continuation:

1. Reopens the exact native captures and compares both publication editions.
2. Checks expected-denial evaluation using an actual retained allowed capabilities response.
3. Opens the local operator in the existing Chromium runtime.
4. Saves a review draft, refreshes/reloads it, rejects an actual wrong-edition import, imports the original response, rebases and saves the retained note.
5. Opens the actual map, checks its native dimensions, downloads the exact native PDF, and operates the comparison.
6. Reviews desktop, 390-pixel and 320-pixel layouts using the same application.
7. Downloads and verifies the complete original handover, then closes the operator.
8. Receives that archive into a fresh directory, starts the included application in a new process, reopens its exact source/history and creates a new receiving export.
9. Publishes QWC_Complete_Native_Receiving.zip with both complete handovers, original native report and actual browser artifacts.

The browser controller permits only the exact local operator origin. Native service captures take place in the preceding capture phases under the original service/session selection.

### Native lifetime and recovery

Keep the foreground command under the existing host's job controller. The journey holds its original kernel flock; the server and browser controller inherit that same lock for their lifetime. Actual child identities are retained, and normal shutdown drains each owned process group. A failed identity/receipt write also enters the same cleanup path.

Continue the same native journey configuration and retained directory after an observed interruption. Its completed captures, browser stages and archives are reopened by exact identity. The final native report/member selection is frozen before package publication. If the full ZIP exists but its last receipt was lost, the driver validates its exact frozen manifest and all member bytes and restores that receipt without rerunning the customer.

The host's original native controller remains responsible for process/record reconciliation after a transport loss. Inspect its actual owner and child state before another foreground invocation; do not infer an exit outcome from a missing tool response.

## Interfaces for an existing operator integration

The Python library exposes PublicationReview.create/open, add_run, capture, capture_record, save_review, compare, export and receive. server.py also provides the command interface:

~~~sh
python3 -B server.py --workspace /absolute/review-data \
  --command overview
python3 -B server.py --workspace /absolute/review-data \
  --command add-run --input /absolute/add-run-action.json
python3 -B server.py --workspace /absolute/review-data \
  --command capture --input /absolute/capture-action.json
python3 -B server.py --workspace /absolute/review-data \
  --command compare --input /absolute/compare-action.json
python3 -B server.py --workspace /absolute/review-data \
  --command review --input /absolute/review-action.json
python3 -B server.py --workspace /absolute/review-data \
  --command export --input /absolute/export-action.json
~~~

Mutation inputs include the actual actor and a unique stable operation_id. add-run accepts plan and sources mapping source names to local file paths. capture accepts run_id, check_id and role_id; native_response optionally selects body and metadata paths. compare accepts left_run and right_run. review accepts capture_id, decision, note and expected_revision. export accepts optional expected_revision.

The browser uses the original local token and /api/actions. It retains a complete immutable payload before sending; polling /api/jobs/<operation_id> reads the selected operation. Reusing an operation ID with changed input is rejected.

## Size and runtime selection

| Input/output | Current supported limit |
| --- | --- |
| Original plan/profile/metadata JSON | 4 MiB per file |
| Selected publication source file | 16 MiB per file |
| Original native/imported response body | 32 MiB per capture |
| Browser action including base64 payloads | 52 MiB |
| Complete receiving archive and expanded member selection | 512 MiB |
| Native map dimensions | Up to 4096 pixels per side |

Select a host budget for the actual original project/response volumes and existing browser runtime. The collector keeps complete original bodies; large maps/PDFs therefore count toward the working set and receiving archive. The original producer's GIS assets are separately accounted for in its project/data package. This product does not require GitHub Actions.

## Source and handover references

- PUBLICATION_CONTRACT.md: the original stac/qwc immutable publication, native generation, role request and deployment contract.
- QWC_SOURCE_CONTRACTS.md: exact QWC/QGIS source pins, native permission/XML/print behavior and primary links.
- [QWC configuration and permissions](https://docs.qwc.app/master/configuration/ResourcesPermissions/).
- [QWC theme configuration](https://docs.qwc.app/master/configuration/ThemesConfiguration/).
- [Original QWC OGC service](https://github.com/qwc-services/qwc-ogc-service/tree/62cf733a278dbc02137bf570eba15ae5afe2730e).
- [QGIS 3.40 native WMS renderer](https://github.com/QGIS/QGIS/blob/final-3_40_0/src/server/services/wms/qgswmsrenderer.cpp).

The complete commissioning handover consists of the original QGIS project/data package, the original QWC publication/deployment/rollback package, and this worked review/receiving package. Their original source and publication hashes join the three parts.
