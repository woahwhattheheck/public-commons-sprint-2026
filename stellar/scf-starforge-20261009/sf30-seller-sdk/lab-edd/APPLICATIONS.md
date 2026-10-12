# Laboratory EDD in Applications

Operate the complete Laboratory EDD product through the original Merchant Workspace.
The **Laboratory EDD** catalog entry opens the original paid-job service with the
installed laboratory application, exact source/configuration review, saved customer
inputs, native output files and its existing Stop/reopen lifecycle.

The product includes three source profiles: the complete EQuIS three-file family,
the EQuIS four-file family, and the Geotech DTS8D workbook. It retains every
physical source record, related sample/test/batch record, limit, qualifier and
source cell. Cross-profile receiving keeps each file family's native identities,
presents candidate correspondence, and saves explicit pair/separate/defer choices
alongside independent field decisions for both sources.

## Install the selected product

Use the maintained `laboratory-edd` source selection in
[the complete installed-product guide](../../distribution/selections/LABORATORY_EDD.md).
It supplies the original Runtime workspace, paid-job merchant, sealed-file intake,
customer checkout, result receiver, merchant tools, complete Lab source and examples.

Linux, Node 24, Python 3.11 or later, npm and `flock` cover the selected installer,
worker, SQLite and native workbook path. Select the original `schema` and `mcp`
features, native Stellar dependencies and operator support in the runtime profile.
Use the installation's retained profile and dependency lock; the workbook bridge
uses the original Python standard-library reader. Its process manager owns Python
execution and cancellation.

## Prepare the actual merchant configuration

Choose the actual public HTTPS origin, Stellar network, asset, recipient and
atomic payment amount. The command reads the installed complete Lab template,
selects its real application path, runs the original job compiler and writes
one new private configuration:

```sh
starforge lab-edd merchant-config \
  --origin https://YOUR_PUBLIC_MERCHANT_ORIGIN \
  --network stellar:testnet \
  --asset ACTUAL_ASSET --pay-to ACTUAL_RECIPIENT \
  --amount ATOMIC_AMOUNT --out /private/laboratory/config/merchant.json
```

Replace each capitalized value with the selected service's actual value. The
command rejects the example asset/recipient tokens. `amount` is an integer
string in the asset's atomic units. Use the chosen actual network rather than
changing it during an existing job. Optional `--service-name` and
`--memory-limit-mb` retain the original compiler's constraints. Default worker
memory is 768 MiB; the example full cross-profile operation returns a complete
8.8 MB archive containing 125 MB of retained logical members.

The JSON keeps all five sealed input slots, complete function schema, byte-result
contract and supported source profiles. It records the actual selected payment;
the configuration command itself prepares source. An existing output path is a
separate retained edition: select a new filename for an intentional change.

The same operation is available to installed Node applications:

```js
import { writeLabMerchantConfiguration } from
  '@tokenjunkielabs/starforge-merchant/seller/lab-edd/merchant-configuration';

const saved = await writeLabMerchantConfiguration({
  file: '/private/laboratory/config/merchant.json',
  publicOrigin: selectedHttpsOrigin,
  payment: {
    scheme: 'exact',
    network: selectedNetwork,
    asset: selectedAsset,
    payTo: selectedRecipient,
    amount: selectedAtomicAmount,
    maxTimeoutSeconds: 60
  }
});
console.log(saved.path, saved.configurationSha256);
```

Create the original private environment JSON used by Applications. Select an
existing absolute Python interpreter and private scratch parents; the native
factory reads the selected HTTPS facilitator URL:

```json
{
  "SF_JOBS_FACILITATOR_URL": "https://ACTUAL_FACILITATOR_HOST",
  "LAB_EDD_PYTHON": "/absolute/python3",
  "LAB_EDD_TEMP_ROOT": "/private/laboratory/workbook-scratch",
  "SF30_JOB_TEMP": "/private/laboratory/job-scratch"
}
```

Keep that JSON and service state private. The native factory is the installed
original `sf30-seller-sdk/jobs/native-runtime.example.mjs`. It constructs the
original HTTP facilitator client and native seller. Use the original job service
deployment with the selected public origin; its local seller port is the upstream
for that deployment.

## Review, save and run

Attach the complete READY installation to the existing Runtime workspace. In
**Applications**, choose **Laboratory EDD** and that attached installation.

| Setting | Selected value and behavior |
| --- | --- |
| Laboratory merchant configuration | The private complete JSON produced above |
| State directory | One private original job-service directory |
| Native factory | The installed original `jobs/native-runtime.example.mjs` |
| Environment file | The selected private environment JSON |
| Port, seller/customer/operations ports | Zero selects available local ports; nonzero ports must be distinct |
| Start worker | Enables the original worker for the same saved service |
| Landing | Inputs, Jobs or Resolutions; Deliveries when its configuration is selected |
| Result delivery configuration/directory | Optional existing original result-delivery settings and storage |

Choose **Review**. Check the selected configuration, actual payment, all five
file slots, installed source paths and resource directory. **Save** retains that
configuration revision. Use the original **Connect**, start review and **Start**
controls, then **Open** for the accepted current instance.

The Lab catalog adds its complete source checks to the existing paid-job
preparation. The original paid-job provider owns the resulting `jobs serve`
request, private launch record, authenticated startup, resource lease, process
group, Stop and reopen. Selecting the same state through the generic paid-job
catalog therefore reaches the same original resource ownership.

The review pins the installed laboratory application, all runtime model/profile/
editor/workbook leaves and the original workbook reader. Configuration source,
application source and any selected intake/delivery/native-factory files retain
the existing job service source binding. A changed selected file requires a new
original review before launch.

[applications.example.json](applications.example.json) is the actual
`runtime-workspace application-review` request shape. Replace its attached
runtime ID and absolute paths. The original CLI supports the same workflow:

```sh
starforge runtime-workspace application-review \
  --workspace /private/runtime-desk --request /private/laboratory/application-review.json
starforge runtime-workspace application-save \
  --workspace /private/runtime-desk --request /private/laboratory/application-save.json
starforge runtime-workspace application-start-review \
  --workspace /private/runtime-desk --application-id SAVED_APPLICATION_ID
starforge runtime-workspace application-start \
  --workspace /private/runtime-desk --request /private/laboratory/application-start.json
```

Use the returned original IDs. Save takes
`{"requestId":"NEW_REQUEST_ID","reviewId":"RETURNED_REVIEW_ID"}`.
Start takes
`{"applicationId":"SAVED_APPLICATION_ID","requestId":"NEW_REQUEST_ID","reviewId":"RETURNED_START_REVIEW_ID"}`.
The existing Runtime workspace guide documents those native request identities,
history, recovery and output controls.

## Receive a complete laboratory job

The **Inputs** desk is the original sealed-file receiving flow. Select the
`laboratoryReview` function, its input JSON and the original file family. Sealing
binds filename, media type, byte count, SHA-256, upload claim and function policy.
Retain the resulting original request/job identity through checkout and receipt
recovery.

| File slot | Complete content |
| --- | --- |
| `source` | Required original CSV-family ZIP or native DTS workbook, up to 16 MiB |
| `baseline` | Optional complete previous or different-profile source, up to 16 MiB |
| `decisions` | Current-source JSON or complete editable CSV/TSV field decisions, up to 4 MiB |
| `baseline_decisions` | Independent baseline field decisions, up to 4 MiB |
| `reconciliation` | Source-bound cross-profile correspondence JSON/CSV/TSV, up to 16 MiB |

The combined file policy permits 56 MiB. Function parameters select the actual
source profile, stable review name, optional baseline profile, encodings, expected
source hashes and decision formats. [input.example.json](input.example.json)
shows the ordinary input. The complete
[cross-profile guide](RECONCILIATION.md) supplies the two-source parameters and
saved correspondence.

Review the retained native payment offer in the original customer checkout.
Its existing Buyer approval/signing and merchant receipt flow start the same
prepared job. The worker reads the sealed originals through its file interface;
the Python workbook path uses its owned process interface. The original Jobs,
Inputs and Resolutions desks retain progress, result or exception state.

Download the complete result ZIP through the original customer result link.
Open `report.html`, or the complete `reconciliation.html` for a
cross-profile job, after extracting the verified archive into a private directory.
The archive contains the exact original files, complete source/review JSON,
editable decision tables, native prepared files and all required editor assets.
The correspondence editor links directly to original rows in either source's
field editor.

For DTS8D, unresolved formulas/errors or incompatible native header layout remain
visible in the downloadable source review and `native-preparation.json`.
Choose explicit literal field decisions and rerun the same source as a new
review to prepare native XLSX. Its writer retains all unchanged source ZIP
parts and cells, native epoch, row positions, source headers and workbook
metadata. EQuIS retains the complete CSV family and related original identities.

## Reissue and independent receiving

Export JSON or the full editable CSV/TSV decision table. Keep leaves the native
value intact; Set and Clear retain the exact source value and reason. Submit a
new original review with the same source and that saved document. For a reissue,
select the complete baseline and its actual profile; keep its decisions separate.
Source-bound correspondence preserves every unresolved or deliberately separate
record while approved links connect the selected original entities.

Use the installed result reader to reopen the complete returned archive:

```sh
starforge lab-edd result --file /private/received/laboratory-edd-receiving.zip \
  --out /private/received/reopened-result.json
```

It verifies members, both source families where present, native output archives,
full source/review bindings and the recomputed correspondence. The original
**Job result receiver** Application can receive and reopen completed paid-job
results into its own private directory using the existing result-delivery
configuration and receipt route.

Use **Stop** on the saved Lab application and wait for its original close.
Fresh Start reuses its selected state, configuration revision and source binding.
Open uses the newly authenticated instance. Jobs and sealed inputs persist in
that original state directory. A source/configuration change follows a new
reviewed revision; the retained previous operation stays readable.

## Complete receiving sources and examples

[RECEIVING.md](RECEIVING.md) and the maintained `lab-edd-receive` command cover
the original file-upload policy, sealed worker, replay, original native files,
portable result reopening, operator browser and process timeout/retirement.
The same configured operation can select EQuIS3, EQuIS4, DTS8D and cross-profile
families.

The product includes both original public McCampbell archives, full source
receipts, complete model result and all executable receiving programs.
[The cross-profile companion](examples/mccampbell/CROSS_PROFILE.md) links its
complete 37-member result ZIP: 8,829,090 bytes, SHA-256
`721a8d4a7a236179c6821e4a1100439003eeebedddc9e28a4825b2d368dfbe6b`.
The installed generator and original inputs reproduce that full artifact.
The source-result report records its actual execution environment and retained
original data identities.
