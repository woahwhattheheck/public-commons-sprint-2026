# Receive MPP through the installed Applications workspace

The MPP entry opens the original customer or merchant workspace from the selected installed runtime. The receiving command completes the saved Applications workflow, reopens the operator while its original child process stays alive, receives usable customer files, and finishes an original Stop and restart.

The maintained entry and its interactive UI are documented in [MPP_APPLICATIONS.md](../runtime-workspace/MPP_APPLICATIONS.md). This command is useful when handing an already configured workspace to its receiving operator. It uses the same Applications HTTP APIs and original MPP customer/merchant APIs.

## Original inputs

Use an installed READY runtime that contains the merged MPP Applications entry and original MPP console readiness/identity implementation. Read its source commit, source-manifest SHA, installation ID and profile ID from the original runtime inspector. The command compares every selected value with that inspector before opening the Applications host.

The receiving command imports the operator, runtime inspector, storage lease and customer APIs directly from that runtime's actual package/source directory. Keep that directory, its original runtime profile and its source manifest together.

Supply the existing private Applications workspace and initialized MPP workspace. Both keep their original identities. The original MPP workspace metadata supplies createdAt. Its retained profiles select their own absolute native dependencyRoot. The MPP native runtime remains the original @stellar/mpp 0.7.1, mppx 0.6.29 and Stellar SDK 15.1.0 dependency tree, independent of the distribution's optional dependencies.

For dependency acquisition, use the maintained MPP runtime template/receiver and its original package-lock. The original profile selects the completed runtime. The receiving caller does not install dependencies or rewrite profiles to impersonate an installed runtime.

## Customer and merchant roles

Many installations keep the buyer's customer history and the merchant's offer profile in separate private workspaces. Receive those workspaces with two input documents and one existing Applications workspace.

| Role | Original workspace used | Receiving behavior |
| --- | --- | --- |
| customer | Customer profile plus original purchases | Review and save the selected customer configuration; preview an actual selected offer; export the current contract, OpenAPI and complete customer package; reopen and compare retained purchases. |
| merchant | Merchant profile and source routes | Export the native merchant contract, OpenAPI and customer package; start the original merchant; inspect its actual health response and optional original SDK challenge; stop and reopen with the same profile/contract. |
| both | One workspace containing both profiles | Perform both workflows in the same original MPP application. |

The original Product4 native journey uses separate customer and merchant directories. Its receiving continuation selects role customer for its customer directory and role merchant for its merchant directory, sequentially. Each application has its own original data-directory resource key. The Apps workspace, installed runtime and operator source stay shared.

## Input document

Save a private regular JSON file owned by the operating account, mode 0600. Its required fields are:

| Field | Meaning |
| --- | --- |
| schema | stellar-forge.mpp-managed-reception.v1 |
| applicationsDirectory | Canonical absolute directory of the original Applications workspace. |
| runtimeDirectory | Actual original READY installation directory. |
| expectedRuntime | sourceCommit, sourceManifestSha256, installationId and profileId returned by that installation's inspector. |
| mppDirectory | Canonical absolute directory of the original initialized customer/merchant workspace. |
| mppCreatedAt | Exact createdAt from that workspace's original workspace.json. |
| receptionDirectory | A new or previously used private directory for this receiving command's journal and exported files. |
| label | Human-readable saved application label, at most 120 characters. |
| settings | port, terminalPython and any existing environmentFile/tokenEnv selection. |
| retainedPurchaseIds | Array of original purchase IDs whose complete views must survive receiving and restart. Use an empty array for a merchant-only workspace. |
| role | customer, merchant or both. The default is both. |

Optional fields:

- applicationId selects an already saved original application. Without it, the receiver reuses the sole existing MPP entry for the same data directory or creates that entry.
- offer contains an actual offer id and optional inputs.query / inputs.json. Customer preview uses the original workbench preview API. Merchant challenge uses the original buildCustomerRequest result, retaining its method, path, query and JSON bytes.
- configureCurrentCustomer defaults to true. It reviews and selects the existing normalized customer profile through the original revision API. Set false when receiving a workspace whose current selected configuration should only be opened.
- exerciseMerchant defaults to true for merchant/both roles. It operates the source merchant through the console's original Start/Stop APIs.
- timeoutMs defaults to 180000 and controls waiting for original adoption, startup and shutdown. An unfinished operation remains identified by its retained request ID.

The settings object accepts the exact MPP Applications fields:

- port is an integer from 0 through 65535; 0 selects an available local port.
- terminalPython is the original PTY Python executable's absolute path.
- environmentFile, when selected, is the existing private JSON environment file consumed by the original manager.
- tokenEnv, when selected, names a 64-character lowercase-hex console token in that original environment.

The caller does not include bearer URLs or environment values in its public progress or result. Its input and journal are private operating records.

## Run and resume

Run the received command with Node 24 or newer:

    node /actual/source/stellar/scf-starforge-20261009/distribution/receiving/mpp-managed-reception.mjs /private/customer-receiving.json

For a separate merchant workspace, run the same command with its merchant-role input after the customer command has finished. Both inputs name the same original Applications workspace and installed runtime.

A program can use the same exported entry:

    const result = await receiveMppApplication(input, {
      progress: event => process.stderr.write(JSON.stringify(event) + '\n')
    });

The caller acquires one lease in its own receptionDirectory. It saves the reviewed command, original Save request, application ID, Start review and exact operation IDs before the corresponding mutation. On continuation, keep the same input and receptionDirectory. The same original Save/Start request is replayed or reopened. Reusing that directory with changed runtime, data-directory inode, source identity or configuration produces a specific input-change error.

If another original application is active on the same MPP workspace, open that existing operation before receiving its configuration. This reflects the original manager's data-directory ownership. An interrupted receiver preserves its own application/run IDs and closes only its temporary operator HTTP surface; the original manager continues to own its detached process and recovery.

## Completed operator workflow

1. Inspect the selected original READY runtime and current MPP workspace identity.
2. Reopen the existing Applications workspace and attach the selected installed runtime.
3. Review and save the native positional command through the original Applications API; allow its existing managed adoption to complete.
4. Review Start and dispatch the original retained operation.
5. Read the original private console URL from the manager and authenticate its identity.
6. Close and reopen the temporary operator host while verifying the same original MPP PID, parent PID, workspace and createdAt.
7. Receive the selected customer/merchant workflow and editable original exports.
8. Stop through the original Applications API, then review and start the same saved application again.
9. Confirm its retained purchases or merchant contract after restart and stop the original operation.
10. Reinspect the selected runtime and write the completed result.

Customer configuration recovery compares the original requested profile and revision. A lost successful response is reconciled from the same selected profile at the next original revision. Changed human or concurrent edits are returned as a concrete revision conflict.

Customer history is paginated through the original API. Explicitly selected purchase views are hashed before use and again after restart. Existing native challenges, phases and customer contract links are retained.

Merchant challenge requests use the source-native SDK at the local merchant listener. The command requires its actual HTTP 402 and authentication challenge response. The native request body comes from the original customer request builder. Original configured paid execution remains available through the normal operator workflow.

## Files received

The private reception directory contains:

- reception.json: original source/runtime/directory binding, saved request/review/run IDs, progress and exact continuation state.
- result.json: completed application identity, role, source/runtime identity, native process identities, retained purchase or merchant-contract comparison, export byte lengths and SHA-256 values.
- customer-contract.json, customer-openapi.json and customer-package.json for a customer-role workspace.
- customer-request-preview.json when an actual customer offer was selected.
- customer-files/ containing the original bundle's materialized README, source clients and examples for a customer-role workspace.
- merchant-customer-contract.json, merchant-customer-openapi.json and merchant-customer-package.json for a merchant-role workspace.
- merchant-customer-files/ containing that merchant's complete original customer bundle, received through the maintained customer file receiver.

The customer package is the original maintained bundle, including its complete source files and their hashes. The caller uses the original customer bundle generator for a selected customer contract and the original console download route for a selected merchant profile. It retains each complete response and validates the saved bytes on continuation.
