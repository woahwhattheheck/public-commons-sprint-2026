# Complete Gravity browser receiving

Use the complete original OPERATED_GRAVITY_REFERRAL.json from the native operation. Start the original operator over that workspace or an explicitly received copy of its UUID.

~~~sh
node fhir_referral/cli.mjs serve \
  --workspace /absolute/private/original-workspace --port 0 \
  --expected-workspace-id ORIGINAL_UUID

node fhir_referral/operate_browser.mjs \
  --url ORIGINAL_PRIVATE_OPERATOR_URL \
  --receiving /absolute/native-output/OPERATED_GRAVITY_REFERRAL.json \
  --output /absolute/private/browser-output
~~~

The driver uses Node 22+, Playwright/Chromium and the existing Python runtime. --chromium ABS_BINARY and --playwright ABS_MODULE select installed dependencies. To operate a complete restored copy on another host, add --workspace ABS_RECEIVED_PRIVATE_WORKSPACE while keeping the original receiving record unchanged.

The actual server must match the original UUID, every selected original native/referral record and the explicitly selected directory.

## Whole operating journey

The driver uses actual UI forms and buttons. It opens the original queue and all 24 Task field observations, downloads/reuploads the same full source, edits the complete 81-row review and verifies its IndexedDB draft after navigation/reload, saves its successor, selects a source-hosted direct-light topology and the entire original Task cohort, records scoped ownership, previews/applies a two-field Task correction, and saves the complete comparison and successor assessment.

It reopens the already-complete original conditional-write and history UUIDs, receives their full files, runs the actual native dataset query, and downloads complete customer and merchant packets. It freezes the authored handoff, receives its complete archive, uploads the actual local file receipt and records the original handoff receiving. Source guidance downloads and verifies all 191 original files.

The final phase downloads Gravity_Complete_Editable_Workspace.zip, starts the same native CLI in a separate private receiving directory, uploads the whole archive through the receiving UI, and verifies original plus authored records and selected complete bodies. It stops that child operator, starts it again with the expected original UUID, and reopens the received queue/handoff.

Only this driver's child servers/pages are closed. The caller retains its existing operator and browser.

## Complete outputs and continuation

OPERATED_GRAVITY_BROWSER.json retains the original input binding, explicit workspace/UUID, original and authored record identities, every actual UI native response as a complete file, original source/exchange/assessment/customer/merchant/handoff/guidance/workspace downloads with full byte/hash identities, screenshots, final native state, received workspace and second-start result.

BROWSER_JOURNEY.json retains phase states, original operation UUIDs and source-bound labels. On continuation, an unknown response is reconciled against its actual saved record before another form write. Completed exchanges retain their exact original request/UUID.

## Embedded helper contract

~~~js
originalGravityReceiving(value)

await originalGravityState(privateURL, receiving, {
  workspace: explicitlyReceivedWorkspace
})

await gravityBrowserReady(page)

await operateGravityBrowser({
  page,
  browser,
  receiving,
  native,      // optional current complete /api/state
  output,      // absolute private result directory
  workspace    // defaults to original receiving.workspace
})
~~~

The supplied page is already open on the current private operator. Its existing origin-scoped capability stays private. Results expose workspacePacket and downloads.workspace as {file,bytes,sha256}, a screens map, receivedWorkspace with the actual reopen result, and finalWorkspace for a later Applications start.

Read-only connected receiving uses body[data-ready="true"], #content[aria-busy="false"] and no body busy state. Navigation uses [data-nav="queue"], [data-nav="datasets"] and [data-nav="receiving"]. #dataset-query-form contains buildId and the exact scalar-string query JSON; the actual response route is /api/builds/{id}/query.
