# Commerce browser workspace

Run the prepared merchant and buyer session from one local browser workspace.
Select an existing purchase, review its request, approve the live payment terms
in the browser, and use the original buyer's retained result. The merchant's developer
workspace and operations dashboard remain available from the same screen.

This is a browser interface to [`openCommerce`](./COMMERCE.md). The original
commerce engine starts SF30, its native facilitator and operations, and invokes
the original SF88 inbox, SF81 approval and configured signer. The browser uses
those APIs and that inbox directly.

Use **Copy merchant operations URL** and open that address directly in a new
tab. The original operations service accepts direct operator navigation; the
workspace keeps its cross-origin API and referrer rules intact.

For an SF101 paid-file order, [import its original merchant handoff in the
commerce plan](./COMMERCE_PAID_FILES.md). The same workspace then shows a
**Purchased file** panel with the exact order, promised bytes, original
request/evidence association, explicit retrieval, verified preview/download
and local receipt recovery. The immediate paid HTTP response remains in the
original **Delivery** panel.

For a finite SSE or NDJSON purchase, use [Streamed purchases](./COMMERCE_STREAMS.md).
The same **Delivery** panel shows the reviewed capture settings, observed bytes,
original payment status, retained record search and paging, partial-prefix
reopening, and the original Exa answer/citation reader.

## Start the prepared session

Complete the merchant, facilitator, operator and buyer setup in
[COMMERCE.md](./COMMERCE.md), then initialize its session with the original CLI:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-cli.mjs init \
  --plan /private/commerce-plan.json --directory /private/merchant-session
```

Start the browser workspace on the operator's host:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs start \
  --directory /private/merchant-session --port 8426
```

Open the complete URL printed by that command. It includes a private access
token in the fragment. The page keeps the token in this tab's session storage
and removes it from the visible address. Keep that host process running while
using the workspace. Browser approval is the default for its owned commerce
session. **Start purchase review** starts the original buyer; its live HTTP 402
challenge then appears in the approval panel for an explicit decision.

The workspace listens on `127.0.0.1`. It accepts authenticated operator actions
only from its own origin. Keep the console private and use the merchant's
existing public HTTPS ingress for customer requests. The prepared buyer's URL,
request content, payment terms, operator policy and signing configuration stay
in their original files. `--port 0` selects an available local console port.

## Review and execute

The **Prepared operation** selector lists every buyer in the original session,
with its stable intent ID and current inbox state. Changing the selection reads
that exact intent; it does not change another tab's selection or a running
buyer's request.

The request panel shows the actual compiled merchant route's selected payment
option, quoted atomic amount, asset, recipient and offered timeout. It also
shows the buyer's separate atomic spending limit. Request details include the
method, URL, headers, body size, operator, service and signer filename.

1. Select a prepared operation and click **Review operation**. The session runs
   the original SF88 offline review of the inbox's request snapshot.
2. Read the terms and request details. The browser's review token is tied to
   that intent, immutable request/body and current bound merchant option.
3. Click **Start purchase review**. The original commerce engine dispatches the
   original inbox command once and obtains the merchant's live HTTP challenge.
4. Read **Approve this purchase**. Check its exact resource, method, body
   digest, network, asset, recipient, amount and current budget estimate.
5. Click **Approve purchase** or **Reject purchase** for that displayed review. Approval goes
   through the original SF62 review and SF36 fresh reservation before the
   existing signer continues. Follow the original attempt and Delivery panels
   for execution, payment and resource results.

The original engine runs one buyer at a time. Other prepared requests remain
selectable while it works. A page reload reads the existing state and never
starts another attempt. A stale or mismatched review is rejected before
dispatch. The original inbox independently prevents repeating an attempted or
cancelled intent.

In challenge-only mode, review and queued cancellation remain available.
Execution becomes available when the prepared session uses the original native
facilitator and the selected intent is still queued. Native signer setup and
diagnostics remain in the original commerce CLI's `signer INTENT` command and
the [SF103 setup guide](../sf103-native-buyer-signer/README.md).


## Live payment approval

The prepared-operation review and the live approval have different inputs.
**Review operation** reads the retained request and merchant configuration
without a network call. After **Start purchase review**, the original SF31 buyer
reads the actual HTTP 402 challenge. The approval panel displays that exact
accepted option and its native SF62 request digest.

The amount to reserve is the exact quoted atomic amount. The prepared
operation's spending limit is a separate ceiling. Complete accepted terms and
the request/body identity remain available in the review, including Unicode and
provider fields preserved by the original mapper.

| Approval state | What to do |
| --- | --- |
| `AWAITING_OPERATOR` | Read Approve this purchase, then choose Approve purchase or Reject purchase |
| `APPROVING` | Wait for the original reservation result |
| `APPROVED` | Follow the original buyer attempt and delivered resource |
| `REJECTED` | Read the retained rejected attempt |
| `EXPIRED` | Read the original attempt after its review deadline |
| `FAILED` | Inspect the original error and ledger association |

`APPROVED` means the original fresh reservation returned. The buyer's payment
and delivery states continue to come from the original inbox and evidence
pipeline. The current governor policy and budget are checked at reservation,
even if capacity changed after the displayed estimate.

The existing authenticated `POST /api/approval` action takes
`{intent, approvalId, requestSha256, decision}`. Each decision is bound to the
current selected intent, exact approval ID and canonical digest. A stale tab
cannot authorize different terms. After a connection interruption, use
**Refresh approval** to read the current original state. Decision controls
become available only after a fresh successful snapshot of an awaiting review.
A lost decision response is recovered using the same approval identity.

The broker is a private host-selected Unix socket. Its token and the operator's
governor keys stay with the original local processes. The page continues to use
the commerce console's existing capability, origin and request checks.

### Choose the original terminal interface

Choose terminal mode when launching the same prepared session:

```sh
node stellar/scf-starforge-20261009/sf66-demo-launcher/commerce-console.mjs start \
  --directory /private/merchant-session --port 8426 --approval-mode terminal
```

An embedding host can select the same interface explicitly:

```js
import { startCommerceConsole } from './commerce-console.mjs';

const workspace = await startCommerceConsole(session, {
  port: 8426,
  approvalMode: 'TERMINAL',
});
```

In that mode, **Execute operation** starts the original buyer. The SF62 prompt
prints the live terms and requires the
typed `APPROVE <digest>` response through `/dev/tty`. The Applications runtime's
existing terminal pane can carry that original prompt and input. The same
native reservation and buyer execution follow the decision. Omitting the option
selects browser mode; `--approval-mode browser` makes that choice explicit.

## Cancellation, interruption and recovery

**Cancel queued request** calls the original inbox cancellation for the selected
intent before execution. Its permanent cancelled state remains visible after
reopening.

**Reject purchase** applies to a live approval after execution has begun. It ends that
pending approval through the original buyer, and the same inbox attempt retains
its result. **Interrupt this buyer** also revokes that buyer's pending approval
while the original cancellation and cleanup complete.

**Stop session** interrupts this process's active buyer, drains its merchant and
native facilitator, and closes the original operations service in the engine's
own order. The browser stays open so its retained results can still be read.
It cannot stop an unrelated process. SIGINT or SIGTERM in the terminal also
closes the browser listener. A reported incomplete drain remains visible.

For an active streamed purchase, **Interrupt this buyer** signals that original
inbox command and waits for its retained result while the merchant continues
running. The stream panel opens the captured complete prefix after an explicit
partial-content selection.

If an intent is recorded as running or interrupted after reopening, **Recover
recorded result** invokes the original inbox recovery from its existing SF82
evidence. It reads that result without replaying the purchase. Any missing
record or original recovery error is shown directly; the workspace does not
infer settlement from an HTTP status or create a replacement result.

## Use the delivered resource

The result panel retains the original buyer status, HTTP status, reservation
outcome, interruption and error details. Expand **Original operation details**
for the original buyer result. A setup failure remains the original error; an
attempted request stays attempted even if it failed before delivery.

When the original result contains a `responseFile` with status `SAVED`, Delivery
shows its name, byte count, content type and configured saved location:

- **Preview result** reads up to 256 KiB as text, formats complete JSON, and
  labels truncated or binary content. Response content is rendered as text.
- **Download result** returns the saved bytes as a file attachment.

Both actions select a path solely from that intent's original saved result.
The server opens the existing regular file without following a final symlink,
and checks its exact size and SHA-256 before reading or downloading it. The
browser cannot supply a path or overwrite a destination. A missing or changed
file is reported as unavailable. A stream's `FAILED` result with a retained
partial path and digest can be opened through the explicitly selected partial
reader described in [COMMERCE_STREAMS.md](./COMMERCE_STREAMS.md).

Run the same start command to reopen the session. The original inbox supplies
the retained attempts and outcomes, and saved files remain at their configured
destinations. Browser review tokens are deliberately new after a restart;
queued requests need another explicit review before dispatch. An earlier
approval ID belongs to its original buyer operation. Read an attempted or
interrupted purchase through that operation's result and recovery controls.

## Embed in an existing operator host

```js
import { openCommerce } from './commerce.mjs';
import { startCommerceConsole } from './commerce-console.mjs';

const session = await openCommerce('/private/merchant-session');
let workspace;
try {
  workspace = await startCommerceConsole(session, {
    port: 8426,
    approvalMode: 'BROWSER',
  });
  console.log(workspace.operatorUrl);
  // Keep the host's existing foreground lifetime and signal handling here.
} catch (error) {
  await session.close();
  throw error;
}
// In the host's shutdown handler:
// await workspace.close();
```

`startCommerceConsole` returns `server`, `url`, `operatorUrl`, `token` and an
idempotent `close()`. `close()` awaits the original owned session's shutdown and
returns its native drain result, then closes the console listener. The host
should retain and handle that result. The built-in foreground command already
does this for SIGINT/SIGTERM.

Browser mode enables the shared SF81 transport for the owned session's original
buyer children. The saved buyer and operator JSON keep their existing schemas;
the host supplies its private socket configuration separately. The console
owns that broker's shutdown together with its original session.

The console has no additional dependencies or build step. A distribution must
include `commerce-console.mjs`, this guide and the complete `commerce-ui/`
directory alongside the original commerce runtime and its existing dependency
closure. The shared approval component and stylesheet are
`sf81-buyer-operator-bridge/browser-ui/approval-panel.mjs` and
`browser-ui/approval.css`; the console serves them under `/approval-ui/`.
