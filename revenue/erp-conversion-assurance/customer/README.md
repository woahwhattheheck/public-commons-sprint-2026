# Customer installation and complete recovery

This installation gives one approved customer a retained finance reconciliation
workspace. The operator uses the maintained conversion browser to map complete
exports, inspect discrepancies, make a linked correction and record the receiving
review. The same jobs can be authorized for the customer's existing AGX peer.

A complete backup carries the customer's original configuration, mapping profile,
source bundles, retained engines, jobs, attempts, reports, reviewer decisions,
HMAC identity, AGX bindings and saved AGX profiles. Receiving that backup in a new
private directory reopens the complete history.

## Install the customer workspace

Use Linux, Node.js 22.12 or newer, Python 3 and the system `flock` command. The local
browser, retained service and backup implementation use the standard runtime
libraries. The AGX connection uses its existing pinned dependencies.

Keep this source closure together:

- `customer/`, `scap-workspace/`, `service/` and `agx/`;
- the current `reconcile.mjs` and supplied CSV/mapping examples;
- the original SCAP profile imported by the maintained browser;
- `stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs`;
- the repository's `LICENSE`.

Run commands from the repository root. Create a private parent for the customer
installations, then use the approved caller's complete 64-character lowercase
public key. The original AGX `identity show --json` command supplies that
`pubkey`.

```sh
umask 077
install -d -m 700 /absolute/private/customer-installations

node revenue/erp-conversion-assurance/customer/cli.mjs create \
  --directory /absolute/private/customer-installations/example-finance \
  --name "Example finance implementation" \
  --peer APPROVED_CALLER_HEX
```

The installer creates a customer identity, saves the finance comparison profile,
and initializes the original peer-specific service. Its JSON output includes
the customer, saved limits, retained bundles, runs and reviews.

The included finance profile starts with fiscal year, fund and account as the
record key; debits and credits use exact cents. The browser's scope and mapping
controls select the actual export headers, accepted grain, tolerances and
coverage. Supply `--profile /absolute/private/agreed-profile.json` when using
another profile supported by the maintained browser.

On a new installation, the original service's resource limits can be selected
with `--max-input-bytes`, `--max-report-bytes`, `--timeout-ms` and
`--max-heap-mib`. The existing service guide describes their complete-file
behavior. Adoption uses the source customer's saved limits.

## Adopt a retained service

Use adoption when the original customer already has runs, reports, input
revisions or reviewer decisions. The installer copies that complete retained
service into a new customer installation while keeping its original HMAC key
and all file identities.

For an existing AGX provider, select the same approved peer:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs create \
  --directory /absolute/private/customer-installations/customer-received \
  --name "Customer finance implementation" \
  --peer APPROVED_CALLER_HEX \
  --adopt-provider /absolute/private/original-provider \
  --adopt-agx-home /absolute/private/original-provider-agx-home \
  --profile /absolute/private/agreed-profile.json
```

This receives that peer's service and its existing job bindings. The explicit
AGX-home argument receives the original provider identity and profile settings,
so the operator can continue with the same identity. The installer validates
copied bindings against the retained bundles and existing jobs.

For a customer previously operated only through the local service, use
`--adopt-service`:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs create \
  --directory /absolute/private/customer-installations/customer-received \
  --name "Customer finance implementation" \
  --peer APPROVED_CALLER_HEX \
  --adopt-service /absolute/private/original-local-service
```

The selected original service must be idle while its complete snapshot is copied.
Finish the current comparison and save the current mapping or review before
adoption. An active original worker returns `CUSTOMER_COMPARISON_BUSY`; the
operator can retry this same installation after that operation finishes.

The saved `adoption.json` records the original service location and complete
copied file inventory. The source service remains available at its original
location, and the new customer installation has its own native runtime leases.

## Open, review and correct

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs open \
  --directory /absolute/private/customer-installations/customer-received \
  --port 8470
```

Open the complete private workspace URL printed by the maintained browser host.
Its saved customer profile and selected peer service are supplied automatically.
The browser binds to the loopback address; `--port 0` selects an available
port.

Use the original application workflow:

1. Select the comparison cohort and record the real source and target systems,
   conversion owner, coverage and historical period.
2. Load both complete CSV exports. Map every selected key, text and amount field
   to its actual source and target header. Add an approved composite-key
   crosswalk when source codes changed.
3. Stage the complete input release, then start it with a stable job ID.
4. Open the complete result in **Runs & review**. Inspect individual and grouped
   differences, record the reviewer's decision and the applicable scenario
   observations.
5. Use the linked correction workflow for a corrected export or mapping. It
   retains the earlier job and bundle, records the correction reason and starts
   the new release with its own job ID.
6. Record the receiving review against the corrected report and download the
   original per-job replay when that individual run is being delivered.

The original browser guide explains every mapping and review control. Reopening
the customer uses the same directory and returns the same retained history.
The installation's HMAC key keeps record and group identifiers stable across
corrections.

A `FAIL` comparison contains completed business discrepancies. The reviewer
can accept a complete report with documented exceptions; its original result
and exact report bytes remain visible alongside the recorded decision.

For the complete local inventory:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs status \
  --directory /absolute/private/customer-installations/customer-received
```

The status result includes every page of bundles and jobs, all reviewer events,
the saved customer profile and the original service limits.

## Customer controls in the browser

Open **Customer** in the existing application navigation. The panel shows the
complete counts of retained runs, bundles, business reviews and agent requests.
Its paginated run list opens the original comparison and prepares a request
from the selected retained job.

**Create complete backup** starts capture in the background. Transfer history
keeps its original operation, status, archive and receipt. When ready, download
both the complete ZIP and its receipt. The page can be refreshed while capture
continues; it reads the same saved transfer.

To receive that backup on this machine:

1. Choose a new installation name and the complete downloaded ZIP.
2. Enter the original SHA-256 from its receipt when available.
3. Select **Receive customer workspace**.
4. Wait for the full archive and every saved file to be checked.
5. Select **Open restored workspace**, then **Review restored customer**.
6. Open the original runs and confirm their reports, reviews and approved
   agent requests in that received installation.

The host streams the archive into a private receiving directory and validates
the complete original file inventory. Receiving requires a new destination and
the same customer identity. Successful receiving is saved before the restored
browser is opened, so opening it again reuses the received installation.

Transfer files live in the private `customer-transfers-CUSTOMER_UUID` directory
beside the customer installations. This keeps the complete exports and their
receiving records available without nesting older backup ZIPs inside later
customer snapshots. The working customer archive carries all original service,
profile, input, report, review and AGX files. Save its receipt with the ZIP on
the agreed private delivery route.

An interrupted upload or capture remains identified in transfer history. The
original customer directory remains available for work. A completed backup can
also be received with the CLI below on another machine.

## Give the agent access to an existing job

A job prepared in the browser already has its retained source, target, mapping
and engine. Create its AGX request directly from that original job:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs request \
  --directory /absolute/private/customer-installations/customer-received \
  --job conversion-run-2 \
  --out /absolute/private/conversion-run-2.request.json
```

The command verifies the selected job and all retained bundle files, then writes
the original adapter's peer/job/bundle binding and request. It preserves the
job's engine snapshot, including when the deployed application has advanced
since that run. Repeating the same binding reuses it. A matching existing request
file can also be reused.

The caller receives the two-field request containing `jobId` and `bundleId`.
The original handler uses the authenticated caller identity to select this
customer's service and checks that exact binding before returning status or a
report range.

## Configure and run the customer's AGX connection

Install the original pinned packages from their supplied lockfile:

```sh
cd revenue/erp-conversion-assurance/agx
npm ci --ignore-scripts --no-audit --no-fund
cd ../../..
```

The customer `agent` command runs the published AGX CLI 0.3.0 with the customer's
saved private AGX home. Reuse the original provider profile when it was adopted.
For a new provider identity:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs agent \
  --directory /absolute/private/customer-installations/customer-received -- \
  identity new --profile provider --json

node revenue/erp-conversion-assurance/customer/cli.mjs agent \
  --directory /absolute/private/customer-installations/customer-received -- \
  config set relays wss://YOUR_AGREED_RELAY --profile provider

node revenue/erp-conversion-assurance/customer/cli.mjs agent \
  --directory /absolute/private/customer-installations/customer-received -- \
  identity allow APPROVED_CALLER_NPUB --profile provider

node revenue/erp-conversion-assurance/customer/cli.mjs agent \
  --directory /absolute/private/customer-installations/customer-received -- \
  identity show --profile provider --json
```

The allowed `npub` and the customer installation's hexadecimal `peer` identify
the same approved caller. Both parties store the agreed relay in their profiles.
The provider's public identity and the original request are the caller's inputs.

Start the retained provider:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs serve-agent \
  --directory /absolute/private/customer-installations/customer-received \
  --profile provider
```

Its handler, peer bindings and jobs point to this same customer installation.
The existing AGX client follows `finance.reconcile.status` and receives every
digest-bound `finance.report` chunk. The complete original AGX guide provides
the caller's command, report transfer and provider restart workflow.

The caller's request remains valid after restoration because the provider
identity, peer binding, bundle, job and exact report bytes remain in the
customer backup.

## Create the complete customer backup

After the reviewed work is saved and the comparison worker is idle, write the
backup outside the customer directory:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs backup \
  --directory /absolute/private/customer-installations/customer-received \
  --out /absolute/private/customer-finance-20261012.zip \
  > /absolute/private/customer-finance-20261012-receipt.json
```

The archive is created with private permissions. It captures the complete
customer file set and a SHA-256/byte inventory. The original queue and worker
leases are held during capture; changes to other saved files are detected
before the archive is published. The receipt gives its original SHA-256, byte
count, customer identity, captured time and file count.

| Retained content | Purpose |
|---|---|
| Customer configuration and profile | Reopen the same customer and agreed workspace |
| Every staged bundle | Keep the complete original exports, mapping and engine snapshots |
| Jobs and all saved attempts | Continue the original operating history |
| Exact reports and immutable reviews | Keep each decision tied to its delivered report |
| Original HMAC key and service settings | Preserve identifiers, resource limits and original file relationships |
| AGX peer/job/bundle bindings | Reconnect the approved agent to the same retained work |
| Saved AGX home | Continue the provider's existing identity and relay/profile settings |
| Adoption and other retained customer files | Carry the customer's previous receiving context |

The operating system's live queue and worker locks are recreated when the
received workspace opens. Source bundles, attempts and business records keep
their original bytes.

Keep the archive and its receipt on the agreed private customer delivery route.
The complete file includes the authorized exports and the keys needed for
continued operation.

Verify all archive members before delivery:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs verify \
  --archive /absolute/private/customer-finance-20261012.zip \
  --sha256 SHA256_FROM_THE_BACKUP_RECEIPT
```

Verification checks the original archive digest, ZIP CRCs and every recorded
file digest, including complete input and report bytes.

## Receive and reopen on another installation

Use the same maintained application source and a new private destination.
The archive receiver validates its complete inventory before publishing the
received directory:

```sh
node revenue/erp-conversion-assurance/customer/cli.mjs restore \
  --archive /absolute/private/customer-finance-20261012.zip \
  --sha256 SHA256_FROM_THE_BACKUP_RECEIPT \
  --directory /absolute/private/customer-installations/customer-restored

node revenue/erp-conversion-assurance/customer/cli.mjs open \
  --directory /absolute/private/customer-installations/customer-restored
```

Restoration checks the customer identity, original key pin and retained history.
The receiving JSON contains the original backup identity, its capture time and
the full reopened customer inventory. Open the previous reports and reviews,
then use the saved correction relationship or agent request to continue the
same work.

An interrupted or queued original job retains its state. The maintained service
operator provides explicit status, cancellation and recovery for that job.
A completed report opens directly from its original retained bytes.

## Operating messages

| Message | Operator response |
|---|---|
| `CUSTOMER_COMPARISON_BUSY` | Finish the original comparison, then repeat the same backup or adoption. |
| `CUSTOMER_WORKSPACE_BUSY` | Let the current customer operation finish, then reopen or repeat the selected command. |
| `SOURCE_CHANGED_DURING_BACKUP` or `SOURCE_CHANGED_DURING_COPY` | Finish saving the active mapping, review or profile and repeat the same capture. |
| `RESTORE_DESTINATION_EXISTS` | Open that existing installation with `status` or choose a new receiving directory. |
| `ARCHIVE_SHA256_CONFLICT` | Select the archive matching the original backup receipt. |
| `BACKUP_FILE_CHANGED` or `BACKUP_INVENTORY_CONFLICT` | Receive a complete copy of the original archive and verify it again. |
| `CUSTOMER_PROFILE_CHANGED` | Restore the customer's saved profile bytes from its complete backup. |
| `HMAC_KEY_CHANGED` | Restore the original customer's retained key and matching service configuration. |
| `PINNED_AGX_DEPENDENCIES_REQUIRED` | Install the AGX packages with the supplied lockfile command. |
| `JOB_INPUT_CONFLICT` | Open the job's original bundle, or use the new ID for the corrected input release. |

## Customer handoff

Deliver the maintained application source, the complete private customer backup,
its readable receipt and the original browser/AGX operating guides. Walk the
receiving operator through both reviewed runs, their correction relationship,
the saved report decisions and the complete restore command. Open the restored
workspace and use its existing agent request to retrieve that same report.

The original [service guide](../service/README.md),
[browser guide](../scap-workspace/README.md) and [AGX guide](../agx/README.md)
remain the detailed operating references. The application is MIT licensed.


## Operate the complete supplied-export example

The customer operating journey uses every row in the repository's supplied
source and target CSV files. Its initial target has one declared one-cent
difference; the corrected target is the complete original target file. It
operates the maintained browser, records the original requested change, adopts
the retained service and AGX identity, creates the linked correction, receives
both reports through the pinned AGX provider, then downloads and receives the
whole customer backup through the browser.

Install the pinned AGX dependencies as described above. Supply an existing
Chromium executable and the installed Playwright module, then choose a private
output directory:

```sh
ERP_CUSTOMER_BROWSER_EXECUTABLE=/absolute/path/to/chromium \
ERP_CUSTOMER_PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
node revenue/erp-conversion-assurance/customer/native-journey.mjs \
  --out /absolute/private/customer-example
```

The saved `journey.json` names the original jobs, report identities, backup
and receiving operation. Reopening the same output continues that case. Its
private AGX home and delivered reports stay with the case. The final receiving
keeps both original runs and reviews, the retained engines and HMAC identity,
and the approved agent bindings. Desktop and phone captures support operator
review in the selected local output.

## Continue an interrupted transfer

Transfer history keeps the original operation identifier and its completed
files. On reopening, the customer workspace can recover a complete backup from
its archive and receipt, or finish the original receiving from the saved
incoming ZIP. If receiving already published the new directory before its
last status write, the original archive inventory is matched to that directory
and its existing result is reopened.

Choose **Continue saved transfer** when an interrupted operation needs to
finish. A complete incoming archive is verified and received under its original
transfer ID. If the upload stopped early, its partial bytes stay in that
transfer directory and the original upload plan reopens. Reselect the same
complete ZIP, installation name and original digest to finish that plan.
A backup that stopped before publishing its ZIP can finish its original
capture operation from the currently saved customer.

A changed complete archive keeps its actual verification error in transfer
history. A matching upload plan is reused after reopening the browser;
an existing customer directory remains a distinct installation.
