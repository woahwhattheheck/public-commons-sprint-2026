# Complete native QWC customer receiving

The original native journey joins the complete publisher, the original saved
QGIS editions, the independent QWC acceptance operator, and the portable
recipient. It calls the maintained product interfaces throughout and keeps one
customer operation and one original native job lifetime.

The selected host supplies its existing QGIS Python, QGIS Server, QWC
ConfigGenerator and ConfigDB, original viewer and service routes, and original
role sessions. The journey publishes two actual saved map editions, captures
each while deployed, restores the first edition, and operates both receiving
applications over those exact results.

## Original source and runtime selection

Keep these complete source directories from the same published source cut:

- stac/qwc/: native publisher, host/source model, console, CLI, this guide and
  the two native journey files.
- stac/qgis/: the original QGIS workspace, archive receiver, native project
  reader, plugin and selected vector adapters.
- stac/qwc-acceptance/: original publication-plan adapter, actual service
  collector, browser operator, native capture/finish driver and complete static
  files.

The original base distribution includes the entire sf30-seller-sdk component.
The stac-qwc contribution adds its installed command, Applications entry and
exact browser asset map. Keep the published distribution manifest with an
installed package; the native receiving input also records the full files and
SHA-256 values of all three directories.

The joined original interfaces are:

| Source owner | Exact interface used |
| --- | --- |
| Original QGIS workspace | QgisWorkspace.export_package, receive_package and original native map verification |
| QWC publisher | QwcWorkspace.create, prepare, publish, inspect and rollback |
| Original ConfigGenerator | Actual ConfigGenerator.write_configs and write_permissions under the retained host input/environment |
| Independent acceptance operator | native_journey.py capture for each deployed edition; native_journey.py finish for the complete operator and portable receiving |
| Original publisher browser | Native console, retained jobs, streaming export/download/upload, original receiving and actual QGIS reopen |
| Portable publisher receiver | Original whole archive preflight, original GIS receive, exact native project read and a new received-console instance |

The independent acceptance source was integrated at
PR1991 / 1648a78c73649532ca3be33c5ba1c4dedef6cc61. Its complete native driver is
92aaaeb95fdb88ee37a24634995fde2bc0154a1b and its operating guide is
e6223c8e03848a1921a71aaadf091cf6e97cb154. The producer consumes the complete
saved-project/vector source from QGIS PR1955 /
07f4140edbd01ceb32b01507995db11d6f0d514b. Later source selections must carry
their full compatible original directories together.

Use an actual existing operator Python 3.11 or later, native QGIS Python,
native ConfigGenerator Python and software, Node 22.16 or later, and the
existing Playwright module and Chromium executable. The browser helper imports
that selected Playwright module directly. It installs no browser or dependency.

## Select the original saved GIS editions and host

Prepare the actual original and refreshed QGIS projects through the original
QGIS application. Each publication request selects its complete saved workspace,
the exact currently displayed revision, and an original retained project ID.

Both requests use the same customer operationId and actor, and distinct
requestId values. The second request selects the actual saved GIS refresh.
Original workspaces can be separately received copies of those full original
editions. Keep their real source history and native paths.

The native host profile follows README.md and
PUBLICATION_CONTRACT.md. Select the existing input, viewer, generated tenant
configuration and QGIS resource directories; original ConfigGenerator src
directory and working directory; the actual Python executables; exact theme
JSON pointer; and actual viewer/OWS URLs.

The native ConfigGenerator source root contains
config_generator/config_generator.py. Its source configuration must select
.qgz projects. The original ConfigDB remains authoritative for users, groups,
roles and publication permissions. Configure the selected new map resource
through that host's existing QWC administration workflow. Retain its actual
permissions_default_allow value in the host profile.

The publisher prepares stable native WMS names from the original layer IDs.
The original profile and actual saved project/layout selection determine the
service requests; GetProjectSettings supplies the native layout and ComposerMap
names. The complete acceptance profile describes the real selected extent,
CRS, image size, query pixel, fields and print layout for each edition.

Keep any existing role headers in their selected private environment variables.
Publication and review files carry those environment names and the original
nonsecret principal references. The native collector resolves those exact
existing sessions when a selected request needs transport.

## Create the complete journey config

Create one private UTF-8 config with absolute paths:

~~~json
{
  "schema": "starforge.stac-qwc-publication-native-journey.v1",
  "operationId": "SOURCEPOLE-STAC-QWC-CUSTOMER-DELIVERY-20261012",
  "actor": "THE_ORIGINAL_SELECTED_OPERATOR",
  "title": "Sourcepole native QWC publication and receiving",
  "directory": "/absolute/private/original-qwc-customer",
  "workspace": "/absolute/private/original-qwc-publisher",
  "profile": "/absolute/private/original-qwc-host-profile.json",
  "editions": [
    {
      "id": "original-edition",
      "request": "/absolute/private/original-publication-request.json",
      "reviewProfile": "/absolute/private/original-native-review-profile.json"
    },
    {
      "id": "refreshed-edition",
      "request": "/absolute/private/refreshed-publication-request.json",
      "reviewProfile": "/absolute/private/refreshed-native-review-profile.json"
    }
  ],
  "browser": {
    "node": "/absolute/existing/node",
    "playwrightModule": "/absolute/existing/playwright/index.mjs",
    "chrome": "/absolute/existing/chrome-headless-shell"
  },
  "browserTimeoutSeconds": 900,
  "maxArchiveBytes": 17179869184,
  "maxDeliveryBytes": 51539607552
}
~~~

These are selection placeholders. Use the exact original host, source and
runtime paths before the first admitted execution. The archive values are
upper input allowances; the native job declaration must account for the
selected actual data volumes and working copies.

The two review profiles use the original
starforge.stac-qwc-review-profile.v1 schema in
../qwc-acceptance/OPERATIONS.md. Each has a distinct run_id and selects:

- GetCapabilities and GetProjectSettings for the selected native map,
  publication keyword, layers, CRS and layouts.
- GetMap with its actual layer names, CRS and wire-order extent, native size
  and image format.
- GetFeatureInfo with the actual queryable layer selection and query pixel.
  Through the QWC OGC proxy, LAYERS equals QUERY_LAYERS and INFO_FORMAT is
  text/xml.
- GetPrint with the actual native ComposerTemplate and ComposerMap extent
  fields and application/pdf output.
- The agreed role-specific permitted/denied layers and visible/protected
  feature fields.

The original acceptance adapter adds the exact publication keyword and
role-selected expected native layer names to its metadata checks. A complete
native workflow requires actual successful capabilities, a visible map and a
native PDF among the retained responses. Its review results remain attached to
the original bytes and selected roles.

## Run the one original complete operation

~~~sh
/absolute/existing/operator-python -B \
  /absolute/published-source/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/qwc/native-journey.py \
  --config /absolute/private/original-qwc-customer-config.json
~~~

Run that full command through the selected host's existing native job
controller. Declare the whole source, publisher and receiving output roots,
complete memory and disk/inode allowance, retained artifacts, and actual
process lifetime. Retain its original job record and foreground identity.

The script takes the original customer kernel flock. Native QGIS,
ConfigGenerator, reload, acceptance and browser children inherit that same
lease. The publisher's native worker also retains its original console and
workspace/host leases. The collector and browser phases run serially; the
existing host services keep their own original owners.

The command carries these phases end to end:

1. Retain the literal original config, complete host/request/review inputs,
   source inventory and actual executable identities.
2. Receive the original GIS archive, reopen the map through native QGIS,
   prepare the full publication review, generate native QWC output, publish
   its exact host files/pointer and perform the selected reload.
3. Call the independent original capture driver while that exact publication
   is selected. Retain every native response and publication/profile binding.
4. Repeat the original publication and native capture for the actual saved
   GIS refresh.
5. Restore the refreshed publication through its original host-file plan and
   reload, returning the host pointer to the first retained edition.
6. Run the original acceptance finish operation over the two retained
   captures. This operates its actual browser, map/PDF/feature comparison,
   original response import and independent portable receiving.
7. Open the publisher console. Inspect both exact editions and actual restored
   state, verify the files, export and download the complete refreshed
   publication, stream it back through the receiving UI, and reopen the
   relocated native project with QGIS.
8. Close that console and open the same complete receiving as a separate
   received-console instance. Verify its original archive identity and files,
   deliberately run a new native QGIS reopen, and inspect the responsive UI.
9. Export the complete first publication, freeze the final native member
   manifest, and publish the complete customer delivery ZIP.

The browser controller permits only the original local operator origin.
Existing viewer and OGC service work occurs through the publisher/acceptance
host routes selected in the original input. Both browser phases use the
existing Chromium executable.

## Resume after an observed interruption

Reconcile the actual original native job/foreground and its child state through
the existing host controller, then continue the same complete command, directory,
config and source. A missing tool response by itself is not a process exit.

The controlling config is retained before its dependent files. Resume reads
those exact copied host/request/review inputs, including when the external
delivery has moved. The complete source and selected executable identities
remain bound to that native operation.

Each publication, native capture, restoration, export and browser/receiving
stage retains its original IDs and results. Completed native captures are read
from the original acceptance journal without requesting another live service
edition. The script advances to the refresh only after the first native capture
is retained.

A new deliberate browser Verify or Reopen has a fresh inspection invocation.
The native reader retains that invocation under the received directory.
Continue same operation and an explicit CLI --invocation-id reuse its original
input and process/result record.

A failed browser or input/result write enters the same owned cleanup path.
The console connection stays present while native and HTTP work drains.
Repeated SIGINT/SIGTERM keep the same first cancellation and wait for the
owned children; the original native controller retains final process custody.

The final native report and delivery member manifest are retained before ZIP
publication. If the complete ZIP exists after a lost final receipt, the same
driver checks every original member and restores the receipt. Reopening a
completed delivery verifies its full archive identity.

## Complete original outputs

| Artifact | Complete content |
| --- | --- |
| QWC_First_Publication.zip | Original first GIS/project/source, QWC output, host selection and publication/deployment history |
| QWC_Refreshed_Publication.zip | Original refreshed source/project, complete generated files, exact host restoration history and portable receiving source |
| QWC_Complete_Native_Receiving.zip | Both original acceptance handovers, native service response/report and its actual browser/portable receiving artifacts |
| native-report.json | The exact two publication identities, captures, restore, both publication/received browser outcomes and complete export records |
| native-input.json | Original config/input/source/executable selection and declared receiving allowances |
| QWC_Complete_Customer_Delivery.zip | All three full handovers, native input/report, original selected profile/request/capture inputs, stage receipts and actual browser images |
| complete-delivery.json | Final complete customer archive path, size, SHA-256, manifest identity and original operation/workspace IDs |

The complete customer delivery is intended for the selected receiving operator.
It carries the original GIS and native service configuration source needed for
commissioning, maintenance and another-host receiving. The public product
source remains the maintained generic publisher, console and native driver.
