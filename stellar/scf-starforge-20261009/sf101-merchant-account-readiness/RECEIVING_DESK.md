# Merchant receiving desk

The receiving desk is a private browser workspace for the merchant’s actual seller configuration. Save its original JSON, run the native receiving review, inspect every accepted payment choice, act on the exact account or token result, and keep the complete review available for comparison and reopening.

The desk uses the original SF30 seller compiler, SF101 account evaluator, Stellar SDK contract reader, and seven-file receiving bundle. The browser presents the same receiving results and action text as the original merchant command.

## Open the desk

Use Linux, Node 22 or later, `flock`, and the component’s pinned `@stellar/stellar-sdk` dependency. In the maintained merchant distribution, use the existing command:

```sh
starforge merchant-readiness workspace \
  --directory /private/merchant/receiving-desk \
  --port 8408
```

From a source checkout:

```sh
node stellar/scf-starforge-20261009/sf101-merchant-account-readiness/merchant-cli.mjs \
  workspace --directory /private/merchant/receiving-desk --port 8408
```

The parent directory must exist. The desk creates the named directory with mode 0700, or reopens that same private directory. Open the loopback URL printed by the command. Keep the process running while working in the browser. Start the same command and directory after a restart to recover its saved configurations and reviews.

One process owns a workspace directory at a time. A second process receives `FLEET_STATE_ALREADY_OWNED`; use a separate private directory for an independent desk. The operating system releases ownership when the original process exits. A normal stop lets an accepted native review finish before releasing the directory, and saved queued reviews resume when the desk reopens.

## Load an actual seller configuration

Choose **Add configuration**, enter a useful name, and select the same seller-service JSON used by the merchant. The file’s bytes are preserved. If it has no `publicOrigin`, enter the seller’s actual public origin in the form. The original compiler validates definition routes, imported offers, response-asset offers, methods, resource paths and all accepted payment terms.

Expand **Asset mapping and network options** when needed:

| Input | Use |
| --- | --- |
| Classic asset map | Supply the existing approved code/issuer-to-contract JSON. Deployed SAC metadata can supply the original verified mapping when this is omitted. |
| RPC endpoint map | Select the merchant’s original RPC endpoints by network. The map supports the original `url` and `urlEnv` forms. |
| Proxy environment variable | Enter the name of an environment variable, such as `HTTPS_PROXY`, when the operator host requires its existing explicit CONNECT transport. |
| Read timeout | Set 1,000–30,000 milliseconds for a native network read. The default is 12,000. |
| Fee operations | Set the original account-advisory operation count from zero to 100,000. It defaults to zero. |

Each JSON input supports up to 1 MiB. **Save configuration** shows its original file names, seller and plan hashes, and every compiled amount, token, network and recipient before a native review starts.

Saved configurations are immutable. Add another configuration after changing the seller’s terms, asset map or endpoint profile. A useful name, such as “Reports · corrected incoming limit,” makes the resulting review history easier to follow.

For a network endpoint selected from the operator environment, the private RPC map can contain:

```json
{
  "stellar:testnet": { "urlEnv": "MERCHANT_TESTNET_RPC_URL" },
  "stellar:pubnet": { "urlEnv": "MERCHANT_PUBLIC_RPC_URL" }
}
```

Make the corresponding environment value available to the command before a live review. Private saved inputs and complete exports contain the merchant’s original configuration and resolved captured endpoint requests, so keep these files with the operator’s other private source material.

## Review every payment choice

Choose **Run live review**. The desk saves the request before returning its queued status. One native review runs at a time in each directory; further requests remain visible in the queue. The browser displays the current native activity and keeps the original request ID in the history.

The result includes every configured option even when another option needs account attention or a provider read fails. Inspect an option to see:

- Its exact resource, normalized payment scheme, network, contract, receiving address, atomic amount and timeout.
- Native token kind, symbol, decimals, observed balance, authorization and contributing ledger numbers.
- The original classic trustline authorization, current balance, limit and remaining inbound capacity for a SAC G-account recipient.
- Dynamic XLM reserve, available balance and account advisories from the original account evaluator.
- The specific receiving actions maintained in `merchant.mjs` and the complete original option result.

Amounts remain exact decimal strings. A successful small incoming amount does not qualify a larger option: the original evaluator checks each amount against the retained raw account and native balance. The browser separates ready options, account action, missing configuration, failed reads and source or custom-token policy review.

Use the exact receiving action attached to the result. Examples include creating the specified code/issuer trustline through the existing wallet, asking that issuer to authorize the merchant’s trustline, increasing its limit or reducing the advertised amount, and restoring the identified archived contract through the existing operator process. After the account or seller change, run a new live review and compare it with the earlier one.

**Cancel review** removes a queued request from execution or requests cancellation of the active read. Its saved request remains visible with the resulting state. A normal process stop preserves queued work for reopening.

## Compare and replay

Select **Compare with an earlier review** before starting a new run. The completed native bundle then includes the original comparison. This selector can use a review from another saved configuration, which is useful when prices, recipients or routes changed.

Within a configuration’s **Review history**, select two completed reviews and choose **Compare selected reviews** for an immediate saved-state comparison. Each row shows added, removed, changed or unchanged payment choices and the introduced or resolved receiving reason codes. Matching uses the complete original payment terms and resource, so reordering options preserves identity and changing an amount creates a different choice.

To examine a retained observation, select its completed review under **Captured observation to replay** and choose **Replay capture**. The original native reader rebuilds the same serialized read requests and consumes their exact captured response bytes. It makes no network requests. The desk verifies the original seller bytes, compiled plan, supplied asset map, fee-operation count, retained input-file hashes and captured request hashes.

Replay uses the endpoint values recorded in the capture. Reopening the desk for replay therefore works after the original `urlEnv` value or proxy setting has been removed from the process environment. New live reviews continue to resolve the original saved input profile.

The browser labels live reads, captured replay and imported observations separately and shows their recorded times. Replay retains the original source-review and freshness reasons produced by the native evaluator. Use **Run live review** to refresh current receiving state.

## Export, reopen and import

Open a completed review and choose **Export complete review**. The downloaded `merchant-receiving-<id>.json` contains the original seller, optional asset and RPC input bytes, retained review metadata, and all seven native files:

| Native file | Contents |
| --- | --- |
| `review.json` | Original report for every route and payment option |
| `review.html` | Original grayscale printable receiving report |
| `options.csv` | Original row-per-option export |
| `plan.json` | Complete original compiled receiving plan |
| `asset-map.json` | Supplied and natively discovered SAC identity mapping |
| `capture.json` | Exact request identities, original response bytes and observation times |
| `manifest.json` | Original source bindings and exact member hashes |

Choose **Import a saved review** in any receiving desk to load that complete export. The import verifies the original manifest and captured request bytes, compiles the retained seller again, and checks the profile/capture bindings before adding the imported profile and completed observation. Each import creates a new local profile and review. Its original native observation time remains visible. The imported capture can then be replayed offline or compared with a new live review.

Saved native files are also directly available under `reviews/<id>/bundle/` in the private directory. Open its `review.html` or use its `options.csv` when a printable or spreadsheet handoff is useful. Profile inputs live under `profiles/<id>/`; the browser keeps their hashes and public compiled terms available while the private original file contents stay in the workspace.

Completed reviews retain their manifest digest in the durable state record. Reopening, replaying and exporting check that anchor before reading the original native members. New profiles, queued requests and imports are written to private staging directories and become visible only when their complete records have been synced and renamed into place. A process interruption during native execution keeps the request visible; a complete retained bundle is recovered, and an incomplete run is marked interrupted for a fresh review.

## Application integration

`workspace/controller.mjs` exports `openReceivingWorkspace({directory, environment, sdk})`. It returns the original browser operations: create/list/get profiles, start/list/get/cancel reviews, compare, export, import, status and close. The controller calls `inspectMerchantReceiving`, `writeMerchantReview`, `readMerchantBundle` and `compareMerchantReadiness` directly. Its return values are the server’s JSON bodies.

`workspace/server.mjs` owns the loopback HTTP interface and composable handler. Its protected API uses the process-scoped `x-receiving-session` header, exact host and same-origin checks, private uncached responses and fixed browser assets. The existing merchant CLI starts that server for the `workspace` subcommand. See the exported functions in that module when mounting the desk inside an existing operator application.

The complete SF101 source directory, including the browser assets and this guide, belongs to the maintained merchant distribution. The original `merchant-readiness` alias provides both the receiving CLI and its workspace subcommand.
