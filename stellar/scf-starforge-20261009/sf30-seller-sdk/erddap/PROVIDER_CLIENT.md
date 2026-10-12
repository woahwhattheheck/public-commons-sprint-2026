# Provider intake clients and complete receiving

The ERDDAP provider workflow starts from an exact retained source capture. It saves the complete provider profile and its readiness findings as immutable revisions, exports the original source and reviewed definitions together, and independently receives that same bundle in another workspace. The HTTP browser, CLI, SDK and MCP methods all use the maintained provider core and HandoffStore.

A provider handoff is distinct from a native merchant dataset. Preparing or receiving it does not change seller prices, activate a merchant publication or start an SF88 purchase. The original merchant and buyer commands continue to operate their saved dataset identities.

## Run the original CLI

The installed entrypoints are equivalent:

~~~sh
starforge-merchant erddap provider-handoff --help
starforge-merchant erddap-provider-handoff --help
~~~

A source checkout can use either original Python route:

~~~sh
python3 -B "$ERDDAP/cli.py" provider-handoff --help
python3 -B "$ERDDAP/provider_handoff_cli.py" --help
~~~

The existing global-workspace form also works:

~~~sh
python3 -B "$ERDDAP/cli.py" --workspace "$WORKSPACE" provider-handoff state
~~~

The selected workspace must be the original private ERDDAP workspace. Commands that open it use the same workspace lease as the original engine; close its browser server before running a separate CLI invocation on that workspace. To operate its already-running server, use the SDK or merchant MCP client below.

### Review an original source

A source-only profile can be prepared before importing the capture:

~~~sh
starforge-merchant erddap-provider-handoff source-draft "$CAPTURE" --output provider-profile.json
starforge-merchant erddap-provider-handoff source-review "$CAPTURE" provider-profile.json --output provider-review.json
~~~

Open provider-profile.json and review its complete fields: title and organization; technical/scientific contacts; original license and attribution; source access and refresh context; source time column, declared timezone and calendar; station identifiers and deployment context; each variable's original name, output alias, role and quality relationships; and the named reviewer. Source-derived values are starting points. A source's original units, missing values, masks and attribution stay in its retained capture.

The review reports concrete unresolved requirements. Save and exchange a review bundle while those findings are being resolved. A ready bundle requires the core's actual readiness checks to pass:

~~~sh
starforge-merchant erddap-provider-handoff source-review "$CAPTURE" provider-profile.json --require-ready
starforge-merchant erddap-provider-handoff source-export "$CAPTURE" provider-profile.json --mode ready --output provider-ready.zip
~~~

The source-export parent option selects an explicit original parent revision when that is part of the retained workflow; use the workspace commands for the maintained saved revision chain.

### Save and reopen a workspace review

Import the complete capture with the original ERDDAP source-add command if it is not already in the workspace. Use the returned full source SHA256:

~~~sh
starforge-merchant erddap --workspace "$WORKSPACE" source-add --file "$CAPTURE" --label "Original provider capture"
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" draft "$SOURCE_SHA256" --output provider-profile.json
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" preview "$SOURCE_SHA256" provider-profile.json
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" save "$SOURCE_SHA256" provider-profile.json
~~~

Omitting --expected-head represents the first revision with no parent. For a following revision, pass the full current head returned by draft, state or history:

~~~sh
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" save "$SOURCE_SHA256" provider-profile.json --expected-head "$PREVIOUS_REVIEW"
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" show "$REVIEW_SHA256"
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" history "$SOURCE_SHA256" --offset 0 --limit 100
starforge-merchant erddap-provider-handoff --workspace "$WORKSPACE" export "$REVIEW_SHA256" --mode review --output provider-review.zip
~~~

A review revision is bound to the complete normalized profile and its selected parent. Repeat the exact profile and expected head after a lost response. An existing exact revision is reopened; a different current head returns a conflict with its current revision so the operator can reconcile the actual intervening edits.

Output commands preserve an existing identical file. Selecting --replace explicitly permits replacing a different output file; it does not rewrite the original source or a saved review.

### Receive the complete handoff

A source-only verification needs no workspace:

~~~sh
starforge-merchant erddap-provider-handoff receive provider-review.zip
~~~

Retained receiving uses a separate original ERDDAP workspace:

~~~sh
starforge-merchant erddap-provider-handoff --workspace "$CUSTOMER_WORKSPACE" init
starforge-merchant erddap-provider-handoff --workspace "$CUSTOMER_WORKSPACE" receive provider-review.zip
starforge-merchant erddap-provider-handoff --workspace "$CUSTOMER_WORKSPACE" received "$BUNDLE_SHA256"
starforge-merchant erddap-provider-handoff --workspace "$CUSTOMER_WORKSPACE" received-export "$BUNDLE_SHA256" --output received-provider-review.zip
~~~

The receiver verifies the bundle's source, profile, revision and complete file identities through the original core. It retains the bundle under its SHA256 and returns its receipt, profile, readiness review and source summary. Receiving does not insert a fabricated local source row or advance a local review head. The received-export command returns the original bundle bytes.

## Use the running operator through the SDK

Start the existing ERDDAP server once, retaining its private startup JSON with the original serve --connection-file option. Configure its workspace and startup path through the existing erddap-workspace-connection.v1 file described in README.md.

~~~js
import { ErddapClient, readErddapConfiguration } from '@tokenjunkielabs/starforge-merchant/client/erddap';
import { ErddapProviderHandoffClient } from '@tokenjunkielabs/starforge-merchant/provider/erddap';

const configuration = await readErddapConfiguration('/private/ocean/workspaces.json');
const client = new ErddapClient(configuration.workspaces.ocean);
const providers = new ErddapProviderHandoffClient(client);

try {
  const draft = await providers.draft(sourceSha256);
  const reviewed = await providers.preview(sourceSha256, completeReviewedProfile);
  const saved = await providers.save(sourceSha256, reviewed.profile, draft.head);
  const exported = await providers.export(saved.id, 'review');
  const received = await providers.received(existingReceivedBundleSha256);
  // Use exported.sha256 and its complete byte count for the file receiving step.
} finally {
  await client.close();
}
~~~

The startup record and its private capability remain local to the host. Before each request the original client checks the actual listener's workspace and instance through /api/launch. Closing this borrowed client drains its accepted requests; the original operator lifecycle remains with its existing owner.

The typed client provides state(), draft(source), preview(source, profile), save(source, profile, expectedHead), review(revision), history(source, {offset, limit}), export(revision, mode), receive(input), received(bundleSha256), file(revision, mode, directory, expectedSha256) and receivedFile(bundleSha256, directory).

An input passed to receive has the same host-selected path, label and complete SHA256 as the connection's declared kind:'handoff' input. The client reads and verifies that exact file before posting it. A receivedFile result binds its expected SHA256 directly to the original bundle identity.

File methods return the original read-only file handle, byte count, SHA256, filename and content type for complete streaming by the consumer. Close the returned handle after use. The temporary export is retained in the host's private exports directory; an existing filename is independently hash-read before its identity is reused.

## Merchant MCP workflow

The existing erddap-workspaces provider now advertises 36 tools. Ten complete provider methods extend the original source, mapping, dataset, comparison and file workflow:

| Method suffix after merchant_erddap_ | Purpose |
| --- | --- |
| provider_status | Native provider head/receiving counts and original limits |
| provider_records | Complete heads or received collection with SHA-bound pagination |
| provider_draft | Full source-derived profile, current head and initial history |
| provider_preview | Complete profile and readiness review against original source |
| provider_save | Immutable profile save against explicit expectedHead |
| provider_review | Reopen the exact saved review |
| provider_history | Page the original revision/parent chain |
| provider_export | Retain an exact review or ready bundle |
| provider_receive | Verify and retain a host-pinned complete provider handoff |
| provider_received | Reopen the complete original receiving result |

All calls select an existing host workspace alias. The first provider_save requires expectedHead:null; following saves require the exact head SHA256. The declared schema requires the field even for the first save. A returned HTTP409 preserves currentRevision. After an uncertain save, recover with the same source, complete profile and expected head, or inspect its original history.

The profile request capacity matches the native core: 2 MiB plus the small source/head JSON wrapper. Complete provider views allow up to 4 MiB; use original history/collection pagination and the complete bundle reader for larger retained material. The host also selects the complete response/file capacity in its original connection, up to 512 MiB per MCP file. Larger native bundles can be received by the original CLI within the core's declared limits.

For customer receiving, add an existing complete file to the host's private connection:

~~~json
{
  "path": "/private/customer/provider-review.zip",
  "kind": "handoff",
  "label": "Reviewed original provider intake",
  "sha256": "REPLACE_WITH_THE_ACTUAL_COMPLETE_FILE_SHA256"
}
~~~

Place that entry under an input alias in the existing workspace's inputs object, and replace the placeholder with the actual 64-character digest. Call input_inspect first if needed, then provider_receive with that alias and the same expectedSha256. A lost response identifies the receiving bundle SHA256 and recovery path; provider_received reopens that exact receipt.

Use the existing file_read method to receive complete output bytes:

~~~json
{
  "workspace": "ocean",
  "kind": "provider-handoff",
  "revision": "FULL_ORIGINAL_REVIEW_SHA256",
  "mode": "review",
  "expectedSha256": "FULL_EXPORTED_BUNDLE_SHA256",
  "offset": 0
}
~~~

For an independently received original bundle, select kind:'provider-received' and receiptId equal to its full bundle SHA256. Continue each read using its returned readId, SHA256 and next offset until the complete byte count is received. Release the same reader with file_release afterwards. Reader release and disconnect keep the original saved source, review, bundle and operator available.

## Run the complete source and provider receiving operation

[PROVIDER_HANDOFF.md](PROVIDER_HANDOFF.md) documents the full provider profile, station/variable outputs, quality conventions and readiness findings. The maintained delivery/provider-native-receive.py entrypoint composes that core with the original ERDDAP native source-to-customer operation. It saves the complete review history, reopens an identical save, checks the actual stale-parent conflict, and independently receives and re-downloads the exact original bundles.

~~~sh
python3 -B "$ERDDAP/delivery/provider-native-receive.py" \
  --source-root "$ERDDAP" --operation-root "$PROVIDER_OPERATION" \
  --capture "$ACTUAL_CAPTURE" --profile "$REVIEWED_DIRECT_PROFILE"
~~~

Both inputs are complete retained files. The profile is the direct stellar-forge.erddap-provider-handoff.v1 object returned by the original draft/review workflow; retain its schema and actual sourceId. For the separately retained NDBC station 46042 one-day 2023 reference, use --ndbc-2023-reference in place of --profile. That recipe binds the five original response hashes and all 144 selected rows, preserves the public technical contact and leaves scientific appointment explicit for provider review.

The operation emits handoff-profile.json for the existing browser owner. Continue that same closed workspace with --handoff-profile "$PROVIDER_OPERATION/handoff-profile.json"; the browser retains the actual review disposition and receives both complete original bundles. A ready export is attempted only when the original core reports readiness. All original source, review, received bundle and checkpoint identities remain under the selected operation directory.

## Installed source and delivery

The maintained distribution contribution includes both installed commands, the original server/browser/CLI and all provider core/store/client source. Its provider SDK export is ./provider/erddap. The original ./client/erddap, ./merchant/erddap, ./seller/erddap and ./buyer/erddap exports remain available.

Keep the complete handoff ZIP with its export receipt and exact source identity when transferring it. Retain the actual source license and attribution terms carried by that bundle. The customer can inspect it with the original pure receive command and then retain it in their own workspace using the same source-native receiving workflow.
