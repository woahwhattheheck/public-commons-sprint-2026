# Python applications in the merchant commerce session

Run an existing Python application inside the same native merchant and buyer
session used by the commerce terminal and browser workspace. The original
Python worker pool owns application initialization and execution. The original
commerce runtime owns the seller, facilitator, buyer inbox and operating history.
There is one merchant listener and the existing payment path.

## Prepare the application

Use Python 3.11 or newer and the Node/native dependencies in
[COMMERCE.md](COMMERCE.md). Start with an actual
[Python merchant declaration](../sf30-seller-sdk/python/README.md). It names the
trusted application module, explicit public functions and inputs, original
merchant origin and payment terms. Optional private `startup` and `shutdown`
hooks may initialize and close an async client, database connection or background
task. The `environment` list passes named values from the process environment;
the commerce session stores those names, not the values.

Keep the merchant declaration and buyer files private (`0600`) inside an existing
private directory (`0700`). The application must be a regular `.py` file, up to
2 MiB, and must not be writable by other users. Keep its dependencies and selected
Python executable installed on the same host. Application code is trusted local
code and runs with the operator's permissions.

Check the actual application before serving:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/python/merchant.mjs diagnose \
  --config /private/merchant/python.json
```

This imports the configured application, completes each worker's initialization,
then closes the workers. It invokes zero public functions and does not make a
purchase. Startup/shutdown hooks can themselves contact their configured
services. `PYTHON_LIFECYCLE_READY` means initialization and cleanup completed;
incomplete cleanup returns a nonzero exit status. Use `inspect` instead to read
configuration without importing the application.

The included `python/example-lifecycle.json` and `python/lifecycle-example.py`
demonstrate a persistent async resource with no third-party Python dependency.
Their sample payment placeholders must be replaced with the merchant's actual
terms before native use.

## Save the existing commerce plan

Select `seller.python` instead of a generic seller configuration/JavaScript
handler pair. The commerce initializer derives the original SF30 service and
offers directly from that Python declaration; do not maintain a second service
file with separate prices or routes.

```json
{
  "schema": "stellar-forge.commerce-plan.v1",
  "seller": {
    "python": "/private/merchant/python.json",
    "port": 8423,
    "facilitatorConfig": "/private/merchant/facilitator.json"
  },
  "operationsPort": 0,
  "buyers": [
    {
      "config": "/private/operator/operator.json",
      "workspace": "/private/operator"
    }
  ]
}
```

Use an existing original SF88 operator workspace or the original SF103
`config`/`signerConfig` buyer pair described in [COMMERCE.md](COMMERCE.md).
Each selected buyer must have a distinct stable intent, the actual Python
function URL/method, accepted input and matching native payment option. The
existing merchant ingress must route its advertised HTTPS origin to the selected
loopback port. The session uses the original public buyer transport.

For an existing facilitator, replace `facilitatorConfig` with
`"facilitator":{"url":"https://your-facilitator.example"}`. An existing
loopback facilitator requires its explicit `allowLocal` option as documented in
the original commerce guide. Choose one facilitator source.

Save the plan privately, then initialize a new session directory:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs init \
  --plan /private/commerce-plan.json --directory /private/merchant-session

node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs inspect \
  --directory /private/merchant-session
```

Initialization copies the normalized Python declaration to `python.json`,
copies its derived original SF30 configuration to `seller.json`, and retains
their digests and the actual application module digest in the existing
`session.json`. Its application path is absolute, so relative paths retain their
original meaning after the configuration is saved. The application remains at
its trusted original location. The original SF88 inbox freezes each buyer's
configuration and body. Initialization does not import Python, start a server or
load a signer.

## Run, observe and stop

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs start \
  --directory /private/merchant-session
```

The saved declaration and actual application bytes are checked before acquiring
the original worker pool. With native payment configured, every worker completes
its startup hook before the merchant session reports `RUNNING`. Initialized
resources and async tasks remain on that worker's event loop between requests.
The original input validation, native verification and settlement ordering, and
the original Python call/queue/output/deadline limits still apply.

Without a facilitator, the session serves original `CHALLENGE_ONLY` offers and
supports buyer review/cancellation/recovery. It does not import Python or start
workers. Status explicitly reports that the application is `NOT_STARTED`.

The existing terminal commands remain `status`, `review ID`, `signer ID`,
`execute ID`, `cancel ID`, `recover ID` and `quit`. Native payment approval stays
in the original operator terminal. The existing browser attaches to this same
session through:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs start \
  --directory /private/merchant-session
```

Use one foreground owner for a session. The browser command owns its commerce
session; it is an alternative to the terminal start command for that directory.

Original status includes `seller.python`: application identity, lifecycle hooks,
startup/shutdown limits and live original pool counters. The merchant's existing
operations pages continue to show native HTTP usage and retained history. Python
worker counters describe application processing, not Stellar settlement or
revenue. The terminal prints the Python cleanup result when the session stops.

On `quit`, SIGINT or SIGTERM, the commerce runtime first waits for its original
buyer/review/signer children, then drains the original seller and facilitator,
checkpoints its existing operations history, and closes the Python pool. Idle
workers run the application shutdown hook and finish loop cleanup; the parent
waits for actual process exit. A hanging hook reaches the declaration's
`shutdownTimeoutMs` and is retired. The existing close result includes the exact
Python summary and reports `drained:false` for incomplete application cleanup;
the foreground CLI exits nonzero. Forced cancellation, SIGKILL or host loss
cannot guarantee execution of application cleanup hooks.

## Reopen and change an application deliberately

Start the same directory to reopen the original buyer inbox and operating
history. A worker that was retired after a function deadline initializes a new
copy of the same pinned application before serving another request. Reopening
after process exit starts fresh worker resources but preserves original buyer
outcomes; it does not replay a completed or ambiguous purchase.

The saved application pin covers the named module's bytes. Python dependencies,
the executable and environment values remain the operator's installed runtime;
they are not copied into the session. Preserve that runtime when reproducing a
deployment.

If application bytes change, inspection/start returns
`COMMERCE_PYTHON_SOURCE_CHANGED`. A changed copied declaration or derived seller
configuration is similarly refused. Restore the actual retained original module
to reopen the same session, or use the changed declaration/application with a new
explicit commerce plan and directory for future intents. Keep the original
directory for buyer outcome/recovery access. Do not edit its recorded digests to
turn old approvals into approvals for different source.

The original inbox remains directly accessible even when an application source
check prevents the commerce server from starting. Inspect or recover its retained
outcome without launching Python or making another purchase:

```sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs show \
  --root /private/merchant-session/inbox --intent ORIGINAL_INTENT
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue-cli.mjs recover \
  --root /private/merchant-session/inbox --intent ORIGINAL_INTENT
```

For a trusted embedding, existing `initializeCommerce` and `openCommerce`
remain the entry points. Setup tooling may call
`preparePythonCommerce(configPath)` from `commerce-python.mjs` to obtain the same
original `compiled.service` for offer selection without importing Python. The
original `createPythonSource` also accepts `expectedApplicationSha256`; when
supplied, it compares actual module bytes before any worker starts.
