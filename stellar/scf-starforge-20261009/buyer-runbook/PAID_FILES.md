# Receive and acquire a paid file

The buyer runbook receives an original SF101 merchant file-order handoff and
takes it through local buyer preparation, reviewed acquisition, terminal
approval, entitled download and reopening. It uses the same original buyer,
spending ledger, purchase preparation and resumable transfer used by SF101 and
the commerce workspace.

## Start the customer workspace

Use the private operator preset described in
[WORKSPACE.md](WORKSPACE.md#receive-a-private-merchant-request). The preset
selects the local actor, service, payer, Python executable, signer source and
maximum total and daily spending limits. A customer can receive orders using an
empty private configuration directory; preparing an order adds its ordinary SF88
config there.

```sh
node stellar/scf-starforge-20261009/buyer-runbook/cli.mjs workspace \
  --state /private/acquisitions/workspace \
  --configs /private/acquisitions/buyer-configs \
  --operator-settings /private/acquisitions/local-operator.json \
  --claim-envs SF101_CLAIM_TOKEN,REPORT_CLAIM_TOKEN \
  --port 8460
```

Open the printed loopback URL. Keep the process in the original operator terminal
for acquisition approval. The existing parent directories must be canonical
local paths, and the configuration directory must exist with mode `0700`.

The merchant supplies the order handoff and its private claim token through the
agreed customer handoff. Set that token in the corresponding environment variable
of the process starting this workspace. The browser selects an environment
**name** declared by the local launcher. Token values stay in the host environment.
The default declared name is `SF101_CLAIM_TOKEN`; `--claim-envs` declares up to 32
comma-separated names when first opening this paid-file receiving workspace.
Use a separate declared name for each order whose token should remain available
in the same process.

Restart with the same `--state` to reopen. The configuration directory, operator
settings path and claim environment names are retained; their flags can be
omitted. Supply the same host environment when continuing delivery.

## Receive, review and prepare an order

1. Choose **Receive paid file order** and upload the merchant's original
   `stellar-forge.sf101.purchase-handoff.v1` JSON, up to 128 KiB.
2. Review the exact purchase and delivery URLs, merchant order reference,
   network, recipient, asset, atomic amount, file size and SHA-256. **Download
   original handoff** returns the privately retained original bytes.
3. Enter the order's total and daily atomic budget, a plain destination filename
   and one of the declared claim environment names. The daily budget must cover
   the price, fit within the total and stay inside the local operator limits.
   Atomic amounts are exact positive integer strings.
4. Choose **Save order review**. Then choose **Prepare local buyer**. The existing
   native initializer creates this order's operator, signer adapter, policy,
   Governor keys and original SQLite spending ledger. The original SF101
   `preparePurchase` binds the approved order to its purchase URL and header.
5. Choose **Add to acquisition plan**. The ordinary config is available in the
   original source selector. Save and review the draft, then choose
   **Initialize acquisition**.

Each merchant origin and order reference has one retained buyer identity and
one stable native intent. Receiving the same order again reopens that identity.
A changed promise under the same merchant order reference requires reconciliation
with the merchant. Preparation publishes its final source configuration only
after the original operator is complete.

The reviewed order, host settings and budget stay fixed once preparation starts.
If preparation is interrupted, reopen the order and choose **Resume local buyer
setup**. The original initializer resumes its retained inputs, keys and ledger.
A restart after final config publication adopts that same prepared buyer.

## Purchase, retrieve and reopen

Open the initialized acquisition and use the original execution controls. The
existing SF88/SF81 buyer presents the live purchase for approval in the operator
terminal. The runbook retains the attempt and its original result. For an
interrupted attempt, use the existing **Recover retained results** and accounting
controls described in [WORKSPACE.md](WORKSPACE.md).

The paid order row also contains **Customer file**:

- **Retrieve entitled file** asks the original merchant delivery endpoint for this
  order using its selected host claim token. The receiver checks current
  entitlement and source bytes.
- **Pause file transfer** cancels the running request through the original
  transfer engine. Its retained byte count and resumable status appear when the
  transfer pauses.
- **Resume entitled file** continues that same transfer, including the original
  range, validator and final digest checks.
- **Discard partial transfer** uses the native reset operation for a recoverable
  partial. A later retrieve starts from the beginning.
- **Check saved file** reuses the original completed-file recovery path.
  **Download customer file** streams the verified file from the same local
  destination. The download is checked against the promised size and SHA-256.

The acquisition's ordinary response download holds the checkout acknowledgment.
The received product has its own reviewed destination under the order's private
`downloads` directory. Both remain accessible from the same acquisition.

Reopening the workspace lists retained orders, draft revisions and acquisitions.
Select the saved acquisition to continue its attempt, accounting or file delivery.
The prepared source config, order identity, native ledger and completed transfer
stay attached to that order across workspace restarts and plan imports.

## Original state and recovery

Paid-file receiving lives under the workspace's existing
`handoffs/paid-files` directory. Each order retains its merchant handoff, saved
reviews, native operator, prepared config and original transfer artifacts there.
Its published source config is named `paid-file-<order-identity>.json` in the
configuration directory selected when starting the runbook.

The existing **Backup and recovery** workspace includes these received orders and
native operators. Choose the original private parent containing the runbook,
configuration directory and local operator settings, review the complete operator
list and use the original encrypted capture/restore workflow. Receiving,
preparation and file-transfer mutations share the original handoff metadata lease
with that capture.

Keep source configurations and the workspace at their retained canonical paths.
The runbook validates the original config and review bindings before execution or
delivery, and the original spending ledger owns stable-intent accounting.

## Existing local interfaces

The browser uses the same session and origin checks as the rest of the runbook.
Trusted embeddings can use `openRunbookWorkspace` from `workspace-model.mjs`:

| Operation | Model method | Local HTTP endpoint |
| --- | --- | --- |
| Receive original handoff | `receivePaidFile` | `POST /api/paid-files/upload` |
| Inspect received order | `paidFile` | `GET /api/paid-files/:order` |
| Save exact local review | `reviewPaidFile` | `POST /api/paid-files/review` |
| Prepare or resume native buyer | `preparePaidFile` | `POST /api/paid-files/prepare` |
| Retrieve or resume file | `retrievePaidFile` | `POST /api/runs/retrieve-file` |
| Reset original partial | `resetPaidFile` | `POST /api/runs/reset-file-transfer` |
| Download verified product | `downloadPaidFile` | `GET /files/:run/paid-files/:operation` |

Review requests include the expected review revision. Preparation selects the
saved review SHA-256. Transfer actions select the original run ID, operation ID,
frozen config SHA-256 and retained handoff SHA-256. They return the existing
workspace task identity, and the normal run status and cancel endpoints track
the operation.

