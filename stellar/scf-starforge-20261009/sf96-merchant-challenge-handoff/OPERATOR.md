# Direct merchant operator workflow

An external merchant can give an operator an HTTPS resource before it has a
catalog listing. This command carries that original offer into a complete private
buyer workspace and saved request. It joins the existing SF85 capture, SF84
decoder, SF96 handoff, SF88 workspace and durable inbox. The original SF31 buyer,
SF81/SF36 terminal approval and budget ledger, SF103 native signer, SF82 checkout
evidence and SF31 response writer continue to do their existing jobs.

The result is usable after a process restart: the operator can inspect the exact
source and request, execute the queued operation from its private workspace, find
the returned file, recover the original evidence and export the existing operator
report. There is one stable intent and one existing queue attempt record.

## Prerequisites

Use the full public sprint checkout with Node 22+, Python 3.11+, and the
[original SF88 workspace dependencies](../sf88-operator-buyer-cli/README.md).
The current native signer uses the official pinned x402 packages. Install the
workspace's declared dependencies as described in that guide, on the operator
machine. Do not install a separate payment implementation for this command.

Have the provider's actual approved HTTPS URL and the public address of the
operator's testnet payer. Ask the provider for its supported scheme, asset,
account/funding requirements, expected 402 flow and facilitator/RPC details.
Use its original response to select the offer. This setup supports the existing
workspace's `exact` / `stellar:testnet` path; custom schemes require their own
native integration. A provider invitation or tooling credit is a design-partner
opportunity; it is not a paid customer, transaction or booked revenue.

The parent directory of a new pilot must exist, belong to the current user, have
mode 0700 and resolve without symlinks. Example private root:

```sh
mkdir -m 700 /absolute/private-pilots
```

All command paths below are illustrative. Substitute the actual original seller
URL, exact selected terms, operator identities and public payer address.

## 1. Observe the original route

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  observe --url 'https://APPROVED_PROVIDER/RESOURCE' \
  --allow-origin 'https://APPROVED_PROVIDER' --method GET \
  --out /absolute/private-pilots/provider-capture.json
```

This invokes the original SF85 command once. It preserves its current HTTPS,
public-address, timeout, original-origin and response-header rules, and its
explicit transport options. It does not download the resource, sign or follow a
redirect. The output adds the original SF84 parsed offer list so the operator can
choose an index without retyping the merchant's terms. An existing unchanged SF85
capture can be used directly; do not recapture merely to repeat this step.

If the operator already has the genuine response headers from another approved
runtime, use the original [SF85 header importer](../sf85-live-402-capture/HEADER_IMPORT.md)
and supply its output to preparation. The workflow accepts that source's exact
shape and preserves its header digest, import time and operator-declared method.
Its unknown response capture time stays null throughout the handoff and report.
It does not turn the import into a TLS-observed response.

## 2. Prepare the complete private operation

Select the zero-based original offer index, choose a stable intent ID, and state
the maximum atomic units explicitly. Preparation makes no network request and
needs no wallet secret:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  prepare --capture /absolute/private-pilots/provider-capture.json \
  --offer-index 0 --intent-id provider-resource-001 --max-atomic 1000 \
  --dir /absolute/private-pilots/provider-resource-001 \
  --actor YOUR_OPERATOR_ID --service YOUR_VERIFIED_PROVIDER_ID \
  --payer YOUR_TESTNET_G_ADDRESS --python /usr/bin/python3
```

The index and amount above are examples, not a provider quote. The ceiling must
cover the actual selected quote and fit the original SF36 budget constraints.
The default total and daily caps equal that ceiling. The existing
`--total-atomic` and `--daily-atomic` options can set explicit larger limits.

An already verified SF96 handoff can be imported instead. Its original intent,
option and ceiling stay fixed:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  prepare --handoff /absolute/private-pilots/existing-handoff \
  --dir /absolute/private-pilots/provider-resource-001 \
  --actor YOUR_OPERATOR_ID --service YOUR_VERIFIED_PROVIDER_ID \
  --payer YOUR_TESTNET_G_ADDRESS --python /usr/bin/python3
```

Preparation preserves the exact original capture in `handoff/`, calls the
original SF88 workspace initializer in `operator/`, then enqueues its generated
configuration in the original `inbox/`. No operator settings come from the
merchant response. The small `pilot.json` contains source hashes and pointers;
the existing inbox owns the execution lifecycle. The directory is create-only.
It will never replace an earlier case, budget ledger or queued operation.

The saved response destination is `delivery/response.bin`. The actual response
content type is recorded by the original writer; the extension does not change
the data. Defaults are 64 MiB and 30 seconds, configurable with
`--max-response-bytes` and `--response-timeout-ms`. The existing writer preserves
completed output and reports a private partial path when appropriate.

The original workspace's `--secret-env`, `--signer-provider` and `--rpc` options
are forwarded unchanged. A wallet provider is a trusted operator module, never a
file chosen by a seller. The source workspace validates these options and owns
the signer. Only use options present in the current merged workspace version.

## 3. Review, then execute from the trusted terminal

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  review --dir /absolute/private-pilots/provider-resource-001
```

Review re-derives the saved original handoff, checks the workspace and queued
configuration against it, and launches the original SF88 workspace review. It
does not open `operator-keys.json`, load a signer or contact the provider.

With the existing wallet supplied to its configured runtime environment or
trusted provider, execute the exact saved request:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  execute --dir /absolute/private-pilots/provider-resource-001
```

This starts the original queue CLI with its native `--workspace` option in a
fresh child process. The queue checks and binds the workspace and signer
prerequisites before recording an attempt, then loads the original private
operator environment. This wrapper never reads the workspace keys or changes a
process-global environment. SF81 presents fresh native terms through `/dev/tty`; its existing typed
approval and original SF36 reservation precede signing. The original buyer makes
its unsigned request and at most one signed retry. This wrapper does not approve
on the user's behalf, select another quote, retry an attempt or reset a budget.

The terminal JSON includes the original queue record, original command exit
status, seller/HTTP outcome, independently produced outcome report and separate
returned-file result. SIGINT/SIGTERM are forwarded to the original command for
its existing cancellation and cleanup behavior. If the process ends before it
prints a summary, reopen the same directory.

An unavailable workspace or signer prerequisite is reported by the original
queue command and leaves an unattempted request queued. Correct that prerequisite
and inspect the same case; the wrapper does not replace the intent or ledger.

## 4. Reopen, recover and hand over the result

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  show --dir /absolute/private-pilots/provider-resource-001
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  report --dir /absolute/private-pilots/provider-resource-001 \
  --out /absolute/private-pilots/provider-resource-001/operator-report.html
```

`show` and `report` load no operator keys. They retain the original queue states,
the exact source selection and saved response path. The report reuses the
existing private SF88 history renderer with commands routed through this
workspace-aware entry point. It is a static local page with no payment controls
or network calls. Export is create-only; select a new report filename for a later
snapshot. The report contains private resource identities, terms and local paths.

For an interrupted or completed execution with a retained original SF82 record:

```sh
node stellar/scf-starforge-20261009/sf96-merchant-challenge-handoff/operator-cli.mjs \
  recover --dir /absolute/private-pilots/provider-resource-001
```

Recovery calls the original queue's evidence recovery and original SF52
classification. It does not contact the seller, sign, release funds or repeat
the operation. SF82 binds its evidence to the intent and terms; it does not
independently record the request URL/method or the saved response-file hash.
This wrapper binds the prepared request to its source, without expanding what
that older evidence format establishes. Use the original download summary for
file completion and the original chain tools for transaction reconciliation.

For an unattempted operation, `cancel --dir ...` records the original queue's
local cancellation. An attempted or cancelled intent cannot be executed again
through this command. `show` includes the applicable original commands.

## Source and compatibility

- Original capture and handoff: [SF85](../sf85-live-402-capture/README.md),
  [SF84](../sf84-mpp-market-intake/README.md), [SF96](README.md).
- Operator setup and attempts: [SF88 workspace](../sf88-operator-buyer-cli/README.md)
  and [durable inbox](../sf88-operator-buyer-cli/QUEUE.md).
- Payment and output: [SF31 buyer](../sf31-buyer-client/README.md),
  [SF81 bridge](../sf81-buyer-operator-bridge/README.md),
  [SF82 evidence](../sf82-checkout-evidence/README.md).

The only SF88 renderer addition is optional `commandFor(verb, queueRoot,
intentId)`, a trusted pure callback returning a display string. The default
commands and all outcome rendering stay as before. Returned commands are
bounded and HTML-escaped; they are never executed by the report.
