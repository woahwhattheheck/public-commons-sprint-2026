# Dataset quality operations

The **Quality** view belongs to the original OpenLineage workspace. It reads retained producer measurements and assertions, saves dataset rules, captures complete evaluations, and records the operator's decisions against individual saved findings. The original workspace connection, selected edition, source browser and request recovery panel remain the operating surface.

## Open the desk

Open **OpenLineage operations** in the maintained Applications view and select the initialized or received project. Start and open that saved application, then choose **Quality** in its navigation. The same desk is available from the native server:

```sh
node cli.mjs serve --workspace /absolute/private/lineage --port 0
```

Use the URL printed by the original server. Connect with the project's existing token when it has one. Choose **Current workspace** or an existing saved edition in the application header. The Quality view uses that exact selection. **Refresh quality** reloads the workspace and its quality records together.

The dataset selector shows the original namespace and name. It retains the exact dataset key; similarly named datasets in different namespaces remain distinct. Select a run to narrow the observations to its exact original run key. Leave **All selected runs** selected to include dataset-only observations. An identity selected before changing editions stays explicitly labeled when it is outside the new view.

The desk uses text labels and neutral grayscale styling. Tables scroll within their own region on a narrow screen. Forms become a single column; the observations, rules, evaluation and decisions tabs remain keyboard accessible.

## Inspect producer observations

The overview reports observed datasets, metrics, assertions and failed assertions. Select a dataset to open its complete facet history. History shows ten observations per page with the full count and explicit previous/next controls.

Every observation identifies:

- Original dataset namespace and name, run key, event ID and event time.
- Event type and observed run state, independently of an assertion's result.
- Input, output or dataset event direction; dataset, input or output facet scope.
- Exact facet name, JSON path, schema URL, producer and retained source positions.
- Reported metric paths and values, assertion results, and any source diagnostics.
- The complete original facet and containing retained observation record.

**Open source** links return to the application's existing retained source inspector. The expandable original record keeps the raw fields available when a producer reports unsupported content. A reported SQL query is displayed as literal text.

A run marked `COMPLETE` may contain a failed assertion with warning severity. The desk displays all three facts separately. Severity describes the producer's priority; it does not turn a false assertion into a pass. An omitted metric remains **Unreported**. A reported `0`, `false`, empty string or null retains its supplied meaning in the complete original record.

The recognized source contracts include the original OpenLineage data quality metric and assertion facets. Dataset `facets` remain distinct from a particular run's `inputFacets` and `outputFacets`. Older or malformed facets expose their original values and readable diagnostics. Correct a producer and import its subsequent original event to add a new observation.

The upstream source and specification are retained with the application. Current reference pin: [OpenLineage/OpenLineage 8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe](https://github.com/OpenLineage/OpenLineage/tree/8ad5c14c63fbab63fedd8ff42f9a208d86ad07fe). Review the retained [source contract](SOURCE_CONTRACT.md) for the source edition and licensed original examples.

## Save rules for an exact dataset

Open **Rules**, select the dataset and enter a useful title. A rule has a scope, severity, enabled state and explicit treatment of missing observations.

| Setting | Meaning |
| --- | --- |
| Dataset | Exact original dataset key selected by namespace and name |
| Scope | Any original facet scope, dataset facets, run input facets, or run output facets |
| Metric threshold | Compare one exact reported JSON pointer with a finite numeric threshold |
| Named assertion | Match the original assertion name and optional exact column, then compare its success result |
| Severity | Error, warning or information for the rule's finding |
| Missing observation | Keep unknown, or explicitly count missing evidence as failure |
| Enabled | Use the saved version in future evaluations |

Metric pointers use the original field names: `/rowCount`, `/bytes`, `/columnMetrics/customer_id/nullCount`, and other paths supplied by the producer. The editor suggests metric paths observed for the selected dataset. Standard JSON Pointer escaping applies to names containing `/` or `~`.

Comparisons are equal, unequal, less than, at most, greater than, at least, and an inclusive range. A range requires both finite endpoints and an upper value at least as large as the lower value. The desk does not replace an absent observation with a numeric zero.

A named assertion matches the original name and column. Leave the column empty for a dataset assertion without a column. Choose whether the expected result is passed or failed. Original producer assertions are also evaluated independently when no saved rule exists.

**Save rule** records the change through the original workspace writer. **Edit rule** opens the saved configuration. **Disable rule** saves a new disabled version while retaining earlier configuration. Expand the complete saved record to inspect the rule and its retained history. Existing saved evaluations keep the exact rule versions used at the time.

## Evaluate a source selection

Open **Evaluation**, verify the edition, dataset and run selectors, then choose **Evaluate selected source**. This preview reads the selected original observations and current saved rule versions. It shows pass, fail and unknown counts and every resulting finding.

Each finding retains its expected and actual values, message, severity, dataset, run, event ID, observation identity, facet path and original source locators. A failed warning appears as **fail** and **warning**. An unsupported or missing value can produce an unknown finding according to the saved rule's missing policy.

Enter an evaluation title and choose **Save evaluation** to retain an immutable result with the exact selected event identities and rule versions. Saving uses the preview's captured workspace, revision, edition, dataset and run. It also sends the preview's exact selection and rule hashes to the original writer. Changing the source selection or refreshing to another revision clears the old preview; evaluate the current source before saving a result.

The saved evaluation selector reopens earlier complete results. Its source revision and edition remain visible even after the live workspace advances. Expand **Selected rule versions** and **Selected original event identities** to see the preserved inputs.

## Record decisions against saved findings

Select a saved evaluation, then choose **Review finding**, or open **Decisions** and select the finding. Choose one of the supported dispositions and enter a substantive reason.

| Disposition | Operator use |
| --- | --- |
| Open | Record that the finding remains to be handled |
| Investigating | Describe the analysis or work underway |
| Accepted | Explain why the observed finding is accepted for this evaluation |
| Resolved | Describe the correction or completed work and its relevant result |

**Save disposition** preserves the exact evaluation ID and finding ID. The finding's original status, severity, expected and actual values remain available. Earlier decisions remain in the saved history. If new producer data arrives, import it and save another evaluation; decisions on the earlier immutable result continue to identify that earlier result.

For useful receiving, explain the action taken and identify the resulting source, change or customer result in the reason. The original application's result attachment workflow can retain the complete supporting file.

## Download reports and hand over the complete workspace

Choose **HTML report**, **JSON data** or **CSV findings**, then **Download quality report**. A report opened from a saved evaluation is generated from that retained evaluation. A report without a selected saved evaluation uses the current quality selection.

The download comes from `quality.report.read` as its complete media type and text. HTML provides a readable report; JSON preserves structured results; CSV provides the findings for spreadsheet use. The desk reports the returned workspace revision after the download.

Use the original workspace export for a complete editable delivery:

```sh
node cli.mjs export \
  --workspace /absolute/private/lineage \
  --out /absolute/delivery/openlineage-workspace.json

node cli.mjs verify \
  --input /absolute/delivery/openlineage-workspace.json

node cli.mjs receive \
  --input /absolute/delivery/openlineage-workspace.json \
  --out /absolute/received-lineage

node /absolute/received-lineage/application/cli.mjs serve \
  --workspace /absolute/received-lineage --port 0
```

The export carries retained sources and results, selected editions, quality rules and their histories, saved evaluations, disposition histories, operation outcomes and the complete portable application. Receiving verifies the complete source and object inventory. Reopen the received project, choose **Quality**, and inspect its saved evaluations and decisions through the same desk.

A quality report complements the editable workspace export. Keep both when the recipient needs a readable review and the ability to continue the operation.

## Typed client and original HTTP actions

The quality client extends the existing `LineageClient`. It uses the same URL, access token, timeout, workspace ID, instance ID and fetch options. It does not create another workspace.

From the maintained selected package:

```js
import { QualityClient } from "@tokenjunkielabs/starforge-merchant/seller/openlineage/quality";
```

From the portable application's own source:

```js
import { QualityClient } from "./quality-client.mjs";

const client = new QualityClient("http://127.0.0.1:8767", {
  token: process.env.OPENLINEAGE_TOKEN,
  expectedWorkspaceId: originalWorkspaceId,
  instanceId: originalServerInstanceId
});

const overview = await client.qualityOverview();
const dataset = overview.datasets.find(item =>
  item.namespace === originalNamespace && item.name === originalDatasetName);
if (!dataset) throw new Error("The selected original dataset has no quality observations.");

const history = await client.qualityHistory(dataset.datasetKey);
const preview = await client.evaluateQuality({ datasetKey: dataset.datasetKey });
```

Mutations require an operation ID and an expected revision. Retain the entire exact request before sending it. Reuse that request after a lost reply; the existing writer recovers the same intended operation. The following sequence illustrates the complete rule, evaluation and decision flow:

```js
const ruleRequest = {
  operationId: originalRuleOperationId,
  expectedRevision: overview.revision,
  rule: {
    title: "Order records must be present",
    datasetKey: dataset.datasetKey,
    enabled: true,
    severity: "error",
    scope: "any",
    kind: "metric",
    metricPath: "/rowCount",
    operator: "gte",
    value: 1,
    missing: "unknown"
  }
};
const ruleResult = await client.saveQualityRule(ruleRequest);

const evaluationRequest = {
  operationId: originalEvaluationOperationId,
  expectedRevision: ruleResult.revision,
  datasetKey: dataset.datasetKey,
  title: "Order dataset review"
};
// To save an already displayed preview, first evaluate after the rule save,
// then retain its exact hashes with the original request:
const currentPreview = await client.evaluateQuality({ datasetKey: dataset.datasetKey });
evaluationRequest.expectedSelectionHash = currentPreview.selectionSha256;
evaluationRequest.expectedRulesHash = currentPreview.ruleSetSha256;
const saved = await client.saveQualityEvaluation(evaluationRequest);
const finding = saved.evaluation.findings.find(item => item.status === "fail");

if (finding) {
  const decisionRequest = {
    operationId: originalDispositionOperationId,
    expectedRevision: saved.revision,
    evaluationId: saved.evaluation.id,
    findingId: finding.id,
    decision: "investigating",
    reason: "Review the retained producer event and identify the source of the reported result."
  };
  await client.saveQualityDisposition(decisionRequest);
}

const report = await client.qualityReport({
  evaluationId: saved.evaluation.id,
  format: "html"
});
```

The operation IDs and original workspace identities in the examples are supplied by the caller's retained operation record. Refresh the actual current revision before starting an unrelated new change. A revision conflict requires reviewing that newer state before preparing a replacement request.

| Client method | Original action | Main arguments |
| --- | --- | --- |
| `qualityOverview(options)` | `quality.overview` | Optional edition, dataset key, run key |
| `qualityHistory(datasetKey, options)` | `quality.history` | Exact dataset key and optional edition/run |
| `saveQualityRule(args)` | `quality.rule.save` | Rule, operation ID and expected revision |
| `evaluateQuality(options)` | `quality.evaluate` | Optional edition, dataset key, run key |
| `saveQualityEvaluation(args)` | `quality.evaluation.save` | Selection, title, operation ID and expected revision |
| `saveQualityDisposition(args)` | `quality.disposition.save` | Saved evaluation/finding IDs, decision, reason and mutation identity |
| `qualityReport(options)` | `quality.report.read` | Saved evaluation or selection, and json/csv/html format |

These actions use the existing `POST /api/action` envelope:

```json
{
  "action": "quality.history",
  "args": {
    "datasetKey": "EXACT_DATASET_KEY",
    "edition": "ORIGINAL_EDITION_ID"
  }
}
```

The optional selection field is `edition`. Omit it for the current workspace. Authentication and the original workspace/instance headers follow the maintained HTTP client contract. The existing action catalog supplies the same operations to the direct and managed MCP surfaces.

## Recover an interrupted browser action

An open rule draft retains the workspace, revision and source selection at which it was opened. When that context changes, the desk keeps the draft text and shows the current saved rule for comparison. Read the current record and choose **Use reviewed revision with my draft** before saving the retained intent. The draft cannot transfer silently to a different workspace. A decision reason follows the same pattern, with the current saved finding history visible before **Use reviewed revision with this decision**.

Rule, evaluation and disposition saves use the original browser request journal. The desk disables further writes while that saved request is outstanding. Reopen the same application URL and follow its saved-request panel to inspect or recover the exact action.

If the workspace changed while a read was in flight, choose **Refresh workspace** to read one current revision. If a mutation received a revision conflict, review the updated state in the original recovery panel before preparing a changed request. A completed save refreshes the quality desk using the returned workspace state.

Browser storage errors remain visible in the application's recovery surface. Read observations and download reports from the current connection while resolving the saved request.

## Managed application and source integration

The installed product selection remains `openlineage-operations`. Its contribution and Applications provider are `openlineage-workspace`; the merchant provider is `openlineage-workspaces`. Use the maintained native/schema/OpenAPI/MCP/operator installation described in the [installed product guide](../../../../products/openlineage/OPERATING.md).

The browser addition is `quality-ui.mjs` plus `quality.css`. It mounts into the original catalog and uses the original action sender, mutation journal, workspace refresh, source inspector and download helper. The explicit browser asset inventory serves those two files. The original portable application inventory includes the client, declarations, desk and this guide, together with the quality domain and action catalog.

For a native receiving review, use the retained original producer sources and the same workspace: inspect metric and assertion history, save a dataset rule, preview and save an evaluation, record a reasoned disposition, download reports, export the full workspace, receive it and reopen the Quality view. Capture the original dataset/run/facet and saved evaluation identities with the delivered result. Existing schema and service-level observations remain part of that same cumulative application.
