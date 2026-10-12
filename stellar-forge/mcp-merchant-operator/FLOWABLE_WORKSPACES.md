# Flowable workspaces through the merchant agent

The flowable-workspaces provider operates the existing private process workspace over its HTTP connection. The browser, installed client and agent share the same native request journal, deployment sources, versioned process definitions, human task operations, migration reviews and complete NDJSON handovers.

Select flowable-workspaces and merchant-provider-flowable-workspaces with the installed Flowable product. The maintained merchant server owns its authenticated MCP listener. The existing Flowable workspace owns the engine connection and its credentials.

## Declare the running workspace

Open the installed workspace and retain its returned workspaceId and private URL file. The connection declaration names those actual values:

~~~json
{
  "schema": "stellar-forge.flowable-workspace-connection.v1",
  "workspaces": {
    "customer": {
      "label": "Customer process operations",
      "workspaceId": "THE-RETURNED-WORKSPACE-UUID",
      "consoleUrlFile": "/srv/private/flowable-product/browser-url.txt",
      "files": {}
    }
  }
}
~~~

Replace the explanatory UUID with the actual returned identity. Use consoleUrlEnv instead of consoleUrlFile when the host maintains the private URL in an environment variable. Relative file paths resolve against this declaration. Multiple original workspaces can have separate aliases.

Initialize the merchant connection and start its maintained listener:

~~~sh
starforge flowable-agent-init --dir /srv/private/flowable-agent --connection /srv/private/flowable-connections.json
starforge merchant-mcp serve --config /srv/private/flowable-agent/merchant-mcp.json --port 0 --token-env MCP_ACCESS_TOKEN
~~~

Set MCP_ACCESS_TOKEN on the host before starting the listener. Its startup response contains the actual bound MCP URL. Repeating the initializer with the same original inputs resumes its private profile. An existing merchant host can instead add flowableWorkspaceConnection to its complete configuration.

The source exports initializeFlowableWorkspaceMerchant, readFlowableWorkspaceConfiguration and MerchantFlowableWorkspaces. The provider initializer accepts directory, connection and optional name.

## Operate native processes

| Tool | Operation |
| --- | --- |
| merchant_flowable_workspaces | Read declared workspace and receiving file aliases |
| merchant_flowable_status | Read engine connections, credential availability and saved counts |
| merchant_flowable_records | Page saved record heads with a stable list snapshot |
| merchant_flowable_record | Read an exact saved record revision |
| merchant_flowable_portfolio | Page one complete captured native collection |
| merchant_flowable_definition | Read a captured process definition and original resources |
| merchant_flowable_source | Read an immutable original source or exchange |
| merchant_flowable_review | Read the exact native request, preimage, validation and response |
| merchant_flowable_save_engine | Save a native REST connection using credential environment names |
| merchant_flowable_capture | Capture deployments, definitions, active work and history |
| merchant_flowable_prepare_release | Save one original BPMN or ZIP/BAR deployment |
| merchant_flowable_dispatch_release | Submit the reviewed native deployment |
| merchant_flowable_prepare_process | Save the definition, business key and raw native variables |
| merchant_flowable_dispatch_process | Start the reviewed native process |
| merchant_flowable_prepare_task | Save claim, unclaim, complete, delegate or resolve input |
| merchant_flowable_dispatch_task | Execute the reviewed native human task operation |
| merchant_flowable_prepare_migration | Read the process and run native migration validation |
| merchant_flowable_dispatch_migration | Apply the reviewed migration document |
| merchant_flowable_reconcile | Refresh a saved operation from native current state and history |
| merchant_flowable_export | Export complete workspace source, revisions and journals |
| merchant_flowable_inspect_delivery | Upload and inspect a declared complete handover |
| merchant_flowable_adopt_delivery | Receive the exact inspected history |
| merchant_flowable_download | Retain the whole handover or original source file |
| merchant_flowable_export_manifest | Read a retained file's complete manifest |
| merchant_flowable_export_file | Read original bytes through EOF |
| merchant_flowable_export_file_release | Release the original retained reader |
| merchant_flowable_cancel_request | Stop the current agent wait while retaining its saved operation |

Every workspace operation takes its declared workspace alias. The shared action schema supplies the remaining fields. A write requires a stable requestId. A dispatch additionally requires the prepared record id, expectedRevision and planSha256. Read the returned review before dispatching that saved operation.

Preparation preserves native bodyText verbatim. Keep Flowable variable type and value together; a long integer should remain in the original text. A process start selects exactly one processDefinitionId, processDefinitionKey or message. Flowable does not accept tenantId with processDefinitionId.

Task bodyText includes its original action. Unclaim uses action claim with assignee null. Delegate and resolve follow the native task owner and delegation state. Migration selects a concrete target definition and uses activityMappings with original source and target activity IDs. The workspace saves Flowable's actual validation response before dispatch.

After an interrupted reply, read the same saved operation and use reconciliation. Repeating an original requestId with identical input retrieves its saved result. An intentional new engine operation requires its own input and requestId.

## Read original source and history

A capture contains eight complete native collections: deployments, definitions, processes, tasks, historicProcesses, historicTasks, historicActivities and historicVariables. Each collection retains its native page identities and original response bytes. readPortfolio pages the selected captured collection without changing that capture.

readDefinition returns original resource references for the selected definition. BPMN XML, native diagrams and response bodies stay in their original form. readReview identifies the exact request plan, preimage, validation and response sources of a release, process, task or migration.

Small replies return directly. Replies larger than 64 KiB are retained whole as COMPLETE_RESULT_RETAINED with an exportId, manifestSha256 and the complete file's SHA and byte count. Source downloads use source.bin and their actual media type, including XML and PNG.

Read merchant_flowable_export_manifest and then merchant_flowable_export_file with the exact manifest and file hashes. Retain the returned readId and next offset through EOF. Each range is at most 65,536 bytes. Select file manifest to receive its literal bytes or original for the complete payload. Release the reader after the full file arrives.

Closing the agent connection drains its current HTTP requests and retained readers. The original workspace keeps its own lifecycle.

## Receive a complete handover

First call merchant_flowable_export. Download its saved delivery with merchant_flowable_download, kind delivery and the returned delivery record id. Read all retained ranges through EOF.

On the receiving host, declare the complete file under the destination workspace:

~~~json
{
  "label": "Customer process operations",
  "workspaceId": "THE-RECEIVING-WORKSPACE-UUID",
  "consoleUrlFile": "/srv/private/receiver/browser-url.txt",
  "files": {
    "handover": {
      "label": "Process operations handover",
      "path": "/srv/private/received/flowable-handover.ndjson",
      "sha256": "THE-COMPLETE-FILE-SHA256"
    }
  }
}
~~~

Replace the UUID and SHA with actual values. Inspect with the destination workspace alias, file handover and a stable requestId. Read the returned receiving record and adopt with its id, expectedRevision and manifestSha256. The receiver checks all source blobs, saved revisions, history chains and native journals before adoption. Closing and reopening the receiving workspace preserves the adopted original records.
