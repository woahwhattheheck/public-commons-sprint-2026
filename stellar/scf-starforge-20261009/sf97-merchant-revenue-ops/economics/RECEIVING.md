# Receive a complete supplier-cost review

Open **Supplier costs → Receive cost reviews** to bring a selected review into
another merchant workspace. The package includes the original supplier files,
cost lines, allocations, coverage assessment, pricing source and any earlier
receiving history. You can inspect that complete original before creating a
local cost draft.

The receiving workflow uses the existing Supplier costs and merchant pricing
engines. An imported draft can be reviewed, corrected, saved, compared, proposed
to pricing and included in a complete workspace backup through those same
controls.

## Export the selected review

In the source workspace, open **Exports and recovery**, choose the saved cost
edition and select **Create cost edition package**. Download the complete TAR
from the returned entry. Preserve its filename and SHA-256 with the handover.
This is the selected `COST_EDITION` package.

For an entire workspace move, use **Create complete private backup** and the
[Applications restore workflow](../../distribution/runtime-workspace/PRICING_APPLICATIONS.md).
That existing restore creates or resumes a complete private pricing directory.
The selected-review receiver opens a cost edition alongside the receiving
merchant's existing history.

A useful handover identifies the supplier/account, actual document period,
original review name, selected billed or quoted basis, and the intended
receiving merchant. The source documents and allocation explanations are
already in the TAR; a separate transcription is unnecessary.

## Receive and reopen the full original

1. Open the receiving merchant's normal pricing workspace and select
   **Supplier costs → Receive cost reviews**.
2. Choose the original TAR and give the received review a recognizable name.
3. Select **Receive complete package**. The server reads the complete archive,
   checks its original manifests, cost edition, pricing report, source receipts
   and original-file identities, then retains the package.
4. Open it from **Received review history**. Inspect the source cost report,
   original pricing and cost identifiers, source documents and file table.
   Every listed member has its complete download.
5. Use **Download complete original TAR** to retrieve the same archive bytes.

Packages may be up to 512 MiB. The original source-file limit remains 16 MiB,
and the original cost-edition and archive member limits remain in force. The
receiver streams the archive and retains it in 8 MiB parts. Those exact parts
keep each retained archive part within the original workspace backup format's
64 MiB member limit. Every exported TAR still has a **512 MiB aggregate limit**,
including all source originals, local copies and receiving lineage. A received
archive near that limit can therefore make a later full backup or selected
re-export too large. The export reports that exact outcome and leaves its source
workspace intact. Download complete received originals separately and preserve
the full private workspace directory for a host-level move of a larger history;
those separate downloads remain individually reopenable received packages.

The ordinary browser upload allows up to 30 minutes for the complete request.
The host needs space for the original input, verified reading files and retained
parts while receiving. A reconstructed TAR used for a download is a derived
local cache. Workspace backups carry the complete original parts and receiving
records, and recreate that cache when needed.

The received report describes its original merchant and original observations.
Use the local correspondence review below to prepare a decision for the
receiving merchant.

## Review correspondence to the local merchant

Choose a saved review from **Local saved pricing review**, then select
**Open local route correspondence**. This selects a complete retained pricing
report from the receiving workspace.

For each original route, choose its intended local route or **Leave amount
unassigned**. Matching route identifiers are initially selected only when the
original method and path also match. Review every row before accepting the
mapping.

The current receiving action supports one original route per selected local
route. A route deliberately left unassigned contributes its original signed
amount and quantity to the ordinary unassigned remainder. The full original
allocation is still available in the received report and source TAR.

The local allocations keep the original exact amounts and quantities. They
become `EXPLICIT_AMOUNT` allocations in the receiving book. Original operator
or HTTP weights remain in the original package and its lineage; receiving does
not recalculate those weights against a different observation period.

Enter the local cost-edition name and explain the receiving/allocation decision.
Select **Review complete mapped costs**. The native cost engine calculates the
entire local result, including currency groups, unassigned amounts, route
assessments and source-period issues.

The correspondence records original and local source IDs, line IDs, route IDs,
pricing report hashes and the exact received archive. Local source IDs are
stable for each exact original source receipt. Reusing that same original in
another received review reuses its local source identity.

## Retain the files and continue in the cost editor

Select **Retain original files and open local draft**. This copies each complete
supplier original through the existing immutable source uploader, saves the
reviewed receiving draft, and opens it in **Cost scope and coverage**.

The receiving draft keeps the original document period. Local route coverage
starts as `UNKNOWN`, zero-cost confirmation is clear, and local period alignment
starts unconfirmed. Review these fields against the selected local observations
and supplier records. An earlier merchant's coverage assessment stays visible
in the original received report.

Continue through the normal workflow:

- Inspect any source mapping or allocation in **Original files**, **Map charge
  columns**, and **Charges and allocations**.
- Complete the local period and route coverage assessment.
- In **Review and save**, calculate the original native review and save a new
  immutable edition.
- Use **Apply costs to pricing** for eligible quoted or billed route costs.
  The original proposal hash and pricing revision identify the explicit save.
- Continue through the original pricing and exact payment-price decision
  workflow when changing merchant terms.

Opening a received draft preserves the earlier local editor state under
**Other open local drafts** in this browser tab, including a retained pending
save. Returning to that state restores its original request and revision.
The receiving draft itself is saved on the server and remains available after
reopening the host.

A corrected saved edition can change its local lines, allocations and coverage
through the ordinary editor. Its `receivedFrom` link continues to identify the
original received draft and archive. Selecting a different local pricing
source requires another explicit correspondence review.

## Recover interrupted work

The browser retains upload and local-draft request selectors in session storage.
For an upload whose reply was interrupted, select **Recover received request**.
If its completed package is listed, that action reopens the existing package.
Otherwise, reselect the same original file and choose **Continue original
package upload**.

A receiving request identifies the complete original bytes, byte count, label
and filename. Reusing it with different content produces a conflict. Use a new
receiving request for a different package. If the server explicitly rejects the
upload, **Choose another package** checks the original request first. It reopens
an already committed result or clears the rejected, uncommitted request so you
can select the correct TAR. An interrupted reply keeps its original recovery
request through successful reopening.

For an interrupted local-draft action, select **Recover original local draft**.
The same request and reviewed mapping recover its saved result. The browser
retains this selector until both the committed draft and its original local
pricing source have reopened successfully. Original files
already copied by that request retain their stable local identities.

**Saved receiving drafts** lists the drafts prepared from the selected package.
**Reopen local draft** returns its complete saved book to the original editor.
The original cost save still uses its separate request ID and the current
economics revision. An interrupted cost save is recovered through the normal
**Recover previous save** action. Edits made while a save runs stay in the local
draft; the saved edition is retained separately. A calculation whose input
changes while it runs is discarded, so its report cannot be shown as the review
of a newer draft.

## Export, back up and receive the lineage

A saved cost edition made from a received draft includes
`received-origin.json`, its original/local correspondence and the
`receivedFrom` binding. Applying its proposal also carries that binding into
the original pricing provenance.

Exporting that saved edition includes the selected receiving record, exact
archive parts and relevant draft under `lineage/PACKAGE_ID/`. Earlier original
packages remain complete, including their own original lineage.

A complete workspace backup includes all committed received packages, their
exact parts and saved receiving drafts under
`economics/received/records/PACKAGE_ID/`. The original restore implementation
receives those files. Reopening Supplier costs rebuilds the reading/download
cache from the same retained bytes when needed.

The source, received draft, saved local cost edition and saved pricing decision
keep distinct identities. Each screen and export can therefore answer which
supplier original was received, how it was assigned locally, and which exact
decision followed.


## Use the existing merchant MCP and CLI

A host can declare complete selected-review packages alongside its original
source and cost-book inputs in the existing pricing connection file:

```json
{
  "schema": "stellar-forge.pricing-workspace-connection.v1",
  "workspaces": {
    "merchant": {
      "label": "Merchant",
      "config": "/private/merchant/seller-service.json",
      "directory": "/private/merchant/pricing",
      "snapshot": "/private/merchant/operations.json",
      "costPackages": {
        "supplier_review": {
          "label": "Supplier cost review",
          "path": "/private/received/review.tar"
        }
      }
    }
  }
}
```

Use the existing connection options for the merchant's configured observation
source. Each PACKAGE alias names a private original regular file. The agent
selects its alias; the server resolves the configured host path. Source and
book aliases continue to use `costInputs` and `costBooks`.

The following operations use the same authenticated merchant endpoint and
opened pricing workspace:

| CLI operation | MCP tool | Purpose |
| --- | --- | --- |
| `cost-inputs` | `merchant_pricing_cost_inputs` | Page declared SOURCE, BOOK or PACKAGE aliases. |
| `cost-input` | `merchant_pricing_cost_input` | Inspect a selected PACKAGE's exact bytes and SHA-256. |
| `cost-receive` | `merchant_pricing_cost_receive` | Retain the complete inspected selected-review TAR. |
| `cost-received` | `merchant_pricing_cost_received` | Page its original cost report, sources, files and receiving drafts. |
| `cost-receiving-review` | `merchant_pricing_cost_receiving_review` | Review all original-to-local route mappings through the native cost engine. |
| `cost-receiving-draft` | `merchant_pricing_cost_receiving_draft` | Retain originals and the reviewed local draft. |
| `cost-preview` / `cost-save` | `merchant_pricing_cost_preview` / `merchant_pricing_cost_save` | Continue with the native editor's book semantics and immutable save. |
| `cost-manifest` / `cost-download` | `merchant_pricing_cost_manifest` / original file tools | Download the complete original TAR using kind `received`. |
| `cost-request` | `merchant_pricing_cost_request` | Find the original receiving request using kind `RECEIVED`. |

Every CLI command takes the existing `--url MCP_ENDPOINT` and token environment
option. Keep argument files private (mode 0600); a file passed with `--input`
contains the exact MCP argument object. Retain that same file for a write retry.

### Inspect and receive

Open the configured workspace with the ordinary `open` operation. Inspect the
declared input:

```sh
merchant-mcp pricing cost-input --url MCP_ENDPOINT --workspace merchant --kind PACKAGE --input-alias supplier_review
```

Create a private receive argument file containing `workspace`, `input`,
`expectedSha256`, `expectedBytes`, a newly generated `requestId`, `label` and
`name`. Use the exact inspected hash and byte count. For example, the selectors
are `workspace: "merchant"`, `input: "supplier_review"`, and
`name: "review.tar"`; the request ID and hash come from the actual operation.

```sh
merchant-mcp pricing cost-receive --url MCP_ENDPOINT --input /private/receive-cost-review.json
```

The returned `packageId` identifies the complete received package. Repeat that
same request after an interrupted reply. Once committed, it reopens even if
the host's original input file has moved. `cost-request` with
`{workspace, kind: "RECEIVED", requestId}` reads the committed outcome.

Use `cost-received` with `{workspace, packageId, view, offset, limit}`. Useful
views are `routes`, `lines`, `allocations`, `sources`, `files` and
`drafts`. Continue each returned `page.nextOffset` until it is null. An
oversized inline row directs the caller to its complete original file.

### Select the exact saved local pricing report

List saved local pricing reviews with `cost-list`, kind `PRICING`. The original
`source` CLI operation (`merchant_pricing_planning_source`) reads one saved
pricing version and pages its retained routes.

Obtain that version's original manifest with
`merchant_pricing_manifest({workspace, kind: "review", id: pricingVersion})`.
Its `manifest.files["report/report.json"].sha256` is the
`expectedPricingReportSha256` for the correspondence review. The generic CLI
`manifest` operation accepts the same object in `--input`:

```sh
merchant-mcp pricing source --url MCP_ENDPOINT --workspace merchant --version SAVED_PRICING_UUID
merchant-mcp pricing manifest --url MCP_ENDPOINT --input /private/saved-pricing-manifest.json
```

Prepare a private review file with these fields:

| Field | Required value |
| --- | --- |
| `workspace` | Existing receiving merchant alias. |
| `packageId` | The committed package ID. |
| `expectedPackageSha256` | SHA-256 of the complete received original TAR. |
| `pricingVersion` | The selected saved local pricing review UUID. |
| `expectedPricingReportSha256` | Hash of that version's original `report/report.json`. |
| `routeMappings` | One `{from, to}` per original route; `to` is a local route ID or null. |
| `label` | Name of the local cost draft. |
| `reason` | Actual reason for the receiving and allocation decision. |

```sh
merchant-mcp pricing cost-receiving-review --url MCP_ENDPOINT --input /private/review-cost-correspondence.json
```

Read the returned exact local report and `reviewSha256`. Repeat the same review
selection with `view: "routeMappings"`, `"sourceMappings"` or `"lineMappings"`
to page the complete retained correspondence. Report views such as
`allocations`, `groups` and `issues` expose the native calculated outcome.

Retain the identical selection in a new private draft argument file, adding
the returned `reviewSha256` and one stable new `requestId`. Remove paging/view
fields from the write input.

```sh
merchant-mcp pricing cost-receiving-draft --url MCP_ENDPOINT --input /private/retain-local-cost-draft.json
```

The result includes `receivedDraft: {packageId, requestId}`. Preserve this exact
selector. Repeating the same draft write recovers its original result.

### Review local coverage and save

Pass the returned `receivedDraft` to `cost-preview` and `cost-save` instead of
transferring the complete book through the MCP body. Optional
`bookAdjustments` can set only `label`, `reason`, `periodAlignment` and the
complete local `coverage` array. Enter the actual assessment; the unchanged
native validator checks its semantics.

For broader corrections to lines, allocations or imports, reopen the receiving
draft in the browser editor, or select a complete explicit inline book or
host-declared `bookSource` through the original cost tools. Exactly one of
`book`, `bookSource` and `receivedDraft` identifies the book for a call.

A save input combines `workspace`, `receivedDraft`, the same reviewed
`bookAdjustments`, one stable save `requestId` and the original
`expectedRevision` read from `cost-state`. Use the normal `cost-preview`,
`cost-save`, `cost-edition`, `cost-proposal` and `cost-apply` sequence.
The received package, receiving-draft request, immutable cost edition and
pricing proposal keep their original separate IDs.

### Download and continue after interruption

The original retained downloader supports the received package directly:

```sh
merchant-mcp pricing cost-manifest --url MCP_ENDPOINT --workspace merchant --kind received --id PACKAGE_UUID
merchant-mcp pricing cost-download --url MCP_ENDPOINT --workspace merchant --kind received --id PACKAGE_UUID --out /private/received-original
```

Supply `--manifest-sha256` when continuing from an already inspected file
manifest. The same private output directory resumes the original verified
chunks. The completed directory includes the exact `PACKAGE_UUID.tar`.
The received TAR's original hash remains distinct from its file-manifest hash.

A later selected edition or complete workspace backup uses the existing
`cost-export` and `cost-download --kind export` operations. The aggregate
archive limit described above applies to those complete packages.

## Local HTTP integration

The original pricing workspace server serves the receiving UI and native
operations. The workspace's existing Host/Origin and token checks apply.
JSON requests retain the existing `x-sf97-workspace` token header.

| Method and path | Input or result |
| --- | --- |
| `POST /api/economics/received-uploads/REQUEST_UUID` | Stream the complete original TAR as `application/octet-stream`. |
| `POST /api/economics/received` | `{packageId}` opens the complete received report and file listing. |
| `POST /api/economics/received-request` | `{packageId}` returns the committed original request outcome. |
| `POST /api/economics/received-review` | The complete route correspondence selection returns the native report and review hash. |
| `POST /api/economics/received-import` | The same selection plus `reviewSha256` and `requestId` retains the local receiving draft. |
| `POST /api/economics/received-drafts` | `{packageId}` lists the retained local drafts. |
| `POST /api/economics/received-draft` | `{packageId, requestId}` reopens one complete local draft. |
| `GET /cost-files/received/PACKAGE_UUID` | Download the exact complete original TAR. |
| `GET /cost-files/received/PACKAGE_UUID/MEMBER_PATH` | Download one full listed original member. |

The raw upload also carries `x-sf97-received`, the URI-encoded JSON
`{label, name, expectedBytes?, expectedSha256?}`. Use the expected values when
already known; the receiver calculates the exact bytes and hash in every case.
List received history through the existing list operation with kind
`RECEIVED`. Preserve the original request across network interruption and
resolve its committed outcome before starting a different request.
