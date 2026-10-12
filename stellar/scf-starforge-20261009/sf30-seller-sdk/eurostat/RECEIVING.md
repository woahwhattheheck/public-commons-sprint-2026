# Complete native Eurostat receiving

The receiving command runs one original operation from complete source through the maintained dataset publisher, configured native merchant, SF88 acquisition, original accounting finalizer, SF100 data room and saved delivery reopening.

Operation: **SCF-EUROSTAT-ECONOMIC-WORKSPACE-20261012**. Source coordination: https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791794802593569

## Launch contract

Use the existing equipped operator’s Linux/Node 24 runtime, original buyer profile, private signer environment, trusted CA/HTTPS ingress or explicit CONNECT transport, original facilitator and SF36 accounting workspace. The configured HTTPS merchant origin must already route to the selected local merchant port.

Save one private receiving configuration using the schema below and the existing operator’s actual paths/resources. Launch:

~~~sh
stellar-forge eurostat receive \
  --workspace /absolute/private/eurostat-project \
  --input /absolute/private/eurostat-receiving.json
~~~

The repository entrypoint is eurostat/cli.mjs with the same arguments. The command prints its retained checkpoint and current phase. Repeating the same command reads that same checkpoint, source, run UUID, release and native buyer session.

### Configuration fields

| Field | Meaning |
| --- | --- |
| schema | stellar-forge.eurostat-receiving-config.v1 |
| id | Stable original receiving operation ID, at most 70 characters |
| title | Merchant dataset title |
| source.file | Absolute path to the complete original response |
| source.sourceUrl / retrievedAt / transport | Actual acquisition metadata from examples/original-acquisition.json |
| query.name | Saved source-query name |
| query.selection | Original dimension codes; an empty object includes the complete captured cube |
| query.includeMissing | Preserve original missing cells and states |
| query.review | Full source-specific reuse review from examples/reviewed-query.json |
| publication.reviewer / note | Original publisher review author and explanation |
| pageSize | Actual advertised customer page size, 1–1000 |
| targetDirectory | Optional original dataset target; otherwise project/dataset |
| release.outputDirectory | New private original SF82 package directory |
| release.releaseDirectory / id / label | Existing selected release store and stable edition identity |
| release.origin / path / payment | Actual configured merchant origin, resource path and payment object |
| release.runtime | Original SF82 port/facilitator/allowLocalFacilitator settings |
| release.activationOptions / runOptions | Existing original generation/runtime controls |
| buyer.configFile | Private existing SF88 Buyer constructor configuration |
| buyer.id | Stable original native dataset acquisition ID |
| buyer.operatorWorkspace | Original SF36/SF88 accounting workspace |
| buyer.maxPages / maxTotalAtomic | Explicit native acquisition page and cumulative caps |
| buyer.maxPageBytes | Original page response limit, normally 1 MiB |
| buyer.acceptIndex | Actual selected advertised payment alternative |

The actual 576-row example can use **pageSize 300 and maxPages 2**. Set its cumulative cap using the existing operator’s reviewed actual offer. Keep the same original financial workspace, payer, asset, merchant and signer references. The source fixture does not contain account credentials.

Use the full source acquisition metadata and review already present in the provided example files. They bind the included original response and its four selected EU geographies. The native receiver calculates and retains its actual source hash before the first project mutation.

## Complete operation

1. **Retain source.** Import the complete original response with actual URL/retrieval metadata.
2. **Review selection.** Save the normalized source query and its reuse review against the current source declaration.
3. **Create the economic briefing.** Write complete HTML, structured JSON, exact CSV and original response beneath the receiving checkpoint.
4. **Extract the native dataset.** Save the complete plan in the original publisher and use one retained run UUID. A repeated operation adopts its original plan/run.
5. **Publish.** Review the actual original target and publish through its native dataset version store. A lost publication response is reconciled from that same store.
6. **Prepare and activate the merchant.** Retain the published candidate, source, review, publication and binding through the original SF82 package. Stage and activate the selected original release.
7. **Run the configured merchant and buyer.** Start the original supervised native release, read its actual advertised offer and prepare an original SF88 configuration. The original dataset session follows its returned cursors, keeps its snapshot binding and enforces the configured caps.
8. **Finalize original accounting.** Use Dataset.finalizeAll with the original workspaceDirectory. Retain all native ranges and require every original reservation to reach its final outcome.
9. **Deliver and compare.** Create the original SF100 data room. Read its fully verified rows and compare each field and row count with the selected original JSON-stat cells. Place the exact original response, capture metadata and full reviewed source handover beside the customer output.
10. **Reopen.** Reopen the saved native delivery and verify its retained rows/snapshot. Close the original supervised merchant cleanly.

All native page execution happens inside the maintained SF88 Dataset. The receiver never reconstructs paid responses or writes a parallel accounting ledger.

## Checkpoint and continuation

The private checkpoint lives at **PROJECT/receivers/ID/receiver.json**. It contains the exact configuration digest, original run UUID, completed phase results, actual native output, current phase and any specific error. The source body and buyer settings are bound by hash. A changed operation configuration requires a new explicit operation identity.

The receiver writes its current phase before each action. Completed steps retain their exact output. The original dataset session decides whether pages need acquisition or recovery; recorded page attempts are handled by that same native session. Original accounting commands retain their own complete outputs, and their finalization is idempotent within the original ledger.

If a host process ends during an actual native operation, continue this same configured receiver. Its original source/plan/run/session and delivery directories remain the authority. Read the named native operation’s actual output before changing an intent or selecting a new runtime.

A completed receiver reports **COMPLETE** after original accounting, full native delivery comparison and reopening. Full native page outputs, source materials, original customer review HTML and exact CSV/JSONL stay in the private receiving directory.

## Original source assets for the equipped receiver

The ready [reviewed-source-handover.json](examples/reviewed-source-handover.json) imports the actual source and review immediately. Its captured response is 10,408 bytes, SHA256 **689d5a0a94c358459f5321fd6a2f8c1da8c089f46ae032b27590c6d895ea56cf**.

The complete [economic briefing](examples/briefing-20261012/briefing.html) and all three companion files are already generated from the same production model. They provide the full analyst product while the original equipped operator runs its configured native receiving.

After native completion, reopen **Eurostat economic workspace** in the existing Applications surface using the same project path. Its source console shows the original retained edition, source review and full cell selection; the publisher panels show the original plan, candidate, publication, merchant/buyer handoff and history.
