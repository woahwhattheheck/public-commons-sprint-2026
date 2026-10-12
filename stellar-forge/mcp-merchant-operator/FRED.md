# Economic workspace clients and agents

Operate a retained FRED economic product from the installed command, a typed JavaScript client, or the existing authenticated merchant MCP host. All three paths attach to the original economic workspace: the same project, source captures, reviews, publication, merchant listener, configured SF88 buyer and saved customer intents.

The client covers official source intake, complete public-table imports, combined macro editions, observations and revision comparisons, projection review, publication, merchant control, customer preparation/execution/recovery, complete downloads and project receiving. The MCP family contains 35 tools and loads its runtime only when that configured family is used.

## Start or reconnect the original workspace

Use Node 24 and the existing economic application installation. The original workspace owner starts its same project with the configured buyer and facilitator:

~~~sh
starforge fred serve \
  --project /PRIVATE/ORIGINAL_FRED_PROJECT \
  --buyer-config /PRIVATE/ORIGINAL_BUYER.json \
  --facilitator https://ORIGINAL-FACILITATOR \
  --merchant-port ORIGINAL_MERCHANT_PORT \
  --connection-file /PRIVATE/fred-console.json
~~~

The capitalized paths, origin and port select the operator's existing resources. The optional connection-file flag writes the actual startup record with owner-only permissions. It includes the native project ID, complete launch binding and private session URL. On a later start of the same project, the record is replaced atomically; an existing record belonging to another project is rejected. The original managed Application may also supply its retained complete startup record directly.

The workspace binding covers its canonical project directory and creation identity, selected buyer configuration hash/path, facilitator, local-facilitator setting and merchant port. The client reads the native launch endpoint and compares the exact binding before it dispatches a workspace operation. A declared expected binding adds a fixed operator selection. A connection-record rotation reconnects the client to the same project using its current session.

Create the installed client connection using the existing original public payment file:

~~~sh
starforge fred-workspace connection-init \
  --out /PRIVATE/fred-client.json \
  --console-url-file /PRIVATE/fred-console.json \
  --workspace macro \
  --inputs-file stellar-forge/mcp-merchant-operator/examples/fred-workspace-inputs.json \
  --payment-file /PRIVATE/ORIGINAL_PUBLIC_PAYMENT.json \
  --merchant-origin https://ORIGINAL-MERCHANT-HOST \
  --profile native
starforge fred-workspace status --connection /PRIVATE/fred-client.json
~~~

The connection initializer authenticates an actual launch read before publishing its private connection file. Its returned projectId, bindingSha256 and instanceId identify that original server. Use an existing profiles JSON file with --profiles-file when there are several merchant configurations.

For a complete source checkout the supplied input-alias example resolves directly to the retained UNRATE, CPIAUCSL and GDP source files. Within an installed distribution these same files sit under its source directory. Input aliases are resolved from the input-alias file's directory. Client configuration paths are resolved from the connection file's directory.

The connection schema is stellar-forge.fred-workspace-connection.v1. Each workspace has one consoleUrlFile or consoleUrlEnv reference, optional projectId and expectedBindingSha256, request capacity/time settings, inputs, and merchantProfiles. The file or environment variable retains the original startup JSON or unchanged private URL. A bare URL requires the explicit original projectId. Credential values stay in the original private workspace and buyer configuration.

## Build and review a real macro edition

Read status and inputs first. input-inspect reads the complete selected source file, returning its file SHA256, original publisher-table URL, retrieval time, series ID and original table byte/hash metadata. The configured input digest, when present, is checked again during import.

~~~sh
starforge fred-workspace inputs --connection /PRIVATE/fred-client.json
starforge fred-workspace input-inspect --connection /PRIVATE/fred-client.json --input unrate
starforge fred-workspace import --connection /PRIVATE/fred-client.json \
  --input unrate --id ORIGINAL_IMPORT_ID --revision CURRENT_REVISION --sha256 ORIGINAL_FILE_SHA256
~~~

Continue with the revision and captureId returned by each original operation. Import the declared CPI and GDP files in the same way, then combine their retained capture IDs:

~~~sh
starforge fred-workspace combine --connection /PRIVATE/fred-client.json \
  --id ORIGINAL_COMBINE_ID --revision CURRENT_REVISION --captures UNRATE_SHA,CPI_SHA,GDP_SHA
starforge fred-workspace observations --connection /PRIVATE/fred-client.json \
  --capture COMBINED_CAPTURE_SHA --series UNRATE --offset 0
starforge fred-workspace review --connection /PRIVATE/fred-client.json \
  --id ORIGINAL_REVIEW_ID --revision CURRENT_REVISION --capture COMBINED_CAPTURE_SHA \
  --policy-file ORIGINAL_PROJECTION.json --note-file ORIGINAL_REVIEW.txt
starforge fred-workspace publish --connection /PRIVATE/fred-client.json \
  --id ORIGINAL_PUBLICATION_ID --revision CURRENT_REVISION --review SAVED_REVIEW_SHA --profile native
~~~

These uppercase IDs/hashes/revisions select values from the actual original operation. Project changes retain their stable id and expectedRevision in the native project journal. An exact repeated completed request returns its saved result. A pending source acquisition continues with its same original ID and revision.

Public-table imports carry the complete original publisher text and supplied retrieval metadata through the maintained parser. Each series retains its frequency, units, seasonal adjustment, publisher and missing values. Public-table retrieval time is represented by the original PUBLIC_TABLE_RETRIEVAL_DATE basis. The FRED API acquisition path retains its original real-time/vintage response fields. The combined product keeps these distinctions in its rows, metadata, source file and saved projection.

The supplied source files contain the actual original full UNRATE, CPIAUCSL and GDP public tables. Their original periods and publisher metadata remain available in each retained source. The macro starter guide describes these inputs in detail: [original macro starter](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/sources/MACRO_STARTER.md).

For official API acquisition, configure saves the actual FRED selection and capture uses the environment-variable reference already recorded in the original project:

~~~sh
starforge fred-workspace configure --connection /PRIVATE/fred-client.json \
  --id ORIGINAL_CONFIGURATION_ID --revision CURRENT_REVISION --selection-file ORIGINAL_SELECTION.json
starforge fred-workspace capture --connection /PRIVATE/fred-client.json \
  --id ORIGINAL_CAPTURE_ID --revision CURRENT_REVISION
starforge fred-workspace operation --connection /PRIVATE/fred-client.json --id ORIGINAL_CAPTURE_ID
~~~

The source model and importer are documented in the [economic application guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/README.md). The native edition retains the FRED attribution and [FRED API terms link](https://fred.stlouisfed.org/docs/api/terms_of_use.html). Official observation parameter semantics are available in the [FRED observations documentation](https://fred.stlouisfed.org/docs/api/fred/series_observations.html); the client forwards the original workspace selection to that maintained source engine.

## Work with large collections and revisions

records pages captures, reviews, publications and original operations. Retain its returned revision as expectedRevision across that collection. Requests use expectedViewSha256 across their separately changing prepared-intent inventory.

observations and compare use the native 100-row response pages. Follow the returned nextOffset until it is null. A capture ID identifies immutable retained source, so both observation paging and before/after comparisons stay tied to their exact source editions.

~~~sh
starforge fred-workspace records --connection /PRIVATE/fred-client.json \
  --kind captures --offset 0 --limit 25 --revision CURRENT_REVISION
starforge fred-workspace compare --connection /PRIVATE/fred-client.json \
  --before EARLIER_CAPTURE_SHA --after LATER_CAPTURE_SHA --offset 0
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --kind comparison --before EARLIER_CAPTURE_SHA --after LATER_CAPTURE_SHA --out /PRIVATE/revisions.json
~~~

The complete comparison download includes every original change. file downloads also retain complete source, project and customer responses.

## Original merchant and customer execution

Read publication to inspect its original snapshot, schema, offers, advertised file paths and complete file hashes. merchant-start forwards that reviewed publication to the original workspace's configured native seller/facilitator.

~~~sh
starforge fred-workspace publication --connection /PRIVATE/fred-client.json --publication PUBLICATION_SHA
starforge fred-workspace merchant-start --connection /PRIVATE/fred-client.json --publication PUBLICATION_SHA
starforge fred-workspace preview --connection /PRIVATE/fred-client.json \
  --publication PUBLICATION_SHA --query 'where_series=UNRATE&limit=100'
starforge fred-workspace prepare --connection /PRIVATE/fred-client.json \
  --publication PUBLICATION_SHA --intent ORIGINAL_INTENT_ID --query 'where_series=UNRATE&limit=100'
starforge fred-workspace buy --connection /PRIVATE/fred-client.json \
  --publication PUBLICATION_SHA --intent ORIGINAL_INTENT_ID
~~~

Use the original dataset's declared query fields when choosing filters, sort and limits. preview invokes that exact dataset handler. The prepared customer request binds its offer, selected payment alternative, query, publication, snapshot and output policy before execution.

The configured SF88 buyer performs its existing approval and native execution. The agent result includes the original native metadata, delivery byte count/hash and cursor metadata. Download the complete saved response with the same intent:

~~~sh
starforge fred-workspace recover --connection /PRIVATE/fred-client.json \
  --publication PUBLICATION_SHA --intent ORIGINAL_INTENT_ID
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --kind customer --publication PUBLICATION_SHA --intent ORIGINAL_INTENT_ID --out /PRIVATE/original-page.json
~~~

For the next dataset page, retain the original preceding page metadata, snapshot and returned nextCursor. Supply that actual cursor in the query and the metadata in --previous-file when preparing the next original intent. Each paid page keeps its own original intent. For a whole source or CSV file, pass the exact path advertised by publication in --file and use the same prepare, buy, recover and complete-download flow.

Every client mutation has one native HTTP request. A lost response retains an ambiguous outcome on the thrown error together with the original ID. Inspect operation for project work and recover the same intent for customer work. A request timeout or client disconnect leaves the original server's operation with its owner. The wait command observes durable project progress through reads; it never dispatches a mutation.

## Export, receive and reconnect

~~~sh
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --kind source --capture CAPTURE_SHA --out /PRIVATE/original-capture.json
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --kind project --out /PRIVATE/fred-project.json
starforge fred-workspace receive --source /PRIVATE/fred-project.json \
  --project /PRIVATE/RECEIVED_FRED_PROJECT --sha256 COMPLETE_DOWNLOAD_SHA256
~~~

The project download checks the native bundle identity and exact project ID. Receiving invokes the maintained original receiveFredProject implementation to reconstruct the source editions, saved reviews and publications. The original customer's native account/ledger and financial operation records remain under their configured custody, while their complete delivered files are exported through the customer download operation.

Downloads preserve the full response bytes, byte count, content type and SHA256. Publication creates a new destination; an already retained identical file is reused after its complete hash and size are checked. A different destination file is preserved and the command returns the conflict.

Reopen the original project or the received directory through fred serve with its same configuration, then retain its actual connection record. A subsequent status reads that record and verifies the same project binding before operating. disconnect releases only the borrowed client and its owned download reads.

## Authenticated merchant MCP

Create the separate merchant configuration from the original connection file:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-fred-workspaces \
  --dir /PRIVATE/fred-merchant-mcp --connection /PRIVATE/fred-client.json
node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /PRIVATE/fred-merchant-mcp/merchant-mcp.json \
  --token-env ORIGINAL_MCP_ACCESS_TOKEN_ENV
~~~

The existing host also accepts its configured --oauth-config resource host. Keep that original host authentication choice. For a cumulative merchant configuration, add fredWorkspaceConnection pointing to the private connection file.

| Area | Tools |
| --- | --- |
| Original scope and sources | merchant_fred_workspaces, status, inputs, input_inspect |
| Retained project and revisions | records, record, operation, observations, compare, briefing_preview, briefing |
| Recurring report definitions and editions | briefing_templates, briefing_template_save, briefing_successor_preview, briefing_successor_save, briefing_successor |
| Source and edition authoring | configure, capture, import, combine, select, review, publish, abandon |
| Merchant and customer | merchant_start, merchant_stop, publication, requests, preview, prepare, buy, recover |
| Complete files and reconnect | file_read, file_release, disconnect |

Every tool in the table uses the merchant_fred_ prefix. Source imports and merchant publication select host-declared aliases. The installed client takes explicit original files and complete request objects.

MCP file_read uses the maintained retained-file reader. Preserve its readId, complete file SHA256 and returned nextOffset. It sends base64 chunks until nextOffset is null; the final chunk closes that private descriptor. After process restart or expiry, select the same original file and expectedSha256 at the required offset to continue.

The catalog contains only static metadata. The provider registry loads the FRED client when its configured family is selected, and the merchant operator owns its shutdown. Public source acquisition and paid customer execution stay on the existing authenticated FRED server.

## Typed JavaScript interface

The installed exports include buyer/fred/workspace-client, buyer/fred/workspace-client/operations, merchant/mcp/fred and merchant/mcp/fred/setup. Each has an explicit .d.mts declaration. The following source-checkout example uses the same client:

~~~js
import {
  FredWorkspaceClient, readFredWorkspaceConfiguration, saveFredFile
} from './stellar-forge/mcp-merchant-operator/fred-workspace-client.mjs';

const configured = await readFredWorkspaceConfiguration('/PRIVATE/fred-client.json');
const client = new FredWorkspaceClient(configured.workspaces.macro);
try {
  const state = await client.state();
  const captureId = state.project.selectedCapture;
  let offset = 0;
  do {
    const page = await client.observations({ captureId, series: 'UNRATE', offset });
    // Consume page.rows with their original date, value, missing flag and units.
    offset = page.nextOffset;
  } while (offset !== null);
  const retained = await saveFredFile(client, { kind: 'project' }, '/PRIVATE/project-copy.json');
  console.log({ projectId: retained.projectId, bytes: retained.bytes, sha256: retained.sha256 });
} finally {
  client.close();
}
~~~

The definitions expose the original launch binding, project/revision structures, source and publication inputs, exact file selections, raw Buffer downloads and recoverable error fields. The client accepts an AbortSignal per operation; timeoutMs controls the client observation window up to 30 minutes. Full request capacity is 128 MiB and full response capacity is 256 MiB, matching the original workspace and bundle contracts. The original source model applies its own source limits.


## Author and deliver an analyst briefing

The installed economic client now includes the complete saved-report workflow. Use `briefing-preview --capture SHA --briefing-file JSON`, then save `review --id ID --revision N --capture SHA --briefing-file JSON` with the original note/projection. Open it with `briefing --review SHA`. Full `download --kind briefing --review SHA --format html|csv|json|manifest --out FILE` verifies the original saved file descriptor and complete response bytes.

The agent tools are `merchant_fred_briefing_preview` and `merchant_fred_briefing`; `merchant_fred_review` accepts the optional normalized analyst selection, and `merchant_fred_file_read` accepts briefing/reviewId/format. The typed Node client exposes `previewBriefing`, `briefing` and the extended file/review types. Existing `publish`, `prepare`, `buy` and `recover` deliver the complete report through the original configured merchant and buyer.

[BRIEFINGS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/BRIEFINGS.md) gives the full authoring, exact period/unit/missing-value rules, native customer and project reopening flow. [The completed offline macro report](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/briefing.html) includes all actual report data and local downloads; [its complete original capture](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-20261012/macro-source.capture.json) imports directly into the existing project. The source keeps all 2,219 observations; its January 2024–September 2026 briefing selects 75 observations and produces 150 exact comparisons.

Projects with saved briefings use the explicit v2 bundle until a recurring template is retained. Recurring projects use v3: the complete templates and successor lineage remain in the original project state, and the existing briefing inventory carries every full saved report. The native receiver validates the original source, calculations, files and lineage and restores those same bytes. Source-only projects keep their original v1 bundle and edition identities.

## Continue an economic briefing with a reusable definition

A recurring template carries the original saved briefing's series, comparison methods, decimal precision, notes and source meaning. Its window determines which original observation dates enter the next report. Create each next briefing explicitly against a selected retained capture.

The complete domain and native operating guide is [TEMPLATES.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/TEMPLATES.md). The maintained [window input](../../stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-template-window.json) selects twelve calendar months with the earliest latest recorded observation date among the selected series. Dates label the source's own periods; a quarterly date and a monthly date keep their original meanings.

### Save the definition and inspect the next edition

Start from a saved analyst review returned by the existing briefing workflow. Use its complete review ID and the current project revision:

~~~sh
starforge fred-workspace briefing-template-save --connection /PRIVATE/fred-client.json \
  --workspace macro --id ORIGINAL_TEMPLATE_OPERATION --revision CURRENT_REVISION \
  --review ORIGINAL_BRIEFING_REVIEW_SHA --name "Monthly economic briefing" \
  --window-file stellar/scf-starforge-20261009/sf30-seller-sdk/fred/examples/briefing-template-window.json

starforge fred-workspace briefing-templates --connection /PRIVATE/fred-client.json \
  --workspace macro --kind templates --offset 0 --limit 50
~~~

The result retains its complete template ID, original review/capture and immutable definition. The IDs have the form fred-template- followed by 64 hexadecimal characters. To edit a definition, create a new template from its reviewed source and pass the previous template ID with --previous-template. Both definitions remain in the same project.

Import or acquire the next complete source through the existing source commands. Then preview it with the selected template:

~~~sh
starforge fred-workspace briefing-successor-preview --connection /PRIVATE/fred-client.json \
  --workspace macro --template ORIGINAL_TEMPLATE_ID --capture NEXT_CAPTURE_SHA \
  --note-file /PRIVATE/NEXT_REVIEW.txt --offset 0 --limit 100 --changes-only true
~~~

Review the returned calendar dates, per-series coverage, missing values, meaningChanges and comparison. The window uses original observation dates including missing markers. latest_all selects the earliest latest date across the selected series; latest_any selects the latest. lagMonths moves the end backward by whole calendar months. An explicit --anchor-date YYYY-MM-DD pins a chosen calendar reference. The original source supplies every reported current and baseline observation.

The comparison separates new periods, earlier additions, periods leaving the window, changed comparison methods, revisions and unchanged economic values. Source time-basis and retrieval-context changes remain visible separately. Use --changes-only false to inspect unchanged values together with their original context. Numeric deltas apply only where units, frequency and seasonal adjustment agree. An absent baseline or original missing marker keeps its explicit source state.

offset and limit page the report comparison. Retain the same template, capture, anchor, preceding report, review note and previewId while reading later pages. The new briefing measures remain available in the preview's first page and, after saving, through the existing briefing command.

### Save, publish and receive the reviewed successor

The preview returns the exact previewId for this source, calculation and review note. Save with that same selection and the current project revision:

~~~sh
starforge fred-workspace briefing-successor-save --connection /PRIVATE/fred-client.json \
  --workspace macro --id ORIGINAL_SUCCESSOR_OPERATION --revision CURRENT_REVISION \
  --template ORIGINAL_TEMPLATE_ID --capture NEXT_CAPTURE_SHA --preview-id REVIEWED_PREVIEW_SHA \
  --note-file /PRIVATE/NEXT_REVIEW.txt

starforge fred-workspace briefing-successor --connection /PRIVATE/fred-client.json \
  --workspace macro --successor SAVED_SUCCESSOR_ID --offset 0 --limit 100 --changes-only false

starforge fred-workspace publish --connection /PRIVATE/fred-client.json \
  --workspace macro --id ORIGINAL_PUBLICATION_OPERATION --revision CURRENT_REVISION \
  --review SAVED_SUCCESSOR_REVIEW_SHA --profile native
~~~

A saved successor has a fred-successor- ID and retains its original template, preceding report, source capture, saved review and complete new report. Its original review ID uses the existing publication, merchant, advertised-file purchase and recovery flow.

The default comparison baseline is the template's originating review. For the following edition, select --previous-successor SAVED_SUCCESSOR_ID from this same template; its saved review becomes the baseline. An explicit --baseline-review must be the origin review or a saved successor review for this template and must agree with --previous-successor when both are supplied. A changed note, anchor or preceding report requires the corresponding new preview.

After an interrupted save, inspect operation with the original operation ID. An exact completed request returns its retained result. The installed client snapshots the complete new mutation input before it awaits connection reads, so later changes to the caller's window object cannot change an in-flight definition.

### Complete change reports and original project receiving

~~~sh
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --workspace macro --kind briefing-successor --successor SAVED_SUCCESSOR_ID \
  --format html --out /PRIVATE/briefing-changes.html
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --workspace macro --kind briefing-successor --successor SAVED_SUCCESSOR_ID \
  --format csv --out /PRIVATE/briefing-changes.csv
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --workspace macro --kind briefing-successor --successor SAVED_SUCCESSOR_ID \
  --format json --out /PRIVATE/briefing-changes.json
starforge fred-workspace download --connection /PRIVATE/fred-client.json \
  --workspace macro --kind project --out /PRIVATE/recurring-fred-project.json
~~~

All three change downloads contain the complete comparison. The offline HTML can filter and page the retained rows locally. The JSON carries the exact template, materialization, successor lineage, full comparison and saved briefing manifest; the client verifies their original binding and complete comparison identity. Every download returns its full byte count and SHA256 and preserves an existing different destination file.

The v3 project contains all original captures, reviews, complete briefing files, templates and successor records. The existing receive command reconstructs the same project and full lineage, after which the normal workspace connection reopens it. Template and successor inventories have pinned-revision paging in the installed CLI/MCP; keep the returned revision while following nextOffset.

### Typed client and authenticated tools

The typed client methods are briefingTemplates, saveBriefingTemplate, previewBriefingSuccessor, saveBriefingSuccessor and briefingSuccessor. The published declarations carry the complete template window, materialization, source coverage, meaning changes, comparison rows, successor records and file selections. The corresponding authenticated tools use the same names under merchant_fred_ with underscores.

~~~js
const selection = {
  templateId: originalTemplate.id,
  captureId: nextRetainedCaptureId,
  note: reviewedNote
};
const preview = await client.previewBriefingSuccessor(selection);
const current = await client.state();
const saved = await client.saveBriefingSuccessor({
  ...selection,
  previewId: preview.previewId,
  id: originalSuccessorOperationId,
  expectedRevision: current.project.revision
});
const file = await saveFredFile(client, {
  kind: 'briefing-successor',
  successorId: saved.successorId,
  format: 'json'
}, '/PRIVATE/briefing-changes.json');
~~~

merchant_fred_briefing_templates pages either templates or successors. merchant_fred_briefing_template_save and merchant_fred_briefing_successor_save retain the original operation ID and expected revision. The preview and saved comparison tools expose the original source changes before publication. merchant_fred_file_read accepts kind briefing-successor with successorId and format, using the existing complete-file chunks, read IDs and SHA256 checks.
