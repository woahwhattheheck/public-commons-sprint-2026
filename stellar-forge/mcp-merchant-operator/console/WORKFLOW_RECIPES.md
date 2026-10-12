# Reusable merchant workflow recipes

Recipes let an operator commission a complete saved workflow in another profile.
A recipe carries the original native tool definitions, arguments, ordered steps,
input mappings, result conditions and planned pauses. The receiving operator
selects inputs and reviews the configured host before saving a new workflow.

The saved workflow uses the existing [Workflows](WORKFLOWS.md) execution,
recovery and handover controls. Its recipe installation retains the original
source, complete review and first workflow edition throughout later edits and
full profile transfers.

## Operator journey

### 1. Prepare an existing operating procedure

Connect to the operator interface, select its profile and open **Workflows**.
Open the saved workflow you want to reuse. Save any current edits, then choose
**Export as recipe**.

Give the recipe a clear name and description. **Prepare recipe** reads the
selected immutable workflow edition and every original saved native request.
It returns a complete recipe with its source workspace, profile, workflow,
revision and source digest.

The **Input declarations** field is optional. Leave it empty to derive declarations
from the workflow's existing mappings from run inputs. The type comes from the
configured native argument schema when that schema specifies a supported type.
An input used in incompatible or unspecified native schema positions is declared
as `any`. Prepare first, inspect the returned declarations, and supply the complete
array to give fields better labels, descriptions and explicit defaults.

Choose **Download complete recipe** to save the UTF-8 JSON file. **Use prepared
recipe here** opens the same complete recipe for installation in the selected
profile.

### 2. Review the receiving profile

On the receiving host, select the intended profile. The Host page shows its
configured host and binding. Review and bind that profile when its host has
changed. Open **Workflows → Recipes** and load the complete downloaded file,
or paste it into **Complete recipe JSON** and choose **Load recipe JSON**.

Name the new workflow and enter its inputs as a JSON object. The declared-input
table shows each pointer, JSON type, required flag and explicit default. Select
**Review current host and inputs**.

The review displays:

- The target profile revision and configured host.
- Effective inputs after declared defaults are applied.
- Every native tool's original and current complete definitions.
- Changed contract fields, with absent values distinguished from JSON `null`.
- Every ordered step, its prepared arguments, remaining bindings, conditions and pause.
- Issues that must be resolved before saving.

A matching tool contract is marked **MATCH**. A changed contract is marked
**CHANGED** and has an explicit acceptance checkbox. Inspect its complete
definitions and change list, select acceptance for that tool, and run Review
again. A missing tool is marked **MISSING**; configure the corresponding native
provider or select a compatible recipe.

The compact changes table displays the first 256 changes and their total count.
Both complete definitions remain available in the same review. Values from
earlier native results and the new run identity retain their original bindings;
the existing workflow engine resolves them when that run reaches the step.

Changes to the recipe, name, inputs, accepted contracts, profile revision or
configured host require a current review. The server repeats that review during
installation, including immediately before the database writes.

### 3. Save and run

Choose **Save as native workflow**. The host saves all native drafts, the complete
first workflow edition and its recipe installation in one SQLite transaction.

The browser retains the exact installation request and complete review before
sending it. The saved result shows its workflow identity, original edition,
current edition, number of native requests and source digests. **Open saved
workflow** opens the normal Workflows editor. Its effective recipe inputs are
filled only while the selected definition is still the original installed
edition and the operator has kept the same editor, input text and connection.

Review the ordered native requests and choose **Start workflow** through the
normal Workflows controls. Native execution, pause, recovery, result conditions,
customer generation and receiving all remain attached to that saved workflow.

Later edits create normal new workflow editions. The installation continues
to reference its original first edition. Open a later edition and supply its
appropriate run inputs; the original installation input selection belongs to
the first edition.

### 4. Recover an interrupted installation

If the response is interrupted, the browser reads the saved installation under
the retained original workflow ID. If that read succeeds, it matches the complete
normalized request and review before releasing the pending action.

If recovery still needs attention, **Recover the original installation** shows
the original workflow ID, recipe and complete retained request. Reloading or
reconnecting restores that action from the existing workspace/profile action
store. Choose **Recover original installation** to read the original installation.
An actual 404 permits replay of the exact retained request under the same ID.

The host returns the original installation when its complete effective request
matches. This also works after the profile or installed native tool contracts
have subsequently changed: the installation's original review remains retained.
A different request under the same ID receives a conflict.

A definite client rejection on the first send returns the recipe and inputs to editing and requires a fresh review. An uncertain earlier attempt retains its original pending action until its saved installation is read or its exact request is recovered.

After an accepted installation, **Prepare another workflow from this recipe**
creates a new workflow identity and review. Use that control for a distinct
commissioning, with inputs selected for that operation.

### 5. Transfer the completed operating case

The normal complete profile export includes `workflowRecipeData` when the profile
contains recipe installations. It carries each installation's full recipe,
review, request and original draft references. The same archive also retains
all native draft editions, workflow editions, runs, events, calls and customer
receiving metadata.

Import receives that complete profile into the original operator store. Each
installation must match its first workflow edition and every deterministic
original native draft. Importing the same archive again reuses the original.
An older archive preserves later local editions and newer existing installation
records; the normal workflow and customer receiving merge rules continue to apply.

Open **Installed recipes in this profile** to select an installation. Open the
saved workflow to continue ordinary editing and execution. Unfinished runs
move through the named-workspace handover procedure described in
[WORKFLOWS.md](WORKFLOWS.md).

## Input declarations and binding behavior

A declaration describes one JSON pointer into the workflow's input object:

```json
[
  {
    "pointer": "/sourceAlias",
    "label": "Configured source",
    "description": "The source alias selected from this merchant host.",
    "type": "string",
    "required": true,
    "default": "initial"
  },
  {
    "pointer": "/releaseId",
    "label": "Release identifier",
    "description": "A new release identity for this commissioning.",
    "type": "string",
    "required": true
  },
  {
    "pointer": "/customerId",
    "label": "Customer export identifier",
    "description": "The original export identity to generate and receive.",
    "type": "string",
    "required": true
  }
]
```

Supported types are `string`, `number`, `integer`, `boolean`, `object`,
`array`, `null` and `any`. Integers must be safe JSON integers; numbers must
be finite. Explicit JSON `null`, `false`, `0`, an empty string and a missing
property have distinct meanings.

Pointers follow RFC 6901: `~0` represents `~`, `~1` represents `/`, and
the empty pointer selects the complete input object. Declare a parent object
once when several bindings use its nested properties. Each input binding must
be covered by a declared field. Overlapping parent/child declarations are
rejected so that defaults have an unambiguous owner.

A default is applied only when its selected property is absent. Nested defaults
can create missing object containers. Supply an actual array in the input object
before applying a default to an existing array position. Whole workflow inputs
and whole native argument replacements must be JSON objects.

The review resolves input bindings against the effective input object. Earlier
step-result and run-identity bindings are executed by the original workflow
engine. Native tools retain their own validation and configured authorization
when the saved workflow runs.

## HTTP interface

All routes are below `/operator/api/` and use the operator's existing
authentication and native tool authorization. JSON objects are sent with
`Content-Type: application/json`.

| Method | Route | Result |
| --- | --- | --- |
| POST | `workflow-recipe-export` | Complete recipe from a saved workflow edition |
| POST | `workflow-recipe-review` | Normalized recipe and complete current review |
| POST | `workflow-recipe-install` | Saved original installation, first definition and effective run inputs |
| GET | `workflow-recipe-install/:workflowId` | Original installation and current workflow revision |
| GET | `workflow-recipes?profile=profileId` | Installed recipes in the selected profile and byte limits |

### Export

```js
const exported = await request("workflow-recipe-export", {
  id: savedWorkflow.id,
  revision: savedWorkflow.revision,
  name: "Commission merchant and receive customer",
  description: "Review the selected host source, run its seller, and receive its customer.",
  inputs: declarations
});
const recipe = exported.recipe;
```

Only `id` is required. Omit `revision` to select the current saved edition.
Omit `inputs` to derive declarations from its input bindings. The exported source
retains the exact selected edition. The currently installed full tool definition
must match each original draft's saved tool-schema digest. Reopen and save a
reviewed current native draft, then save the workflow edition when that contract
has changed.

### Review and install

```js
const selected = {
  id: newWorkflowId,
  profileId: receivingProfile.id,
  name: "Receiving merchant commissioning",
  recipe,
  inputs: {
    releaseId: newReleaseId,
    customerId: newCustomerExportId
  },
  acceptToolChanges: []
};

const { review } = await request("workflow-recipe-review", selected);
if (!review.canInstall) {
  showCompleteReview(review);
} else {
  const originalRequest = {
    ...selected,
    expectedReviewSha256: review.contentSha256
  };
  await retainOriginalRequest(originalRequest, review);
  const result = await request("workflow-recipe-install", originalRequest);
  openSavedWorkflow(result.definition, result.runInputs);
}
```

The request identifier belongs to the newly installed workflow. Review does not
reserve it. Installation checks both workflow and deterministic draft identities,
then saves the entire operating procedure atomically. Distinct operations use
distinct workflow identifiers.

The review digest binds the original recipe, target workflow/name/profile,
profile revision, configured host, effective inputs, accepted tool names, full
original/current native definitions, prepared steps and all issues. A stale digest
returns `CONSOLE_RECIPE_REVIEW_CHANGED`.

### Original-installation recovery

```js
const original = await read("workflow-recipe-install/" + originalRequest.id);
// Match original.installation.request to the retained normalized original intent.
// If the original read returns 404, POST the retained originalRequest.
```

An installation response contains:

```js
{
  installation: {
    schema: "stellar-forge.merchant-workflow-recipe-install.v1",
    id, profileId, workspaceId, name, createdAt,
    recipeSha256, requestSha256,
    request, recipe, review,
    definitionId, definitionRevision: 1, definitionSha256,
    drafts: [
      { stepId, id, revision: 1, argumentsSha256, toolSchemaSha256 }
    ],
    contentSha256
  },
  definition,
  runInputs,
  reused,
  currentDefinitionRevision
}
```

The normalized saved request includes effective input defaults, trimmed workflow
name and sorted unique accepted tool names. Its SHA-256 covers that complete
effective intent, including the selected review digest. A matching replay returns
the same original installation and first definition.

### Format and storage limits

A complete recipe has schema `stellar-forge.merchant-workflow-recipe.v1`.
It contains `name`, `description`, optional original-source reference,
`inputs`, complete ordered `steps`, and `contentSha256`. Each step retains
its original full `definition`, `arguments`, `bindings`, `expect` and
`pauseAfter`, together with its step ID, name and native tool name.

The normalized recipe is sealed over canonical JSON. The supported authoring
helper `sealWorkflowRecipe()` creates that representation;
`normalizeWorkflowRecipe()` validates a complete received packet.

Limits are 1–128 native steps, up to 256 non-overlapping declared inputs, 16 MiB
for the complete recipe, 16 MiB for effective inputs and 32 MiB for a complete
recipe HTTP request. A complete profile import uses the operator's 128 MiB
receiving limit. The browser displays complete definitions and requests through
expandable panels and file download.

## Complete native commissioning and receiving

The maintained executable
`receiving/workflow-recipes-journey.mjs` continues the original
`ASTRA-24EA-MERCHANT-WORKFLOW-20261012` operation. It first runs or reopens the
existing [whole workflow journey](WORKFLOWS.md), then uses that same original
merchant configuration, two named SQLite workspaces and private operation directory.

The continuation creates a reusable eight-step commissioning procedure using
the original native tools:

| Order | Native request | Selected data |
| --- | --- | --- |
| 1 | `merchant_status` | Current original release generation |
| 2 | `merchant_stage` | Declared source alias and new release ID |
| 3 | `merchant_activate` | Actual staged ID/digest and original generation |
| 4 | `merchant_start` | Actual selected generation/digest |
| 5 | `merchant_client_export` | Actual owned instance and new customer ID |
| 6 | `merchant_client_export_manifest` | The same original customer export |
| 7 | `merchant_stop` | The same owned instance |
| 8 | `merchant_status` | Completed original merchant state |

Its browser exports the full template, loads the actual recipe file into the
receiving profile, applies explicit inputs/defaults and reviews every native
contract. It recovers an accepted installation whose response was lost, then
executes the saved workflow and receives all original customer files and archive.
It transfers and replays the full completed profile, retains later workflow
editions alongside the original recipe, and closes/reopens both native stores.
Desktop and narrow-screen captures are part of the retained original output.

Run from the complete selected repository source with its installed merchant
dependencies, Node 24, Playwright and Chromium:

```sh
node stellar-forge/mcp-merchant-operator/receiving/workflow-recipes-journey.mjs \
  --directory ORIGINAL_PRIVATE_DIRECTORY \
  --chromium ACTUAL_CHROMIUM_PATH \
  --playwright-module ACTUAL_INSTALLED_PLAYWRIGHT_MODULE \
  --source-commit EXACT_SELECTED_COMMIT
```

`STARFORGE_CHROMIUM` and `STARFORGE_PLAYWRIGHT_MODULE` supply the same runtime
options. Reuse the same original directory when continuing. The native report
retains source selections, original installation/run requests, full produced
archives, actual native call identities and generated customer file identities.
