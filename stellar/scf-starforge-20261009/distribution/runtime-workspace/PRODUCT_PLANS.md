# Saved product plans

Operation: `SCF-SAVED-PRODUCT-PLANS-A8CE-20261012`

A product plan keeps a team's purpose, required capabilities, exact source recipe,
dependency inspection and native build together. It lives in the existing Runtime
workspace, beside its source reviews and build operations. A second operator can
open the same plan after a browser or server restart. Another workspace can receive
the complete plan document and continue with its own existing Git checkout.

This extends [product requirements](../discovery/PRODUCT_REQUIREMENTS.md) and the
original [source-build workflow](SOURCE_BUILDS.md). The original product catalog,
recipe composer, manifest reader, builder and adapter installer remain the engines
behind the work.

## Use the existing browser

Open **Build a product** in the Runtime workspace. Its **Product plans** shelf
shows saved plans and supports name, purpose, recipe and capability searches.
The list returns complete pages with previous/next controls.

1. Load committed products from the existing Git repository. Choose the required
   capabilities and a product covering the full basket.
2. Inspect the product's source declarations, actual optional dependency manifests
   and committed lock entries. Enter a plan name and its purpose, then choose
   **Save product plan**.
3. The saved plan opens its original review below the product details. Choose
   **Build reviewed product** to start that review's existing native request.
   Follow its retained progress, continue an interrupted build, or download the
   completed package.
4. Choose **Choose adapters and install** on the completed build. This opens the
   same archive in **Source & profile**, where the original runtime profile and
   installation operations continue the work.
5. Reopen the saved plan from the shelf after restarting the browser or server.
   Its complete capability basket, immutable source, stored dependency inspection,
   review ID, request UUID and original build are restored.

Changing a plan's name, purpose, source, recipe or capability basket creates a new
immutable plan when saved. Plans selecting the same underlying source review can
share that original build. A capability change clears the old displayed review
until the new full basket has been reviewed or saved.

**Export complete plan** downloads the full plan, every retained origin and the
actual build observations recorded with it. **Save original build request**
exports the exact request accepted by the original source-build operation.

### Receive in another workspace

Choose the complete exported JSON document under **Receive a product plan**.
The browser shows its name, recipe, commit and capability count before receiving.
Set this workspace's existing Git repository, Python interpreter and local-object
option in the source form, then choose **Receive using current source settings**.

The receiver saves the entire input document and the selected host settings first.
It then resolves the immutable recipe through the existing Git reader, confirms
the same product definition and complete capability basket, and obtains this
workspace's normal saved source review. Original workspace IDs, reviews, requests,
manifest inspections and build observations remain in the plan's history.

The local review is the one used by the existing build controls. Receiving a
document into a second workspace does not cause another workspace's worker state
to become a local operation.

An interrupted receive appears under **Retained receiving**. **Continue receiving**
uses that exact retained document and its saved source settings. **Download
original plan** returns the whole input plan again. If the operator selected the
wrong repository or source mode, **Use current source settings** receives the
retained document with the explicitly corrected settings. The prior receiving
record remains available.

Received plans have their own name/source search, status filter and previous/next
pages. The shelf reads small retained summaries and status files; complete source
documents are opened only for receiving, continuation or download. An input saved
before its summary was written remains visible and recovers its description when
continued.

### Reopen with local source and dependency inspection

Opening an already saved local plan reads its private retained plan, original
native review and stored manifest inspection. It does not fetch Git objects.
Saving the unchanged plan or receiving it again with the same local binding
reuses those records and the original request UUID.

When API or CLI callers omit `offline` and `python`, a matching existing local
binding supplies its saved choices. Matching bindings use the newest retained
origin, with the origin ID as a stable tie-breaker. A new local binding defaults to local Git
objects and `python3`. Explicit settings always select the requested binding.

**Refresh source inspection** invokes the original source reader at the same
immutable commit using the selected binding's saved offline/Python settings.
The refreshed manifest inspection becomes another retained origin for the same
native review. Runtime installation still follows its own original source,
dependency cache, package lock and recovery options.

## Readable product briefings

Open a saved plan and choose **View / print briefing**. The original Runtime
screen shows a document with the team's purpose, complete required capability
basket, immutable product recipe, actual manifest and committed-lock versions,
and the selected native review and package state. **Print / save PDF** uses the
browser's printer; **Download HTML** saves a self-contained document.

Technical sections contain the full command/export inventory, transitive package
instances, source declarations and retained build history. Expand the sections
needed for the review before printing. The ordinary preview and printed pages
lead with the purpose, required capabilities, direct dependency declarations and
current native package information. **Export Markdown briefing** includes the
complete technical appendices in readable text.

Every briefing records its generation time, saved plan, immutable commit and
selected review. Package state comes from that original local build. The source
projection uses the stored manifest inspection; the original inspection-refresh
action updates it explicitly. Source paths, package IDs and build references make
the delivery traceable, while host bindings remain in the complete plan document
used by the receiving workflow.

```bash
starforge runtime-workspace source-plan-briefing --workspace /absolute/existing/runtime-workspace --plan-id PLAN_ID --format html --output product-briefing.html
starforge runtime-workspace source-plan-briefing --workspace /absolute/existing/runtime-workspace --plan-id PLAN_ID --format markdown --output product-briefing.md
starforge runtime-workspace source-plan-briefing --workspace /absolute/existing/runtime-workspace --plan-id PLAN_ID --format json --output product-briefing.json
```

Omit `--output` to write the complete selected format to stdout. Each supplied
output path must be new. The CLI publishes the full UTF-8 file atomically with
private permissions and preserves existing destinations. `--binding-id` selects
one exact local source review; the default uses the saved plan's deterministic
local binding.

`GET /api/source-builds/plan-briefing` accepts `planId`, optional `bindingId`
and `format` (`markdown`, `html` or `json`). The existing workspace capability
protects the request. The response contains the complete `content`, `filename`,
`mimeType`, `planId`, `bindingId`, `sourceCommit`, `generatedAt` and `format`.
The source-owned `./operator/product-plan-briefing` export supplies the typed
projection and formatters for applications using the same opened plan view.

The browser document uses the Runtime's declared local stylesheet and original
content policy. Standalone HTML embeds that same stylesheet. The saved-plan
receiving journey can therefore finish with a readable customer export from the
actual reopened plan and its original native package.

## CLI

Use `starforge runtime-workspace`, or invoke the same
`distribution/runtime-workspace/cli.mjs` from a current source checkout.
Every workspace path identifies an existing private Runtime workspace.

| Command | Purpose |
| --- | --- |
| `source-plans --workspace DIRECTORY [--query TEXT --limit 30 --cursor ID]` | Search saved-plan pages; receiving has independent `--receiving-query`, `--receiving-status`, `--receiving-limit` and `--receiving-cursor` options |
| `source-plan-inspect --document COMPLETE_JSON` | Read and validate the complete portable plan without opening a workspace |
| `source-plan-save --workspace DIRECTORY --request COMPLETE_JSON` | Save purpose, exact product source and full capability basket |
| `source-plan-open --workspace DIRECTORY --plan-id ID [--binding-id ID]` | Reopen its native local review and stored inspection |
| `source-plan-refresh --workspace DIRECTORY --plan-id ID [--binding-id ID]` | Refresh actual immutable source manifests with the saved reader options |
| `source-plan-briefing --workspace DIRECTORY --plan-id ID [--binding-id ID --format markdown\|html\|json --output NEW_FILE]` | Preview, print or export the readable saved product and actual native package state |
| `source-plan-export --workspace DIRECTORY --plan-id ID [--output NEW_JSON]` | Export the complete plan, origins and actual observed build history |
| `source-plan-receive --workspace DIRECTORY --document COMPLETE_JSON --repository ABSOLUTE_GIT [--offline true\|false --python PROGRAM]` | Retain the complete input and establish or reuse a local native binding |
| `source-plan-receiving --workspace DIRECTORY --receipt-id ID [--output NEW_JSON]` | Read the entire original receiving input and its current result |
| `source-plan-continue --workspace DIRECTORY --receipt-id ID` | Continue the retained receive or reopen its completed local binding |
| `source-plan-build --workspace DIRECTORY --plan-id ID [--binding-id ID]` | Pass that exact saved build request to the original workspace worker |

Save input contains `repository`, the immutable `ref` returned by the catalog,
`selection`, `label`, optional `purpose`, `requirements`, `offline` and
`python`. Requirements use the existing exact capability IDs, for example
`command:grant-workspace` and `command:grant-source-tables`.

A successful save/open/receive includes `plan.planId`, `bindingId`, the original
`review`, the actual stored `product.runtimeRequirements`, and `buildRequest`.
Use the returned IDs in subsequent commands. Export destinations are new private
files; the CLI refuses to replace an existing file. Without `--output`, commands
print the complete JSON to standard output. Receiving status accepts `all`,
`RECEIVED`, `FAILED` or `COMPLETE`; `receivingNextCursor` advances its own page.

After `source-plan-build`, the original `source-builds`,
`source-build-continue --operation-id UUID`, Runtime status and browser controls
observe or resume the same operation. The plan command delegates to
`workspace.begin(plan.buildRequest)`.

## API: prepare a complete grant-operations plan

This example resolves the actual commit from an existing checkout and uses the
real grant-operations recipe and both requested commands. It saves a plan and
exports its complete document through the installed package APIs.

```js
import { openRuntimeWorkspace }
  from '@tokenjunkielabs/starforge-merchant/runtime-workspace';
import { saveSourceProductPlan, exportSourceProductPlan }
  from '@tokenjunkielabs/starforge-merchant/operator/product-plans';

const workspace = await openRuntimeWorkspace({
  directory: '/srv/starforge/runtime-workspace',
});
const catalog = await workspace.sourceBuildsCatalog({
  repository: '/srv/starforge/source', ref: 'HEAD', offline: true,
});
const plan = await saveSourceProductPlan(workspace.directory, {
  repository: catalog.repository,
  ref: catalog.sourceCommit,
  selection: 'grant-operations',
  label: 'Grant delivery operations',
  purpose: 'Prepare source-backed grant budgets and recurring delivery work.',
  requirements: ['command:grant-workspace', 'command:grant-source-tables'],
  offline: catalog.offline,
  python: 'python3',
});
const document = await exportSourceProductPlan(workspace.directory, {
  planId: plan.plan.planId,
});
console.log(JSON.stringify({ planId: plan.plan.planId,
  bindingId: plan.bindingId, buildRequest: plan.buildRequest, document }, null, 2));

// Start or reopen the same original native build when ready:
const operation = await workspace.begin(plan.buildRequest);
console.log(operation);
```

The model methods `sourcePlansState`, `sourcePlanRead`, `sourcePlanSave`,
`sourcePlanRefresh`, `sourcePlanExport`, `sourcePlanReceive`,
`sourcePlanReceiving` and `sourcePlanContinue` expose the same functions against
the open workspace. The typed `operator/product-plans` export exposes the
underlying functions for other local tools. That export belongs to the
`operator-discovery` contribution: use a package including that declaration or
import the same source module from a maintained checkout.

| Authenticated HTTP route | Input |
| --- | --- |
| `GET /api/source-builds/plans` | `query`, `limit` (1–100), `cursor`; independent `receivingQuery`, `receivingStatus`, `receivingLimit` and `receivingCursor` |
| `GET /api/source-builds/plan` | `planId`, optional `bindingId` |
| `GET /api/source-builds/plan-export` | `planId` |
| `GET /api/source-builds/plan-receiving` | `receiptId` |
| `POST /api/source-builds/plan-save` | Complete save input described above |
| `POST /api/source-builds/plan-refresh` | `planId`, optional `bindingId` |
| `POST /api/source-builds/plan-receive` | Complete `bundle`, `repository`, optional `offline` and `python` |
| `POST /api/source-builds/plan-receive-continue` | `receiptId` |

The existing loopback capability and exact write-origin checks protect these
routes. The portable document limit is 16 MiB, with room for the small receiving
request envelope. Save requests accept the full supported basket of 128 exact
capability IDs. Lists paginate; exported/imported documents include all origins
and observations.

## Retained source and operation identity

The immutable intent comprises the normalized name, purpose, commit, recipe and
sorted capability basket. Its identifier is independent of host paths. The saved
product definition retains original composed commands, applications, source
owners, input blob hashes and package identity.

Each origin contains its workspace UUID, the full original validated native
review, dependency inspection and timestamp. Only a binding created in this
workspace can supply its executable review. Review/request IDs continue to come
from the existing native review store.

The workspace retains:

- `source-builds/plans/PLAN_ID/plan.json`: complete immutable intent and product.
- `origins/`, `bindings/` and `observations/` inside that plan: source history,
  local bindings and actual native build snapshots.
- `source-builds/plan-receiving/RECEIPT_ID/input.json`: the full original document,
  bundle hash and chosen repository/offline/Python settings.
- `summary.json` beside each receiving input: compact immutable source metadata
  used by the independently paged shelf; ordinary list reads leave the full
  source document in its retained file.
- `state.json` beside the receiving input: its current receiving result. A
  completed receipt points back to its local plan binding and original review.

The same private-directory, atomic record and native lease helpers used by the
Runtime workspace retain these files. A repeated save or receive converges on
the existing records. Source inspection uses original committed inputs;
installation readiness and continuation remain with the existing native
builder and runtime installer.

## Native receiving journey

Use the current Runtime server and an existing source checkout to save a real
full capability basket, build its original review and choose its archive for
adapter installation. Restart the same server, reopen the plan, and inspect its
unchanged review/request/build identity and stored manifest versions.

Export the complete plan, receive it in another existing Runtime workspace, and
open the new local binding. Confirm that the originating workspace/review/build
history is retained and that its local build request comes from that workspace's
normal native review. Reimport the same document to resume that binding. The
existing source-build and Grant application receiving operations retain their
own original sources and operation identities throughout this extension.

Open the reopened plan's readable briefing, review its native package and actual
dependency versions at desktop and mobile widths, then save the standalone HTML
and Markdown. Use the original browser's print preview for the customer PDF and
check that the generated document names the same source, review and build.
