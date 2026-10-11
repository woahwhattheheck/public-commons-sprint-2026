# One joined OAuth application workflow

This retained workflow runs the original merchant source against one local OAuth protocol peer and one operator browser. It covers source import, authorization and grant review, saved source revisions, the existing seller challenge and upstream handler, and the existing SF82/SF99 receiving-host output.

The peer implements actual authorization-code exchange with S256 verification, one-time codes, bearer requests, rotating refresh tokens and token-family revocation. Its account and records are explicitly local protocol fixtures. The original SF61 example supplies the nonpayable payment markers. An application response or a generated host bundle is not described as a settled payment or an installed service.

## Runtime and source

Use the same Node runtime and dependencies required by the original merchant, Python only for the existing admission wrapper when applicable, and the existing Playwright/Chromium installation. Use a regular Git checkout of the complete repository. The host generator intentionally rejects symlinked selected entry files.

Required files in this directory are:

- `native-session.mjs`: one owner for the peer, original workspace, compiled application handles and receiving-host checks.
- `oauth-peer.mjs`: the retained local protocol account and its actual HTTP endpoints.
- `operator-session.cjs`: the paired browser owner, which attaches to the existing workspace and starts no second server.

Select a new private working directory outside the source checkout. The same directory is retained for a continuation; do not delete it to retry a later phase.

~~~sh
mkdir -m 700 /private/oauth-workflow
SCF_OAUTH_WORKSPACE_ROOT=/private/oauth-workflow \
SCF_OAUTH_SOURCE_ROOT=/absolute/repository \
SCF_OAUTH_OPERATOR_DRIVER=/absolute/repository/stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/native-workflow/operator-session.cjs \
node /absolute/repository/stellar/scf-starforge-20261009/sf30-seller-sdk/oauth-connections/native-workflow/native-session.mjs
~~~

The browser owner can use explicit `SCF_OAUTH_BROWSER_EXECUTABLE`, `SCF_OAUTH_BROWSER_TMPDIR` and `SCF_OAUTH_PLAYWRIGHT_MODULE_PATH` when supplied by its host. These select an existing browser/runtime, not a signed-in account profile.

On a shared managed host, run this exact process tree through its existing memory/disk admission owner. The controller launches the sole browser child. It does not start another application copy or self-register a second job.

## What is retained

`native-private/workflow.json` fixes the chosen local ports and both source profiles. Each profile has its own exact source hash and callback path:

| Alias | Source operation | Purpose |
| --- | --- | --- |
| records-demo | GET /records | Original import, approved grant and runtime lifecycle |
| records-demo-revision | GET /v2/records | A changed original source and explicitly selected revision grant |

Both sources use the same retained provider HTTP service. The changed document requires its own registered profile; the editor cannot silently reuse another source's grant.

The private ready file is `native-private/ready.json`. It contains the current workspace capability and exact local paths used by the browser owner. The corresponding `acceptance/native-ready.json` contains only safe status, origins and source identities. A workspace restart replaces the capability in the private ready file while keeping the source bytes, ports, provider state and approved connection stores.

The peer's tokens and authorization codes are private in `native-private/provider/`. The two application grant stores are private siblings. Do not publish or include these working directories in a source package. The generated original OpenAPI files and public profiles are in `acceptance/inputs/`.

## Browser sequence

The browser owner uses the existing source and connection controls:

1. Import the original source, inspect its authorization-code and client-credentials declarations, and choose the actual authorization-code connection.
2. Begin authorization, use **Allow records access** in the provider page, return to the original workspace, and approve the displayed scopes and expiry with an operator/reference.
3. Compile and save an explicit route, inspect its exact source/profile/grant references, and start the original challenge preview. Unpaid requests must leave provider/backend counters unchanged.
4. Exercise the compiled original application handler and its selected shared-read policy. Observe a real backend 401 and subsequent explicit renewal without replaying the failed request.
5. Reconnect with a newly reviewed grant and demonstrate that an older package binding is rejected until the source/connection selection is reviewed again.
6. Import the replacement source, authorize its separate profile and use the maintained revision desk to explicitly map the changed operation, review the candidate, save and stage it.
7. Exercise a lost rotating-refresh response and a lost revocation response. Keep the old refresh from being blindly reused; keep unfinished remote cleanup visible through reconnect. An older cleanup cannot be sent while a newer local grant is connected.
8. Restart the original workspace, reopen the retained connection/package state and finish exact-request recovery. Prepare and check the original receiving-host bundle and mount topology.

All generated checks and browser outputs belong to this same operated workspace. A failed phase remains a concrete continuation on its retained source/state; completed phases are not replaced by a new fixture.

## Controller interface

The browser/engineering owner writes one JSON request to `acceptance/control/ID.request.json`:

~~~json
{"id":"host-original","action":"host.prepare","payload":{"package":"records-original"}}
~~~

The controller returns `ID.result.json` with the request's content hash, `ok`, and a result or safe error. Reusing the filename with changed request bytes is rejected.

| Action | Payload | Result |
| --- | --- | --- |
| status | {} | Safe connection status, current peer counters and original application handles |
| peer.control | {action} | Retained invalidate_access, lose_next_refresh, lose_next_revocation or clear_failures instruction |
| application.invoke | {package, routeId?, invalidateCache?} | Actual compiled SF30 handler response and safe lifecycle counters |
| application.close | {} | Drained original application handles |
| workspace.restart | {} | Same workspace/store/source, with a newly issued private workspace capability |
| host.prepare | {package} | Original release stage/activation, checked host bundle and exact mount bindings |
| scan.public | {package} | Scan of retained package/status/host output for the peer's actual private token/code values |
| close | {} | Drain the original browser, workspace, handlers and peer |

`application.invoke` directly calls the original compiled application handler for the credential/backend join. It is deliberately separate from the original HTTP challenge check and asserts no payment verification or settlement.

`host.prepare` invokes the original release store, stage and activation functions, followed by `generate`, `checkBundle`, `checkOAuthHostConnections`, `prepareMounts` and `checkMounts`. Its output records the exact OAuth write path and preflight command in the generated seller unit. It verifies an explicit same-path writable OAuth bind with `create_host_path:false`. It asserts that these host checks made no provider requests. It does not start systemd or Docker.

## Completion and continuation

Close through the controller after the browser owner records the completed journey. The controller writes `native-closed.json` and removes the obsolete private ready capability. A process interruption can be resumed only after the original lifetime is confirmed stopped, using the same directory and source closure. The process does not assume that an interrupted callback flow survived; approved grants and durable command results do.

Keep the concise actual journey result and useful source identities with the product's original handoff. Keep token stores, browser working data, raw callback material and full private logs with the operator.
