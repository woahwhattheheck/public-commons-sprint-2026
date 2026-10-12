# ArcGIS publication to a managed seller release

The ArcGIS deployment commands take a reviewed, published extraction from the
original publisher and stage it through the existing SF82 release system.
The seller opens the same version store used by that publication. Source capture,
candidate review, release selection and customer delivery keep their original
identities.

Use the original release console to select, start, stop, restart and roll back
the seller. This adapter does not create another controller or a new dataset
store. Its runtime dependency is the maintained SF82 versioned-dataset release
adapter, including its authenticated loopback dataset control transport.

## Select the published source and merchant

Use Linux, Node 22.16 or newer, and util-linux flock. Set the source root and the
existing private ArcGIS job directory. The job below already contains the
published publisher workspace, its dataset store and its original seller.json.
Use the actual run ID shown by the original publisher status.

~~~sh
export STARFORGE_SOURCE="$(cd /path/to/existing/starforge-source && pwd)"
export ARCGIS_JOB="$(cd ./arcgis-operator && pwd)"
export ARCGIS_RUN="the-existing-published-extraction-id"
umask 077
mkdir -p "$ARCGIS_JOB/deployment" "$ARCGIS_JOB/receiving"

node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  status --workspace "$ARCGIS_JOB/publisher"
~~~

Close the publisher UI or its current CLI owner before opening its workspace
through another process. Export does not start a seller or request a payment.

The selected run must already be PUBLISHED, with its original review bound to the
same candidate and publication snapshot. The merchant file must define one
original GET dataset route with the native dataset query parameters and optional
snapshot parameter. Use the original versioned seller configuration. The
adapter retains its bytes, public origin, route, payment terms and recipient;
the native release compiler checks that its advertised query capabilities match
this dataset.

Export the same published candidate:

~~~sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  deployment-export \
  --workspace "$ARCGIS_JOB/publisher" \
  --run "$ARCGIS_RUN" \
  --seller "$ARCGIS_JOB/seller.json" \
  --out "$ARCGIS_JOB/deployment/package"

node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  deployment-status --package "$ARCGIS_JOB/deployment/package"
~~~

The package contains:

| File | Retained purpose |
| --- | --- |
| dataset.csv | Exact published candidate CSV bytes. |
| dataset.json | Original dataset configuration with its local CSV filename set to dataset.csv. |
| seller.json | Exact original merchant configuration. |
| binding.json | Original absolute version-store path, baseline snapshot and native query-contract binding. |
| source.json | Candidate/publication identity, merchant hash and the complete public GIS receiving declaration. |
| arcgis-receiving.json | Convenient standalone copy of that same receiving declaration. |

The original SF82 stage retains the first five files. The full GIS declaration
therefore remains in its source.json even after the publisher is closed or the
prepared-package copy is retired.

Export copies the CSV in 256 KiB chunks. The original dataset compiler still
loads the dataset to validate its native query contract; use a host sized for
that dataset. The native release accepts CSV input up to 256 MiB, dataset
configuration up to 64 KiB, and each other native package file up to 1 MiB.

Identical export inputs can reopen the same package directory after an
interruption. Complete files are synchronized before publication; interrupted
staging is collected under the package's original kernel lock. An existing
different file is preserved and rejected. Choose a new package directory for a
different candidate or merchant.

## Stage and operate through the existing release console

The ArcGIS stage command calls the original stageRelease function. It initializes
only the release catalog when that catalog does not yet exist.

~~~sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  deployment-stage \
  --package "$ARCGIS_JOB/deployment/package" \
  --releases "$ARCGIS_JOB/deployment/releases" \
  --id arcgis-a --label "ArcGIS published source"

node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs" \
  console --store "$ARCGIS_JOB/deployment/releases" --port 0
~~~

Open the private operator URL printed by the console. Use **Select this release**
for arcgis-a, then **Start selected**. The console retains the original selection
generation and owns the seller process it starts. Open its native health, offers,
documentation and OpenAPI links to see the actual running merchant.

The default deployment runtime is port 0, so the operating system selects an
available local port. Without a facilitator the original seller exposes its
challenge-only mode. To use an existing facilitator, supply --runtime with a
private JSON file containing port and facilitator. An explicitly allowed local
facilitator additionally uses allowLocalFacilitator: true and the literal
http://127.0.0.1 host. The original SF82 runtime normalizer validates these values.

For a stable-port successor, choose an available port and stage a new release ID:

~~~sh
printf '{"port":8461}\n' > "$ARCGIS_JOB/deployment/runtime-b.json"

node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  deployment-stage \
  --package "$ARCGIS_JOB/deployment/package" \
  --releases "$ARCGIS_JOB/deployment/releases" \
  --id arcgis-b --label "ArcGIS stable listener" \
  --runtime "$ARCGIS_JOB/deployment/runtime-b.json"

node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf82-seller-pilot/release-cli.mjs" \
  diff --store "$ARCGIS_JOB/deployment/releases" --from arcgis-a --to arcgis-b
~~~

Refresh the existing console and inspect the difference. Selecting arcgis-b
preserves the running arcgis-a process; the console displays **RESTART REQUIRED**.
Use **Restart selected** to drain the owned seller and start the selected
configuration. The original version writer releases its lease only as that
seller closes.

Use **Select previous release** to return the selection to arcgis-a, then
**Restart selected** to apply that selection. **Stop seller** drains the current
owned process. Close and reopen the same console and release-store directory to
continue the retained catalog and selection.

This is a release-configuration transition when the source package is unchanged.
It does not create a new data edition. A future original publisher refresh can
advance the same version store; the release retains its baseline source identity
while runtime status reports the current version. The original buyer's snapshot
parameter pins the exact retained version it requests.

After an uncertain stage response, repeat the same package, release ID, label
and runtime. The adapter first inspects the original retained release and reuses
it only when all those values match. A changed source or runtime needs a new
release ID. Selection changes remain protected by the original expected
generation; refresh the console after a concurrent change.

## Recover the GIS declaration from the retained release

A receiving operator can recover the exact public declaration after the
original publisher and prepared package are closed:

~~~sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  deployment-receiving \
  --releases "$ARCGIS_JOB/deployment/releases" \
  --id arcgis-a \
  --out "$ARCGIS_JOB/receiving/arcgis-receiving.json"
~~~

This command runs the original release inspection, reads source.json at its
retained hash and checks the candidate, dataset snapshot and merchant binding
before writing the declaration. Use a private receiving output directory; exact
existing output is reusable and a different file is preserved.

Send that public receiving declaration with the original merchant offer and
buyer instructions. The [ArcGIS receiving workflow](README.md#receive-a-usable-esri-featureset)
uses the existing SF88 acquisition and finalized SF100 delivery. Once that
original delivery is complete:

~~~sh
node "$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/arcgis/cli.mjs" \
  receive \
  --delivery /absolute/path/to/original-sf100-delivery \
  --plan "$ARCGIS_JOB/receiving/arcgis-receiving.json" \
  --out "$ARCGIS_JOB/receiving/features.esri.json"
~~~

The receiving declaration and resulting Esri FeatureSet are portable customer
files. Native field definitions, scalar attributes, object IDs, spatial
reference and polygon rings stay unchanged. Payment status belongs to the
original buyer intent and its recorded result.

The seller release package itself includes a private, host-local binding to the
existing dataset directory. Copying that package to another machine does not
migrate or initialize the version store. Preserve the original directory on the
same host for restart and rollback. A new host needs an explicitly prepared
original version store and a new native binding; do not relabel the old absolute
binding or expose that private package as the public GIS download.

## Installed and programmatic use

The maintained installed command is starforge arcgis; arcgis-publisher invokes
the same CLI. Original lifecycle commands remain under starforge releases.
Programmatic consumers import:

~~~js
import {
  exportArcgisDeployment,
  inspectArcgisDeployment,
  stageArcgisDeployment,
  prepareArcgisReleaseReceiving
} from '@tokenjunkielabs/starforge-merchant/seller/arcgis/deployment';
~~~

These functions use the same original publisher, dataset release compiler,
release catalog and receiving implementation as the commands above.
