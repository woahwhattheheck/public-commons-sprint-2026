# Tyk workspaces through the merchant agent

The source-selected tyk-workspaces provider operates the original private Tyk browser workspace over its existing HTTP connection. It uses the same native request journal, saved portfolio, rollout reviews and complete NDJSON deliveries.

Select the tyk-workspaces and merchant-provider-tyk-workspaces contributions with the Tyk installed product. The native transport and browser use Node built-ins. The merchant listener uses the distribution's maintained MCP feature and existing merchant server.

## Original connection declaration

After opening the workspace, retain its actual UUID and original private URL file. Create a private connection document:

~~~json
{
  "schema": "stellar-forge.tyk-workspace-connection.v1",
  "workspaces": {
    "customer": {
      "label": "Customer Tyk migration",
      "workspaceId": "THE-ORIGINAL-WORKSPACE-UUID",
      "consoleUrlFile": "/srv/private/tyk-product/browser-url.txt",
      "files": {}
    }
  }
}
~~~

Use consoleUrlEnv instead of consoleUrlFile when the original host maintains the private URL in a named environment variable. A workspace UUID is required and must be the one returned by that browser. Relative file paths resolve against this declaration's directory. Multiple original workspaces can be declared under distinct aliases.

## Initialize and start the agent

With the complete installed Tyk product and maintained MCP feature selected, initialize one private merchant profile from that original connection file:

~~~sh
starforge tyk-agent-init --dir /srv/private/tyk-agent --connection /srv/private/tyk-merchant-connections.json
starforge merchant-mcp serve --config /srv/private/tyk-agent/merchant-mcp.json --port 0 --token-env MCP_ACCESS_TOKEN
~~~

Set MCP_ACCESS_TOKEN in the host environment before starting the maintained listener. Its startup output contains the actual MCP URL and selected tool names. The browser's original workspace URL and native Tyk target credentials remain with their existing host owners.

The initializer uses the maintained merchant configuration, original release store and private export directory. Repeating the same setup opens its matching configuration and completes an interrupted initial release setup. It preserves an existing different profile. The existing merchant-mcp server can reopen the saved configuration directly.

For a previously configured merchant host, add the provider field to its complete configuration:

~~~json
{
  "tykWorkspaceConnection": "/srv/private/tyk-merchant-connections.json"
}
~~~

Its existing name, release store, exports directory and authentication remain part of that configuration. The source exports initializeTykWorkspaceMerchant, readTykWorkspaceConfiguration and MerchantTykWorkspaces for direct composition. The source-owned provider's initialize hook accepts directory, connection and optional name.

For receiving, a declared file has its complete original SHA:

~~~json
{
  "label": "Customer Tyk migration",
  "workspaceId": "THE-ORIGINAL-WORKSPACE-UUID",
  "consoleUrlFile": "/srv/private/tyk-product/browser-url.txt",
  "files": {
    "handover": {
      "label": "Original customer handover",
      "path": "/srv/private/received/tyk-handover.ndjson",
      "sha256": "THE-COMPLETE-FILE-SHA256"
    }
  }
}
~~~

Replace the explanatory UUID and SHA values with the actual saved values. The original file stays private and is verified before upload. The Tyk credential itself is resolved only by the original browser owner.

## Complete operator flow

| Tool | Customer operation |
| --- | --- |
| merchant_tyk_workspaces | Read original declared workspaces and receiving files |
| merchant_tyk_status | Read targets, credential availability and saved record counts |
| merchant_tyk_records | Page current records with their exact list snapshot |
| merchant_tyk_record | Read a selected record revision and its full native review |
| merchant_tyk_capture | Capture the complete native API portfolio |
| merchant_tyk_import_capture | Import a complete native JSON capture |
| merchant_tyk_definition | Read a captured original API definition |
| merchant_tyk_adapt_definition | Review its exact target-native Classic envelope |
| merchant_tyk_review | Page every saved native field change and download its complete original sources |
| merchant_tyk_source | Read a complete retained source JSON blob |
| merchant_tyk_save_target | Save a native target revision |
| merchant_tyk_save_cohort | Save exact API IDs from a captured portfolio revision |
| merchant_tyk_prepare | Save a full native request and fresh target preimages |
| merchant_tyk_dispatch | Execute that original reviewed request |
| merchant_tyk_reconcile | Read the original request's current native outcome |
| merchant_tyk_export | Produce a complete workspace NDJSON handover |
| merchant_tyk_inspect_delivery | Inspect a complete declared original handover |
| merchant_tyk_adopt_delivery | Receive the exact inspected history |
| merchant_tyk_cancel_request | Stop the original in-flight agent wait |
| merchant_tyk_download | Retain a complete delivery or source file |
| merchant_tyk_export_manifest | Read the exact retained export manifest |
| merchant_tyk_export_file | Read all original file bytes through EOF |
| merchant_tyk_export_file_release | Close an original retained reader |

Pass the selected workspace alias to native workspace actions. Each write includes its stable requestId. The shared action contract supplies the exact remaining input fields. A saved rollout is dispatched using its record ID, current revision and planSha256. A migration additionally binds its explicit cohort and source hashes.

Gateway reload is a separately prepared native request. Preserve the earlier write record and use reconciliation after reload. When a current full definition matches a request whose original response was interrupted, the reconciliation identifies the observed configuration and original acknowledgement separately.

## Native definition review

merchant_tyk_review accepts the rollout id, optional saved revision, offset and limit. It returns the original rollout reference, immutable report SHA, source references, summary and one page of field changes. Read pages using nextOffset; the selected revision keeps the report stable. Download the full report or an original before/after document with merchant_tyk_download kind: "source" and its returned reference.

The prepared review compares captured target definitions with the complete native request. The completed review uses actual current readback; a migration dry run uses Tyk's returned converted definitions. Staged copies identify their canonical Classic source. Sources marked PENDING have no complete document for that role yet; ABSENT records an actual absent target capture.

JSON field comparison preserves original decimal and integer lexemes, array positions and escaped member names. Different whitespace, object member order and equivalent decimal notation compare equally. Non-JSON documents retain a complete text comparison. Every changed field includes original value previews, hashes and full source links; all changes remain in the original report.

## Large source and complete files

Small replies are returned directly. A reply larger than 64 KiB is retained in full and returns COMPLETE_RESULT_RETAINED with exportId, manifestSha256 and the original file's SHA and byte count. This is a complete original result file.

Use merchant_tyk_export_manifest to inspect it. Read merchant_tyk_export_file with the exact manifest and file hashes, retaining the returned readId and next offset until EOF. Each range is at most 65,536 bytes. To download the manifest's literal original bytes, select file: "manifest" and its manifest SHA. The default file: "original" selects the full result, source JSON or handover.

The complete NDJSON workspace export is first produced with merchant_tyk_export and its stable requestId. Download that saved delivery ID with merchant_tyk_download kind: "delivery". Download a saved source reference with kind: "source". Neither path substitutes a preview for the original file.

The existing RetainedFileReads implementation owns each read-only descriptor and verifies its original identity around range reads. Release the reader after receiving the complete file. Closing the merchant connection drains its active HTTP requests and export readers; the original Tyk browser keeps its own lifecycle.

## Receiving on another original workspace

Declare the exact original handover file and SHA under the destination workspace. Inspect it with merchant_tyk_inspect_delivery and a stable requestId. Review the full returned receiving record. Adopt using its id, expectedRevision and manifestSha256 with a new intentional request UUID.

The receiver validates every source blob, record revision, history chain, native journal and full stream hash. An interrupted local adoption resumes through the same saved record when that workspace reopens. The resulting customer workspace supports the same browser, CLI, SDK and agent operations.
