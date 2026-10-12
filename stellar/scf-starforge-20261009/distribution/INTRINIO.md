# Installed Intrinio statement review

Use `starforge intrinio` to open the retained Intrinio application from the
maintained merchant package. It delegates to the original SF30 Python workspace:
source revisions, review decisions, previews, release history and complete
export/import stay in that workspace.

The [application guide](../sf30-seller-sdk/intrinio/README.md) documents every
source, review, comparison and selection format. This guide covers the installed
entry points and a complete receiving handover.

## Select the installed source

Use Node 22.16 or later and Python 3.11 or later with the existing supported
merchant runtime. Run commands from the application directory where that package
is installed:

```sh
npx --no-install starforge registrations --source intrinio
npx --no-install starforge intrinio --help
```

The registration identifies the original command, exported module and selected
archive source. An older archive without this registration needs the following
maintained release; editing an installed archive's manifest is not an upgrade.

The package includes all Intrinio Python modules, original acquisition code,
declarations and local browser assets. Reviewing retained input uses the selected
Python interpreter and its standard library. Live acquisition separately uses the
original Intrinio Python SDK. A provider account, wallet or paid seller is not
created when this application opens.

## Create and open a private workspace

Choose a new private directory outside the installed package. Its parent must
already exist. Keep the same absolute path when reopening:

```sh
npx --no-install starforge intrinio create \
  --workspace /private/intrinio-review --label "Fundamentals review"
npx --no-install starforge intrinio serve --workspace /private/intrinio-review
```

Open the printed `operatorUrl`. The source, statements, comparisons and customer
exports use this one private browser. The header also opens the original native
authoring/release interface. The full local URL contains the existing workspace
access token in its fragment; keep it private. Stop the original foreground
process with Ctrl-C, then use the same `serve` command to reopen.

Use `create --python /absolute/path/to/python3` when the selected interpreter
differs from the machine default. It becomes an ordinary source declaration
revision. The original **Refresh source** action reloads the selected declaration,
including that declaration's interpreter setting.

The supplied declaration has explicitly unverified demo payment terms for private
previews. A deployed seller uses the operator's actual approved service origin,
network, asset, recipient, atomic prices and data rights through the native
release interface. These terms are not an Intrinio tariff.

## Retain original input and import it

Locate the collector beside the actual installed opening module:

```sh
INTRINIO_SOURCE="$(node --input-type=module -e \
  'import { APPLICATION_DIRECTORY } from "@tokenjunkielabs/starforge-merchant/seller/intrinio/workspace"; console.log(APPLICATION_DIRECTORY)')"
python3 "$INTRINIO_SOURCE/acquisition.py" --help
```

For already retained complete response files, use the source owner's supplied
import manifest. This command makes no provider request:

```sh
python3 "$INTRINIO_SOURCE/acquisition.py" import \
  --manifest /private/retained-import.json --out /private/intrinio-capture
```

For an authorized account acquisition, select the original SDK 7.2.0 runtime,
edit the included `example-acquisition-plan.json` for the intended operations and
use the customer's existing API-key environment variable:

```sh
python3 "$INTRINIO_SOURCE/acquisition.py" collect \
  --plan /private/acquisition-plan.json --out /private/intrinio-capture \
  --api-key-env INTRINIO_API_KEY --timeout 30
```

The argument is the environment variable's name, never its value. The collector
retains original response bytes and acquisition metadata before the application
imports them. It records the actual SDK version and the original source contract.
Its returned status, pagination coverage and partition requirement determine
whether acquisition is complete. Exit 2 preserves incomplete or partitioned
capture; Ctrl-C preserves the same acquisition ledger for explicit continuation.
Reissue the same selected command and directory to resume that capture. A changed
request plan is a different source acquisition.

Do not turn an SDK model serialization into a claimed original HTTP response.
The collector preserves the raw numeric tokens through its original SDK raw-body
boundary. A documentation sample remains a documentation sample; absent
pagination fields remain absent.

Import the completed source manifest and all of its original response members
into the selected application:

```sh
npx --no-install starforge intrinio import-capture \
  --workspace /private/intrinio-review \
  --manifest /private/intrinio-capture/workspace.json \
  --actor "Operator name" --operation receive-original-capture
npx --no-install starforge intrinio state --workspace /private/intrinio-review
```

The browser's **Sources** import accepts the same complete capture. Retain its
response files, metadata and original source references together. The application
verifies byte counts and hashes, preserves native company/filing/fundamental
identities, and saves the original source revision. Repeating an identical
capture preserves the existing import and intervening review edits.

## Review, compare and deliver a customer selection

Use the same browser to select the exact edition, inspect full fact pages, save
named review decisions, compare actual source editions and map the selected rows
to customer columns. Reported and standardized facts remain distinct. Dimensions
are separate facts; overlapping contexts must not be silently added together.

A changed source head requires review or explicit rebase in the existing
application. Saved customer selections remain bound to their original rows and
review revision. The application guide contains the exact command-file formats
for terminal operation:

```sh
npx --no-install starforge intrinio review \
  --workspace /private/intrinio-review --command /private/review.json
npx --no-install starforge intrinio select \
  --workspace /private/intrinio-review --command /private/customer-selection.json
npx --no-install starforge intrinio export-selection \
  --workspace /private/intrinio-review --selection SAVED_SELECTION_ID \
  --format csv --out /private/customer-statement.csv
```

Select the returned native selection ID. Exports also support `json` and `html`;
each destination must be new. The returned original preview status, output
length, digest and preview ID identify the saved result. A noncompleted native
preview remains visible for inspection rather than being presented as a
completed statement. These exports do not start a paid seller.

## Hand over and reopen the complete workspace

A customer extract contains the chosen result. To hand over the whole application
state, export the original workspace with its retained source, reviews, previews
and native history:

```sh
npx --no-install starforge intrinio export-workspace \
  --workspace /private/intrinio-review --out /private/intrinio-review-export.json
```

Deliver the original selected merchant archive and its source/digest identity,
this complete workspace export, the actual runtime prerequisites and the
operator's permitted source files. Preserve private custody where required by
the provider's data terms. On the receiving machine, install the selected
maintained package using its existing installer, then import into a new directory:

```sh
npx --no-install starforge intrinio import-workspace \
  --workspace /private/intrinio-received --bundle /private/intrinio-review-export.json
npx --no-install starforge intrinio state --workspace /private/intrinio-received
npx --no-install starforge intrinio serve --workspace /private/intrinio-received
```

Receiving uses the original export/import format. Keep the retained workspace
outside `node_modules`; select a following package separately when upgrading.
Review any original host/interpreter bindings through the native source interface.
Do not automatically replace a populated receiving directory or initialize over
an existing workspace.

## JavaScript opening API

The explicit package module exposes the actual application:

```js
import {
  IntrinioWorkspace,
  createIntrinioWorkspace,
  openIntrinioWorkspace,
  importIntrinioWorkspace,
  startIntrinioWorkspace,
} from '@tokenjunkielabs/starforge-merchant/seller/intrinio/workspace';
```

The same five names are also available from the package root. The explicit
subpath selects this application without loading unrelated product entry points.

| Interface | Original operation |
| --- | --- |
| `createIntrinioWorkspace(directory, {config, python, label})` | Create one new native workspace and select its complete Intrinio declaration. |
| `openIntrinioWorkspace(directory)` | Open and validate the existing retained source revision. |
| `importIntrinioWorkspace(directory, bundle)` | Receive the original native export into a new directory. |
| `startIntrinioWorkspace(directory, {port: 0})` | Open the original loopback application and return its private URLs and lifecycle. |
| `IntrinioWorkspace` | The existing application composition over the native Python workspace. |

Always close the returned workspace or server. A read and portable export use
the existing object directly:

```js
const workspace = await openIntrinioWorkspace('/private/intrinio-review');
try {
  const state = await workspace.state();
  console.log({
    sourceRevision: state.revision.id,
    historical: state.historical,
    editions: Object.keys(state.index.editions),
  });
  const exported = await workspace.exportWorkspace('/private/new-review-export.json');
  console.log(exported);
} finally {
  await workspace.close();
}
```

An embedded server owns the original native listener lifecycle. Use its printed
private URL and close it on the application's own shutdown:

```js
const server = await startIntrinioWorkspace('/private/intrinio-review', {port: 0});
let closing;
const close = () => (closing ??= server.close());
process.once('SIGINT', close);
process.once('SIGTERM', close);
try {
  console.log(server.operatorUrl);
  await server.closed;
} finally {
  process.removeListener('SIGINT', close);
  process.removeListener('SIGTERM', close);
  await close();
}
```

The original preview, cancellation, source compare-and-save, output and release
APIs remain available through `workspace.native`. Their status and operation
identities are authoritative. The installed command forwards arguments and
signals to the original CLI; no additional queue or execution service is added.
