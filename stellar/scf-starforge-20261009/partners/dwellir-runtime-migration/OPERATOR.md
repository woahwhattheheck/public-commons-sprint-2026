# Operating and handing over a Dwellir migration

## Select the actual application contract

Start with the application's existing entry point, environment file and RPC configuration. Put those exact source files in sourceFiles and the exact declared HTTPS methods in requiredMethods. Retain the intended network genesis from the application's reviewed chain configuration or a primary chain registry.

The source review reports the selected files' hashes, visible environment references, RPC method names, WebSocket references and historical-state references. Use these locations to complete the application-specific review. Source inspection is limited to the selected source files; the application's original SDK remains responsible for its own protocol and session behavior.

Choose the same original chain and network on both providers. A relay chain, Asset Hub, Westend and an EVM-compatible parachain each have distinct identities. For this Substrate operator, chain_getBlockHash(0) is the network identity.

## Preparation

The existing configuration supplies the original endpoint. The candidate comes from one of two original Dwellir surfaces:

1. The current public endpoint JSON catalog, matching exact chain, network, public access and HTTPS URL.
2. The installed native CLI's endpoint discovery and its existing named-key project environment.

Preparation leaves the application configuration available at its original values. It retains candidate and baseline requests/responses, source references, before/after configuration snapshots and the review. The fifteen normal provider reads are serial and use the selected timeout and byte limit.

The review includes the original baseline finalized hash. Both providers must return the same complete header and runtime version for that exact hash. The candidate must be healthy, serve the intended genesis and advertise every selected required method. Its finalized head must satisfy the plan's explicit maximum lag. Additional historical probes compare their exact selected block and storage result.

After an interrupted or unsuccessful preparation, reconcile its operation.json and provider attempt directory. Continue the same selected plan and application with:

~~~sh
python3 -B dwellir_migration.py prepare \
  --plan /absolute/path/original-plan.json \
  --project /absolute/path/original-application \
  --operation /absolute/private/path/original-operation \
  --resume
~~~

The command requires the existing incomplete preparation and unchanged original application configuration. It preserves earlier provider attempts and records the next native attempt in the same operation. Completed responses can be reused when their exact request, endpoint and response hashes match and their original observation age is within resumeMaxAgeSeconds (900 seconds by default; set 0 for fresh requests). The new attempt retains the unchanged raw responses, original UTC times and source paths, and records reused and new network reads separately. Completed reviews proceed through inspect, apply or rollback.

## Apply and restart

Read the review and select its SHA-256. Apply verifies the retained review, original snapshots, current application configuration and selected source files. It writes one reviewed file at a time and records the operation state.

The operator deliberately uses the application's existing env or JSON binding. Select the application's original service restart or deployment command after applying the configuration. The receiving example starts both original reader processes freshly. A production service restart stays with that application's existing service manager, release tool or container runtime.

Inspect reopens the retained operation in a fresh process:

| Observed state | Meaning |
| --- | --- |
| ORIGINAL | Every selected file matches its original version |
| ACTIVE | Every selected file matches its reviewed Dwellir version |
| PARTIAL | Each selected file is an original or reviewed version; a transition can continue |
| CONFLICT | At least one selected file has a later, different edit |

The journal also records REVIEW_READY, APPLYING, ACTIVE, ROLLING_BACK or ROLLED_BACK. Actual file hashes decide the receiving state after a process interruption. Repeating apply with the same review completes the selected direction. Repeating rollback restores the original direction.

## Preserve later application edits

A reviewed operation owns only its selected configuration files. A changed file remains intact. Read its current bytes with the application owner, select the appropriate new baseline, and prepare the next actual review. Source changes after review also require a new selection before apply.

All application paths must remain within the selected project and contain regular files. Configuration is replaced under the same operator ownership. Native credential-bearing configuration must be untracked and ignored by the application's Git repository; the original native CLI supplies its own private environment and ignore rule.

## Restore the original provider

Run rollback against the same retained operation. It compares the actual files with both selected versions, writes the retained original bytes and mode, and reads them back. Then use the application's original restart command and existing read path.

The receiving command proves this full sequence with two configuration files and both language clients. Its final result compares the restored bytes with the original pre-migration hashes.

## Handoff and receiving

Export to a new private handoff directory. The handoff contains the selected plan, review, source files, complete native receiving command and successful provider requests/responses. handoff.json records every included file's identity.

If an export is interrupted, repeat the same output selection. The retained handoff intent binds it to the same review; a completed handoff is verified and reopened. The original application configuration snapshots and native credential file stay in the private migration operation.

For a second host, transfer the complete delivered source package, choose that host's Python/Node executables and run delivery/native_receiving.py with a new private receiving directory. The receiving fixture creates its own application configuration and uses the published keyless Dwellir endpoint. A customer installation instead selects the customer's existing CLI account, named key and actual application plan.

## Commercial acceptance map

| Acceptance output | Retained product output |
| --- | --- |
| Exact chain and endpoint selection | review.json discovery + intended genesis + original source map |
| Actual application compatibility | Selected source hashes, required-method inventory and anchored provider comparison |
| Reviewed migration | Exact before/after configuration hashes and selected reviewSha256 |
| Working customer caller | Original application's result plus supplied Node/Python caller results |
| Retained rollback | Byte-exact original configuration and reopened operator state |
| Operator ownership | Private original configuration/credential files and complete exported handoff |
| Receiving reproducibility | Complete receiving command, source hashes and stage journal |

The commercial work selects one customer's actual application and deployment environment, then completes this same operating sequence with that application owner.
