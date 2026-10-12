# USGS Water agent operations and customer receiving

The maintained merchant MCP now opens the original USGS Water project and operator console. An analyst and an agent work with the same project revision, retained provider captures, source reviews, immutable editions, HEC-DSS plans, native exports and original job state. The customer command downloads a complete source/native handover and receives it through that same Water project engine.

The native scientific mapping, format, time and quality rules remain documented in [DSS.md](../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/DSS.md). This guide covers the complete agent and customer workflow. The existing [Water operator guide](../../stellar/scf-starforge-20261009/sf30-seller-sdk/usgs-water/README.md) covers the source console and original merchant/buyer operations.

## 1. Attach original projects

Create a private connection file. Declare each original project once under a stable lower-case alias. Project directories must already exist at their canonical paths with mode 0700. Connection and selected mapping/handover files are private regular files with mode 0600.

    {
      "schema": "stellar-forge.usgs-workspace-connection.v1",
      "workspaces": {
        "potomac": {
          "label": "Potomac daily flow",
          "directory": "/private/water-project",
          "files": {
            "mapping": {
              "kind": "mapping",
              "path": "/private/potomac-mapping.json",
              "sha256": "<complete mapping-file SHA256>"
            }
          }
        },
        "received": {
          "label": "Received analyst project",
          "directory": "/private/received-water",
          "files": {}
        }
      }
    }

Relative paths in this file resolve against its directory. There may be 1–32 workspace aliases and up to 128 selected file handles per alias. A handle's kind is mapping or handover; its optional configured SHA256 pins the operator's original selection. MCP arguments select these aliases and handles. Executable paths and arbitrary host paths are host configuration.

From repository source:

    node stellar-forge/mcp-merchant-operator/serve.mjs init-usgs-workspaces \
      --dir /private/water-mcp \
      --connection /private/water-connection.json

    node stellar-forge/mcp-merchant-operator/serve.mjs serve \
      --config /private/water-mcp/merchant-mcp.json \
      --port 3211 --token-env MCP_ACCESS_TOKEN

Use the existing host bearer secret in MCP_ACCESS_TOKEN. It must be printable ASCII and at least 24 characters. The maintained server also retains its existing OAuth hosting options. An original general merchant initialization can attach this connection with --usgs-workspaces; an existing merchant configuration can set usgsWorkspaceConnection to this private file.

The portable product exposes these same commands as merchant-mcp and merchant-usgs. It includes the original source dependencies and this guide. The customer operations are also available as:

    node stellar-forge/mcp-merchant-operator/serve.mjs usgs --help

Native DSS creation, readback and runtime inspection use the official interpreter configured on the host through USGS_HECDSS_PYTHON. Use the original DSS runtime guide to install or select it. The MCP caller does not choose a Python executable.

## 2. Open and inspect the shared project

Call merchant_usgs_workspaces to inspect the declared aliases and selected file handles. Then open the original project:

    {"workspace":"potomac"}

Pass that object to merchant_usgs_open. Its returned URL opens the original Water console. A second open through this host reuses that console. Close/reopen retains the same project files and native operation identities.

Use merchant_usgs_status for current project revision, original job progress, counts and active retained reads. merchant_usgs_inventory pages captures, reviews, editions, dssExports, jobs or history. For example:

    {"workspace":"potomac","kind":"captures","limit":25}

Each page contains total, snapshot, offset, items and nextOffset. Follow nextOffset with the same expectedSnapshot. A changed original collection reports USGS_INVENTORY_CHANGED so the caller can inspect page zero again. Pages honor both the requested row limit and the encoded response size. The returned nextOffset is authoritative.

Save an explicit source selection with merchant_usgs_project_save, including title, selection and the current expectedRevision. Start or resume a capture with merchant_usgs_capture_start and its stable captureId and expectedRevision. The original console retains provider pages and job progress. merchant_usgs_capture_cancel reaches the same original acquisition.

After an interrupted source call, inspect the original capture ID and retained pages before resuming it. The source IDs and provider observations remain attached to the original project revision. Acquisition is an explicit operation; opening, inspection, file retrieval and customer receiving do not reacquire USGS data.

## 3. Analyze, compare and retain the decision

merchant_usgs_capture returns source metadata and page count. merchant_usgs_capture_pages returns original response URLs, exact hashes and retrieval metadata. merchant_usgs_capture_file_read retrieves a selected page by its original pageIndex.

Run merchant_usgs_analysis with captureId, optional original comparisonCaptureId and the original analysis options. The default series view returns series identities, exact summary statistics and counts. It does not expand every time observation inside each series.

The view parameter supports these complete source-preserving reads:

| View | Original data returned | Additional selection |
| --- | --- | --- |
| series | Series identities, current/baseline summaries and counts | None |
| source-pages | Exact pages that belong to the analysis | None |
| observations | Original current-window time observations | seriesKey |
| baseline-observations | Original baseline-window time observations | seriesKey |
| conflicts | Conflicting feature identities and retained version counts | None |
| conflict-records | Complete retained versions of one conflicting feature | featureKey |
| added, removed, changed | Corresponding original capture comparison records | comparisonCaptureId when analyzing |
| unresolved | Original unresolved comparison identities and side counts | comparisonCaptureId when analyzing |
| unresolved-previous, unresolved-current | Complete records for one side of an unresolved feature | featureKey |

For example, obtain a series key from the default result and then request:

    {
      "workspace": "potomac",
      "captureId": "usgs-october-01-07",
      "view": "observations",
      "seriesKey": "<complete original series key>",
      "limit": 100
    }

All these collections use the same snapshot/offset contract. Comparison views require an actual original comparison capture; an absent comparison is not reported as zero changes.

Retain a decision with merchant_usgs_review_save using reviewId, captureId, the reviewed expectedCaptureSha256, the same options/comparison and a note. The original immutable review binds the analysis, source and decision. Repeat the same ID and inputs to reopen it after a lost reply. A different decision under that ID is rejected.

merchant_usgs_review applies the same views to the saved review. For large analyses, retain the review once and page it instead of repeatedly recomputing the original analysis. merchant_usgs_review_file_read provides the complete native JSON, HTML, CSV or GeoJSON export. Unusually large individual records remain available through those original file exports or the exact source page.

Prepare the original source edition with merchant_usgs_edition_prepare using the existing reviewId and a stable editionId. merchant_usgs_edition pages its original member manifest. merchant_usgs_edition_file_read selects an exact member from that manifest and preserves its byte hash.

## 4. Review and run the native DSS mapping

Use merchant_usgs_dss_source with the retained editionId. This exposes original source identity and paged series, including units, observation states, clock information and approval counts.

A mapping is the complete native starforge.usgs-dss-mapping.v1 object described by DSS.md. Pass it inline to merchant_usgs_dss_preview, or select the declared mappingFile and expectedMappingFileSha256. To inspect a configured handle first:

    {"workspace":"potomac","file":"mapping"}

Use merchant_usgs_configured_file. The preview using that handle is:

    {
      "workspace": "potomac",
      "editionId": "october-water",
      "mappingFile": "mapping",
      "expectedMappingFileSha256": "<reviewed complete mapping-file SHA256>"
    }

The preview returns the original planSha256, source identity, native totals and series settings. Every selected series keeps its original key. The complete mapping explicitly identifies excluded series. A previousDssId selects the retained original comparison export and source.

Start with merchant_usgs_dss_start using the same edition/mapping selection, a stable dssId and that exact expectedPlanSha256. This starts the original console job and original native writer. It does not introduce another job engine.

Inspect merchant_usgs_dss_operation and the original jobs inventory. An unchanged completed DSS ID reopens its original result without another native write. An interrupted operation retains its plan and operation identity for inspection. The complete original plan is available through merchant_usgs_dss_file_read with kind=plan, including before native completion.

Native inspection and delivery kinds are dss, report, mapping, rows, native, comparison, plan and handover. The plan and mapping files preserve complete per-series selections and excluded observations, while the default MCP response supplies compact native summaries. A source or file hash change is reported against the exact retained selection.

Use merchant_usgs_dss_runtime to inspect the original host runtime. merchant_usgs_dss_verify starts the original native readback job against the saved DSS and mapped request. Readback is a separate explicit operation and retains its native comparison result.

## 5. Prepare a complete customer delivery

First call merchant_usgs_dss_handover on the completed native export. It starts or reopens the original complete handover job. Inspect the original job and then merchant_usgs_dss_file with kind=handover.

Once that original ZIP is retained, create a stable customer delivery:

    {
      "workspace": "potomac",
      "dssId": "potomac-daily-20261012-7737",
      "exportId": "potomac-dss"
    }

Pass this object to merchant_usgs_delivery_prepare. The customer exportId is a lower-case alias of up to 64 characters. It is distinct from the original native DSS ID, which retains the original Water naming rules.

The compact usgs-delivery.json completion manifest binds the customer ID, configured workspace, original native DSS ID, native export hash, plan hash, source identity, totals and complete handover ZIP's exact name/bytes/SHA256. Retaining this manifest does not copy or rebuild the original handover.

The manifest is published as a complete single-link file under the original Linux state lease. A process interruption leaves either the existing complete manifest or a resumable uncommitted temporary file. Repeating an identical delivery ID returns the same manifest. Reusing it for a different source or handover reports USGS_DELIVERY_CONFLICT.

merchant_usgs_deliveries finds retained deliveries after restart or a lost prepare reply. merchant_usgs_delivery_manifest supplies the manifest file's exact hash. Customer file reads work from the retained original project after host restart without opening its console or running another DSS job.

This transfer is authenticated operator delivery. Original Water edition sales use the existing stage, merchant, buy-prepare, buy and buy-reopen commands with their original payment configuration and buyer intent IDs.

## 6. Download, interrupt and resume

Inspect the exact delivery from the maintained CLI:

    merchant-usgs inspect --url http://127.0.0.1:3211/mcp \
      --export-id potomac-dss

Retain the returned manifestSha256, then download:

    merchant-usgs download --url http://127.0.0.1:3211/mcp \
      --export-id potomac-dss \
      --manifest-sha <reviewed-manifest-SHA256> \
      --out /private/potomac-download

Use an HTTPS endpoint for a remote host or the original loopback HTTP listener. The bearer comes from MCP_ACCESS_TOKEN or --token-env. Credentials stay in the caller's environment.

The downloader is the maintained retained-download.mjs transport. It keeps its original Linux flock lease, original completion manifest and durable byte checkpoint. Each completed chunk is flushed before the checkpoint advances. Ctrl-C, a lost transport response or a host restart can be recovered by repeating the same command and directory.

A resumed download checks the retained prefix, reacquires an expired read at the same exact file/hash/offset, and preserves completed files. Only an owned uncheckpointed suffix can be discarded. A different endpoint, manifest, file hash or unrelated directory content is rejected instead of overwriting the original download.

Chunks are up to 196608 bytes. --chunk-bytes selects a smaller positive chunk size. The first read of an original large descriptor may need to hash the complete file; that call has a 30-minute timeout while subsequent reads use the ordinary request timeout. The caller's cancellation signal remains active throughout.

The server's shared reader streams and verifies the original native file descriptor. It does not buffer a complete multi-GiB handover or create a second whole-file snapshot. Native DSS member files retain their original size limits; complete handovers may be up to 8 GiB. Four live reads share this provider's retained-read limit. EOF, release, expiry and provider shutdown release the original descriptors.

## 7. Receive and reopen the complete project

Receive a completed download into an original private Water project outside the download directory:

    merchant-usgs receive \
      --dir /private/potomac-download \
      --project /private/received-water \
      --export-id potomac-dss \
      --manifest-sha <reviewed-manifest-SHA256>

The receiver checks the completed local checkpoint and manifest, streams the exact selected ZIP, verifies its complete byte hash before EOF, and passes the expected native export, source and plan identities to the original Water receiver. That original receiver validates its staged edition/export manifests before either destination is installed.

A wrong selected identity leaves the existing destination editions and exports unchanged. A matching package installs the original source edition and original native DSS export. Repeating the same package reopens those IDs. The original receiver handles a previously interrupted matching installation without creating another source edition or DSS export.

Add --verify to run the original native HEC-DSS readback on the receiving host. This requires its configured official interpreter and native library. Receiving does not execute code from the downloaded archive.

Open the received original console:

    merchant-usgs serve --project /private/received-water --port 0

The CLI prints its original loopback URL. Ctrl-C closes the original console and its owned resources.

Agents can also receive through merchant_usgs_dss_receive into an open declared workspace. Select either a declared handover file handle or fromWorkspace plus the original dssId, and provide the exact expectedSha256. The same native receiving engine performs the installation.

## 8. File and lifecycle contracts

For ordinary source, review, edition and DSS file tools, the first read returns a readId and exact file metadata. Continue with that readId, expectedSha256, offset and limit. Use nextOffset from the reply. A final null nextOffset releases the descriptor. merchant_usgs_file_release explicitly closes an unfinished workspace read.

Customer delivery file tools additionally bind exportId and expectedManifestSha256. The maintained downloader handles this protocol, file release and host-restart continuation.

merchant_usgs_close advances the workspace's admission generation, aborts in-flight native requests, cancels the original project jobs, drains previously admitted calls and closes its file scope. Old setup continuations cannot attach after that close. A subsequent open can use the same retained project again.

The full merchant provider begins USGS cancellation before waiting for its admitted mutation. Close and capture-cancel remain reachable while a long receive is admitted. Only this host's owned console/jobs/readers are stopped. Independent customer delivery reads retain their separate delivery scopes until EOF, explicit release, idle expiry or provider shutdown.

## Programmatic use

The distribution exports:

- ./merchant/mcp/usgs-workspaces: MerchantUSGSWorkspaces, connection reader and the 35 tool definitions.
- ./merchant/mcp/usgs-delivery: the original delivery schema, parser and handover limit.
- ./merchant/mcp/usgs-download: inspectUSGSCustomer, downloadUSGSCustomer and receiveUSGSCustomer.
- ./seller/usgs-water/dss: original scientific planning, native export and staged receiving.

The customer functions accept the same endpoint, token environment, manifest and directory selections as the CLI. downloadUSGSCustomer also accepts signal, chunkSize and onProgress. receiveUSGSCustomer takes the reviewed expectedManifestSha256 and an explicit optional verify flag. Completion returns the retained original IDs and a command for reopening the original Water console.
