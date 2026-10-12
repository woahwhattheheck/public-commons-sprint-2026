# Deploy a Blockscout merchant and activate paid service

The same prepared package and private merchant directory support two explicit deployment modes. Start with `challenge-only` when the receiving operator needs to inspect the original offers, public routes and private account desk before provider credentials and the facilitator are ready. After that run has stopped, review and save `paid` on the same Applications record, then review its next launch.

Omitting the mode continues to select paid service. Existing prepared package bytes, connection reviews, plan hashes, provider-account identities and source bundles keep their original meaning. Deployment mode belongs to the process settings; it does not change the plan or reset provider usage.

## What each mode opens

| Setting or behavior | `challenge-only` | `paid` |
| --- | --- | --- |
| Seller health, offers, developer portal and unpaid resource response | Original SF30 service; health identifies `CHALLENGE_ONLY` and valid resource requests return the original 402 challenge | Original SF30 service with the configured native x402 runtime |
| Provider credential at startup | Missing credential references remain deferred; a malformed supplied value is rejected | A credential required by the selected provider connection must be present and valid |
| Facilitator | Optional retained reference | Required for the installed CLI; HTTPS, or explicitly allowed local HTTP |
| Native payment runtime | Constructed only in paid mode | Original facilitator client, native seller adapter and delivery journal |
| Account, quota history, response records, outbox and operator controls | Open the original private merchant state | Reopen that same state |
| Explicit private operator probe | Uses the maintained provider attempt and accounting flow when credentials permit it | Uses that same flow |

A challenge-only resource request cannot activate the payment runtime through request headers. Mode is selected by the operator at startup. Its public handler returns the challenge before supplier admission, provider dispatch or payment verification. An explicit **Probe** action on the private provider desk remains a provider request, with its existing accounting and cost.

The operator status response includes `deployment.mode`, the actual `merchantMode`, the original seller lifecycle, and `providerCredential.state` (`MISSING`, `CONFIGURED` or `NOT_REQUIRED`). The provider desk displays the live deployment mode. Credential values remain in the process or selected private environment file.

## First deployment through the installed CLI

Use the already prepared package and its existing private merchant directory. For a new merchant, the operator must first create the intended private directory with its normal owner and permissions. Do not replace a previously used account directory with an empty directory.

```sh
starforge blockscout serve \
  --package /private/blockscout/package \
  --state /private/blockscout/merchant \
  --mode challenge-only \
  --port 0 --operations-port 0 --desk-port 0
```

The single startup JSON records the reviewed package and plan hashes, the original merchant state directory, `deploymentMode`, the actual `merchantMode`, and the original local endpoints. Its provider-desk URL carries the private control capability in the fragment. Keep it with the operator, and expose only the intended merchant routes through the existing HTTPS deployment.

Open the original `/_seller/health`, `/_seller/offers` and provider desk. Inspect the provider account, retained source connection, atomic prices, payment network and recipient. A valid unpaid request to a configured token resource returns the actual challenge described by that offer. This request consumes no supplier attempt.

Use SIGINT or SIGTERM to stop the original process. Startup signals are observed during each resource acquisition: an interrupted partial startup closes acquired services and does not publish a running startup record. During shutdown, the merchant stops accepting work and drains its original dispatches. The private desk and operations listener drain before the provider application closes. A forced socket deadline retains the original error and keeps the account/resources alive until original dispatches finish.

When provider credentials and the original facilitator are configured on that same host:

```sh
starforge blockscout serve \
  --package /private/blockscout/package \
  --state /private/blockscout/merchant \
  --mode paid \
  --facilitator https://facilitator.example \
  --port 0 --operations-port 0 --desk-port 0
```

Use the actual operator-selected facilitator URL. The sample URL is illustrative. For an existing local development facilitator, `--allow-local-facilitator` permits only `http://127.0.0.1`; the default transport requires HTTPS. Paid activation performs the original startup credential validation and native runtime construction. It does not submit a buyer purchase by itself.

## First deployment in the connection workspace

Open the installed `blockscout-connections` desk, intake the original plan or connection bundle, review it, and prepare or receive its original package. Connect the existing Applications workspace and select an installed merchant edition that contains the Blockscout deployment capability.

On **Merchant configuration**:

1. Select **Challenge-only first deployment**.
2. Keep the original private merchant state directory.
3. Select the intended local ports; port 0 asks the original listener for an available port.
4. Retain an existing environment-file or facilitator reference if already configured. Neither is required to open challenge-only service.
5. Review and save the application, then review and start its original launch.

The runtime review checks the selected installed edition's deployment capability before accepting an explicit mode. An older paid-only installed CLI must be upgraded through the existing runtime receiving workflow before it can launch an explicitly selected mode.

### Activate the same saved application

In **Saved merchant applications**, use the current run's **Stop this run** or **Recover this run** controls until the original Applications state is terminal. The deployment edit remains unavailable while the original run is active, queued or awaiting reconciliation.

Choose **Review deployment** on that application. The form displays its current application ID and revision, package, private merchant state and runtime. Select **Paid service**, supply the actual facilitator and select the private environment JSON file containing the provider credential. Empty environment-file selection uses the process environment; it does not copy credentials into the browser.

The review shows the previous and selected deployment settings. Save it, then use **Review launch** and **Start original merchant**. This operation updates the existing application ID and retains its original runtime, managed home, label, package, provider state and past runs. Each startup has its own normal reviewed run ID; previous run IDs retain their own output and recovery history.

The same form can return a stopped paid application to challenge-only mode. This is a deployment revision of the original merchant; it does not reverse provider activity or reset its ledger.

## API and CLI activation

The original HTTP action surface and `model.call` support:

```json
{
  "requestId": "OPERATOR_SELECTED_UUID",
  "applicationId": "RETURNED_APPLICATION_ID",
  "expectedRevision": "CURRENT_APPLICATION_REVISION_SHA256",
  "settings": {
    "deploymentMode": "paid",
    "facilitator": "https://facilitator.example",
    "environmentFile": "/private/blockscout/environment.json",
    "allowLocalFacilitator": false
  }
}
```

Send it to `/api/actions/deployment-review` through the private workspace's original token and origin controls, or call `model.call('deployment-review', payload)`. The returned workspace review selects the original Applications review ID. The mode is mandatory in this change request; the other three fields may be omitted to preserve their current values. Explicit `null` clears only the optional facilitator or environment-file reference. Paid mode still requires a facilitator after composition.

Use the same installed commands:

```sh
starforge blockscout-connections deployment-review \
  --workspace /private/blockscout/connections \
  --application RETURNED_APPLICATION_ID \
  --revision CURRENT_APPLICATION_REVISION_SHA256 \
  --settings /private/blockscout/deployment-change.json \
  --request-id REVIEW_UUID

starforge blockscout-connections application-save \
  --workspace /private/blockscout/connections \
  --review RETURNED_WORKSPACE_REVIEW_ID \
  --request-id SAVE_UUID

starforge blockscout-connections launch-review \
  --workspace /private/blockscout/connections \
  --application RETURNED_APPLICATION_ID \
  --request-id LAUNCH_REVIEW_UUID

starforge blockscout-connections launch \
  --workspace /private/blockscout/connections \
  --review RETURNED_LAUNCH_REVIEW_ID \
  --request-id LAUNCH_UUID
```

The deployment-change file contains the `settings` object from the preceding example. Use actual returned IDs, source revision and operator-selected UUIDs.

## Revision conflicts and interrupted receiving

The deployment request is bound to the current original application revision. An external edit or a newly active run produces the original conflict, so the operator reopens the existing application before creating another review. The change API cannot alter the package directory, state directory, label, runtime or account plan.

Every saved review maps to one deterministic original Applications save request. The desk stores both previous and target revision records before atomically moving its current application pointer. If execution or output is interrupted after Applications saves, `resume` retries that same original save and completes the desk pointer; it does not create another application or apply a different revision.

The **History** page retains `deployment-review` and `application-save` with their exact original requests. **Continue review** reopens a saved deployment comparison. A lost response can be received with the same request ID or:

```sh
starforge blockscout-connections resume \
  --workspace /private/blockscout/connections \
  --operation ORIGINAL_REQUEST_UUID
```

Immutable desk revision records are available through `record --type application-revisions --id RETURNED_REVISION_RECORD_ID`. The record ID is the canonical SHA-256 of `{applicationId,revision}`; the original Applications workspace separately retains its complete application revisions and run history.

[Connection preparation and receiving](CONNECTIONS.md) · [Standalone setup workspace](connection-workspace/README.md) · [Provider account contract](CONTRACT.md)
