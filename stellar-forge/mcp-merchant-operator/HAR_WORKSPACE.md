# HAR merchant operations through MCP

The existing merchant MCP can operate the original captured-API workspace from
first source intake through immutable decisions, later capture editions, exact
merchant packages and complete receiving adoption. Agents and the industrial
browser use the same private source library, original HAR decoder, refresh
engine, reviewed OpenAPI compiler and merchant package writer.

The adapter attaches to an existing SF61 console. Its native writes go through
that console's authenticated HTTP endpoints and original mutation/drain
lifecycle. Paged observations and saved reviews use the original native readers.
The browser's own unchanged-route plan function supplies merchant-setting carry.

## Attach the original console

Start the original workspace against an existing private projects directory:

~~~sh
node stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/server.mjs \
  --out-parent /private/har-merchant/projects --port 0
~~~

Retain its complete printed URL in a private mode-0600 file or environment
variable. The URL includes the original workspace token in its fragment. The
adapter uses that token in the native x-workspace-token header and checks the
authenticated source-library identity against the declared projects directory
before every console operation. This uses a one-entry library read; full merchant
package inspection runs only for status and package operations.
The original browser can remain open.

Create a private connection document:

~~~json
{
  "schema": "stellar-forge.har-workspace-connection.v1",
  "workspaces": {
    "supplier": {
      "label": "Supplier captured API",
      "projectsDirectory": "/private/har-merchant/projects",
      "consoleUrlFile": "/private/har-merchant/console-url.txt",
      "files": {
        "current": {
          "kind": "capture",
          "path": "/private/har-merchant/inputs/current.har",
          "label": "Current original capture"
        },
        "later": {
          "kind": "capture",
          "path": "/private/har-merchant/inputs/later.har",
          "label": "Later original capture"
        },
        "decisions": {
          "kind": "decisions",
          "path": "/private/har-merchant/inputs/decisions.json"
        },
        "terms": {
          "kind": "merchant-plan",
          "path": "/private/har-merchant/inputs/merchant-plan.json"
        }
      },
      "imports": {
        "retained": {
          "kind": "refresh",
          "directory": "/private/har-merchant/previous-refresh",
          "label": "Existing complete source edition"
        }
      },
      "destinations": {
        "handover": {
          "directory": "/private/har-receiving/complete-source"
        }
      }
    },
    "receiver": {
      "label": "Receiving merchant",
      "projectsDirectory": "/private/har-receiver/projects",
      "consoleUrlEnv": "HAR_RECEIVING_CONSOLE_URL",
      "files": {
        "terms": {
          "kind": "merchant-plan",
          "path": "/private/har-merchant/inputs/merchant-plan.json"
        }
      }
    }
  }
}
~~~

Each projects directory must exist privately before initialization. Start an
original receiving SF61 console for the second alias when receiving work begins.
Capture, decision and plan files must be private regular files. File aliases can
also declare sha256 to pin a host-selected immutable input; otherwise each
operation pins the actual hash returned by merchant_har_files.

Imports select original directories created by the native HAR CLI or console.
A destination is a new child of an existing canonical private directory. Callers
choose these declared aliases. The connection document controls their paths.

Initialize the existing operator:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs init-har-workspaces \
  --dir /private/har-mcp \
  --connection /private/har-merchant/har-connections.json \
  --name "Captured API merchant"

node stellar-forge/mcp-merchant-operator/serve.mjs serve \
  --config /private/har-mcp/merchant-mcp.json \
  --port 3211 --token-env MCP_ACCESS_TOKEN
~~~

The installed forms are starforge merchant-mcp init-har-workspaces and
starforge merchant-mcp serve. Ordinary merchant initialization also accepts
--har-workspaces CONNECTION_JSON. An existing private merchant-mcp.json can
declare harWorkspaceConnection with that connection path. Other configured
source providers retain their original settings.

Use the original merchant stdio or authenticated HTTP connection. The existing
incoming OAuth resource configuration also applies to these registered tools.
The outbound SF61 console reference remains a separate private host setting.

## Complete source and review workflow

1. Call merchant_har_workspaces, then merchant_har_status for the selected alias.
   The status checks the actual console and reports retained source/package
   counts. merchant_har_library pages its original entries with after and limit.
   Repeat the native next cursor until null.
2. Call merchant_har_files with workspace and file. Retain its actual sha256 and
   byte count. Pass file and expectedSha256 to merchant_har_ingest. The original
   HAR bytes stream to the existing native intake. The completed result contains
   native.selection, sourceSha256 and the original inventory counts.
3. Alternatively, call merchant_har_adopt with a declared source directory alias.
   This copies a complete native capture or refresh packet into the console.
   Re-adopting the same source incorporates additional valid immutable reviews.
4. Read merchant_har_groups with the exact selection. It returns the original
   decoder's observed groups. Read merchant_har_review to get the complete native
   review metadata and its paged operations. Without a revision this is the
   original new capture draft or retained refresh draft.
5. Assemble the complete decision document from review plus every returned
   operations page. Author the real source origin, title/version, selected
   operations, path templates and examples, query decisions, backend credential
   references, headers, body/response contracts and each route acknowledgment.
   The original HAR model validates these choices.
6. Save the complete decision document with merchant_har_decisions_save. Choose
   either review for an inline document or a declared decisions file plus its
   current expectedSha256. The original immutable writer returns native.revision
   and native.selection; retain that exact selection.
7. Call merchant_har_source with that saved revision. Its capturedSource binds the
   original source bytes and approved OpenAPI bytes. items pages the exact native
   merchant operation seeds, including reviewed examples and header references.

Offset-based pages return snapshot and nextOffset. Repeat expectedSnapshot with
the next offset. A changed inventory requires a new first page. The adapter
limits each page by row count and response bytes; unusually large native rows
can be retrieved in the complete retained inventory or decision export.
The native HAR reviewer supports 1–100 approved operations. The original
merchant compiler supports up to 64 routes in one merchant plan.

The original offline reviewer is available through merchant_har_export with
kind reviewer. Download its exact HTML, open it locally, complete the existing
review form, and return its decision file through the same immutable save path.
This also works when a captured contract is more comfortable to review visually.

## Configure and save the merchant

Use the complete original merchant plan schema documented in the
[SF61 workspace guide](../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/README.md).
Configure the public seller URL, network, asset, recipient, exact atomic price
strings, selected operations and original backend transports. The operation set
must exactly match the approved HAR review. Save another source review when a
different route selection is required.

Call merchant_har_preview with selection and either plan or the declared
merchant-plan file plus expectedSha256. The adapter reads the exact source
internally; callers do not substitute OpenAPI text or an unbound route set.
The original console applies its OAuth/profile checks and native compiler.

Call merchant_har_save with the same selection/plan and an explicit name. The
original saveHarMerchant or packageRefresh path publishes the native merchant
package. The returned folder can enter the existing SF82 merchant initialization
and release lifecycle. merchant_har_packages and merchant_har_load reopen these
same saved packages and their original captured-source binding.

For an interrupted save reply, look up the intended package name. Repeating an
identical completed save reopens its original source and plan. A name already
bound to different content is reported as a conflict; retain that package and
choose the intended source or a new name. Preview, save and load preserve atomic
amounts as strings, including values larger than JavaScript's safe integer range.

After loading the package, use the existing original merchant release tools for
source inspection, staging, exact digest/generation review, activation, seller
startup, actual customer use and retained client export. The HAR agent arm
produces the same input package consumed by those established operations.

## Continue later source editions

Call merchant_har_ingest for the later capture's declared file and exact hash,
adding previous equal to the saved earlier selection, including its revision.
The native refresh packet retains both source editions, the previous immutable
review, complete comparison, original draft and subsequent saved reviews.

Use merchant_har_changes for paged operations or ambiguous source groups. Read
merchant_har_review without a revision to continue the native refresh draft.
Unchanged reviewed routes carry; changed observation sections need renewed
decisions. Temporarily absent authored routes retain their identity and
provenance through later editions. Returning dormant routes remain unselected
until explicitly included and acknowledged.

After saving the new decisions, merchant_har_plan takes the new selection and
the previous packageName. It invokes the same mergeHarMerchantPlan function
used by the browser. Exact matching source/review lineage and unchanged authored
route decisions control price/transport carry. New, changed and returning routes
receive empty prices. Review its preserved and needsPrice counts, complete the
plan, and use the same native preview/save workflow.

## Retain and resume complete original files

merchant_har_export accepts the exact selection and one kind:

| Kind | Complete original file |
| --- | --- |
| reviewer | The original self-contained review.html |
| inventory | The decoder's inventory.json |
| draft | The original capture draft or retained refresh draft.json |
| decisions | Exact immutable decisions.json for the selected saved revision |
| comparison | Complete retained refresh change-report.json |
| openapi | Exact approved openapi.json for the selected saved revision |

The adapter records one complete file and har-export.json under the existing
private customer-export root. exportId binds workspace, source selection, kind,
original source hash and exact file descriptor. A completed equal export reuses
its manifest. merchant_har_exports recovers these records after a lost reply or
restart. Retained files remain readable after the source console stops.

merchant_har_export_manifest returns the exact manifest identity.
merchant_har_export_file requires exportId, file and expectedManifestSha256.
Continue with expectedSha256, readId and nextOffset. The shared retained reader
supports chunks up to 196608 bytes and verified temporary snapshots. A completed
read releases its snapshot. merchant_har_export_file_release releases a read
that is no longer needed. The retained original stays in place.

Use the maintained downloader for automatic checkpoints and restart:

~~~sh
starforge merchant-mcp inspect-har \
  --url http://127.0.0.1:3211 --export-id ACTUAL_EXPORT_ID

starforge merchant-mcp download-har \
  --url http://127.0.0.1:3211 --export-id ACTUAL_EXPORT_ID \
  --out /private/received-har-file \
  --manifest-sha256 ACTUAL_MANIFEST_SHA256 --chunk-bytes 65536
~~~

Supply the original MCP bearer through MCP_ACCESS_TOKEN or --token-env. Run the
same download command and output directory after interruption. The common
transport verifies the saved prefix, resumes its byte offset, reopens an expired
read, verifies the complete original SHA256 and publishes the completion
manifest. Installed JavaScript exports are:

- ./merchant/mcp/har-workspaces: configuration reader, native adapter and tool definitions.
- ./merchant/mcp/har-export: exact completion manifest parser.
- ./merchant/mcp/har-download: inspectHarExport and downloadHarExport.

## Receive the complete source

merchant_har_copy writes the full original native source to one declared
destination. A refresh copy includes previous and candidate captures, comparison,
draft, original reviewer and every immutable review. A completed equal receiving
copy can be reopened after a lost reply. Existing different content is preserved.
If the sender has acquired more reviews since an earlier copy, use a new receiving
destination or re-adopt the current source into a configured receiving console.

merchant_har_receive copies a selection from fromWorkspace into the receiving
workspace through the original adoption endpoint. It verifies the source and all
saved revisions in the receiving directory. Both aliases belong to the same
configured host; the receiver thereafter owns its full independent source.
To move across hosts, transfer the complete native private directory with the
existing artifact carrier, declare it under the receiving imports, then call
merchant_har_adopt. Standalone OpenAPI or reviewer downloads are useful operating
files; the complete native directory carries the capture-edition history.

Once received, use merchant_har_source, merchant_har_plan or a declared plan,
native preview/save, and the original merchant release workflow on that receiving
alias. The source library and complete exports survive closure of this MCP
process. Closing the adapter drains its active calls and temporary reads while
the externally owned SF61 consoles retain their existing lifetimes.

## Original receiving operation

The native receiving entry is receiving/har-console-adoption.mjs. It consumes the
completed AF825-HAR-CONSOLE-20261012 result and its retained original captures and
merchant plan. It operates the actual original merchant MCP HTTP factory and both
native SF61 consoles, continuing source intake/refresh, immutable decision save,
merchant package/replay, receiver adoption, original file download/restart and
complete package reopening. Source identity and the retained native request
results are recorded in its output directory.

~~~sh
node stellar-forge/mcp-merchant-operator/receiving/har-console-adoption.mjs \
  --console-result /private/completed-har-console/result.json \
  --out /private/har-agent-receiving
~~~

The existing AF825 Muse receiving request owns this continuation and its source
repairs. Reuse its completed originals and retained result before dispatching.
