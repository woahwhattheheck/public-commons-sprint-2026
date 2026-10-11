# Starforge Buyer for n8n

A customer can receive an actual merchant request in n8n, retain it in the
original buyer inbox, review its exact terms, hand one selected intent to the
original operator terminal, and resume that intent to obtain verified data and
financial history.

This package uses the installed SF88 Node Buyer and Inbox. The operator profile,
terminal approval, signer, native request/attempt, response capture, evidence
recovery and original ledger remain the existing implementations. Node
operations act on the configured existing workspace.

## Install into the existing self-hosted n8n

Use Node 22 or newer, an existing n8n installation, and the matching complete
Starforge merchant distribution. The node needs local filesystem access to that
distribution and the private buyer directories under the same operating-system
user. A hosted n8n environment without those local capabilities cannot run this
native node.

The package contains executable CommonJS node and credential files; it needs no
TypeScript compilation or browser installation. From this directory, create
the ordinary npm package:

~~~sh
npm pack --ignore-scripts
~~~

Install the resulting tarball into the existing n8n community-node directory,
using that instance's normal package installation procedure. For an installation
that uses a private `~/.n8n/nodes` directory:

~~~sh
cd /absolute/existing/n8n-user/.n8n/nodes
npm install --ignore-scripts --omit=dev /absolute/path/n8n-nodes-starforge-buyer-0.1.1.tgz
~~~

Keep the `n8n-workflow` peer compatible with the installed engine and restart
that instance after installation. For a container, add the node through the
existing image/custom-node deployment and mount the original runtime and private
directories at the paths used by both n8n and the operator terminal. Use the
maintained complete merchant release; SF88's CLI requires its original
dependency closure.

The merchant distribution includes this source directory under its SF88
component. Its cumulative release owner registers the workflow command and
package metadata. The npm tarball is this n8n extension, with no separate
merchant-distribution builder.

## Connect one original buyer workspace

Create a **Starforge Buyer Workspace** credential in n8n. Its fields are paths
and command settings, not signer secrets:

| Field | Value |
|---|---|
| Original SF88 Runtime Directory | Absolute installed directory containing `cli.mjs` and `node/index.mjs` |
| Existing Node Application State | The original private Node buyer state directory |
| Existing Native Inbox | The original private inbox containing `inbox.json` and `jobs/` |
| Original Operator Profile File | Existing private profile for packet intake when no workspace is selected |
| Original Operator Workspace | Existing workspace used by packet intake, the terminal command and financial finalizer |
| Original Merchant Outbox | Optional existing outbox for the selected merchant finalization route |
| Private Report Directory | Optional existing private report folder; otherwise the Node state holds reports |
| Native Command Timeout | Original command timeout, default 360,000 ms |

State and inbox must already exist, be private and belong to the process user.
Use canonical paths. The node does not initialize an inbox when a path is
missing. When setting up a new customer, use the maintained Node customer CLI's
`inbox-init` and original operator provisioning, then configure those paths.
Keep writers stopped during a whole-workspace snapshot or restore through the
existing recovery workflow in the selected runtime's `node/RECOVERY.md`.

When an operator workspace is selected, packet intake uses the native importer
and `Buyer.fromWorkspace` to preserve that workspace's operator, signer, policy,
ledger and evidence directory. The selected workspace takes precedence over a
profile file. Use a complete runtime with the maintained `fromWorkspace` API;
an older runtime returns `ORIGINAL_WORKSPACE_BUYER_RUNTIME_REQUIRED` before intake.

Without a workspace, the original operator profile supplies the operator and
signer through `Buyer.fromOperationHandoff`. An imported merchant packet cannot
replace either configuration. **Enqueue Original Configuration** retains the
configuration file's own settings and applies no profile or workspace override.

Version 0.1.1 corrects workspace binding for newly imported handoffs. Existing
prepared requests keep their original configuration and intent; this update
does not rewrite them. Inspect their native operator and evidence binding before
choosing an original continuation. Changing the credential does not migrate a
retained job to another workspace.

## Import the complete customer workflow

Generate a new private directory of six inactive workflow JSON files:

~~~sh
node workflow.mjs --output /absolute/new/starforge-n8n-workflows \
  --credential-id EXISTING_N8N_CREDENTIAL_ID \
  --credential-name "Original Starforge buyer workspace" \
  --format binary
~~~

Select the credential in each node after import if its existing ID was omitted.
The manifest describes the package and is not a workflow. The generator accepts
`--intent` for a saved request and `--format json|csv|ndjson|sse`. **Select original
intent** is otherwise blank: paste the ID actually returned by intake into that
node.

| File | Purpose |
|---|---|
| `01_merchant_packet_intake.json` | Actual packet and an explicit offered-option index into the original inbox |
| `02_review_operator_handoff.json` | Native review and the operator's exact command |
| `03_read_verified_response.json` | Same-intent verified response after native execution |
| `04_recover_existing_attempt.json` | Explicit evidence recovery and retained response lookup |
| `05_finalize_and_export_history.json` | Original reservation finalization and private HTML history |
| `06_resume_prepared_intake.json` | Complete an interrupted enqueue of the original saved Node operation |

Connect intake to the customer's existing private n8n route or authenticated
trigger. Its POST JSON body contains `packet`, the complete actual exported
native operation-handoff object or its original JSON text, and a numeric
`acceptIndex` selected from **Inspect Merchant Handoff**.

The importer retains the selected offered tuple's amount, asset, network and
recipient. It does not accept an overridden tuple. The webhook acknowledgment
returns only the retained intent, state and packet digest. Full original
operator paths and review remain in the private n8n execution.

A node may instead take a packet from an existing private file or an n8n binary
field. Binary input preserves the original packet bytes. JSON values preserve
native embedded file hashes, body and ticket through the original importer.
Incoming attachments and native review handoffs are retained under
`n8n-packets/` and `n8n-reviews/` inside the existing Node state. These are
immutable input and review files; the original inbox owns the job and attempt.

## Review, execute and reopen

Run workflow 02 for the retained intent. Its result includes the native review,
current job, configuration/body/ticket hashes, private review file, and
`operatorHandoff.program`, `argv` and a quoted POSIX command.

Run that command in the original operator terminal with its existing profile
and workspace. It invokes `node/examples/customer.mjs inbox-execute
--review-file` against the same inbox and intent. Original terminal approval and
policy checks precede the permanent attempt. The node has no headless purchase
action. An attempted or cancelled job returns its native state without a new
execution command.

Run workflow 03 with that same intent. It opens the saved response without
another merchant request. An unavailable original response returns
`responseAvailable: false` and the current job.

If packet import completed but its enqueue response was interrupted, keep the
original intent. Use **Show Request** and workflow 06 to complete the prepared
intake. A repeated import does not replace an existing Node operation: the native
`INTENT_ALREADY_EXISTS_USE_RECOVER` result identifies the retained intent.
Changed bytes or another inbox cannot replace its assignment.

Workflow 04 calls original evidence recovery for an existing attempt. Workflow
05 explicitly continues its original reservation through the selected workspace
and can read providers or update the original financial ledger. For an original
merchant outbox, set its matching **Merchant Route**. A download and the
finalizer's outcome remain separate fields.

## Use verified binary and structured data

Every result retains the original `native` job or report. A native command's
current `process` status remains separate from the historical buyer outcome.
Response items include the original summary, delivery metadata and stream facts;
they add no historical-process `ok` flag.

- **Binary File** uses original verified `bytes()` and returns an n8n binary
  property, default `data`, for an existing receiving file or API node.
- **JSON Value** returns the original decoded value in `json.data`.
- **CSV Records** returns `json.records` and `recordCount`. The original CSV
  parser retains decimal text, headers, quoted fields and row values. Use n8n's
  Split Out node downstream when a receiving route wants one item per row.
- **NDJSON Records** and **SSE Events** reuse the original SF31 stream codec.
  Partial mode is explicit and preserves the native partial-file digest and
  complete-record boundary.

The adapter exhausts native verification before returning an item. Defaults
are an 8 MiB read limit and 10,000 records. These are n8n consumption limits,
separate from saved capture limits and financial authorization. Larger responses
remain in the original inbox for the maintained streaming CLI. An explicit n8n
read limit can be set up to 64 MiB.

**Export Native History** returns the original private HTML report as a binary
download. Reports use a new filename per execution unless specified. Existing
files are never replaced.

On error, context retains the typed native code, original intent and available
native/process observation. **Continue On Fail** emits those fields as an item.
Private native logs and bearer ticket bytes are not embedded in error messages.
Generated workflows disable automatic node retries. Choose the original
continuation according to the actual saved state.

## Source and engine compatibility

The package follows n8n's programmatic node interface and binary helpers. Its
manifest registers the executable node and credential. The original Node buyer
is imported from the configured installed runtime; there is no copied SDK,
response parser, queue, signer or ledger.

Official references:

- https://docs.n8n.io/connect/create-nodes/build-your-node/tutorial-build-a-programmatic-style-node/
- https://docs.n8n.io/connect/create-nodes/deploy-your-node/install-private-nodes/
- https://github.com/n8n-io/n8n-nodes-starter

The installation page includes historical Docker examples; this package
requires the existing engine and the native buyer's Node 22+ runtime. Keep
original state, profile files and raw merchant packets private.
